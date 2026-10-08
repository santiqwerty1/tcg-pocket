/**
 * Limitless sync (PLAN §3.5, Fase 5): lists tournaments page by page, then downloads details and standings of the
 * ones that count (finished, Standard or NOEX, at least `minPlayers`), newest first. Every tournament carries its own
 * status in the database, so a run can be cut at any point (deploy, 429, shutdown) and the next one goes on from
 * there. The first run downloads the last 60 days; then a run every 6 hours picks up what is new.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import {
  DEFAULT_BACKFILL_DAYS,
  type ExclusionReason,
  effectiveFormat,
  exclusionFromDetails,
  type LimitlessTournament,
  limitlessDetailsSchema,
  limitlessTournamentListSchema,
  type NormalizedEntry,
  parseStandings,
  standingsIncomplete,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { type CallStats, LimitlessClient, LimitlessError } from './limitless.client.js'
import { TournamentDataVersion, TournamentSettings } from './tournament-settings.js'

const DAY_MS = 24 * 60 * 60 * 1000
const PAGE_SIZE = 100
const MAX_PAGES = 40
/** A tournament is final a day after its scheduled start (the longest ones take 6–8 h). */
const FINISHED_AFTER_MS = DAY_MS
/** Incremental runs list until a page is all known and older than this. */
const RELIST_MS = 2 * DAY_MS
const MAX_ATTEMPTS = 3
const RETRY_INCOMPLETE_MS = DAY_MS
const RETRY_FAILED_MS = 6 * 60 * 60 * 1000
const BOOT_DELAY_MS = 20_000

export type SyncKind = 'incremental' | 'backfill'

export interface SyncProgress {
  runId: number
  kind: SyncKind
  startedAt: Date
  calls: number
  waitedMs: number
  listed: number
  done: number
  /** Candidates still to download when the listing finished. */
  pending: number
  current: string | null
}

