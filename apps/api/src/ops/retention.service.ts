/**
 * Retención (Fase 39, R-006): Supabase Free has 500 MB, and the replays of the simulations were most of it (84 of
 * 153 MB on 9/10/2026: a 100×100 matrix keeps ~9 000 replays, ~70 MB). Every day after the copy, and on demand:
 *
 * 1. jobs archived more than 7 days ago keep one replay per pairing (archiving is undone in a tap; a week later the
 *    rest goes, and the screen says so);
 * 2. replays of jobs finished more than 30 days ago go (the results stay: only the replays);
 * 3. a matrix keeps one replay per pairing (the first game of its first chunk);
 * 4. all replays together stay under 100 MB: past that, the oldest go;
 * 5. Limitless' raw standings of tournaments more than 180 days old go (they only serve to re-normalize; the parsed
 *    lists stay).
 *
 * Then a plain VACUUM of the two tables, so the space is reused (Postgres does not give it back to the disk, but the
 * database stops growing). Never touches results, lists, matches or the owner's data. A replay can be played again:
 * the chunk keeps its seed, and the engine plays the same game again for the same seed and engine commit.
 */
import { Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const RETENTION_OLD_JOB_DAYS = 30
export const RETENTION_ARCHIVED_DAYS = 7
export const RETENTION_REPLAY_BUDGET_MB = 100
export const RETENTION_RAW_STANDINGS_DAYS = 180
/** `app_settings` key of the last run. */
export const RETENTION_LAST_KEY = 'retentionLast'

export interface RetentionResult {
  at: string
  /** True: nothing was deleted (the same statements, rolled back): what a real run would delete. */
  dryRun: boolean
  /** Replays deleted, by rule (in this order; a replay counts under the first rule that takes it). */
  replays: { archived: number; oldJobs: number; matrixExtra: number; overBudget: number }
  /** Tournaments whose raw standings were dropped. */
  rawStandings: number
  /** Megabytes freed (replays and raw standings) and what the replays weigh after the run. */
  freedMb: number
  replaysMb: number
  vacuumed: boolean
}

/** Thrown inside the transaction to roll a dry run back. */
class DryRunRollback extends Error {
  constructor(readonly result: Omit<RetentionResult, 'at' | 'dryRun' | 'vacuumed'>) {
    super('dry run')
  }
}

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RetentionService.name)
  }

  /** Every day at 04:20 (after the 04:00 copy), only with RETENTION_CRON=true (off until the owner saw a dry run). */
  @Cron('20 4 * * *', { timeZone: OWNER_TIME_ZONE })
  async daily(): Promise<void> {
    if (!this.env.retentionCron) return
    await this.run().catch((error) => this.logger.error({ err: error }, 'retention failed'))
  }

  async last(): Promise<RetentionResult | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: RETENTION_LAST_KEY } })
    return (row?.value as RetentionResult | undefined) ?? null
  }

  /**
   * `dryRun` (the default for the HTTP call): the same statements inside a transaction that is rolled back, so the
   * numbers are exactly what a real run would delete. The daily run is real.
   */
  async run(options: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionResult> {
    const now = options.now ?? new Date()
    const dryRun = options.dryRun ?? false
    const oldBefore = new Date(now.getTime() - RETENTION_OLD_JOB_DAYS * 86_400_000)
    const archivedBefore = new Date(now.getTime() - RETENTION_ARCHIVED_DAYS * 86_400_000)
    const rawBefore = new Date(now.getTime() - RETENTION_RAW_STANDINGS_DAYS * 86_400_000)
    const budget = RETENTION_REPLAY_BUDGET_MB * 1024 * 1024
    let counts: Omit<RetentionResult, 'at' | 'dryRun' | 'vacuumed'>
    try {
      counts = await this.prisma.$transaction(
        async (tx) => {
          const weight = async () => {
            const [row] = await tx.$queryRaw<{ replays: bigint; raw: bigint }[]>`
              SELECT (SELECT coalesce(sum(size_bytes), 0) FROM simulation_replays)::bigint AS replays,
                     (SELECT coalesce(sum(octet_length(raw_standings_gz)), 0) FROM tournaments)::bigint AS raw`
            return { replays: Number(row?.replays ?? 0), raw: Number(row?.raw ?? 0) }
          }
          const before = await weight()
          const archived = await tx.$executeRaw`
            DELETE FROM simulation_replays r USING (
              SELECT r2.id, row_number() OVER (
                PARTITION BY ch.job_id, ch.snapshot_a_id, ch.snapshot_b_id ORDER BY ch.idx, r2.game_index, r2.id
              ) AS n
              FROM simulation_replays r2
              JOIN simulation_chunks ch ON ch.id = r2.chunk_id
              JOIN simulation_jobs j ON j.id = ch.job_id
              WHERE j.archived_at IS NOT NULL AND j.archived_at < ${archivedBefore}
            ) x
            WHERE r.id = x.id AND x.n > 1`
          const oldJobs = await tx.$executeRaw`
            DELETE FROM simulation_replays r USING simulation_chunks ch, simulation_jobs j
            WHERE r.chunk_id = ch.id AND ch.job_id = j.id
              AND j.finished_at IS NOT NULL AND j.finished_at < ${oldBefore}`
          const matrixExtra = await tx.$executeRaw`
            DELETE FROM simulation_replays r USING (
              SELECT r2.id, row_number() OVER (
                PARTITION BY ch.job_id, ch.snapshot_a_id, ch.snapshot_b_id ORDER BY ch.idx, r2.game_index, r2.id
              ) AS n
              FROM simulation_replays r2
              JOIN simulation_chunks ch ON ch.id = r2.chunk_id
              JOIN simulation_jobs j ON j.id = ch.job_id
              WHERE j.kind = 'matrix'
            ) x
            WHERE r.id = x.id AND x.n > 1`
          const overBudget = await tx.$executeRaw`
            DELETE FROM simulation_replays WHERE id IN (
              SELECT id FROM (
                SELECT id, sum(size_bytes) OVER (ORDER BY created_at DESC, id DESC) AS running FROM simulation_replays
              ) s WHERE s.running > ${budget}
            )`
          const rawStandings = await tx.$executeRaw`
            UPDATE tournaments SET raw_standings_gz = NULL
            WHERE raw_standings_gz IS NOT NULL AND date < ${rawBefore}`
          const after = await weight()
          const result = {
            replays: { archived, oldJobs, matrixExtra, overBudget },
            rawStandings,
            freedMb: mb(before.replays - after.replays + before.raw - after.raw),
            replaysMb: mb(after.replays),
          }
          if (dryRun) throw new DryRunRollback(result)
          return result
        },
        { timeout: 120_000 },
      )
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error
      counts = error.result
    }
    const deleted =
      counts.replays.archived +
      counts.replays.oldJobs +
      counts.replays.matrixExtra +
      counts.replays.overBudget +
      counts.rawStandings
    let vacuumed = false
    if (!dryRun && deleted > 0) {
      try {
        // Outside any transaction (Prisma runs each raw statement on its own): the freed space is reused.
        await this.prisma.$executeRawUnsafe('VACUUM (ANALYZE) simulation_replays')
        await this.prisma.$executeRawUnsafe('VACUUM (ANALYZE) tournaments')
        vacuumed = true
      } catch (error) {
        this.logger.warn({ err: error }, 'vacuum after retention failed')
      }
    }
    const result: RetentionResult = { at: now.toISOString(), dryRun, ...counts, vacuumed }
    if (!dryRun) {
      const value = JSON.parse(JSON.stringify(result))
      await this.prisma.appSetting.upsert({
        where: { key: RETENTION_LAST_KEY },
        create: { key: RETENTION_LAST_KEY, value },
        update: { value },
      })
    }
    this.logger.info(result, dryRun ? 'retention dry run' : 'retention done')
    return result
  }
}
