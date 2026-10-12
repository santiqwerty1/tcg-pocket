/**
 * Phase 42 (decided by the Coordinator on 09/10 and 11/10): no number mixes two ways of playing. A job is played whole
 * with one engine: one deckgym (`engine_rev`) and one games revision (`games_rev`, how engine-cli plays; fixed by the
 * job's first result, see WorkerQueueService.result). When that engine is gone, the job would wait forever, because
 * the queue gives its chunks only to workers with the same:
 * - at start-up, a job of another deckgym moves to the current one (ENGINE_REV changed at a deploy);
 * - every few minutes, a job fixed to a games revision that no worker has had for half an hour, while workers with a
 *   newer one are there, goes to the newest (all the workers updated themselves to a new engine-cli). An older one
 *   (a worker before 0.3.3) never makes a job move.
 * Either way, a job with nothing played just takes the new engine, and one with chunks played is played again whole,
 * with the same seeds. What the old engine played is not lost: its chunks (with their replays) move to a job of their
 * own, cancelled and named after the old engine, and the job keeps its number (others point to it: an optimize's
 * confirmation, the Laboratorio, the cache's copies) and says «rejugada entera» (`params.engineChange`, with the
 * history in `engineChanges`). A Laboratorio search is left as it is (its state depends on the rounds it played): an
 * alert says it waits for the old engine, and the Laboratorio decides (AlertsService). Games against the bot end in
 * LiveGamesService.
 */
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ChunkCacheService } from './chunk-cache.service.js'
import { EngineStatusService } from './snapshots.service.js'
import { WorkerQueueService } from './worker-queue.service.js'

/** A games revision nobody has had for this long, while workers with another one are there, is gone. */
export const GAMES_REV_GONE_MS = 30 * 60 * 1000
/** How often the queue looks for jobs fixed to a games revision that is gone. */
const SWEEP_MS = 5 * 60 * 1000

/** What a job keeps in `params.engineChange` after it moved to another engine. */
export interface EngineChange {
  from: string
  to: string
  /** A new games revision of the same deckgym: from and to. */
  gamesFrom?: number
  gamesTo?: number
  at: string
  /** True: it had played chunks and was played again whole (once true, it stays: the job was replayed). */
  replayed: boolean
  /** The cancelled job that kept what the old engine played. */
  oldResults?: number
}

export function engineChangeOf(params: Prisma.JsonValue): EngineChange | null {
  const value = (params as { engineChange?: unknown } | null)?.engineChange
  return value && typeof value === 'object' ? (value as EngineChange) : null
}

export interface EngineChangeView {
  from: string
  at: string
  replayed: boolean
  gamesFrom: number | null
  gamesTo: number | null
  oldResults: number | null
}

/** What a job's view says about it (`JobSummaryView.engineChange`). */
export function engineChangeView(params: Prisma.JsonValue): EngineChangeView | null {
  const change = engineChangeOf(params)
  return change
    ? {
        from: change.from,
        at: change.at,
        replayed: change.replayed,
        gamesFrom: change.gamesFrom ?? null,
        gamesTo: change.gamesTo ?? null,
        oldResults: change.oldResults ?? null,
      }
    : null
}

