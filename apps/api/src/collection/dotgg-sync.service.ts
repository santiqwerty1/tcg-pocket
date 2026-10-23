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
import { ADVISORY_LOCKS } from '../prisma/advisory-locks.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CollectionService, REMOTE_KEYS } from './collection.service.js'
import { DotggClient, DotggError } from './dotgg-client.js'
import { DOTGG_LINK_KEY, DotggLinkStore } from './dotgg-link.store.js'
import { type SourceSnapshot, SourceSnapshots } from './source-snapshot.js'

export const DOTGG_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Held while a ptcgpocket.gg read or apply is under way (every key: prisma/advisory-locks.ts). */
const SYNC_LOCK = ADVISORY_LOCKS.dotggSync
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
    private readonly snapshots: SourceSnapshots,
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
   * and the tracker's warning goes. Another link (or one pasted again after removing it) starts over: its pending
   * preview, its state, its alert and its last applied and checked syncs belong to the old link and go too. The same link keeps
   * them (a pending review stays in Avisos).
   */
  async setLink(text: string): Promise<DotggStatus> {
    const check = parseDotggExportLink(text)
    if (!check.ok) throw new BadRequestException({ code: 'dotgg_link', message: check.message })
    const sealed = this.links.seal(check.url)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      const same = (await this.links.read(tx)) === check.url
      await tx.appSecret.upsert({
        where: { key: DOTGG_LINK_KEY },
        create: { key: DOTGG_LINK_KEY, value: sealed },
        update: { value: sealed },
      })
      await tx.collectionImport.updateMany({
        where: { status: 'pending', source: same ? 'tracker' : { in: ['tracker', 'dotgg'] } },
        data: { status: 'discarded' },
      })
      await tx.appSetting.deleteMany({ where: { key: 'trackerSyncWarning' } })
      if (!same)
        await tx.appSetting.deleteMany({
          where: { key: { in: [KEYS.warning, KEYS.state, KEYS.lastApplied, KEYS.lastChecked] } },
        })
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
    // An unreadable link is told with the alert even with the daily sync off: the tracker stays paused meanwhile.
    if (config.unreadable) {
      await this.warnUnreadable(now)
      return null
    }
    if (!config.enabled || !config.configured) return null
    if (config.lastAttemptAt && now.getTime() - Date.parse(config.lastAttemptAt) < DOTGG_SYNC_INTERVAL_MS) return null
    return this.preview(true, now)
  }

  /**
   * Reads the export and leaves the preview. Everything it writes afterwards — the import (checked in its transaction),
   * the state, the alert — is written only while the link is still the one of the snapshot taken at the start.
   */
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
      const snapshot = await this.snapshots.take()
      link = snapshot.link
      const due = !config.lastAttemptAt || now.getTime() - Date.parse(config.lastAttemptAt) >= DOTGG_SYNC_INTERVAL_MS
      if (automatic && (!config.enabled || !due || (!link && !snapshot.unreadable))) return null
      if (!link && snapshot.unreadable) {
        // The stored link cannot be opened (SESSION_SECRET changed): said where Santi looks, never a silent stop.
        if (!automatic) throw new BadRequestException({ code: 'dotgg_unreadable', message: UNREADABLE })
        await this.warnUnreadable(now)
        return null
      }
      if (!link || !snapshot.linkId)
        throw new BadRequestException({ code: 'dotgg_not_configured', message: NOT_CONFIGURED })
      const fingerprint = snapshot.linkId
      const state: DotggSyncState = { ...EMPTY, lastAttemptAt: now.toISOString(), automatic }
      // Persist before the request: a restart or a failure must not cause another automatic read within 24 h.
      await this.writeState(snapshot, state)
      try {
        const bytes = await this.client.exportCsv(link)
        const parsed = parseDotggCsv(bytes)
        if (parsed.fatal) throw new DotggError('dotgg_format', parsed.errors[0]?.message ?? 'Respuesta inválida.')
        if (parsed.rows.length === 0 && parsed.errors.length === 0)
          throw new DotggError(
            'dotgg_empty',
            'ptcgpocket.gg devolvió la colección vacía: revisá que el link sea el de tu cuenta y que ptcgpocket.gg esté sincronizado con el juego. No se aplicó nada.',
          )
        if (automatic) {
          const current = await this.status()
          const changed = this.snapshots.changes(snapshot, await this.snapshots.take(), ['link'])
          if (!current.enabled || changed.length > 0) return null
        }
        const preview = await this.collection.createDotggImport(parsed, bytes, {
          automatic,
          checkedAt: now,
          linkFingerprint: fingerprint,
        })
        if ('unchanged' in preview) {
          state.result = preview.reviewReasons.length ? 'review' : 'unchanged'
          if (preview.reviewReasons.length) {
            state.error = preview.reviewReasons.join(' ')
            await this.warning(snapshot, { at: state.lastAttemptAt, message: state.error, previewId: null })
          }
          await this.writeState(snapshot, state)
          return null
        }
        state.previewId = preview.id
        state.result = 'preview'
        if (automatic) {
          if (preview.blocked || preview.dotgg?.requiresReview) {
            state.result = 'review'
            state.error = `${preview.dotgg?.reviewReasons.join(' ') || 'La exportación tiene errores.'} Revisá la vista previa antes de aplicar.`
            await this.warning(snapshot, { at: state.lastAttemptAt, message: state.error, previewId: preview.id })
          } else {
            await this.collection.applyImport(preview.id, true)
            // Applied status, timestamps and the cleared warning commit atomically with the collection.
            return preview
          }
        }
        await this.writeState(snapshot, state)
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
        // A failure of the old link is not the new link's state (the link may have changed while reading).
        await this.writeState(snapshot, state)
        if (automatic) {
          await this.warning(snapshot, { at: state.lastAttemptAt, message, previewId: state.previewId })
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

  /**
   * Applies a stored preview. Its own snapshot is the one stored with it (the link's fingerprint and the baseline,
   * catalog included), and `applyImport` compares them with the present under the collection's locks.
   */
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

  /** The sync's state, only while the link is still the snapshot's (otherwise it is another link's, and dropped). */
  private async writeState(snapshot: SourceSnapshot, state: DotggSyncState) {
    const json = JSON.parse(JSON.stringify(state))
    await this.snapshots.whileSame(snapshot, ['link'], (tx) =>
      tx.appSetting.upsert({
        where: { key: KEYS.state },
        create: { key: KEYS.state, value: json },
        update: { value: json },
      }),
    )
  }

  /** The alert for a stored link that cannot be opened, written once (pasting or removing the link takes it away). */
  private async warnUnreadable(now: Date) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      if (!(await this.links.state(tx)).unreadable) return
      const current = await tx.appSetting.findUnique({ where: { key: KEYS.warning } })
      if ((current?.value as { message?: unknown } | null | undefined)?.message === UNREADABLE) return
      const value = { at: now.toISOString(), message: UNREADABLE, previewId: null }
      await tx.appSetting.upsert({
        where: { key: KEYS.warning },
        create: { key: KEYS.warning, value },
        update: { value },
      })
    })
  }

  /**
   * The alert of an automatic run, only while the link is still the snapshot's, the switch is on and its preview
   * pending (in one transaction with turning the switch off, changing the link, applying or discarding the preview).
   */
  private async warning(
    snapshot: SourceSnapshot,
    value: { at: string | null; message: string; previewId: string | null },
  ) {
    const json = JSON.parse(JSON.stringify(value))
    await this.snapshots.whileSame(snapshot, ['link'], async (tx) => {
      const auto = await tx.appSetting.findUnique({ where: { key: KEYS.auto } })
      if (auto?.value !== true) return
      if (
        value.previewId &&
        !(await tx.collectionImport.findFirst({ where: { id: Number(value.previewId), status: 'pending' } }))
      )
        return
      await tx.appSetting.upsert({
        where: { key: KEYS.warning },
        create: { key: KEYS.warning, value: json },
        update: { value: json },
      })
    })
  }
}
