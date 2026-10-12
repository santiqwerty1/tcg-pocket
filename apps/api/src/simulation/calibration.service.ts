/**
 * Calibration of the simulations against tournaments (R-012): a matrix of the meta bank played by a chosen bot, and
 * its report next to the archetypes' tournament matchups of the same era (`calibrationReport` in @tcg/domain). The
 * bot is the parameter: the same bank with e2 and with another bot says which one is closer to people.
 */
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  botLabel,
  type CalibrationPairing,
  type CalibrationReport,
  type ChunkOutcome,
  calibrationReport,
  type GameRecord,
  isBotCode,
  matchupPerGame,
  mixListRecords,
  pairingRecords,
  type TournamentFormat,
} from '@tcg/domain'
import type { Prisma } from '../generated/prisma/client.js'
import { LabService } from '../lab/lab.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentDataVersion } from '../tournaments/tournament-settings.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'
import type { JobSummaryView } from './simulation-views.js'
import { SimulationsService } from './simulations.service.js'
import { SnapshotsService } from './snapshots.service.js'

/** What a calibration job keeps in `params.calibration`: the bank it played, as the Laboratorio built it. */
export interface CalibrationParams {
  era: string
  format: TournamentFormat
  bot: string
  bank: { listKey: string; archetypeId: string; archetypeName: string; share: number; weight: number }[]
}

export interface CalibrationJobView {
  id: number
  status: JobSummaryView['status']
  label: string
  bot: string
  botEs: string
  era: string
  format: TournamentFormat
  engineRev: string
  gamesPerPair: number
  createdAt: Date
  finishedAt: Date | null
  progress: JobSummaryView['progress']
  /** Lists of the bank. */
  lists: number
}

export interface CalibrationView {
  job: CalibrationJobView
  report: CalibrationReport
  /** The tournament side, read now (the era's matchups keep growing while a calibration is kept). */
  tournaments: { era: string; format: TournamentFormat; matches: number; tournamentsWithPairings: number }
  /** Pairings of the bank still to be played (all their chunks, when a pairing is split). */
  pending: number
  /** Pairings whose chunks failed in the engine: they will not come (the job ends «failed» with the rest). */
  failed: number
  /** Pairings a cancelled job left unplayed, whole or in part: they will not come either. */
  cancelled: number
  /**
   * Pairings of two lists of one archetype (the bank's second lists, or archetypes an alias merged after the bank was
   * kept): tournaments have no matchup for an archetype against itself, so they are not compared.
   */
  mirrors: number
}

export interface CalibrationSummaryView extends CalibrationJobView {
  /** Finished jobs only (done, or failed with the pairings that did play). */
  summary: Pick<CalibrationReport, 'compared' | 'compatible' | 'meanAbsDifference' | 'rankCorrelation'> | null
  failed: number
  cancelled: number
}

/** Calibrations the list shows, newest first. */
const LISTED = 50

/** Games per pairing by default: 105 pairings × 200 is 21.000 games, ~4 minutes of the PC's worker with e2. */
export const CALIBRATION_GAMES_PER_PAIR = 200

export function calibrationOf(params: Prisma.JsonValue): CalibrationParams | null {
  const value = (params as { calibration?: unknown } | null)?.calibration
  return value && typeof value === 'object' ? (value as CalibrationParams) : null
}

