import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CollectionService } from './collection.service.js'
import { TrackerClient, TrackerError } from './tracker-client.js'

export const TRACKER_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
export interface TrackerSyncState {
  lastAttemptAt: string | null
  result: 'preview' | 'applied' | 'review' | 'error' | null
  error: string | null
  previewId: string | null
  automatic: boolean
}
const EMPTY: TrackerSyncState = { lastAttemptAt: null, result: null, error: null, previewId: null, automatic: false }

@Injectable()
export class TrackerSync implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null
  constructor(
    private readonly client: TrackerClient,
    private readonly collection: CollectionService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    if (this.env.isTest) return
    this.timer = setInterval(() => void this.tick().catch(() => this.logger.warn('tracker sync tick failed')), 60_000)
    this.timer.unref()
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async status() {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['trackerFriendId', 'trackerAutoSync', 'trackerSyncState', 'trackerLastAppliedAt'] } },
    })
    const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      friendId: typeof settings.trackerFriendId === 'string' ? settings.trackerFriendId : '',
      lastAppliedAt: typeof settings.trackerLastAppliedAt === 'string' ? settings.trackerLastAppliedAt : null,
      ...EMPTY,
      ...(settings.trackerSyncState as Partial<TrackerSyncState> | undefined),
      // `enabled` reports the current switch; `automatic` is the mode of the last request.
      enabled: settings.trackerAutoSync === true,
    }
  }

  async tick(now = new Date()) {
    const config = await this.status()
    if (!config.enabled || !/^\d{16}$/.test(config.friendId)) return null
    if (config.lastAttemptAt && now.getTime() - Date.parse(config.lastAttemptAt) < TRACKER_SYNC_INTERVAL_MS) return null
    return this.preview(true, now)
  }

  async preview(automatic = false, now = new Date()) {
    const lock = await this.prisma.pool.connect()
    let acquired = false
    try {
      acquired =
        (await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(994201) AS locked')).rows[0]?.locked ??
        false
      if (!acquired) {
        if (automatic) return null
        throw new ConflictException({
          code: 'tracker_busy',
          message: 'Ya hay una sincronización del tracker en curso.',
        })
      }
      const config = await this.status()
      if (
        automatic &&
        (!config.enabled ||
          (config.lastAttemptAt && now.getTime() - Date.parse(config.lastAttemptAt) < TRACKER_SYNC_INTERVAL_MS))
      )
        return null
      if (!/^\d{16}$/.test(config.friendId))
        throw new BadRequestException({
          code: 'tracker_friend_id',
          message: 'Guardá tu friend_id de 16 dígitos en los ajustes de la app.',
        })
      const state: TrackerSyncState = { ...EMPTY, lastAttemptAt: now.toISOString(), automatic }
      // Persist before the first request: a restart/failure must not cause another automatic fetch within 6 h.
      await this.write('trackerSyncState', state)
      try {
        const rows = await this.client.collection(config.friendId)
        const preview = await this.collection.createTrackerImport(rows, config.friendId)
        state.previewId = preview.id
        state.result = 'preview'
        const currentConfig = await this.status()
        if (automatic && currentConfig.enabled && currentConfig.friendId === config.friendId) {
          if (preview.tracker?.requiresReview) {
            state.result = 'review'
            state.error = `Bajan ${preview.tracker.removedCopies} de ${preview.tracker.currentCopies} copias (más del 10 %). Revisá la vista previa antes de aplicar.`
            await this.write('trackerSyncWarning', {
              at: state.lastAttemptAt,
              message: state.error,
              previewId: preview.id,
            })
          } else {
            await this.collection.applyImport(preview.id, true)
            // Applied status, timestamp and cleared warning commit atomically with the collection.
            return preview
          }
        }
        await this.write('trackerSyncState', state)
        return preview
      } catch (error) {
        const message =
          error instanceof TrackerError
            ? error.message
            : error instanceof ConflictException
              ? error.message
              : 'No se pudo sincronizar la colección del tracker. Podés importar el CSV.'
        state.result = 'error'
        state.error = message
        await this.write('trackerSyncState', state)
        await this.write('trackerSyncWarning', { at: state.lastAttemptAt, message, previewId: state.previewId })
        if (automatic) return null
        if (error instanceof ConflictException) throw error
        throw new ServiceUnavailableException({
          code: error instanceof TrackerError ? error.code : 'tracker_data',
          message,
        })
      }
    } finally {
      if (acquired) await lock.query('SELECT pg_advisory_unlock(994201)').catch(() => undefined)
      lock.release()
    }
  }

  async apply(id: string) {
    const lock = await this.prisma.pool.connect()
    let acquired = false
    try {
      acquired =
        (await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(994201) AS locked')).rows[0]?.locked ??
        false
      if (!acquired)
        throw new ConflictException({
          code: 'tracker_busy',
          message: 'Ya hay una sincronización del tracker en curso.',
        })
      const preview = await this.collection.importPreview(id)
      if (preview.source !== 'tracker')
        throw new BadRequestException({ code: 'tracker_preview', message: 'Elegí una vista previa del tracker.' })
      return await this.collection.applyImport(id)
    } finally {
      if (acquired) await lock.query('SELECT pg_advisory_unlock(994201)').catch(() => undefined)
      lock.release()
    }
  }

  private async write(key: string, value: unknown) {
    const json = JSON.parse(JSON.stringify(value))
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
  }
}
