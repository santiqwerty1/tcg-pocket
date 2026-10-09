/**
 * Simulation jobs (BRIEF M7, PLAN §3.7): queue a matrix, a comparison or an optimization; the worker on the owner's
 * PC plays them. Results keep wins, losses and ties apart, with the bot, n and seed always named. Simulation is its
 * own source: never mixed with tournaments or own matches.
 */
import { randomInt } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  BOT_LABEL_ES,
  botLabel,
  type ConsistencySplit,
  chunkSeed,
  comparePairings,
  DEFAULT_CONSISTENCY_GAMES,
  DEFAULT_CONSISTENCY_TURNS,
  type DeckCardEntry,
  deckRecord,
  defaultKeyCards,
  describeProblems,
  estimateSeconds,
  type GameRecord,
  isBotCode,
  MAX_BASE_SEED,
  matrixPairings,
  matrixRows,
  mergeHistograms,
  optimizeRanking,
  planChunks,
  randomBaseSeed,
  readinessCurve,
  type SimulationKind,
  simulationRate,
} from '@tcg/domain'
import { CatalogService } from '../catalog/catalog.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import { gunzipJson } from '../http/gunzip.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineUpstreamService } from './engine-upstream.service.js'
import type {
  ConsistencyView,
  EngineView,
  JobDetailView,
  JobProgressView,
  JobSummaryView,
  ReplaySummaryView,
  ReplayView,
  SnapshotView,
  WorkerView,
} from './simulation-views.js'
import { EngineStatusService, type SnapshotSource, SnapshotsService } from './snapshots.service.js'
import { WorkerQueueService } from './worker-queue.service.js'

export const MAX_DECKS_PER_SIDE = 150
export const MAX_GAMES_PER_PAIR = 20_000
const WORKER_ONLINE_MS = 2 * 60 * 1000

export interface CreateJobInput {
  kind: SimulationKind
  label?: string | undefined
  sideA: SnapshotSource[]
  sideB: SnapshotSource[]
  gamesPerPair: number
  players: [string, string]
  seed?: number | undefined
  bothOrders?: boolean | undefined
  replaySample?: number | undefined
  cores?: number | undefined
  /** Leave the decks that cannot be simulated out instead of refusing the job. */
  skipNotSimulable?: boolean | undefined
  /** Stored with the job's params (the Laboratorio's meta bank and weights, T-008). */
  lab?: Prisma.InputJsonValue | undefined
  /** optimize: the deck (side A, one), the cards to take out, the candidates to try. */
  optimize?:
    | {
        remove: { cardId: string; count: number }[]
        candidates: string[]
      }
    | undefined
}

type JobRow = Prisma.SimulationJobGetPayload<object>

