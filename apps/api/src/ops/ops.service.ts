/**
 * Operación (Fase 38, R-011, R-008, R-006): how the server itself is doing, in one place. What runs on its own
 * (the daily backup, the Limitless sync, the catalog, the GitHub checks, the workers) and what it costs (memory,
 * database size). `/api/ops/status` and the `system_status` tool show it; `AlertsService` turns the bad parts into
 * Avisos, which reach the phone like every other alert.
 */
import { getHeapStatistics } from 'node:v8'
import { Inject, Injectable } from '@nestjs/common'
import { OffsiteBackupService, type OffsiteCheck, type OffsiteResult } from '../backup/offsite.service.js'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineUpstreamService, type UpstreamFailure } from '../simulation/engine-upstream.service.js'
import { TournamentSyncService } from '../tournaments/tournament-sync.service.js'
import { type RetentionResult, RetentionService } from './retention.service.js'

/** Supabase Free's database limit (R-006). */
export const DATABASE_LIMIT_MB = 500
/** Avisos from this size on: room for a few months of tournaments before the limit. */
export const DATABASE_ALERT_MB = 350
/** The alert's title moves in steps of this size (one push per step). */
export const DATABASE_ALERT_STEP_MB = 50
/** The daily copy runs at 04:00: more than this without one is a missed day (plus a margin). */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000
/** The Limitless sync runs every 6 hours: more than this without a good run is two missed runs. */
export const LIMITLESS_STALE_MS = 13 * 60 * 60 * 1000
/** A worker seen this recently is online (as in Simulación). */
const WORKER_ONLINE_MS = 2 * 60 * 1000
/** `app_settings` key of the last failed daily copy (BackupCronService). */
export const BACKUP_FAILURE_KEY = 'backupFailure'

const MB = 1024 * 1024
const mb = (bytes: number) => Math.round((bytes / MB) * 10) / 10

export interface OpsStatusView {
  version: string
  startedAt: string
  uptimeSeconds: number
  /** Megabytes; `heapLimitMb` is V8's ceiling (`--max-old-space-size`). */
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; heapLimitMb: number; externalMb: number }
  database: { sizeMb: number | null; alertMb: number; limitMb: number }
  backup: {
    enabled: boolean
    last: { at: string; sizeKb: number } | null
    copies: number
    /** The last failed daily copy, when it is newer than the last good one. */
    failure: { at: string; error: string } | null
    drill: { at: string; ok: boolean } | null
    /** Fase 39: the copy outside Supabase (the bucket). */
    offsite: { enabled: boolean; last: OffsiteResult | null; check: OffsiteCheck | null }
  }
  /** Fase 39: the last cleanup of old replays and raw standings. */
  retention: RetentionResult | null
  limitless: {
    enabled: boolean
    running: boolean
    last: { status: string; startedAt: string; finishedAt: string | null; error: string | null } | null
    lastDoneAt: string | null
  }
  catalog: {
    trackerCommit: string | null
    engineRev: string | null
    lastSync: { status: string; fetchedAt: string; error: string | null } | null
    /** The sync in memory and the last one applied: different after a `catalog-sync.js` CLI, until the API loads it. */
    loadedSyncId: number | null
    latestAppliedSyncId: number | null
  }
  github: { token: boolean; engineCheck: UpstreamFailure | null; trackerCheck: UpstreamFailure | null }
  workers: {
    lastSeenAt: string | null
    online: { name: string; version: string | null; cores: number; lastSeenAt: string }[]
  }
  queue: { chunks: number; liveGames: number }
}

