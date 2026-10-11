/**
 * The exact cache of chunks (phase 42, decided by the Coordinator on 09/10): a chunk that would play exactly what a
 * finished one played takes its result instead of going to a worker. Exactly: the same lists on each side (snapshot
 * key, the hash of the text the engine reads), the same bots, the same engine (deckgym rev and engine-cli version),
 * the same seed, the same first game and the same number of games. The game i of a chunk plays with
 * `gameSeed(seed, i)`, so such a chunk would give the same result; and the job can still be played again from its seed.
 *
 * Only pairings of matrices and comparisons: an optimize or a consistency job reads more than the lists (candidates,
 * key cards), and a Laboratorio search seeds every round apart. A copied chunk says where its result came from
 * (`cachedFrom`: one a worker played, when there is one) and is left out of what adds results across jobs (the decks'
 * «simulación» column), so that no game counts twice.
 */
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkerQueueService } from './worker-queue.service.js'

/**
 * Which engine would play the chunk: the one that played the results of the job's deckgym in this window, as engine-cli
 * said it (version and build fingerprint, «0.3.4+<build>»). With two among them, which one plays is not known, and
 * nothing is copied.
 */
export const CACHE_RECENT_RESULTS_MS = 24 * 60 * 60 * 1000
/** «0.3.4+<16 hex>»: an engine that named its build. Anything else in `cli_version` is kept, but never copied. */
const EXACT_ENGINE = String.raw`^[0-9]+\.[0-9]+\.[0-9]+\+[0-9a-f]{16}$`
/** The copy is one statement; past this it is given up (the cache is optional: the chunks are just played). */
const FILL_TIMEOUT_MS = 15_000

@Injectable()
export class ChunkCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WorkerQueueService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ChunkCacheService.name)
  }

  /**
   * Fills the queued chunks of `jobId` that a finished chunk already played, and settles the job if nothing is left.
   * The replays are not copied: the job's page reads them from the chunk each copy came from (`cachedFrom`), which
   * has to keep the ones the job asks for. Never throws: a copy that fails leaves the chunks to the workers.
   */
  async fill(jobId: number): Promise<number> {
    const since = new Date(Date.now() - CACHE_RECENT_RESULTS_MS)
    let filled = 0
    try {
      filled = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${FILL_TIMEOUT_MS}`)
          const rows = await tx.$queryRaw<{ id: number }[]>`
            WITH job AS (
              SELECT "id", "kind", "players", "engine_rev", "replay_sample",
                COALESCE("params"->>'perGame' = 'true', false) AS per_game
              FROM "simulation_jobs" WHERE "id" = ${jobId}
            ), cli AS (
              SELECT DISTINCT r."cli_version" AS version FROM "simulation_chunks" r, job
              -- Only results that name their build («<version>+<build>», engine-cli 0.3.4 on): a version alone is not exact.
              WHERE r."status" = 'done' AND r."cached_from_id" IS NULL AND r."cli_version" ~ ${EXACT_ENGINE}
                AND r."engine_rev" = job."engine_rev" AND r."finished_at" > ${since}
            ), target AS (
              SELECT t."id", t."seed", t."games", t."first_game", a."key" AS key_a, b."key" AS key_b,
                CASE WHEN t."first_game" = 0 THEN job."replay_sample" ELSE 0 END AS replays
              FROM "simulation_chunks" t
              JOIN job ON job."id" = t."job_id"
              JOIN "deck_snapshots" a ON a."id" = t."snapshot_a_id"
              JOIN "deck_snapshots" b ON b."id" = t."snapshot_b_id"
              WHERE t."status" = 'queued' AND job."kind" IN ('matrix', 'compare') AND (SELECT count(*) FROM cli) = 1
            ), source AS (
              SELECT DISTINCT ON (target."id") target."id" AS target_id, s.*
              FROM target
              CROSS JOIN job
              JOIN "simulation_chunks" s ON s."seed" = target."seed" AND s."games" = target."games"
                AND s."first_game" = target."first_game" AND s."status" = 'done' AND s."job_id" <> job."id"
                AND s."cached_from_id" IS NULL
                AND s."engine_rev" = job."engine_rev" AND s."cli_version" ~ ${EXACT_ENGINE}
                AND s."cli_version" = (SELECT version FROM cli)
              JOIN "simulation_jobs" sj ON sj."id" = s."job_id" AND sj."players" = job."players"
                AND sj."kind" IN ('matrix', 'compare')
              JOIN "deck_snapshots" a ON a."id" = s."snapshot_a_id" AND a."key" = target.key_a
              JOIN "deck_snapshots" b ON b."id" = s."snapshot_b_id" AND b."key" = target.key_b
              WHERE (NOT job.per_game OR s."extra"->'perGame' IS NOT NULL)
                AND (SELECT count(*) FROM "simulation_replays" r
                     WHERE r."chunk_id" = s."id" AND r."game_index" < target."replays") = target."replays"
              ORDER BY target."id", s."id"
            )
            UPDATE "simulation_chunks" t SET
              "status" = 'done', "wins_a" = source."wins_a", "wins_b" = source."wins_b", "ties" = source."ties",
              "games_done" = source."games", "turns" = source."turns", "duration_ms" = source."duration_ms",
              "engine_rev" = source."engine_rev", "cli_version" = source."cli_version", "extra" = source."extra",
              "cached_from_id" = source."id", "error" = NULL, "started_at" = now(), "finished_at" = now()
            FROM source
            WHERE t."id" = source.target_id AND t."status" = 'queued'
            RETURNING t."id"`
          return rows.length
        },
        { timeout: FILL_TIMEOUT_MS + 5_000 },
      )
    } catch (error) {
      this.logger.warn({ job: jobId, error: String(error).slice(0, 300) }, 'chunk cache skipped')
      return 0
    }
    if (filled > 0) {
      this.logger.info({ job: jobId, chunks: filled }, 'chunks copied from the cache')
      await this.queue.settle(jobId)
    }
    return filled
  }
}