@Injectable()
export class SimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly engine: EngineStatusService,
    private readonly snapshots: SnapshotsService,
    private readonly queue: WorkerQueueService,
    private readonly upstream: EngineUpstreamService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------------------------------------------

  private validate(input: CreateJobInput): void {
    for (const code of input.players) {
      if (!isBotCode(code)) throw new BadRequestException({ code: 'validation', message: `Bot «${code}» desconocido.` })
    }
    if (input.sideA.length === 0)
      throw new BadRequestException({ code: 'validation', message: 'Elegí al menos un mazo.' })
    if (input.sideA.length > MAX_DECKS_PER_SIDE || input.sideB.length > MAX_DECKS_PER_SIDE) {
      throw new BadRequestException({ code: 'validation', message: `Hasta ${MAX_DECKS_PER_SIDE} mazos por lado.` })
    }
    // A matrix needs no rivals (empty = every deck of side A against the others, see withRivals).
    if (input.kind !== 'matrix' && input.sideB.length === 0) {
      throw new BadRequestException({ code: 'validation', message: 'Elegí al menos un rival.' })
    }
    if (input.kind === 'optimize' && (input.sideA.length !== 1 || !input.optimize)) {
      throw new BadRequestException({
        code: 'validation',
        message: 'Optimizar va con un mazo, cartas a sacar y candidatas.',
      })
    }
  }

  /** What a job would play: the snapshots (with «no simulable» reasons), pairings and a time estimate. */
  async preview(input: CreateJobInput): Promise<{
    sideA: Omit<SnapshotView, 'id'>[]
    sideB: Omit<SnapshotView, 'id'>[]
    pairings: number
    totalGames: number
    estimatedSeconds: number
    engineRev: string
  }> {
    this.validate(input)
    input = withRivals(input)
    const sideA = await Promise.all(input.sideA.map((source) => this.snapshots.preview(source)))
    const sideB = await Promise.all(input.sideB.map((source) => this.snapshots.preview(source)))
    // Decks are told apart by the key of their list: the same list on both sides is one deck.
    const ids = new Map<string, number>()
    const idOf = (key: string) => {
      const known = ids.get(key)
      if (known !== undefined) return known
      ids.set(key, ids.size)
      return ids.size - 1
    }
    const aIds = sideA.filter((s) => s.simulable).map((s) => idOf(s.key))
    const bIds = sideB.filter((s) => s.simulable).map((s) => idOf(s.key))
    const pairings =
      input.kind === 'compare'
        ? comparePairings(aIds, bIds).length
        : input.kind === 'matrix'
          ? matrixPairings(aIds, bIds, input.bothOrders).length
          : 1
    const totalGames = pairings * input.gamesPerPair
    return {
      sideA,
      sideB,
      pairings,
      totalGames,
      estimatedSeconds: Math.round(estimateSeconds(totalGames, input.players, input.cores ?? 2)),
      engineRev: this.engine.engineRev(),
    }
  }

  async create(raw: CreateJobInput): Promise<JobSummaryView> {
    this.validate(raw)
    const input = withRivals(raw)
    if (!Number.isInteger(input.gamesPerPair) || input.gamesPerPair < 1 || input.gamesPerPair > MAX_GAMES_PER_PAIR) {
      throw new BadRequestException({
        code: 'validation',
        message: `Partidas por cruce: de 1 a ${MAX_GAMES_PER_PAIR}.`,
      })
    }
    // Snapshots are shared by identical sources: the same deck on both sides is one snapshot.
    const saved = new Map<string, SnapshotView>()
    const snapshotOf = async (source: SnapshotSource) => {
      const key = JSON.stringify(source)
      const hit = saved.get(key)
      if (hit) return hit
      const snapshot = await this.snapshots.save(source)
      saved.set(key, snapshot)
      return snapshot
    }
    const sideA: SnapshotView[] = []
    for (const source of input.sideA) sideA.push(await snapshotOf(source))
    const sideB: SnapshotView[] = []
    for (const source of input.sideB) sideB.push(await snapshotOf(source))

    const blocked = [...sideA.filter(() => input.kind !== 'optimize'), ...sideB].filter(
      (snapshot) => !snapshot.simulable,
    )
    if (blocked.length > 0 && !input.skipNotSimulable) {
      throw new UnprocessableEntityException({
        code: 'not_simulable',
        message: `No se pueden simular: ${blocked.map((s) => `${s.label} (${describeProblems(s.problems)})`).join('; ')}.`,
        details: blocked.map((s) => ({ id: s.id, label: s.label, problems: s.problems })),
      })
    }
    const okA = sideA.filter((s) => s.simulable || input.kind === 'optimize').map((s) => s.id)
    const okB = sideB.filter((s) => s.simulable).map((s) => s.id)
    const baseSeed = input.seed !== undefined ? input.seed : randomBaseSeed(() => randomInt(0, 2 ** 32 - 1) >>> 0)
    if (!Number.isSafeInteger(baseSeed) || baseSeed < 0 || baseSeed > MAX_BASE_SEED) {
      throw new BadRequestException({ code: 'validation', message: 'Semilla: un entero de 0 a 2^52.' })
    }
    const replaySample = Math.min(5, Math.max(0, input.replaySample ?? 2))
    const label = input.label?.trim() || defaultLabel(input.kind, sideA, sideB)

    let params: Prisma.InputJsonValue
    let chunks: { idx: number; a: number | null; b: number | null; games: number; firstGame: number }[]
    if (input.kind === 'optimize') {
      const optimize = await this.optimizeJob(input, sideA[0] as SnapshotView, sideB)
      params = { sideA: okA, sideB: okB, engineJob: optimize.engineJob } as Prisma.InputJsonValue
      chunks = [{ idx: 0, a: okA[0] ?? null, b: null, games: optimize.estimatedGames, firstGame: 0 }]
    } else {
      const pairings = input.kind === 'compare' ? comparePairings(okA, okB) : matrixPairings(okA, okB, input.bothOrders)
      if (pairings.length === 0) {
        throw new BadRequestException({ code: 'validation', message: 'No queda ningún cruce para simular.' })
      }
      params = {
        sideA: okA,
        sideB: okB,
        bothOrders: input.bothOrders ?? false,
        ...(input.lab === undefined ? {} : { lab: input.lab }),
      }
      chunks = planChunks(pairings, input.gamesPerPair)
    }
    const totalGames = chunks.reduce((sum, chunk) => sum + chunk.games, 0)
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simulationJob.create({
        data: {
          kind: input.kind,
          label,
          params,
          engineRev: this.engine.engineRev(),
          players: input.players,
          gamesPerPair: input.gamesPerPair,
          baseSeed: BigInt(baseSeed),
          cores: input.cores ?? null,
          replaySample,
          totalGames,
        },
      })
      await tx.simulationChunk.createMany({
        data: chunks.map((chunk) => ({
          jobId: created.id,
          idx: chunk.idx,
          snapshotAId: chunk.a,
          snapshotBId: chunk.b,
          games: chunk.games,
          firstGame: chunk.firstGame,
          seed: BigInt(chunkSeed(baseSeed, chunk.idx)),
        })),
      })
      return created
    })
    this.queue.notifyQueued()
    return this.summary(job, await this.progress([job.id]))
  }

  /** The engine-cli optimize job: deck minus the removed cards, candidates as implemented engine ids, rivals. */
  private async optimizeJob(input: CreateJobInput, deck: SnapshotView, rivals: SnapshotView[]) {
    const index = this.catalog.requireIndex()
    const status = await this.engine.status()
    const remove = new Map(input.optimize?.remove.map((item) => [item.cardId, item.count]))
    const kept: string[] = []
    let missing = 0
    const row = await this.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: deck.id } })
    const cards = row.cards as unknown as { cardId: string; playedAs: string; engineId: string; count: number }[]
    for (const card of cards) {
      const take = Math.min(card.count, remove.get(card.cardId) ?? 0)
      missing += take
      const left = card.count - take
      const played = index.cardById(card.playedAs)
      if (left > 0 && played) kept.push(`${left} ${played.nameEn} ${played.expansionId} ${played.number}`)
    }
    if (missing === 0)
      throw new BadRequestException({ code: 'validation', message: 'Sacá al menos una carta para optimizar.' })
    const candidates = (input.optimize?.candidates ?? []).map((cardId) => {
      const card = index.cardById(cardId)
      if (!card) throw new BadRequestException({ code: 'validation', message: `Carta ${cardId} desconocida.` })
      const played = status(card.engineId) === true ? card : null
      const alternative =
        played ?? index.cardsOfGroup(card.functionalGroupId).find((other) => status(other.engineId) === true) ?? null
      if (!alternative) {
        throw new UnprocessableEntityException({
          code: 'not_simulable',
          message: `${card.nameEs} (${card.id}) no está implementada en el motor.`,
        })
      }
      return alternative.engineId
    })
    if (candidates.length === 0)
      throw new BadRequestException({ code: 'validation', message: 'Elegí cartas candidatas.' })
    const energyLine = row.deckgymText.split('\n').find((line) => line.startsWith('Energy:')) ?? ''
    const enemies = rivals.filter((rival) => rival.simulable).map((rival) => rival.deckgymText)
    if (enemies.length === 0) throw new BadRequestException({ code: 'validation', message: 'Elegí al menos un rival.' })
    const combos = multisetCount(candidates.length, missing)
    if (combos > 200) {
      throw new BadRequestException({
        code: 'validation',
        message: `${combos} combinaciones posibles superan el límite de 200: elegí menos candidatas o sacá menos cartas.`,
      })
    }
    return {
      engineJob: {
        deck: `${energyLine}\n${kept.join('\n')}\n`,
        candidates: [...new Set(candidates)],
        missing,
        enemies,
        gamesPerEnemy: input.gamesPerPair,
        players: input.players,
      },
      estimatedGames: combos * enemies.length * input.gamesPerPair,
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------------------------------------------

  private async progress(jobIds: readonly number[]): Promise<Map<number, JobProgressView>> {
    const groups = await this.prisma.simulationChunk.groupBy({
      by: ['jobId', 'status'],
      where: { jobId: { in: [...jobIds] } },
      _count: { _all: true },
      _sum: { gamesDone: true, games: true, durationMs: true },
    })
    const map = new Map<number, JobProgressView & { doneGames: number; doneMs: number }>()
    for (const id of jobIds) {
      map.set(id, {
        totalGames: 0,
        gamesDone: 0,
        chunks: { total: 0, done: 0, running: 0, failed: 0 },
        etaSeconds: null,
        doneGames: 0,
        doneMs: 0,
      })
    }
    for (const group of groups) {
      const entry = map.get(group.jobId)
      if (!entry) continue
      const count = group._count._all
      entry.chunks.total += count
      entry.totalGames += group._sum.games ?? 0
      entry.gamesDone += group._sum.gamesDone ?? 0
      if (group.status === 'done') {
        entry.chunks.done += count
        entry.doneGames += group._sum.games ?? 0
        entry.doneMs += group._sum.durationMs ?? 0
      } else if (group.status === 'leased') entry.chunks.running += count
      else if (group.status === 'failed') entry.chunks.failed += count
    }
    const out = new Map<number, JobProgressView>()
    for (const [id, entry] of map) {
      const left = entry.totalGames - entry.gamesDone
      out.set(id, {
        totalGames: entry.totalGames,
        gamesDone: entry.gamesDone,
        chunks: entry.chunks,
        // Engine time per game of the finished chunks × games left, shared by the chunks playing right now (workers).
        etaSeconds:
          entry.doneGames > 0 && left > 0
            ? Math.round(((entry.doneMs / entry.doneGames) * left) / 1000 / Math.max(1, entry.chunks.running))
            : null,
      })
    }
    return out
  }

  private summary(job: JobRow, progress: Map<number, JobProgressView>): JobSummaryView {
    const players = [job.players[0] ?? 'r', job.players[1] ?? 'r'] as [string, string]
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      label: job.label,
      players,
      playersEs: [botLabel(players[0]), botLabel(players[1])],
      gamesPerPair: job.gamesPerPair,
      baseSeed: job.baseSeed.toString(),
      engineRev: job.engineRev,
      replaySample: job.replaySample,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      lab: labMode(job.params),
      archived: job.archivedAt !== null,
      progress: progress.get(job.id) ?? {
        totalGames: job.totalGames,
        gamesDone: 0,
        chunks: { total: 0, done: 0, running: 0, failed: 0 },
        etaSeconds: null,
      },
    }
  }

  /** Newest first: the ones in the list (default), the archived ones, or every job (`null`, for Claude). */
  async list(limit = 50, archived: boolean | null = false): Promise<JobSummaryView[]> {
    const jobs = await this.prisma.simulationJob.findMany({
      where: archived === null ? {} : { archivedAt: archived ? { not: null } : null },
      orderBy: { id: 'desc' },
      take: limit,
    })
    const progress = await this.progress(jobs.map((job) => job.id))
    return jobs.map((job) => this.summary(job, progress))
  }

  /** The list page: its jobs and how many are archived, cancelled or done (for the bulk buttons). */
  async listView(archived: boolean): Promise<{
    items: JobSummaryView[]
    counts: { archived: number; cancelled: number; done: number }
  }> {
    const [items, archivedCount, cancelled, done] = await Promise.all([
      this.list(archived ? 200 : 50, archived),
      this.prisma.simulationJob.count({ where: { archivedAt: { not: null } } }),
      this.prisma.simulationJob.count({ where: { status: 'cancelled' } }),
      this.prisma.simulationJob.count({ where: { status: 'done', archivedAt: null } }),
    ])
    return { items, counts: { archived: archivedCount, cancelled, done } }
  }

  /** Summaries of some jobs, newest first (the Laboratorio's list). */
  async summariesOf(ids: readonly number[]): Promise<JobSummaryView[]> {
    const jobs = await this.prisma.simulationJob.findMany({ where: { id: { in: [...ids] } }, orderBy: { id: 'desc' } })
    const progress = await this.progress(jobs.map((job) => job.id))
    return jobs.map((job) => this.summary(job, progress))
  }

  private async requireJob(rawId: string): Promise<JobRow> {
    const job = await this.prisma.simulationJob.findUnique({ where: { id: parseNumericId(rawId, 'Simulación') } })
    if (!job) throw new NotFoundException(`Simulación ${rawId} no encontrada.`)
    return job
  }

  async progressOf(rawId: string): Promise<JobSummaryView> {
    const job = await this.requireJob(rawId)
    return this.summary(job, await this.progress([job.id]))
  }

  async detail(rawId: string): Promise<JobDetailView> {
    const job = await this.requireJob(rawId)
    const params = job.params as { sideA?: number[]; sideB?: number[] }
    const sideA = params.sideA ?? []
    const sideB = params.sideB ?? []
    const [chunks, replays, snapshots, progress] = await Promise.all([
      this.prisma.simulationChunk.findMany({ where: { jobId: job.id }, orderBy: { idx: 'asc' } }),
      this.prisma.simulationReplay.findMany({
        where: { chunk: { jobId: job.id } },
        select: { id: true, chunkId: true, gameIndex: true, seed: true, winner: true, sizeBytes: true },
        orderBy: [{ chunkId: 'asc' }, { gameIndex: 'asc' }],
      }),
      this.snapshots.byIds([...new Set([...sideA, ...sideB])]),
      this.progress([job.id]),
    ])
    const done = chunks
      .filter((chunk) => chunk.status === 'done' && chunk.snapshotAId !== null && chunk.snapshotBId !== null)
      .map((chunk) => ({
        a: chunk.snapshotAId as number,
        b: chunk.snapshotBId as number,
        winsA: chunk.winsA ?? 0,
        winsB: chunk.winsB ?? 0,
        ties: chunk.ties ?? 0,
      }))
    const rows =
      job.kind === 'optimize'
        ? []
        : matrixRows(done, sideA, sideB).map((row) => ({
            snapshot: row.deck,
            total: row.total,
            rate: simulationRate(row.total),
            cells: row.cells.map((cell) => ({
              rival: cell.rival,
              record: cell.record,
              rate: cell.record ? simulationRate(cell.record) : null,
            })),
          }))
    const chunkOf = new Map(chunks.map((chunk) => [chunk.id, chunk]))
    return {
      ...this.summary(job, progress),
      snapshots,
      sideA,
      sideB,
      rows,
      optimize: job.kind === 'optimize' ? this.optimizeRows(chunks[0]?.extra ?? null, sideB) : null,
      consistency:
        job.kind === 'consistency'
          ? this.consistencyView(
              job,
              snapshots[0] ?? null,
              chunks[0]?.status === 'done' ? (chunks[0]?.extra ?? null) : null,
            )
          : null,
      replays: replays.map(
        (replay): ReplaySummaryView => ({
          id: replay.id,
          chunkId: replay.chunkId,
          a: chunkOf.get(replay.chunkId)?.snapshotAId ?? null,
          b: chunkOf.get(replay.chunkId)?.snapshotBId ?? null,
          gameIndex: replay.gameIndex,
          seed: replay.seed,
          winner: replay.winner as ReplaySummaryView['winner'],
          sizeBytes: replay.sizeBytes,
        }),
      ),
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        idx: chunk.idx,
        a: chunk.snapshotAId,
        b: chunk.snapshotBId,
        games: chunk.games,
        gamesDone: chunk.gamesDone,
        status: chunk.status,
        seed: chunk.seed.toString(),
        attempt: chunk.attempt,
        error: chunk.error,
      })),
    }
  }

  private optimizeRows(extra: Prisma.JsonValue | null, rivals: readonly number[]): JobDetailView['optimize'] {
    const combinations = (extra as { combinations?: unknown } | null)?.combinations
    if (!Array.isArray(combinations)) return []
    const index = this.catalog.requireIndex()
    return optimizeRanking(combinations as Parameters<typeof optimizeRanking>[0]).map((row) => ({
      cards: row.cards.map((engineId) => {
        const card = index.cardByEngineId(engineId)
        return { engineId, cardId: card?.id ?? null, nameEs: card?.nameEs ?? engineId }
      }),
      record: row.record,
      rate: simulationRate(row.record),
      perEnemy: row.perEnemy.map((record, at) => ({
        snapshot: rivals[at] ?? -1,
        record,
        rate: simulationRate(record),
      })),
    }))
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Consistency (Fase 8)
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * How soon one of my decks has its key attacker ready: one chunk of goldfish games (engine-cli `consistency`). The
   * key cards are the owner's pick or, by default, the attacker worth the most prize points.
   */
  async createConsistency(input: {
    deckId: string
    keyCards?: string[] | undefined
    games?: number | undefined
    bot?: string | undefined
    seed?: number | undefined
    /** Against the meta (D-019): the bank's rivals with their games (the Laboratorio builds it). */
    meta?: { era: string; format: string; rivals: ConsistencyRival[] } | undefined
  }): Promise<JobSummaryView> {
    const bot = input.bot ?? 'e2'
    if (!isBotCode(bot)) throw new BadRequestException({ code: 'validation', message: `Bot «${bot}» desconocido.` })
    const rivals = input.meta?.rivals.filter((rival) => rival.games > 0) ?? []
    if (input.meta && rivals.length === 0) {
      throw new UnprocessableEntityException({ code: 'empty_bank', message: 'El banco del meta no tiene rivales.' })
    }
    const games = input.meta
      ? rivals.reduce((sum, rival) => sum + rival.games, 0)
      : (input.games ?? DEFAULT_CONSISTENCY_GAMES)
    if (!Number.isInteger(games) || games < 10 || games > 10_000) {
      throw new BadRequestException({ code: 'validation', message: 'Partidas: de 10 a 10.000.' })
    }
    const snapshot = await this.snapshots.save({ deckId: input.deckId })
    if (!snapshot.simulable) {
      throw new UnprocessableEntityException({
        code: 'not_simulable',
        message: `No se puede simular ${snapshot.label}: ${describeProblems(snapshot.problems)}.`,
      })
    }
    const index = this.catalog.requireIndex()
    const row = await this.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })
    const cards = row.cards as unknown as { cardId: string; engineId: string; count: number }[]
    const entries: DeckCardEntry[] = cards.map((card) => ({ cardId: card.cardId, count: card.count }))
    const wanted = input.keyCards && input.keyCards.length > 0 ? input.keyCards : defaultKeyCards(entries, index)
    const groups = new Set(wanted.map((cardId) => index.cardById(cardId)?.functionalGroupId).filter(Boolean))
    const key = cards.filter((card) => groups.has(index.cardById(card.cardId)?.functionalGroupId))
    if (key.length === 0) {
      throw new BadRequestException({ code: 'validation', message: 'Las cartas clave tienen que estar en el mazo.' })
    }
    const baseSeed = input.seed ?? randomBaseSeed(() => randomInt(0, 2 ** 32 - 1) >>> 0)
    if (!Number.isSafeInteger(baseSeed) || baseSeed < 0 || baseSeed > MAX_BASE_SEED) {
      throw new BadRequestException({ code: 'validation', message: 'Semilla: un entero de 0 a 2^52.' })
    }
    const consistency: ConsistencyParams = {
      mode: input.meta ? 'meta' : 'goldfish',
      keyCards: [...new Set(key.map((card) => card.cardId))],
      engineIds: [...new Set(key.map((card) => card.engineId))],
      maxTurn: DEFAULT_CONSISTENCY_TURNS,
      bot,
      ...(input.meta ? { era: input.meta.era, format: input.meta.format, rivals } : {}),
    }
    const keyName = index.cardById(key[0]?.cardId ?? '')?.nameEs ?? 'atacante'
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simulationJob.create({
        data: {
          kind: 'consistency',
          label: input.meta
            ? `Consistencia contra el meta ${input.meta.era} de ${snapshot.label}: ${keyName}`
            : `Consistencia de ${snapshot.label}: ${keyName}`,
          params: { sideA: [snapshot.id], sideB: [], consistency } as unknown as Prisma.InputJsonValue,
          engineRev: this.engine.engineRev(),
          players: input.meta ? [bot, bot] : [bot, 'et'],
          gamesPerPair: games,
          baseSeed: BigInt(baseSeed),
          replaySample: 0,
          totalGames: games,
        },
      })
      await tx.simulationChunk.create({
        data: {
          jobId: created.id,
          idx: 0,
          snapshotAId: snapshot.id,
          snapshotBId: null,
          games,
          firstGame: 0,
          seed: BigInt(chunkSeed(baseSeed, 0)),
        },
      })
      return created
    })
    this.queue.notifyQueued()
    return this.summary(job, await this.progress([job.id]))
  }

  private consistencyView(
    job: JobRow,
    snapshot: SnapshotView | null,
    extra: Prisma.JsonValue | null,
  ): ConsistencyView | null {
    const result = extra as { ready?: ConsistencySplit; attack?: ConsistencySplit } | null
    if (!result?.ready || !result.attack) return null
    const params = (job.params as { consistency?: Partial<ConsistencyParams> }).consistency
    const index = this.catalog.requireIndex()
    const curves = (split: ConsistencySplit) => ({
      first: readinessCurve(split.first),
      second: readinessCurve(split.second),
      all: readinessCurve(mergeHistograms(split.first, split.second)),
    })
    const bot = params?.bot ?? job.players[0] ?? 'e2'
    return {
      mode: consistencyMode(job.params),
      era: params?.era ?? null,
      rivals: (params?.rivals ?? []).map((rival) => ({ label: rival.label, share: rival.share, games: rival.games })),
      deckId: snapshot?.deckId ?? null,
      deck: snapshot?.label ?? '',
      keyCards: (params?.keyCards ?? []).map((cardId) => ({
        cardId,
        nameEs: index.cardById(cardId)?.nameEs ?? cardId,
      })),
      bot,
      botEs: botLabel(bot),
      maxTurn: params?.maxTurn ?? result.ready.first.firstOnTurn.length,
      ready: curves(result.ready),
      attack: curves(result.attack),
      games: {
        first: result.ready.first.games,
        second: result.ready.second.games,
        all: result.ready.first.games + result.ready.second.games,
      },
    }
  }

  /** The latest finished consistency of a deck (any revision) in each mode, with its job summary; null when none. */
  async deckConsistency(
    rawDeckId: string,
  ): Promise<Record<'goldfish' | 'meta', { job: JobSummaryView; consistency: ConsistencyView } | null>> {
    const deckId = parseNumericId(rawDeckId, 'Mazo')
    const snapshots = await this.prisma.deckSnapshot.findMany({ where: { deckId }, select: { id: true } })
    if (snapshots.length === 0) return { goldfish: null, meta: null }
    const jobs = await this.prisma.simulationJob.findMany({
      where: {
        kind: 'consistency',
        status: 'done',
        chunks: { some: { snapshotAId: { in: snapshots.map((row) => row.id) } } },
      },
      orderBy: { id: 'desc' },
      select: { id: true, params: true },
      take: 50,
    })
    const latest = async (mode: 'goldfish' | 'meta') => {
      const job = jobs.find((row) => consistencyMode(row.params) === mode)
      if (!job) return null
      const detail = await this.detail(String(job.id))
      return detail.consistency ? { job: detail, consistency: detail.consistency } : null
    }
    return { goldfish: await latest('goldfish'), meta: await latest('meta') }
  }

  async cancel(rawId: string): Promise<JobSummaryView> {
    const job = await this.requireJob(rawId)
    if (job.status === 'queued' || job.status === 'running') {
      await this.prisma.$transaction([
        this.prisma.simulationChunk.updateMany({
          where: { jobId: job.id, status: { in: ['queued', 'leased'] } },
          data: { status: 'cancelled', leaseUntil: null },
        }),
        this.prisma.simulationJob.update({
          where: { id: job.id },
          data: { status: 'cancelled', finishedAt: new Date() },
        }),
      ])
    }
    return this.progressOf(rawId)
  }

  /** Archive (hide from the list) or bring back a job that is not running. */
  async archive(rawId: string, archived: boolean): Promise<JobSummaryView> {
    const job = await this.requireJob(rawId)
    if (archived && (job.status === 'queued' || job.status === 'running')) {
      throw new BadRequestException({
        code: 'job_running',
        message: 'Esperá a que termine (o cancelala) antes de archivarla.',
      })
    }
    if (archived !== (job.archivedAt !== null)) {
      await this.prisma.simulationJob.update({
        where: { id: job.id },
        data: { archivedAt: archived ? new Date() : null },
      })
    }
    return this.progressOf(rawId)
  }

  /** Bulk clean-up from the list: delete every cancelled job, or archive every finished one. */
  async cleanup(action: 'delete_cancelled' | 'archive_done'): Promise<{ count: number }> {
    if (action === 'delete_cancelled') {
      return { count: (await this.prisma.simulationJob.deleteMany({ where: { status: 'cancelled' } })).count }
    }
    const archived = await this.prisma.simulationJob.updateMany({
      where: { status: 'done', archivedAt: null },
      data: { archivedAt: new Date() },
    })
    return { count: archived.count }
  }

  async remove(rawId: string): Promise<void> {
    const job = await this.requireJob(rawId)
    if (job.status === 'queued' || job.status === 'running') {
      throw new BadRequestException({ code: 'job_running', message: 'Cancelá la simulación antes de borrarla.' })
    }
    await this.prisma.simulationJob.delete({ where: { id: job.id } })
  }

  /** A replay with the Spanish name of every card it mentions (engine ids → catalog). */
  async replayRaw(rawId: string): Promise<unknown> {
    const row = await this.prisma.simulationReplay.findUnique({
      where: { id: parseNumericId(rawId, 'Repetición') },
      select: { dataGz: true },
    })
    if (!row) throw new NotFoundException(`Repetición ${rawId} no encontrada.`)
    return gunzipJson(row.dataGz)
  }

  async replay(rawId: string): Promise<ReplayView> {
    const row = await this.prisma.simulationReplay.findUnique({
      where: { id: parseNumericId(rawId, 'Repetición') },
      select: {
        dataGz: true,
        gameIndex: true,
        seed: true,
        winner: true,
        chunk: {
          select: {
            snapshotAId: true,
            snapshotBId: true,
            job: { select: { id: true, label: true, players: true, engineRev: true } },
          },
        },
      },
    })
    if (!row) throw new NotFoundException(`Repetición ${rawId} no encontrada.`)
    const replay = gunzipJson<{ cards?: Record<string, unknown> }>(row.dataGz)
    const index = this.catalog.requireIndex()
    const names: Record<string, string> = {}
    const cardIds: Record<string, string> = {}
    for (const engineId of Object.keys(replay.cards ?? {})) {
      const card = index.cardByEngineId(engineId)
      names[engineId] = card?.nameEs ?? engineId
      if (card) cardIds[engineId] = card.id
    }
    const ids = [row.chunk.snapshotAId, row.chunk.snapshotBId].filter((id): id is number => id !== null)
    const snapshots = await this.prisma.deckSnapshot.findMany({
      where: { id: { in: ids } },
      select: { id: true, label: true },
    })
    const labelOf = (id: number | null) => snapshots.find((snapshot) => snapshot.id === id)?.label ?? null
    const job = row.chunk.job
    return {
      replay,
      names,
      cardIds,
      game: {
        jobId: job.id,
        jobLabel: job.label,
        engineRev: job.engineRev,
        gameIndex: row.gameIndex,
        seed: row.seed,
        winner: row.winner as ReplayView['game']['winner'],
        decks: [labelOf(row.chunk.snapshotAId), labelOf(row.chunk.snapshotBId)],
        playersEs: [botLabel(job.players[0] ?? ''), botLabel(job.players[1] ?? '')],
      },
    }
  }

  async engineView(): Promise<EngineView> {
    const [summary, upstream, workers, leased] = await Promise.all([
      this.engine.summary(),
      this.upstream.status(this.engine.engineRev()).catch(() => null),
      this.prisma.workerNode.findMany({ orderBy: { lastSeenAt: 'desc' } }),
      this.prisma.simulationChunk.findMany({
        where: { status: 'leased', leaseUntil: { gt: new Date() } },
        select: { id: true, jobId: true, workerId: true, gamesDone: true, games: true },
      }),
    ])
    const now = Date.now()
    return {
      engineRev: this.engine.engineRev(),
      ...summary,
      upstream,
      workers: workers.map((worker): WorkerView => {
        const current = leased.find((chunk) => chunk.workerId === worker.id)
        return {
          id: worker.id,
          name: worker.name,
          engineRev: worker.engineRev,
          cliVersion: worker.cliVersion,
          cores: worker.cores,
          version: worker.version,
          lastSeenAt: worker.lastSeenAt,
          online: now - worker.lastSeenAt.getTime() < WORKER_ONLINE_MS,
          current: current
            ? { jobId: current.jobId, chunkId: current.id, gamesDone: current.gamesDone, games: current.games }
            : null,
        }
      }),
      bots: Object.entries(BOT_LABEL_ES).map(([code, label]) => ({ code, label })),
    }
  }

  /**
   * The «simulación» column of a deck: finished games of its current list (same snapshot key) against any rival,
   * for the bot pair with the most games (the rate depends on the bot, so pairs are never mixed).
   */
  async deckColumn(deckId: number): Promise<{
    record: GameRecord
    players: [string, string]
    games: number
    jobs: number
    engineRev: string
  } | null> {
    const latest = await this.prisma.deckSnapshot.findFirst({ where: { deckId }, orderBy: { id: 'desc' } })
    if (!latest) return null
    let current: SnapshotView
    try {
      current = await this.snapshots.preview({ deckId: idToString(deckId) }).then((preview) => ({ ...preview, id: -1 }))
    } catch {
      return null
    }
    const snapshots = await this.prisma.deckSnapshot.findMany({
      where: { deckId, key: current.key },
      select: { id: true },
    })
    const ids = snapshots.map((row) => row.id)
    if (ids.length === 0) return null
    const chunks = await this.prisma.simulationChunk.findMany({
      where: {
        status: 'done',
        OR: [{ snapshotAId: { in: ids } }, { snapshotBId: { in: ids } }],
        job: { kind: { in: ['matrix', 'compare'] } },
      },
      select: {
        snapshotAId: true,
        snapshotBId: true,
        winsA: true,
        winsB: true,
        ties: true,
        jobId: true,
        job: { select: { players: true, engineRev: true } },
      },
    })
    if (chunks.length === 0) return null
    // One engine and one bot pair, never mixed: the current engine first (after a deckgym update the old results stay
    // apart), then the bot pair with the most chunks.
    const currentRev = this.engine.engineRev()
    const byPlayers = new Map<string, typeof chunks>()
    for (const chunk of chunks) {
      const key = `${chunk.job.engineRev}|${chunk.job.players.join(',')}`
      byPlayers.set(key, [...(byPlayers.get(key) ?? []), chunk])
    }
    const isCurrent = (key: string) => (key.startsWith(`${currentRev}|`) ? 1 : 0)
    const [groupKey, chosen] = [...byPlayers].sort(
      (x, y) => isCurrent(y[0]) - isCurrent(x[0]) || y[1].length - x[1].length,
    )[0] as [string, typeof chunks]
    const pairKey = groupKey.split('|')[1] ?? ''
    const own = new Set(ids)
    const outcomes = chosen.map((chunk) => ({
      a: own.has(chunk.snapshotAId ?? -1) ? 0 : 1,
      b: own.has(chunk.snapshotAId ?? -1) ? 1 : 0,
      winsA: chunk.winsA ?? 0,
      winsB: chunk.winsB ?? 0,
      ties: chunk.ties ?? 0,
    }))
    const record = deckRecord(outcomes, 0)
    const players = pairKey.split(',') as [string, string]
    return {
      record,
      players,
      games: record.wins + record.losses + record.ties,
      jobs: new Set(chosen.map((chunk) => chunk.jobId)).size,
      engineRev: chosen[0]?.job.engineRev ?? this.engine.engineRev(),
    }
  }
}