@Injectable()
export class OpsService {
  private readonly startedAt = new Date()
  /** Set by AlertsModule (the tracker check lives there). */
  trackerFailure: () => UpstreamFailure | null = () => null

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly engineUpstream: EngineUpstreamService,
    private readonly sync: TournamentSyncService,
    private readonly offsite: OffsiteBackupService,
    private readonly retention: RetentionService,
  ) {}

  /** `pg_database_size` in bytes; null when the database does not say (or does not answer). */
  async databaseBytes(): Promise<number | null> {
    try {
      const [row] = await this.prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`
      return row ? Number(row.size) : null
    } catch {
      return null
    }
  }

  async backup(): Promise<OpsStatusView['backup']> {
    const [last, copies, failure, drill, offsite, check] = await Promise.all([
      this.prisma.backupBlob.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, sizeBytes: true },
      }),
      this.prisma.backupBlob.count(),
      this.prisma.appSetting.findUnique({ where: { key: BACKUP_FAILURE_KEY } }),
      this.prisma.appSetting.findUnique({ where: { key: 'backupDrill' } }),
      this.offsite.last(),
      this.offsite.lastCheck(),
    ])
    const failed = failure?.value as { at?: string; error?: string } | undefined
    const tried = drill?.value as { at?: string; ok?: boolean } | undefined
    return {
      enabled: this.env.backupCron,
      last: last ? { at: last.createdAt.toISOString(), sizeKb: Math.round(last.sizeBytes / 1024) } : null,
      copies,
      failure:
        failed?.at && (!last || new Date(failed.at) > last.createdAt)
          ? { at: failed.at, error: failed.error ?? 'error desconocido' }
          : null,
      drill: tried?.at ? { at: tried.at, ok: tried.ok !== false } : null,
      offsite: { enabled: this.offsite.enabled(), last: offsite, check },
    }
  }

  async limitless(): Promise<OpsStatusView['limitless']> {
    const [last, done] = await Promise.all([
      this.prisma.limitlessSyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      this.prisma.limitlessSyncRun.findFirst({
        where: { status: 'done' },
        orderBy: { startedAt: 'desc' },
        select: { finishedAt: true },
      }),
    ])
    return {
      enabled: this.env.limitlessSync,
      running: this.sync.isRunning(),
      last: last
        ? {
            status: last.status,
            startedAt: last.startedAt.toISOString(),
            finishedAt: last.finishedAt?.toISOString() ?? null,
            error: last.error,
          }
        : null,
      lastDoneAt: done?.finishedAt?.toISOString() ?? null,
    }
  }

  async catalogSync(): Promise<OpsStatusView['catalog']> {
    const [last, memory] = await Promise.all([
      this.prisma.catalogSync.findFirst({
        orderBy: { id: 'desc' },
        select: { status: true, fetchedAt: true, error: true },
      }),
      this.catalog.memoryState(),
    ])
    return {
      trackerCommit: this.catalog.trackerCommit,
      engineRev: this.catalog.engineRev,
      lastSync: last ? { status: last.status, fetchedAt: last.fetchedAt.toISOString(), error: last.error } : null,
      loadedSyncId: memory.loaded?.id ?? null,
      latestAppliedSyncId: memory.latest?.id ?? null,
    }
  }

  async status(): Promise<OpsStatusView> {
    const now = Date.now()
    const memory = process.memoryUsage()
    const [databaseBytes, backup, limitless, catalog, workers, chunks, liveGames, retention] = await Promise.all([
      this.databaseBytes(),
      this.backup(),
      this.limitless(),
      this.catalogSync(),
      this.prisma.workerNode.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 20 }),
      this.prisma.simulationChunk.count({
        where: { status: 'queued', job: { status: { in: ['queued', 'running'] } } },
      }),
      this.prisma.liveGame.count({ where: { status: 'queued' } }),
      this.retention.last(),
    ])
    return {
      version: this.env.version,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: mb(memory.rss),
        heapUsedMb: mb(memory.heapUsed),
        heapTotalMb: mb(memory.heapTotal),
        heapLimitMb: mb(getHeapStatistics().heap_size_limit),
        externalMb: mb(memory.external),
      },
      database: {
        sizeMb: databaseBytes === null ? null : mb(databaseBytes),
        alertMb: DATABASE_ALERT_MB,
        limitMb: DATABASE_LIMIT_MB,
      },
      backup,
      limitless,
      catalog,
      github: {
        token: this.env.githubToken !== null,
        engineCheck: this.engineUpstream.lastFailure,
        trackerCheck: this.trackerFailure(),
      },
      workers: {
        lastSeenAt: workers[0]?.lastSeenAt.toISOString() ?? null,
        online: workers
          .filter((worker) => now - worker.lastSeenAt.getTime() < WORKER_ONLINE_MS)
          .map((worker) => ({
            name: worker.name,
            version: worker.version,
            cores: worker.cores,
            lastSeenAt: worker.lastSeenAt.toISOString(),
          })),
      },
      queue: { chunks, liveGames },
      retention,
    }
  }
}
