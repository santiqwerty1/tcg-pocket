/**
 * The collection from the game through ptcgpocket.gg (T-020). Santi pastes the «Permanent export link»; «Sincronizar
 * ahora» reads it and leaves the same preview as a CSV or the tracker (nothing changes until it is applied), and the
 * automatic sync (off by default) reads it once a day and applies by itself only what needs no look. With the link
 * configured this is the source of the collection: the tracker's sync stops writing it and is only compared
 * («Tracker al día»).
 *
 * The link is a secret: it lives sealed in `app_secrets` (DotggLinkStore) and no status, error, log line or alert
 * carries it — every message goes through `redactDotggLink` before it is stored, logged or answered.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common'
import { parseDotggCsv, parseDotggExportLink, redactDotggLink } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CollectionService, REMOTE_KEYS } from './collection.service.js'
import { DotggClient, DotggError } from './dotgg-client.js'
import { DOTGG_LINK_KEY, DotggLinkStore } from './dotgg-link.store.js'

export const DOTGG_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Held while a ptcgpocket.gg read or apply is under way (the tracker's is 994201; collection writes take 994202). */
const SYNC_LOCK = 994203
const KEYS = REMOTE_KEYS.dotgg

export interface DotggSyncState {
  lastAttemptAt: string | null
  result: 'preview' | 'applied' | 'unchanged' | 'review' | 'error' | null
  error: string | null
  previewId: string | null
  automatic: boolean
}

export interface DotggStatus extends DotggSyncState {
  /** A readable link is stored: ptcgpocket.gg is the source of the collection. */
  configured: boolean
  /** `…/exportcollection?…token=••••abcd`, never the link. */
  link: string | null
  /** A link is stored but cannot be opened (SESSION_SECRET changed): paste it again. */
  unreadable: boolean
  /** The automatic switch. */
  enabled: boolean
  lastAppliedAt: string | null
  lastCheckedAt: string | null
}

const EMPTY: DotggSyncState = { lastAttemptAt: null, result: null, error: null, previewId: null, automatic: false }
const NOT_CONFIGURED = 'Pegá el link de exportación de ptcgpocket.gg en Más → Ajustes de la app.'
const UNREADABLE =
  'El link de ptcgpocket.gg guardado no se puede leer (cambió la clave del servidor): pegalo de nuevo en Más → Ajustes de la app.'