@Injectable()
export class CalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lab: LabService,
    private readonly tournaments: TournamentsService,
    private readonly simulations: SimulationsService,
    private readonly snapshots: SnapshotsService,
    private readonly tournamentData: TournamentDataVersion,
  ) {}

  /**
   * Summaries of finished calibrations: their chunks no longer change, so a summary only goes stale when the
   * tournaments, the settings or the aliases do (the key carries `TournamentDataVersion`).
   */
  private readonly summaries = new Map<string, Pick<CalibrationSummaryView, 'summary' | 'failed' | 'cancelled'>>()

  /** Queues the bank against itself with `bot` on both sides. */
  async start(input: {
    bot: string
    gamesPerPair?: number | undefined
    size?: number | undefined
    era?: string | undefined
    format?: TournamentFormat | undefined
  }): Promise<JobSummaryView> {
    if (!isBotCode(input.bot)) {
      throw new BadRequestException({ code: 'validation', message: `Bot «${input.bot}» desconocido.` })
    }
    const bank = await this.lab.bank({ era: input.era, format: input.format, size: input.size })
    if (bank.rivals.length < 3) {
      throw new UnprocessableEntityException({
        code: 'bank_too_small',
        message: `El banco del meta de ${bank.era} tiene ${bank.rivals.length} listas: hacen falta al menos 3.`,
      })
    }
    const calibration: CalibrationParams = {
      era: bank.era,
      format: bank.format,
      bot: input.bot,
      bank: bank.rivals.map((rival) => ({
        listKey: rival.listKey,
        archetypeId: rival.archetypeId,
        archetypeName: rival.archetypeName,
        share: rival.share,
        weight: rival.weight,
      })),
    }
    return this.simulations.create({
      kind: 'matrix',
      label: `Calibración · ${botLabel(input.bot)} · ${bank.era}`,
      sideA: bank.rivals.map((rival) => ({
        listKey: rival.listKey,
        era: bank.era,
        format: bank.format,
        kind: 'group',
      })),
      sideB: [],
      gamesPerPair: input.gamesPerPair ?? CALIBRATION_GAMES_PER_PAIR,
      players: [input.bot, input.bot],
      replaySample: 0,
      calibration: calibration as unknown as Prisma.InputJsonValue,
    })
  }

  private jobView(job: Prisma.SimulationJobGetPayload<object>, summary: JobSummaryView): CalibrationJobView {
    const calibration = calibrationOf(job.params) as CalibrationParams
    return {
      id: job.id,
      status: summary.status,
      label: job.label,
      bot: calibration.bot,
      botEs: botLabel(calibration.bot),
      era: calibration.era,
      format: calibration.format,
      engineRev: job.engineRev,
      gamesPerPair: job.gamesPerPair,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      progress: summary.progress,
      lists: calibration.bank.length,
    }
  }

  /**
   * Every calibration, newest first, with the summary of the finished ones (made once and kept until the tournament
   * data change: the list is read every few seconds while one plays).
   */
  async list(): Promise<CalibrationSummaryView[]> {
    const ids = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "simulation_jobs"
      WHERE "kind" = 'matrix' AND "params"->'calibration' IS NOT NULL
      ORDER BY "created_at" DESC LIMIT ${LISTED}`
    const jobs = await this.prisma.simulationJob.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      orderBy: { createdAt: 'desc' },
    })
    const byId = new Map((await this.simulations.summariesOf(jobs.map((job) => job.id))).map((job) => [job.id, job]))
    // While a calibration plays, only how many pairings already failed (cheap: no report).
    const failedChunks = await this.prisma.simulationChunk.groupBy({
      by: ['jobId', 'snapshotAId', 'snapshotBId'],
      where: { jobId: { in: jobs.map((job) => job.id) }, status: 'failed' },
    })
    // A chunk can still finish after its job did (a late result): the summary is made again then.
    const lastChunks = new Map(
      (
        await this.prisma.simulationChunk.groupBy({
          by: ['jobId'],
          where: { jobId: { in: jobs.map((job) => job.id) } },
          _max: { finishedAt: true },
        })
      ).map((row) => [row.jobId, row._max.finishedAt?.getTime() ?? 0]),
    )
    const out: CalibrationSummaryView[] = []
    for (const job of jobs) {
      const summary = byId.get(job.id)
      if (!summary) continue
      const view = this.jobView(job, summary)
      if (summary.status === 'queued' || summary.status === 'running') {
        const failed = failedChunks.filter((row) => row.jobId === job.id).length
        out.push({ ...view, summary: null, failed, cancelled: 0 })
        continue
      }
      const key = `${job.id}:${summary.status}:${job.finishedAt?.getTime() ?? 0}:${lastChunks.get(job.id) ?? 0}:${this.tournamentData.current()}`
      let kept = this.summaries.get(key)
      if (!kept) {
        const full = await this.report(job.id)
        const { compared, compatible, meanAbsDifference, rankCorrelation } = full.report
        kept = {
          summary: { compared, compatible, meanAbsDifference, rankCorrelation },
          failed: full.failed,
          cancelled: full.cancelled,
        }
        for (const old of this.summaries.keys()) if (old.startsWith(`${job.id}:`)) this.summaries.delete(old)
        this.summaries.set(key, kept)
      }
      out.push({ ...view, ...kept })
    }
    return out
  }

  /** The report of one calibration, against the era's tournament matchups as they are now. */
  async report(id: number): Promise<CalibrationView> {
    const job = await this.prisma.simulationJob.findUnique({ where: { id } })
    const calibration = job ? calibrationOf(job.params) : null
    if (!job || !calibration) throw new NotFoundException(`No hay una calibración ${id}.`)
    const summary = await this.simulations.progressOf(String(id))
    const sideA = ((job.params as { sideA?: number[] }).sideA ?? []) as number[]
    const [snapshots, aliases] = await Promise.all([this.snapshots.byIds(sideA), this.tournaments.aliases()])
    // Each list of the bank under the archetype it is now: an alias merged since must still find its matchups.
    const lists = new Map<string, { archetypeId: string; label: string; weight: number }>()
    for (const entry of calibration.bank) {
      const archetypeId = aliases.get(entry.archetypeId) ?? entry.archetypeId
      lists.set(entry.listKey, { archetypeId, label: entry.archetypeName, weight: entry.weight })
    }
    // A list's part of its archetype: the bank's second lists (T-017 D3) split their archetype's share.
    const archetypeWeight = new Map<string, number>()
    for (const list of lists.values()) {
      archetypeWeight.set(list.archetypeId, (archetypeWeight.get(list.archetypeId) ?? 0) + list.weight)
    }
    const listOf = new Map(
      snapshots.flatMap((snapshot) => {
        const list = snapshot.sourceType === 'tournament_list' ? lists.get(snapshot.sourceId ?? '') : undefined
        return list ? [[snapshot.id, list] as const] : []
      }),
    )
    const all = await this.prisma.simulationChunk.findMany({
      where: { jobId: id, snapshotAId: { not: null }, snapshotBId: { not: null } },
      select: { snapshotAId: true, snapshotBId: true, winsA: true, winsB: true, ties: true, status: true },
    })
    const statusesOf = new Map<string, string[]>()
    for (const chunk of all) {
      const key = `${chunk.snapshotAId}:${chunk.snapshotBId}`
      statusesOf.set(key, [...(statusesOf.get(key) ?? []), chunk.status])
    }
    // A pairing split in several chunks is played once all of them are; a cancelled part leaves it unplayed.
    const active = summary.status === 'queued' || summary.status === 'running'
    const stateOf = (key: string): 'played' | 'pending' | 'failed' | 'cancelled' => {
      const statuses = statusesOf.get(key) ?? []
      if (statuses.includes('failed')) return 'failed'
      if (statuses.length > 0 && statuses.every((status) => status === 'done')) return 'played'
      if (statuses.some((status) => status === 'queued' || status === 'leased')) return 'pending'
      return active ? 'pending' : 'cancelled'
    }
    const records = pairingRecords(
      all
        .filter((chunk) => chunk.status === 'done')
        .map(
          (chunk): ChunkOutcome => ({
            a: chunk.snapshotAId as number,
            b: chunk.snapshotBId as number,
            winsA: chunk.winsA ?? 0,
            winsB: chunk.winsB ?? 0,
            ties: chunk.ties ?? 0,
          }),
        ),
    )
    const { scope, dataset } = await this.tournaments.scopedDataset({
      era: calibration.era,
      format: calibration.format,
    })
    const matchups = await this.tournaments.matchupsOf(dataset)
    // The archetype's name as it is now: a bank list of an archetype merged since keeps the old one (review of #44).
    const ownName = new Map(
      calibration.bank
        .filter((entry) => !aliases.has(entry.archetypeId))
        .map((entry) => [entry.archetypeId, entry.archetypeName] as const),
    )
    const nameOf = (list: { archetypeId: string; label: string }) =>
      dataset.archetypes.get(list.archetypeId)?.name ?? ownName.get(list.archetypeId) ?? list.label
    const counts = { pending: 0, failed: 0, cancelled: 0, mirrors: 0 }
    // R-012 (review of #44): tournaments have one matchup per pair of archetypes, so the pairings of their lists make
    // one point (mixListRecords); counting each list apart would count that matchup twice. An archetype pairing goes
    // in once every one of its list pairings is played.
    const groups = new Map<
      string,
      {
        a: string
        b: string
        labelA: string
        labelB: string
        parts: { record: GameRecord; weight: number }[]
        complete: boolean
      }
    >()
    for (let i = 0; i < sideA.length; i++) {
      for (let j = i + 1; j < sideA.length; j++) {
        const [x, y] = [sideA[i] as number, sideA[j] as number]
        const [a, b] = [listOf.get(x), listOf.get(y)]
        if (!a || !b) continue
        const state = stateOf(`${x}:${y}`)
        // Two lists of one archetype: no tournament matchup to compare with. A failed one still counts as failed, as
        // it does while the job plays (the list's count of failed chunks).
        if (a.archetypeId === b.archetypeId) {
          counts[state === 'failed' ? 'failed' : 'mirrors']++
          continue
        }
        const record = records.get(`${x}:${y}`)?.record
        const key = [a.archetypeId, b.archetypeId].sort().join('|')
        const group = groups.get(key) ?? {
          a: a.archetypeId,
          b: b.archetypeId,
          labelA: nameOf(a),
          labelB: nameOf(b),
          parts: [],
          complete: true,
        }
        groups.set(key, group)
        if (state !== 'played' || !record) {
          counts[state === 'played' ? 'pending' : state]++
          group.complete = false
          continue
        }
        // From the group's side: a pairing played the other way round is turned.
        const turned = group.a !== a.archetypeId
        const part = (list: { archetypeId: string; weight: number }) =>
          list.weight / Math.max(Number.EPSILON, archetypeWeight.get(list.archetypeId) ?? 0)
        group.parts.push({
          record: turned ? { wins: record.losses, losses: record.wins, ties: record.ties } : record,
          weight: part(a) * part(b),
        })
      }
    }
    const pairings: CalibrationPairing[] = []
    for (const group of groups.values()) {
      const simulated = group.complete ? mixListRecords(group.parts) : null
      if (!simulated) continue
      pairings.push({
        a: group.a,
        b: group.b,
        labelA: group.labelA,
        labelB: group.labelB,
        simulated,
        // The n shown is the games played; the mixture's scaled record is only for the interval.
        simulatedGames: group.parts.reduce((sum, part) => sum + part.record.wins + part.record.losses, 0),
        tournament: matchupPerGame(matchups, group.a, group.b),
      })
    }
    return {
      job: this.jobView(job, summary),
      report: calibrationReport(pairings, { shares: archetypeWeight }),
      tournaments: {
        era: scope.era,
        format: scope.format,
        matches: matchups.matches,
        tournamentsWithPairings: matchups.tournamentsWithPairings,
      },
      ...counts,
    }
  }
}