/** Whether a job belongs to the Laboratorio, from the `lab` block of its params (T-008). */
/** A rival of a consistency «contra el meta» as the job stores it. */
export interface ConsistencyRival {
  snapshot: number
  label: string
  listKey: string
  share: number
  weight: number
  games: number
}

/** What a consistency job stores in `params.consistency`. */
export interface ConsistencyParams {
  /** Missing in jobs from before D-019: goldfish. */
  mode: 'goldfish' | 'meta'
  keyCards: string[]
  engineIds: string[]
  maxTurn: number
  bot: string
  era?: string
  format?: string
  rivals?: ConsistencyRival[]
}

export function consistencyMode(params: Prisma.JsonValue): 'goldfish' | 'meta' {
  return (params as { consistency?: { mode?: unknown } } | null)?.consistency?.mode === 'meta' ? 'meta' : 'goldfish'
}

export function labMode(params: Prisma.JsonValue): 'test' | 'explore' | null {
  const mode = (params as { lab?: { mode?: unknown } } | null)?.lab?.mode
  return mode === 'test' || mode === 'explore' ? mode : null
}

/** A matrix with an empty «Contra» side: side A against itself, every pair once (DECISIONES 6.4). */
function withRivals(input: CreateJobInput): CreateJobInput {
  return input.kind === 'matrix' && input.sideB.length === 0 ? { ...input, sideB: input.sideA } : input
}

function defaultLabel(kind: SimulationKind, sideA: readonly SnapshotView[], sideB: readonly SnapshotView[]): string {
  if (kind === 'optimize') return `Optimizar ${sideA[0]?.label ?? ''}`
  if (kind === 'explore') return `Explorar ${sideA[0]?.label ?? ''}`
  if (kind === 'compare') return `${sideA.map((s) => s.label).join(' vs ')} contra ${sideB.length} rivales`
  return `Matriz ${sideA.length} × ${sideB.length}`
}

/** Multisets of size k from n candidates: C(n + k − 1, k) (deckgym's combinations repeat cards). */
function multisetCount(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n + i - 1)) / i
  return Math.round(result)
}