@Injectable()
export class DotggSync implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly client: DotggClient,
    private readonly links: DotggLinkStore,
    private readonly collection: CollectionService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(DotggSync.name)
  }

  onApplicationBootstrap() {
    // A CLI shares the database with the API that is running: this is the server's start-up work, not its own.
    if (this.env.cli || this.env.isTest) return
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          this.logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'dotgg sync tick failed'),
        ),
      60_000,
    )
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async status(): Promise<DotggStatus> {
    const [rows, link] = await Promise.all([
      this.prisma.appSetting.findMany({
        where: { key: { in: [KEYS.auto, KEYS.state, KEYS.lastApplied, KEYS.lastChecked] } },
      }),
      this.links.state(),
    ])
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    const state = settings[KEYS.state]
    return {
      ...EMPTY,
      ...(state && typeof state === 'object' && !Array.isArray(state) ? (state as Partial<DotggSyncState>) : {}),
      configured: link.link !== null,
      link: link.masked,
      unreadable: link.unreadable,
      enabled: settings[KEYS.auto] === true,
      lastAppliedAt: typeof settings[KEYS.lastApplied] === 'string' ? (settings[KEYS.lastApplied] as string) : null,
      lastCheckedAt: typeof settings[KEYS.lastChecked] === 'string' ? (settings[KEYS.lastChecked] as string) : null,
    }
  }

  /**
   * Saves the link (checked, sealed). From then on ptcgpocket.gg is the source: pending tracker previews are discarded
   * and the tracker's warning goes; a different link also discards the pending ptcgpocket.gg preview it did not read.
   */
  async setLink(text: string): Promise<DotggStatus> {
    const check = parseDotggExportLink(text)
    if (!check.ok) throw new BadRequestException({ code: 'dotgg_link', message: check.message })
    const sealed = this.links.seal(check.url)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      const before = await this.links.read(tx)
      await tx.appSecret.upsert({
        where: { key: DOTGG_LINK_KEY },
        create: { key: DOTGG_LINK_KEY, value: sealed },
        update: { value: sealed },
      })
      await tx.collectionImport.updateMany({
        where: { status: 'pending', source: before === check.url ? 'tracker' : { in: ['tracker', 'dotgg'] } },
        data: { status: 'discarded' },
      })
      await tx.appSetting.deleteMany({ where: { key: { in: ['trackerSyncWarning', KEYS.warning] } } })
    })
    return this.status()
  }

  /** Forgets the link: the tracker (if configured) is the source again. Pending ptcgpocket.gg previews are discarded. */
  async clearLink(): Promise<DotggStatus> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      await tx.appSecret.deleteMany({ where: { key: DOTGG_LINK_KEY } })
      await tx.collectionImport.updateMany({
        where: { status: 'pending', source: 'dotgg' },
        data: { status: 'discarded' },
      })
      await tx.appSetting.deleteMany({ where: { key: KEYS.warning } })
    })
    return this.status()
  }

  async tick(now = new Date()) {
    const config = await this.status()
    if (!config.enabled || (!config.configured && !config.unreadable)) return null
    if (config.lastAttemptAt && now.getTime() - Date.parse(config.lastAttemptAt) < DOTGG_SYNC_INTERVAL_MS) return null
    return this.preview(true, now)
  }

  async preview(automatic = false, now = new Date()) {
    const lock = await this.prisma.pool.connect()
    let acquired = false
    let link: string | null = null
    try {
      acquired =
        (await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [SYNC_LOCK])).rows[0]
          ?.locked ?? false
      if (!acquired) {
        if (automatic) return null
        throw new ConflictException({
          code: 'dotgg_busy',
          message: 'Ya hay una sincronización con ptcgpocket.gg en curso.',
        })
      }
      const config = await this.status()
      link = await this.links.read()
      const due = !config.lastAttemptAt || now.getTime() - Date.parse(config.lastAttemptAt) >= DOTGG_SYNC_INTERVAL_MS
      if (automatic && (!config.enabled || !due || (!link && !config.unreadable))) return null
      if (!link && config.unreadable) {
        // The stored link cannot be opened (SESSION_SECRET changed): said where Santi looks, never a silent stop.
        if (!automatic) throw new BadRequestException({ code: 'dotgg_unreadable', message: UNREADABLE })
        const failed: DotggSyncState = {
          ...EMPTY,
          lastAttemptAt: now.toISOString(),
          automatic,
          result: 'error',
          error: UNREADABLE,
        }
        await this.write(KEYS.state, failed)
        await this.warning(null, { at: failed.lastAttemptAt, message: UNREADABLE, previewId: null })
        return null
      }
      if (!link) throw new BadRequestException({ code: 'dotgg_not_configured', message: NOT_CONFIGURED })
      const fingerprint = this.links.fingerprint(link)
      const state: DotggSyncState = { ...EMPTY, lastAttemptAt: now.toISOString(), automatic }
      // Persist before the request: a restart or a failure must not cause another automatic read within 24 h.
      await this.write(KEYS.state, state)
      try {
        const bytes = await this.client.exportCsv(link)
        const parsed = parseDotggCsv(bytes)
        if (parsed.fatal) throw new DotggError('dotgg_format', parsed.errors[0]?.message ?? 'Respuesta inválida.')
        if (parsed.rows.length === 0 && parsed.errors.length === 0)
          throw new DotggError(
            'dotgg_empty',
            'ptcgpocket.gg devolvió la colección vacía: revisá que el link sea el de tu cuenta y que ptcgpocket.gg esté sincronizado con el juego. No se aplicó nada.',
          )
        const current = await this.status()
        const currentLink = await this.links.read()
        if (automatic && (!current.enabled || currentLink !== link)) return null
        const preview = await this.collection.createDotggImport(parsed, bytes, {
          automatic,
          checkedAt: now,
          linkFingerprint: fingerprint,
        })
        if ('unchanged' in preview) {
          state.result = preview.reviewReasons.length ? 'review' : 'unchanged'
          if (preview.reviewReasons.length) {
            state.error = preview.reviewReasons.join(' ')
            await this.warning(fingerprint, { at: state.lastAttemptAt, message: state.error, previewId: null })
          }
          await this.write(KEYS.state, state)
          return null
        }
        state.previewId = preview.id
        state.result = 'preview'
        if (automatic) {
          if (preview.blocked || preview.dotgg?.requiresReview) {
            state.result = 'review'
            state.error = `${preview.dotgg?.reviewReasons.join(' ') || 'La exportación tiene errores.'} Revisá la vista previa antes de aplicar.`
            await this.warning(fingerprint, { at: state.lastAttemptAt, message: state.error, previewId: preview.id })
          } else {
            await this.collection.applyImport(preview.id, true, fingerprint)
            // Applied status, timestamps and the cleared warning commit atomically with the collection.
            return preview
          }
        }
        await this.write(KEYS.state, state)
        return preview
      } catch (error) {
        const message = redactDotggLink(
          error instanceof DotggError || error instanceof ConflictException
            ? error.message
            : 'No se pudo sincronizar con ptcgpocket.gg.',
          link,
        )
        // Never the error object: a library error may quote the URL it was given.
        this.logger.warn(
          {
            code: error instanceof DotggError ? error.code : null,
            error: error instanceof Error ? error.name : 'unknown',
            message,
          },
          'dotgg collection sync failed',
        )
        state.result = state.previewId && error instanceof ConflictException ? 'review' : 'error'
        state.error = message
        await this.write(KEYS.state, state)
        if (automatic) {
          await this.warning(fingerprint, { at: state.lastAttemptAt, message, previewId: state.previewId })
          return null
        }
        // Our own conflicts (catalog changed, link removed meanwhile) never quote the link.
        if (error instanceof ConflictException) throw error
        throw new ServiceUnavailableException({
          code: error instanceof DotggError ? error.code : 'dotgg_failed',
          message,
        })
      }
    } finally {
      if (acquired) await lock.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK]).catch(() => undefined)
      lock.release()
    }
  }

  async apply(id: string) {
    const lock = await this.prisma.pool.connect()
    let acquired = false
    try {
      acquired =
        (await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [SYNC_LOCK])).rows[0]
          ?.locked ?? false
      if (!acquired)
        throw new ConflictException({
          code: 'dotgg_busy',
          message: 'Ya hay una sincronización con ptcgpocket.gg en curso.',
        })
      const preview = await this.collection.importPreview(id)
      if (preview.source !== 'dotgg')
        throw new BadRequestException({ code: 'dotgg_preview', message: 'Elegí una vista previa de ptcgpocket.gg.' })
      return await this.collection.applyImport(id)
    } finally {
      if (acquired) await lock.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK]).catch(() => undefined)
      lock.release()
    }
  }

  private async write(key: string, value: unknown) {
    const json = JSON.parse(JSON.stringify(value))
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
  }

  /**
   * The alert of an automatic run, only while the switch is on, the link is the one read (null: the stored link is
   * still unreadable) and its preview pending.
   */
  private async warning(
    fingerprint: string | null,
    value: { at: string | null; message: string; previewId: string | null },
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Serialize with turning the switch off, changing the link, applying or discarding the preview.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      const auto = await tx.appSetting.findUnique({ where: { key: KEYS.auto } })
      const stored = await this.links.state(tx)
      if (auto?.value !== true) return
      if (
        fingerprint === null ? !stored.unreadable : !stored.link || this.links.fingerprint(stored.link) !== fingerprint
      )
        return
      if (
        value.previewId &&
        !(await tx.collectionImport.findFirst({ where: { id: Number(value.previewId), status: 'pending' } }))
      )
        return
      const json = JSON.parse(JSON.stringify(value))
      await tx.appSetting.upsert({
        where: { key: KEYS.warning },
        create: { key: KEYS.warning, value: json },
        update: { value: json },
      })
    })
  }
}