@Injectable()
export class TournamentSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private running: Promise<void> | null = null
  private progress: SyncProgress | null = null
  private readonly shutdown = new AbortController()
  private bootTimer: NodeJS.Timeout | null = null

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly client: LimitlessClient,
    private readonly settings: TournamentSettings,
    private readonly version: TournamentDataVersion,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TournamentSyncService.name)
  }

  async onApplicationBootstrap(): Promise<void> {
    // A run cut by a restart stays «running» in the table: mark it, the tournaments keep their own status.
    await this.prisma.limitlessSyncRun.updateMany({
      where: { status: 'running' },
      data: { status: 'interrupted', finishedAt: new Date() },
    })
    this.logger.info({ enabled: this.env.limitlessSync }, 'limitless sync')
    if (!this.env.limitlessSync) return
    this.bootTimer = setTimeout(() => this.start(), BOOT_DELAY_MS)
    this.bootTimer.unref()
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer)
    this.shutdown.abort(new Error('shutdown'))
  }

  @Cron('20 */6 * * *')
  scheduled(): void {
    if (this.env.limitlessSync) this.start()
  }

  isRunning(): boolean {
    return this.running !== null
  }

  currentProgress(): SyncProgress | null {
    return this.progress ? { ...this.progress } : null
  }

  callsInWindow(): number {
    return this.client.callsInWindow()
  }

  /** Starts a run in the background unless one is going; returns whether it started. */
  start(options: { kind?: SyncKind; backfillDays?: number } = {}): boolean {
    if (this.running) return false
    this.running = this.run(options)
      .catch((error) => this.logger.error({ err: error }, 'limitless sync failed'))
      .finally(() => {
        this.running = null
        this.progress = null
      })
    return true
  }

  /** Awaits the run in course (tests). */
  async idle(): Promise<void> {
    await this.running
  }

  /** One run: list, then download the pending tournaments. Exposed for the e2e tests (`await sync.run()`). */
  async run(options: { kind?: SyncKind; backfillDays?: number; now?: Date } = {}): Promise<void> {
    const now = options.now ?? new Date()
    const backfillDays = options.backfillDays ?? DEFAULT_BACKFILL_DAYS
    const known = await this.prisma.tournament.count({ where: { status: 'complete' } })
    const kind: SyncKind = options.kind ?? (known === 0 ? 'backfill' : 'incremental')
    const run = await this.prisma.limitlessSyncRun.create({ data: { kind, status: 'running' } })
    const stats: CallStats = { calls: 0, waitedMs: 0 }
    this.progress = {
      runId: run.id,
      kind,
      startedAt: run.startedAt,
      calls: 0,
      waitedMs: 0,
      listed: 0,
      done: 0,
      pending: 0,
      current: null,
    }
    const signal = this.shutdown.signal
    const save = (data: Prisma.LimitlessSyncRunUpdateInput) =>
      this.prisma.limitlessSyncRun.update({ where: { id: run.id }, data })
    try {
      const listed = await this.list(kind, now, backfillDays, stats, signal)
      this.bump({ listed })
      await save({ tournamentsListed: listed, calls: stats.calls, waitedMs: stats.waitedMs })
      const minPlayers = await this.settings.minPlayers()
      const candidates = await this.prisma.tournament.findMany({
        where: {
          status: { in: ['listed', 'incomplete'] },
          format: { in: ['STANDARD', 'NOEX'] },
          players: { gte: minPlayers },
          date: {
            gte: new Date(now.getTime() - backfillDays * DAY_MS),
            lt: new Date(now.getTime() - FINISHED_AFTER_MS),
          },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { date: 'desc' },
        select: { id: true, name: true, attempts: true },
      })
      this.bump({ pending: candidates.length })
      let done = 0
      for (const tournament of candidates) {
        if (signal.aborted) throw signal.reason
        this.bump({ current: tournament.name })
        await this.download(tournament, stats, signal)
        done += 1
        this.bump({ done, calls: stats.calls, waitedMs: stats.waitedMs })
        await save({ tournamentsDone: done, calls: stats.calls, waitedMs: stats.waitedMs })
      }
      await save({ status: 'done', finishedAt: new Date(), calls: stats.calls, waitedMs: stats.waitedMs })
      this.logger.info({ kind, listed, done, calls: stats.calls }, 'limitless sync done')
    } catch (error) {
      const interrupted = signal.aborted
      await save({
        status: interrupted ? 'interrupted' : 'failed',
        finishedAt: new Date(),
        calls: stats.calls,
        waitedMs: stats.waitedMs,
        error: interrupted ? null : String(error instanceof Error ? error.message : error).slice(0, 500),
      }).catch(() => undefined)
      if (!interrupted) throw error
    }
  }

  private bump(patch: Partial<SyncProgress>): void {
    if (this.progress) Object.assign(this.progress, patch)
  }

  /** Pages of `/tournaments`, newest first, upserting what they bring. Returns how many tournaments it saw. */
  private async list(
    kind: SyncKind,
    now: Date,
    backfillDays: number,
    stats: CallStats,
    signal: AbortSignal,
  ): Promise<number> {
    const oldestWanted = now.getTime() - backfillDays * DAY_MS
    let seen = 0
    for (let page = 1; page <= MAX_PAGES; page++) {
      const raw = await this.client.get(`/tournaments?game=POCKET&limit=${PAGE_SIZE}&page=${page}`, stats, signal)
      const items = limitlessTournamentListSchema.parse(raw).filter((item) => item.game === 'POCKET')
      if (items.length === 0) break
      const allKnown = await this.upsertListed(items, now)
      seen += items.length
      const oldest = Math.min(...items.map((item) => Date.parse(item.date)))
      if (oldest < oldestWanted) break
      if (kind === 'incremental' && allKnown && oldest < now.getTime() - RELIST_MS) break
      if (items.length < PAGE_SIZE) break
    }
    return seen
  }

  /** Inserts new tournaments, refreshes known ones; returns whether every item was already known. */
  private async upsertListed(items: readonly LimitlessTournament[], now: Date): Promise<boolean> {
    const existing = new Map(
      (
        await this.prisma.tournament.findMany({
          where: { id: { in: items.map((item) => item.id) } },
          select: { id: true, players: true, status: true },
        })
      ).map((row) => [row.id, row]),
    )
    const fresh = items.filter((item) => !existing.has(item.id))
    if (fresh.length > 0) {
      await this.prisma.tournament.createMany({
        data: fresh.map((item) => {
          const format = effectiveFormat(item.format)
          const reason: ExclusionReason | null =
            format !== null ? null : item.format === 'CUSTOM' ? 'custom_format' : 'unknown_format'
          return {
            id: item.id,
            name: item.name,
            date: new Date(item.date),
            formatRaw: item.format ?? null,
            format: format ?? 'EXCLUDED',
            players: item.players,
            organizerId: item.organizerId ?? null,
            status: reason ? 'excluded' : 'listed',
            excludedReason: reason,
          }
        }),
        skipDuplicates: true,
      })
    }
    const known = items.filter((item) => existing.has(item.id))
    if (known.length > 0) {
      await this.prisma.tournament.updateMany({
        where: { id: { in: known.map((item) => item.id) } },
        data: { lastSeenAt: now },
      })
      // A tournament that grew after we downloaded it (late registrations, a list fixed) is downloaded again.
      for (const item of known) {
        const row = existing.get(item.id)
        if (row && row.players !== item.players && row.status === 'complete') {
          await this.prisma.tournament.update({
            where: { id: item.id },
            data: { players: item.players, status: 'listed', attempts: 0, nextAttemptAt: null },
          })
        } else if (row && row.players !== item.players) {
          await this.prisma.tournament.update({ where: { id: item.id }, data: { players: item.players } })
        }
      }
    }
    return fresh.length === 0
  }

  /** Details, then standings, of one tournament. Errors of one tournament never stop the run. */
  private async download(
    tournament: { id: string; name: string; attempts: number },
    stats: CallStats,
    signal: AbortSignal,
  ): Promise<void> {
    const attempts = tournament.attempts + 1
    const fail = async (status: 'listed' | 'incomplete' | 'failed', error: string, retryInMs: number) => {
      await this.prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : status,
          attempts,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + retryInMs),
        },
      })
    }
    try {
      const detailsRaw = await this.client.get(
        `/tournaments/${encodeURIComponent(tournament.id)}/details`,
        stats,
        signal,
      )
      const details = limitlessDetailsSchema.parse(detailsRaw)
      const detailsJson = {
        decklists: details.decklists ?? null,
        isOnline: details.isOnline ?? null,
        isPublic: details.isPublic ?? null,
        phases: details.phases ?? [],
        bannedCards: details.bannedCards ?? [],
        specialRules: details.specialRules ?? [],
      } as Prisma.InputJsonValue
      const organizerName = details.organizer?.name ?? null
      const exclusion = exclusionFromDetails(details)
      if (exclusion) {
        await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: 'excluded', excludedReason: exclusion, details: detailsJson, organizerName, attempts },
        })
        return
      }
      const raw = await this.client.get(`/tournaments/${encodeURIComponent(tournament.id)}/standings`, stats, signal)
      let entries: NormalizedEntry[]
      try {
        entries = parseStandings(raw)
      } catch (error) {
        await fail('failed', `standings con forma inesperada: ${String(error).slice(0, 300)}`, RETRY_FAILED_MS)
        return
      }
      if (standingsIncomplete(entries)) {
        await fail('incomplete', 'standings sin partidas todavía', RETRY_INCOMPLETE_MS)
        return
      }
      const json = JSON.stringify(raw)
      await this.prisma.$transaction([
        this.prisma.tournamentEntry.deleteMany({ where: { tournamentId: tournament.id } }),
        this.prisma.tournamentEntry.createMany({
          data: entries.map((entry) => ({
            tournamentId: tournament.id,
            playerId: entry.playerId,
            playerName: entry.playerName,
            country: entry.country,
            placing: entry.placing,
            drop: entry.drop,
            wins: entry.record.wins,
            losses: entry.record.losses,
            ties: entry.record.ties,
            archetypeId: entry.archetype?.id ?? null,
            archetypeName: entry.archetype?.name ?? null,
            archetypeIcons: entry.archetype?.icons ?? [],
            energies: entry.energies,
            decklist: (entry.decklist ?? undefined) as Prisma.InputJsonValue | undefined,
          })),
          skipDuplicates: true,
        }),
        this.prisma.tournament.update({
          where: { id: tournament.id },
          data: {
            status: 'complete',
            attempts,
            lastError: null,
            nextAttemptAt: null,
            details: detailsJson,
            organizerName,
            rawStandingsGz: gzipSync(json),
            standingsSha256: createHash('sha256').update(json).digest('hex'),
            fetchedAt: new Date(),
          },
        }),
      ])
      this.version.bump()
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof LimitlessError && error.status === 404) {
        await this.prisma.tournament.update({
          where: { id: tournament.id },
          data: { status: 'excluded', excludedReason: 'not_found', attempts },
        })
        return
      }
      this.logger.warn({ tournament: tournament.id, err: error }, 'tournament download failed')
      await fail('listed', error instanceof Error ? error.message : String(error), RETRY_FAILED_MS)
    }
  }
}