@Injectable()
export class EngineChangeService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineStatusService,
    private readonly queue: WorkerQueueService,
    private readonly cache: ChunkCacheService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EngineChangeService.name)
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.moveJobs().catch((error: unknown) => {
      this.logger.error({ error: String(error).slice(0, 300) }, 'jobs not moved to the new engine')
    })
    this.timer = setInterval(() => {
      void this.releaseGoneGamesRevs().catch((error: unknown) => {
        this.logger.warn({ error: String(error).slice(0, 300) }, 'games revisions not swept')
      })
    }, SWEEP_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Moves the queued and running jobs of another deckgym to the current one. */
  async moveJobs(): Promise<{ moved: number[]; replayed: number[] }> {
    const to = this.engine.engineRev()
    const jobs = await this.prisma.simulationJob.findMany({
      where: { status: { in: ['queued', 'running'] }, engineRev: { not: to }, kind: { not: 'explore' } },
      select: { id: true, engineRev: true, kind: true },
    })
    return this.replayAll(jobs, (job) => ({ from: job.engineRev, to }))
  }

  /**
   * Moves the jobs fixed to a games revision no worker has had for half an hour, while workers with the job's deckgym
   * and a newer revision are there, to the newest. With no worker at all nothing changes: the PC is just off.
   */
  async releaseGoneGamesRevs(now = Date.now()): Promise<{ moved: number[]; replayed: number[] }> {
    const since = new Date(now - GAMES_REV_GONE_MS)
    const jobs = await this.prisma.$queryRaw<{ id: number; engineRev: string; kind: string; gamesRev: number }[]>`
      SELECT j."id", j."engine_rev" AS "engineRev", j."kind", j."games_rev" AS "gamesRev"
      FROM "simulation_jobs" j
      WHERE j."status" IN ('queued', 'running') AND j."kind" <> 'explore' AND j."games_rev" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "worker_nodes" w
          WHERE w."engine_rev" = j."engine_rev" AND w."games_rev" = j."games_rev" AND w."last_seen_at" > ${since})
        AND EXISTS (
          SELECT 1 FROM "worker_nodes" w
          WHERE w."engine_rev" = j."engine_rev" AND w."games_rev" > j."games_rev" AND w."last_seen_at" > ${since})`
    if (jobs.length === 0) return { moved: [], replayed: [] }
    const revs = await this.prisma.$queryRaw<{ engineRev: string; gamesRev: number }[]>`
      SELECT DISTINCT ON (w."engine_rev") w."engine_rev" AS "engineRev", w."games_rev" AS "gamesRev"
      FROM "worker_nodes" w WHERE w."last_seen_at" > ${since} AND w."games_rev" IS NOT NULL
      ORDER BY w."engine_rev", w."games_rev" DESC`
    const newest = new Map(revs.map((row) => [row.engineRev, row.gamesRev]))
    return this.replayAll(jobs, (job) => ({
      from: job.engineRev,
      to: job.engineRev,
      gamesFrom: job.gamesRev,
      gamesTo: newest.get(job.engineRev) ?? 0,
    }))
  }

  private async replayAll<T extends { id: number; engineRev: string; kind: string }>(
    jobs: readonly T[],
    target: (job: T) => Omit<EngineChange, 'at' | 'replayed'>,
  ): Promise<{ moved: number[]; replayed: number[] }> {
    const moved: number[] = []
    const replayed: number[] = []
    for (const job of jobs) {
      const to = target(job)
      const change = await this.replayWhole(job.id, to)
      // Ended or cancelled meanwhile: nothing to move.
      if (!change) continue
      ;(change.oldResults === undefined ? moved : replayed).push(job.id)
      this.logger.warn({ job: job.id, ...change }, 'job moved to the engine there is now')
      // A new deckgym can take what other jobs played with it. After a new games revision, nothing: the copies would
      // come from the revision just left (review of #68), and the cache takes only the one the workers have.
      if ((job.kind === 'matrix' || job.kind === 'compare') && to.gamesFrom === undefined) await this.cache.fill(job.id)
    }
    if (jobs.length > 0) this.queue.notifyQueued()
    return { moved, replayed }
  }

  /**
   * One job to another engine: what it played goes to a cancelled job of its own (chunks and replays, their ids
   * unchanged so the cache's copies still point to them), and the job gets fresh chunks with the same seeds and its new
   * engine: a new deckgym with no games revision (the first result fixes it), or the new games revision, fixed (a late
   * result of the old one is turned down: WorkerQueueService.result). The job's row is locked and checked again: a job
   * that ended or was cancelled meanwhile is left as it is (null).
   */
  private async replayWhole(
    jobId: number,
    target: Omit<EngineChange, 'at' | 'replayed'>,
  ): Promise<EngineChange | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "simulation_jobs" WHERE "id" = ${jobId} AND "status" IN ('queued', 'running') FOR UPDATE`
      if (locked.length === 0) return null
      const current = await tx.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
      const played = await tx.simulationChunk.findMany({
        where: { jobId, status: { in: ['done', 'failed'] } },
        select: { id: true, idx: true, snapshotAId: true, snapshotBId: true, games: true, firstGame: true, seed: true },
      })
      const before = engineChangeOf(current.params)
      const change: EngineChange = {
        ...target,
        at: new Date().toISOString(),
        replayed: played.length > 0 || before?.replayed === true,
        ...(before?.oldResults === undefined ? {} : { oldResults: before.oldResults }),
      }
      if (played.length > 0) {
        const what =
          target.gamesFrom === undefined ? `motor ${target.from.slice(0, 7)}` : `revisión ${target.gamesFrom}`
        const kept = await tx.simulationJob.create({
          data: {
            kind: current.kind,
            status: 'cancelled',
            label: `${current.label} (${what})`,
            // Its own params, without the job's moves (they are the job's, not what it kept).
            params: {
              ...Object.fromEntries(
                Object.entries(current.params as Prisma.JsonObject).filter(
                  ([key]) => key !== 'engineChange' && key !== 'engineChanges',
                ),
              ),
              replacedBy: current.id,
            } as Prisma.InputJsonValue,
            engineRev: current.engineRev,
            gamesRev: current.gamesRev,
            players: current.players,
            gamesPerPair: current.gamesPerPair,
            baseSeed: current.baseSeed,
            cores: current.cores,
            replaySample: current.replaySample,
            totalGames: played.reduce((sum, chunk) => sum + chunk.games, 0),
            startedAt: current.startedAt,
            finishedAt: new Date(),
            error: `Lo jugado con el ${what}: la simulación #${current.id} se volvió a jugar entera con el motor que hay ahora.`,
          },
        })
        change.oldResults = kept.id
        await tx.simulationChunk.updateMany({
          where: { id: { in: played.map((chunk) => chunk.id) } },
          data: { jobId: kept.id },
        })
        await tx.simulationChunk.createMany({
          data: played.map((chunk) => ({
            jobId,
            idx: chunk.idx,
            snapshotAId: chunk.snapshotAId,
            snapshotBId: chunk.snapshotBId,
            games: chunk.games,
            firstGame: chunk.firstGame,
            seed: chunk.seed,
          })),
        })
      }
      // Every chunk left back to the queue, from scratch: a lease held by a worker of the old engine is dropped (it is
      // told «lost» at its next heartbeat, and its result is turned down: WorkerQueueService.result), and the replays
      // it uploaded before its result go too.
      await tx.simulationReplay.deleteMany({ where: { chunk: { jobId, status: { in: ['queued', 'leased'] } } } })
      await tx.simulationChunk.updateMany({
        where: { jobId, status: { not: 'cancelled' } },
        data: {
          status: 'queued',
          leaseUntil: null,
          workerId: null,
          attempt: 0,
          // Returns of a lost result (worker 0.3.4) start over too: they were of the other engine.
          returns: 0,
          returnedBy: [],
          // A copy of the old engine goes too (review of #73).
          copyWorker: null,
          copyUntil: null,
          copySince: null,
          gamesDone: 0,
          error: null,
        },
      })
      const history = [...((current.params as { engineChanges?: EngineChange[] }).engineChanges ?? []), change]
      await tx.$executeRaw`
        UPDATE "simulation_jobs" SET "engine_rev" = ${target.to}, "games_rev" = ${target.gamesTo ?? null}::int,
          "status" = 'queued',
          "started_at" = NULL,
          "params" = jsonb_set(jsonb_set("params", '{engineChange}', ${JSON.stringify(change)}::jsonb),
            '{engineChanges}', ${JSON.stringify(history)}::jsonb)
        WHERE "id" = ${jobId}`
      return change
    })
  }
}
