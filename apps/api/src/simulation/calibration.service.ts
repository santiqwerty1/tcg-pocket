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
  isBotCode,
  matchupPerGame,
  pairingRecords,
  type TournamentFormat,
} from '@tcg/domain'
import type { Prisma } from '../generated/prisma/client.js'
import { LabService } from '../lab/lab.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
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
  /** Pairings of the bank without a simulated result yet (the job is still running, or a chunk failed). */
  pending: number
}

export interface CalibrationSummaryView extends CalibrationJobView {
  /** Done jobs only. */
  summary: Pick<CalibrationReport, 'compared' | 'inside' | 'meanAbsDifference' | 'rankCorrelation'> | null
}

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
  ) {}

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

  /** Every calibration, newest first, with the summary of the finished ones. */
  async list(): Promise<CalibrationSummaryView[]> {
    const jobs = (
      await this.prisma.simulationJob.findMany({ where: { kind: 'matrix' }, orderBy: { createdAt: 'desc' }, take: 200 })
    ).filter((job) => calibrationOf(job.params) !== null)
    const out: CalibrationSummaryView[] = []
    for (const job of jobs.slice(0, 50)) {
      const view = await this.report(job.id)
      const { compared, inside, meanAbsDifference, rankCorrelation } = view.report
      out.push({
        ...view.job,
        summary: view.job.status === 'done' ? { compared, inside, meanAbsDifference, rankCorrelation } : null,
      })
    }
    return out
  }

  /** The report of one calibration, against the era's tournament matchups as they are now. */
  async report(id: number): Promise<CalibrationView> {
    const job = await this.prisma.simulationJob.findUnique({ where: { id } })
    const calibration = job ? calibrationOf(job.params) : null
    if (!job || !calibration) throw new NotFoundException(`No hay una calibración ${id}.`)
    const summary = await this.simulations.detail(String(id))
    const sideA = ((job.params as { sideA?: number[] }).sideA ?? []) as number[]
    const snapshots = await this.snapshots.byIds(sideA)
    const bankByList = new Map(calibration.bank.map((entry) => [entry.listKey, entry]))
    const archetypeOf = new Map(
      snapshots.flatMap((snapshot) => {
        const entry = snapshot.sourceType === 'tournament_list' ? bankByList.get(snapshot.sourceId ?? '') : undefined
        return entry ? [[snapshot.id, entry] as const] : []
      }),
    )
    const chunks = await this.prisma.simulationChunk.findMany({
      where: { jobId: id, status: 'done', snapshotAId: { not: null }, snapshotBId: { not: null } },
      select: { snapshotAId: true, snapshotBId: true, winsA: true, winsB: true, ties: true },
    })
    const records = pairingRecords(
      chunks.map(
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
    const pairings: CalibrationPairing[] = []
    let pending = 0
    for (let i = 0; i < sideA.length; i++) {
      for (let j = i + 1; j < sideA.length; j++) {
        const [x, y] = [sideA[i] as number, sideA[j] as number]
        const [a, b] = [archetypeOf.get(x), archetypeOf.get(y)]
        if (!a || !b) continue
        const record = records.get(`${x}:${y}`)?.record
        if (!record) {
          pending++
          continue
        }
        pairings.push({
          a: a.archetypeId,
          b: b.archetypeId,
          labelA: a.archetypeName,
          labelB: b.archetypeName,
          simulated: record,
          tournament: matchupPerGame(matchups, a.archetypeId, b.archetypeId),
        })
      }
    }
    return {
      job: this.jobView(job, summary),
      report: calibrationReport(pairings, {
        shares: new Map(calibration.bank.map((entry) => [entry.archetypeId, entry.share])),
      }),
      tournaments: {
        era: scope.era,
        format: scope.format,
        matches: matchups.matches,
        tournamentsWithPairings: matchups.tournamentsWithPairings,
      },
      pending,
    }
  }
}
