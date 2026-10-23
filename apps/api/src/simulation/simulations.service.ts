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
  type CardId,
  type ConsistencySplit,
  chunkSeed,
  combinationNamesEs,
  comparePairings,
  comparisonSeed,
  DEFAULT_BOT,
  DEFAULT_CONSISTENCY_GAMES,
  DEFAULT_CONSISTENCY_TURNS,
  DEFAULT_PLAYERS,
  type DeckCardEntry,
  deckRecord,
  defaultKeyCards,
  defaultReplaySample,
  describeProblems,
  ET_BOT_CODE,
  estimateSeconds,
  type GameRecord,
  isBotCode,
  LEGACY_DEFAULT_BOT,
  MAX_BASE_SEED,
  MAX_GAMES_PER_CHUNK,
  matrixPairings,
  matrixRows,
  mergeHistograms,
  type OptimizeCandidate,
  optimizeConfirmationGames,
  optimizeConfirmGamesPerRival,
  optimizeFinalists,
  optimizePlan,
  optimizeRanking,
  planChunks,
  randomBaseSeed,
  readinessCurve,
  type SelectableEnergy,
  type SimulationKind,
  simulationRate,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import { gunzipJson } from '../http/gunzip.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ChunkCacheService } from './chunk-cache.service.js'
import { engineChangeView } from './engine-change.service.js'
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
/** A claim on an optimize's confirmation older than this was a crash halfway: the next read queues it again. */
const CONFIRM_CLAIM_MS = 60_000
const WORKER_ONLINE_MS = 2 * 60 * 1000

/** A snapshot that already exists: the app's own jobs (the confirmation of an optimize) reuse its rivals. */
type JobSource = SnapshotSource | { snapshotId: number }

/** H-011.5: the combinations a confirmation plays (engine ids, in the optimize's order) and each one's snapshot. */
type ConfirmationPlan = {
  combinations: string[][]
  /** null: the deck with that combination is not one the engine plays. */
  snapshots: (number | null)[]
}

/**
 * What an optimize keeps in `params.confirmation`: `pending` from the update that ends it (with `claimedAt` while one
 * reader queues it, and the last `error`, retried when the optimize is read), then the comparison, or `skipped`.
 */
type ConfirmationParams =
  | { pending: true; claimedAt?: number; error?: string }
  | ({ jobId: number } & ConfirmationPlan)
  | { skipped: string }

export interface CreateJobInput {
  kind: SimulationKind
  label?: string | undefined
  sideA: JobSource[]
  sideB: JobSource[]
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
  /** Every game reported by index (`params.perGame`, H-010): pairings only, played by workers from 0.2.5 on. */
  perGame?: boolean | undefined
  /**
   * A comparison with each rival's own games (fase 42: by its weight), by side B's order; `gamesPerPair` stays the
   * job's nominal number.
   */
  gamesByRival?: number[] | undefined
  /** D-024: below 0 waits behind the rest (a search's replay with another bot, review of #49). */
  priority?: number | undefined
  /** The meta bank a calibration matrix plays (R-012, calibration.service.ts). */
  calibration?: Prisma.InputJsonValue | undefined
  /** Phase 42: false plays every chunk, even one the exact cache has (a real repeat). */
  cache?: boolean | undefined
  /** The confirmation of an optimize (H-011.5): stored as `params.confirmationOf`, kept out of the decks' column. */
  confirmationOf?: ({ jobId: number } & ConfirmationPlan) | undefined
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
    private readonly logger: PinoLogger,
    private readonly cache: ChunkCacheService,
  ) {
    this.logger.setContext(SimulationsService.name)
    this.queue.onJobDone((jobId) => this.afterDone(jobId))
  }

  /** H-011.5: a finished optimize queues the confirmation of its best combinations. */
  private async afterDone(jobId: number): Promise<void> {
    const job = await this.prisma.simulationJob.findUnique({ where: { id: jobId }, select: { kind: true } })
    if (job?.kind === 'optimize') await this.confirmOptimize(jobId)
  }

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
    /** Every game the job plays; for an optimize, its confirmation's too (`confirmationGames`). */
    totalGames: number
    confirmationGames: number
    /** An optimize's combinations, counted as the engine plays them (H-050); 0 for the other kinds. */
    combinations: number
    /** Why creating this optimize would be refused (H-050), in Spanish; null when it would be queued. */
    optimizeProblem: string | null
    /** Candidates that play the same as another one and do not go on their own (H-050), in Spanish. */
    optimizeMerged: string[]
    estimatedSeconds: number
    engineRev: string
  }> {
    this.validate(input)
    input = withRivals(input)
    // Only the app's own jobs name an existing snapshot; a preview comes from the screen, with decks and lists.
    const previewOf = (source: JobSource) =>
      'snapshotId' in source ? this.existingSnapshot(source.snapshotId) : this.snapshots.preview(source)
    const sideA = await Promise.all(input.sideA.map(previewOf))
    const sideB = await Promise.all(input.sideB.map(previewOf))
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
          : bIds.length
    // optimize: every combination against every rival, then its confirmation (H-011.5) when it ends.
    let combinations = 0
    let optimizeProblem: string | null = null
    let optimizeMerged: string[] = []
    const optimizeSource = input.sideA[0]
    if (input.kind === 'optimize' && input.optimize && optimizeSource) {
      // The cards of the deck as the job will read them, so the screen and the job count the same.
      const cards =
        'snapshotId' in optimizeSource
          ? ((await this.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: optimizeSource.snapshotId } }))
              .cards as unknown as SnapshotCardRow[])
          : (await this.snapshots.draft(optimizeSource)).draft.cards
      const base = optimizeBase(cards, input.optimize.remove, this.catalog.requireIndex())
      const { candidates, problems, merged } = await this.optimizeCandidates(input.optimize.candidates)
      const plan = optimizePlan(candidates, base.keptByName, base.missing)
      combinations = plan.combinations
      optimizeProblem = problems[0]?.message ?? plan.problem
      optimizeMerged = merged
    }
    const confirmationGames =
      input.kind === 'optimize' ? optimizeConfirmationGames(combinations, bIds.length, input.gamesPerPair) : 0
    const totalGames =
      (input.kind === 'optimize' ? combinations * bIds.length : pairings) * input.gamesPerPair + confirmationGames
    return {
      sideA,
      sideB,
      pairings,
      totalGames,
      confirmationGames,
      combinations,
      optimizeProblem,
      optimizeMerged,
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
    const snapshotOf = async (source: JobSource) => {
      const key = JSON.stringify(source)
      const hit = saved.get(key)
      if (hit) return hit
      const snapshot =
        'snapshotId' in source ? await this.existingSnapshot(source.snapshotId) : await this.snapshots.save(source)
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
    const replaySample = Math.min(5, Math.max(0, input.replaySample ?? defaultReplaySample(input.kind)))
    const label = input.label?.trim() || defaultLabel(input.kind, sideA, sideB)

    let params: Prisma.InputJsonValue
    let chunks: { idx: number; a: number | null; b: number | null; games: number; firstGame: number }[]
    if (input.kind === 'optimize') {
      const optimize = await this.optimizeJob(input, sideA[0] as SnapshotView, sideB)
      // The cards taken out stay with the job: the confirmation rebuilds each combination's deck from them.
      params = {
        sideA: okA,
        sideB: okB,
        engineJob: optimize.engineJob,
        remove: input.optimize?.remove ?? [],
      } as Prisma.InputJsonValue
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
        ...(input.perGame ? { perGame: true } : {}),
        ...(input.calibration === undefined ? {} : { calibration: input.calibration }),
        ...(input.confirmationOf ? { confirmationOf: input.confirmationOf } : {}),
      }
      chunks =
        input.kind === 'compare' && input.gamesByRival
          ? pairings
              .flatMap((pairing) => {
                const at = sideB.findIndex((snapshot) => snapshot.id === pairing.b)
                return planChunks([pairing], input.gamesByRival?.[at] ?? input.gamesPerPair)
              })
              .map((chunk, idx) => ({ ...chunk, idx }))
          : planChunks(pairings, input.gamesPerPair)
    }
    const totalGames = chunks.reduce((sum, chunk) => sum + chunk.games, 0)
    // H-020: in a comparison every deck plays each rival with the same seeds (variants face the same shuffles);
    // a matrix keeps base + idx.
    const seedOf = (chunk: { idx: number; b: number | null; firstGame: number }) =>
      input.kind === 'compare' && chunk.b !== null
        ? comparisonSeed(baseSeed, okB.indexOf(chunk.b), Math.floor(chunk.firstGame / MAX_GAMES_PER_CHUNK))
        : chunkSeed(baseSeed, chunk.idx)
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
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
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
          seed: BigInt(seedOf(chunk)),
        })),
      })
      return created
    })
    // Phase 42: what a finished chunk already played exactly is copied, not played again.
    if ((input.kind === 'matrix' || input.kind === 'compare') && input.cache !== false) await this.cache.fill(job.id)
    this.queue.notifyQueued()
    const current = await this.prisma.simulationJob.findUniqueOrThrow({ where: { id: job.id } })
    return this.summary(current, await this.progress([job.id]))
  }

  private async existingSnapshot(id: number): Promise<SnapshotView> {
    const [snapshot] = await this.snapshots.byIds([id])
    if (!snapshot) throw new NotFoundException(`La foto de mazo ${id} no existe.`)
    return snapshot
  }

  /**
   * H-011.5: the best of up to 200 combinations, measured on the same games, is the luckiest one too (the winner's
   * curse). The `OPTIMIZE_CONFIRM_TOP` best (and the ones tied with the last) are played again against the same rivals
   * with fresh seeds and more games, as the Laboratorio's confirmation does; the optimize's view shows both.
   *
   * Once per optimize: the update that ends it marks it `pending` (WorkerQueueService.settle), and this claims the mark
   * in one statement, so two readers never queue it twice. A failed attempt goes back to `pending` with its error and
   * is retried when the optimize is read (`detail`). null when there is nothing to do.
   */
  async confirmOptimize(jobId: number): Promise<JobSummaryView | null> {
    const now = Date.now()
    const claimed = await this.prisma.$executeRaw`
      UPDATE "simulation_jobs"
      SET "params" = jsonb_set("params", '{confirmation}', jsonb_build_object('pending', true, 'claimedAt', ${now}::bigint))
      WHERE "id" = ${jobId} AND "kind" = 'optimize' AND "status" = 'done'
        AND "params"->'confirmation'->>'pending' = 'true'
        AND COALESCE(("params"->'confirmation'->>'claimedAt')::bigint, 0) < ${now - CONFIRM_CLAIM_MS}::bigint`
    if (claimed === 0) return null
    try {
      const { confirmation, job } = await this.queueConfirmation(jobId)
      await this.setConfirmation(jobId, confirmation)
      return job
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.setConfirmation(jobId, { pending: true, error: message.slice(0, 300) })
      throw error
    }
  }

  /** `params.confirmation` of an optimize, written alone (nothing else of its params changes). */
  private async setConfirmation(jobId: number, confirmation: ConfirmationParams): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "simulation_jobs" SET "params" = jsonb_set("params", '{confirmation}', ${JSON.stringify(confirmation)}::jsonb)
      WHERE "id" = ${jobId}`
  }

  /** The comparison that confirms an optimize: the one already queued (a crash after creating it), or a new one. */
  private async queueConfirmation(
    jobId: number,
  ): Promise<{ confirmation: ConfirmationParams; job: JobSummaryView | null }> {
    const queued = await this.prisma.simulationJob.findFirst({
      where: { kind: 'compare', params: { path: ['confirmationOf', 'jobId'], equals: jobId } },
    })
    if (queued) {
      const plan = (queued.params as unknown as { confirmationOf: ConfirmationPlan }).confirmationOf
      return {
        confirmation: { jobId: queued.id, combinations: plan.combinations, snapshots: plan.snapshots },
        job: this.summary(queued, await this.progress([queued.id])),
      }
    }
    const job = await this.prisma.simulationJob.findUniqueOrThrow({ where: { id: jobId } })
    const params = job.params as { sideA?: number[]; sideB?: number[]; remove?: { cardId: string; count: number }[] }
    const skipped = (reason: string) => ({ confirmation: { skipped: reason }, job: null })
    if (!params.remove || !params.sideA?.[0] || !params.sideB?.length) return skipped('El trabajo no guardó sus datos.')
    const chunk = await this.prisma.simulationChunk.findFirst({ where: { jobId, status: 'done' } })
    const combinations = (chunk?.extra as { combinations?: unknown } | null)?.combinations
    if (!Array.isArray(combinations)) return skipped('El motor no devolvió combinaciones.')
    const best = optimizeFinalists(optimizeRanking(combinations as Parameters<typeof optimizeRanking>[0]))
    if (best.length === 0) return skipped('El motor no devolvió combinaciones.')
    const index = this.catalog.requireIndex()
    const base = await this.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: params.sideA[0] } })
    const { keptById: kept } = optimizeBase(base.cards as unknown as SnapshotCardRow[], params.remove, index)
    const sources: SnapshotSource[] = best.map((combination, at) => {
      const cards = new Map(kept)
      const names: string[] = []
      for (const engineId of combination.cards) {
        const card = index.cardByEngineId(engineId)
        if (!card)
          throw new UnprocessableEntityException({ code: 'unknown_card', message: `Carta ${engineId} desconocida.` })
        cards.set(card.id, (cards.get(card.id) ?? 0) + 1)
        names.push(card.nameEs)
      }
      return {
        cards: [...cards].map(([cardId, count]) => ({ cardId: cardId as CardId, count })),
        energies: base.energies as SelectableEnergy[],
        label: `${base.label} · ${at + 1}.º: + ${combinationNamesEs(names)}`,
        origin: 'lab',
      }
    })
    // Saved one by one so each combination keeps its snapshot (null: the engine would not play it).
    const variants: (SnapshotView | null)[] = []
    for (const source of sources) {
      const snapshot = await this.snapshots.save(source)
      variants.push(snapshot.simulable ? snapshot : null)
    }
    const playable = variants.filter((snapshot): snapshot is SnapshotView => snapshot !== null)
    if (playable.length === 0) {
      return skipped('Ninguna de las mejores combinaciones da un mazo que el motor juegue.')
    }
    const plan: ConfirmationPlan = {
      combinations: best.map((combination) => combination.cards),
      snapshots: variants.map((snapshot) => snapshot?.id ?? null),
    }
    const confirmation = await this.create({
      kind: 'compare',
      label: `Confirmación de «${job.label}» (#${job.id})`,
      sideA: playable.map((snapshot) => ({ snapshotId: snapshot.id })),
      sideB: params.sideB.map((snapshotId) => ({ snapshotId })),
      gamesPerPair: Math.min(MAX_GAMES_PER_PAIR, optimizeConfirmGamesPerRival(job.gamesPerPair)),
      // The optimize job's own bots (a stored job always has them; the fallback is the one of its time, D-029).
      players: [job.players[0] ?? LEGACY_DEFAULT_BOT, job.players[1] ?? LEGACY_DEFAULT_BOT],
      replaySample: 0,
      confirmationOf: { jobId, ...plan },
    })
    return { confirmation: { jobId: confirmation.id, ...plan }, job: confirmation }
  }

  /**
   * The engine-cli optimize job: deck minus the removed cards, candidates as implemented engine ids (each as many times
   * as copies of it still fit, H-050), rivals.
   */
  private async optimizeJob(input: CreateJobInput, deck: SnapshotView, rivals: SnapshotView[]) {
    const row = await this.prisma.deckSnapshot.findUniqueOrThrow({ where: { id: deck.id } })
    const base = optimizeBase(
      row.cards as unknown as SnapshotCardRow[],
      input.optimize?.remove ?? [],
      this.catalog.requireIndex(),
    )
    if (base.missing === 0)
      throw new BadRequestException({ code: 'validation', message: 'Sacá al menos una carta para optimizar.' })
    const { candidates, problems } = await this.optimizeCandidates(input.optimize?.candidates ?? [])
    const problem = problems[0]
    if (problem) {
      throw problem.kind === 'unknown'
        ? new BadRequestException({ code: 'validation', message: problem.message })
        : new UnprocessableEntityException({ code: 'not_simulable', message: problem.message })
    }
    if (candidates.length === 0)
      throw new BadRequestException({ code: 'validation', message: 'Elegí cartas candidatas.' })
    const energyLine = row.deckgymText.split('\n').find((line) => line.startsWith('Energy:')) ?? ''
    const enemies = rivals.filter((rival) => rival.simulable).map((rival) => rival.deckgymText)
    if (enemies.length === 0) throw new BadRequestException({ code: 'validation', message: 'Elegí al menos un rival.' })
    // H-050: each candidate as many times as copies of its name still fit (X + X too), counted the same way, and
    // refused for the same reasons as the preview says.
    const plan = optimizePlan(candidates, base.keptByName, base.missing)
    if (plan.problem) throw new BadRequestException({ code: 'validation', message: plan.problem })
    return {
      engineJob: {
        deck: `${energyLine}\n${base.lines.join('\n')}\n`,
        candidates: plan.list,
        missing: base.missing,
        enemies,
        gamesPerEnemy: input.gamesPerPair,
        players: input.players,
      },
      estimatedGames: plan.combinations * enemies.length * input.gamesPerPair,
    }
  }

  /**
   * «Optimizar»'s candidates as the engine plays them: an edition it implements (another of the same card if needed)
   * and the English name the deck rules count copies by. Editions of one functional card play the same, so only the
   * first goes (H-050: each extra one would multiply what the engine builds before dropping repeats). An unknown or
   * unplayable card is a problem: the job refuses it, the preview says it.
   */
  private async optimizeCandidates(cardIds: readonly string[]): Promise<{
    candidates: OptimizeCandidate[]
    problems: { kind: 'unknown' | 'not_simulable'; message: string }[]
    /** Editions left out because another of the same functional card is already a candidate, in Spanish. */
    merged: string[]
  }> {
    const index = this.catalog.requireIndex()
    const status = await this.engine.status()
    const candidates: OptimizeCandidate[] = []
    const problems: { kind: 'unknown' | 'not_simulable'; message: string }[] = []
    const merged: string[] = []
    const groups = new Map<string, string>()
    for (const cardId of cardIds) {
      const card = index.cardById(cardId)
      if (!card) {
        problems.push({ kind: 'unknown', message: `Carta ${cardId} desconocida.` })
        continue
      }
      const first = groups.get(card.functionalGroupId)
      if (first !== undefined) {
        if (first !== card.id) merged.push(`${card.nameEs} (${card.id}) juega igual que ${first}: va una sola.`)
        continue
      }
      const played = status(card.engineId) === true ? card : null
      const alternative =
        played ?? index.cardsOfGroup(card.functionalGroupId).find((other) => status(other.engineId) === true) ?? null
      if (!alternative) {
        problems.push({
          kind: 'not_simulable',
          message: `${card.nameEs} (${card.id}) no está implementada en el motor.`,
        })
        continue
      }
      groups.set(card.functionalGroupId, card.id)
      candidates.push({ id: alternative.engineId, name: alternative.nameEn })
    }
    return { candidates, problems, merged }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------------------------------------------

  private async progress(jobIds: readonly number[]): Promise<Map<number, JobProgressView>> {
    const [groups, leases] = await Promise.all([
      this.prisma.simulationChunk.groupBy({
        by: ['jobId', 'status'],
        where: { jobId: { in: [...jobIds] } },
        _count: { _all: true },
        _sum: { gamesDone: true, games: true, durationMs: true },
      }),
      // Workers playing each job right now: a worker with a batch holds many chunks but plays them at once (B2).
      this.prisma.simulationChunk.groupBy({
        by: ['jobId', 'workerId'],
        where: {
          jobId: { in: [...jobIds] },
          status: 'leased',
          leaseUntil: { gt: new Date() },
          workerId: { not: null },
        },
      }),
    ])
    const workers = new Map<number, number>()
    for (const lease of leases) workers.set(lease.jobId, (workers.get(lease.jobId) ?? 0) + 1)
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
        // Engine time per game of the finished chunks × games left, shared by the workers playing it right now.
        etaSeconds:
          entry.doneGames > 0 && left > 0
            ? Math.round(((entry.doneMs / entry.doneGames) * left) / 1000 / Math.max(1, workers.get(id) ?? 0))
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
      priority: job.priority,
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
      engineChange: engineChangeView(job.params),
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
    let job = await this.requireJob(rawId)
    // H-011.5: a confirmation that could not be queued when the optimize ended is retried when it is read.
    if (confirmationPending(job)) {
      const id = job.id
      await this.confirmOptimize(id).catch((error: unknown) => {
        this.logger.warn({ job: id, error: String(error).slice(0, 300) }, 'optimize confirmation not queued')
      })
      job = await this.requireJob(rawId)
    }
    const params = job.params as { sideA?: number[]; sideB?: number[] }
    const sideA = params.sideA ?? []
    const sideB = params.sideB ?? []
    const [chunks, snapshots, progress] = await Promise.all([
      this.prisma.simulationChunk.findMany({ where: { jobId: job.id }, orderBy: { idx: 'asc' } }),
      this.snapshots.byIds([...new Set([...sideA, ...sideB])]),
      this.progress([job.id]),
    ])
    // Phase 42: a chunk copied from the cache shows the replays of the chunk it came from (they are the same games).
    const copyOf = new Map(chunks.flatMap((chunk) => (chunk.cachedFrom === null ? [] : [[chunk.cachedFrom, chunk]])))
    const replays = (
      await this.prisma.simulationReplay.findMany({
        where: { OR: [{ chunk: { jobId: job.id } }, { chunkId: { in: [...copyOf.keys()] } }] },
        select: { id: true, chunkId: true, gameIndex: true, seed: true, winner: true, sizeBytes: true },
        orderBy: [{ chunkId: 'asc' }, { gameIndex: 'asc' }],
      })
    ).flatMap((replay) => {
      const copy = copyOf.get(replay.chunkId)
      if (!copy) return [replay]
      const wanted = copy.firstGame === 0 ? job.replaySample : 0
      return replay.gameIndex < wanted ? [{ ...replay, chunkId: copy.id }] : []
    })
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
      optimizeConfirmation: job.kind === 'optimize' ? await this.optimizeConfirmation(job.params) : null,
      // «Reintentar lo que falló»: why not, for a failed job (null when it can, or when it did not fail).
      retryBlocked: job.status === 'failed' ? ((await this.retryBlocked(job))?.message ?? null) : null,
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
        cachedFrom: chunk.cachedFrom,
      })),
    }
  }

  /**
   * What the confirmation of an optimize measured for each of its best combinations, in the optimize's order. A row
   * has a rate only once every rival was played: until then (or when a rival failed in the engine) it says how many.
   */
  private async optimizeConfirmation(params: Prisma.JsonValue): Promise<JobDetailView['optimizeConfirmation']> {
    const own = params as { sideB?: number[]; confirmation?: ConfirmationParams } | null
    const confirmation = own?.confirmation
    if (!confirmation) return null
    const rivals = own?.sideB?.length ?? 0
    if ('pending' in confirmation) {
      return { jobId: null, status: 'pending', error: confirmation.error ?? null, engineChange: null, rivals, rows: [] }
    }
    if ('skipped' in confirmation) {
      return { jobId: null, status: 'skipped', error: confirmation.skipped, engineChange: null, rivals, rows: [] }
    }
    const job = await this.prisma.simulationJob.findUnique({ where: { id: confirmation.jobId } })
    if (!job) return null
    const chunks = await this.prisma.simulationChunk.findMany({
      where: { jobId: job.id },
      select: { snapshotAId: true, snapshotBId: true, status: true, winsA: true, winsB: true, ties: true },
    })
    const sideB = (job.params as { sideB?: number[] }).sideB ?? []
    const index = this.catalog.requireIndex()
    return {
      jobId: job.id,
      status: job.status,
      error: null,
      engineChange: engineChangeView(job.params),
      rivals: sideB.length,
      rows: confirmation.combinations.map((cards, at) => {
        const snapshot = confirmation.snapshots[at] ?? null
        // A variant that is also a rival does not play itself (comparePairings).
        const opponents = sideB.filter((rival) => rival !== snapshot)
        let rivalsPlayed = 0
        let rivalsFailed = 0
        const record = { wins: 0, losses: 0, ties: 0 }
        for (const rival of opponents) {
          // A pairing may be split in several chunks: it counts once all of them are done.
          const pairing = chunks.filter((chunk) => chunk.snapshotAId === snapshot && chunk.snapshotBId === rival)
          if (pairing.some((chunk) => chunk.status === 'failed')) rivalsFailed++
          else if (pairing.length > 0 && pairing.every((chunk) => chunk.status === 'done')) {
            rivalsPlayed++
            for (const chunk of pairing) {
              record.wins += chunk.winsA ?? 0
              record.losses += chunk.winsB ?? 0
              record.ties += chunk.ties ?? 0
            }
          }
        }
        const complete = snapshot !== null && opponents.length > 0 && rivalsPlayed === opponents.length
        return {
          rank: at + 1,
          cards: cards.map((engineId) => {
            const card = index.cardByEngineId(engineId)
            return { engineId, cardId: card?.id ?? null, nameEs: card?.nameEs ?? engineId }
          }),
          rivalsPlayed: snapshot === null ? 0 : rivalsPlayed,
          rivalsFailed: snapshot === null ? 0 : rivalsFailed,
          record: complete ? record : null,
          rate: complete ? simulationRate(record) : null,
          playable: snapshot !== null,
        }
      }),
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
    // D-029: the domain's bot by default (g2 since 23/10/2026), against a passive rival and against the meta.
    const bot = input.bot ?? DEFAULT_BOT
    // «et» only ends its turn: it is the goldfish rival, never the bot that plays the deck (H-051). The queue lets
    // consistency jobs through to engines without «et» for that rival, so one with «et» as the bot would fail there.
    if (!isBotCode(bot) || bot === ET_BOT_CODE) {
      throw new BadRequestException({ code: 'validation', message: `Bot «${bot}» desconocido.` })
    }
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
    // A stored job: its own bot (the fallback is the one of its time, D-029).
    const bot = params?.bot ?? job.players[0] ?? LEGACY_DEFAULT_BOT
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

  /**
   * «Reintentar lo que falló»: the failed chunks of a job that ended «failed» go back to the queue as they were (the
   * same seeds, attempt 0), and the job is active again; when they play well it ends «done» (an optimize then queues
   * its confirmation). Its games revision, when fixed, stays: the queue gives the chunks only to workers that play that
   * way. Not a Laboratorio search (its rounds decide what it plays) nor a job of another deckgym (it is played again
   * whole: «Repetir»).
   */
  async retryFailed(rawId: string): Promise<JobSummaryView> {
    const job = await this.requireJob(rawId)
    const blocked = await this.retryBlocked(job)
    if (blocked) throw new BadRequestException(blocked)
    const retried = await this.prisma.$transaction(async (tx) => {
      // The job first, still failed (two clicks at once retry once). An archived one comes back to the list: it plays.
      const reopened = await tx.simulationJob.updateMany({
        where: { id: job.id, status: 'failed' },
        data: { status: 'running', finishedAt: null, error: null, archivedAt: null },
      })
      if (reopened.count === 0) return null
      const chunks = await tx.simulationChunk.updateMany({
        where: { jobId: job.id, status: 'failed' },
        // From scratch, like a chunk never played: no attempts and no returns (#72) either.
        data: {
          status: 'queued',
          attempt: 0,
          returns: 0,
          returnedBy: [],
          // Phase 42: no copy either (a failed chunk has none, but nothing old is kept).
          copyWorker: null,
          copyUntil: null,
          copySince: null,
          error: null,
          leaseUntil: null,
          workerId: null,
          gamesDone: 0,
        },
      })
      return chunks.count
    })
    if (retried === null) {
      throw new BadRequestException({ code: 'job_not_failed', message: 'Ya se está reintentando.' })
    }
    // Nothing failed any more (a good result came late, after the job ended): it is just done again.
    if (retried === 0) await this.queue.settle(job.id)
    else this.queue.notifyQueued()
    return this.progressOf(rawId)
  }

  /**
   * Why a job cannot take «Reintentar lo que falló», or null when it can. Besides its status and kind: one of another
   * deckgym, or fixed to a games revision older than the newest of the workers seen in the last half hour, would be
   * played again whole by the engine change (EngineChangeService) instead of retrying its failed chunks.
   */
  private async retryBlocked(job: {
    id: number
    kind: string
    status: string
    engineRev: string
    gamesRev: number | null
  }): Promise<{ code: string; message: string } | null> {
    if (job.kind === 'explore') {
      return {
        code: 'explore',
        message: 'Una búsqueda del laboratorio no se reintenta: lanzá otra desde el Laboratorio.',
      }
    }
    if (job.status !== 'failed') {
      return { code: 'job_not_failed', message: 'Solo se reintenta una simulación que terminó con cruces fallados.' }
    }
    if (job.engineRev !== this.engine.engineRev()) {
      return {
        code: 'other_engine',
        message: `Se jugó con otro motor (deckgym ${job.engineRev.slice(0, 7)}): repetila entera.`,
      }
    }
    if (job.gamesRev !== null) {
      const newest = await this.prisma.workerNode.aggregate({
        where: { engineRev: job.engineRev, lastSeenAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
        _max: { gamesRev: true },
      })
      if ((newest._max.gamesRev ?? job.gamesRev) > job.gamesRev) {
        return {
          code: 'other_games_rev',
          message: `Se jugó con la revisión ${job.gamesRev} de las partidas y los workers de ahora juegan con otra: repetila entera.`,
        }
      }
    }
    return null
  }

  /** Only active jobs can be moved in the queue; the conditional write also checks concurrent completion. */
  async setPriority(rawId: string, priority: number): Promise<JobSummaryView> {
    const job = await this.requireJob(rawId)
    const changed = await this.prisma.simulationJob.updateMany({
      where: { id: job.id, status: { in: ['queued', 'running'] } },
      data: { priority },
    })
    if (changed.count === 0) {
      throw new BadRequestException({
        code: 'job_finished',
        message: 'Solo podés adelantar simulaciones en cola o corriendo.',
      })
    }
    this.queue.notifyQueued()
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
      // The copies are handed over in the same transaction as the delete.
      return this.prisma.$transaction(async (tx) => {
        const ids = (await tx.simulationJob.findMany({ where: { status: 'cancelled' }, select: { id: true } })).map(
          (row) => row.id,
        )
        await this.promoteCopies(tx, ids)
        return { count: (await tx.simulationJob.deleteMany({ where: { id: { in: ids } } })).count }
      })
    }
    const archived = await this.prisma.simulationJob.updateMany({
      where: { status: 'done', archivedAt: null },
      data: { archivedAt: new Date() },
    })
    return { count: archived.count }
  }

  /**
   * Phase 42: before jobs go, each of their chunks that other jobs copied hands its place to one copy (the oldest): it
   * becomes the original, takes the replays and the other copies point to it. The copies keep counting as one.
   */
  private async promoteCopies(tx: Prisma.TransactionClient, jobIds: readonly number[]): Promise<void> {
    if (jobIds.length === 0) return
    await tx.$executeRaw`
      WITH gone AS (SELECT "id" FROM "simulation_chunks" WHERE "job_id" = ANY(${[...jobIds]}::int[])),
      heir AS (
        SELECT DISTINCT ON (c."cached_from_id") c."cached_from_id" AS original, c."id" AS heir
        FROM "simulation_chunks" c JOIN gone ON gone."id" = c."cached_from_id"
        WHERE c."job_id" <> ALL(${[...jobIds]}::int[])
        ORDER BY c."cached_from_id", c."id"),
      replays AS (
        UPDATE "simulation_replays" r SET "chunk_id" = heir.heir FROM heir WHERE r."chunk_id" = heir.original
        RETURNING 1),
      others AS (
        UPDATE "simulation_chunks" c SET "cached_from_id" = heir.heir FROM heir
        WHERE c."cached_from_id" = heir.original AND c."id" <> heir.heir
        RETURNING 1)
      UPDATE "simulation_chunks" c SET "cached_from_id" = NULL FROM heir WHERE c."id" = heir.heir`
  }

  async remove(rawId: string): Promise<void> {
    const job = await this.requireJob(rawId)
    if (job.status === 'queued' || job.status === 'running') {
      throw new BadRequestException({ code: 'job_running', message: 'Cancelá la simulación antes de borrarla.' })
    }
    await this.prisma.$transaction(async (tx) => {
      await this.promoteCopies(tx, [job.id])
      await tx.simulationJob.delete({ where: { id: job.id } })
    })
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
          paused:
            worker.pausedUntil && worker.pausedUntil.getTime() > now
              ? { until: worker.pausedUntil, reason: worker.pauseReason ?? 'lost_results' }
              : null,
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
    // H-011.5: the confirmation of an optimize replays its rivals, which would count them twice. Phase 42: and what an
    // engine change kept apart (`replacedBy`) is played again by the job that replaced it.
    const confirmations = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT "id" FROM "simulation_jobs"
      WHERE ("kind" = 'compare' AND "params"->'confirmationOf' IS NOT NULL) OR "params" ? 'replacedBy'`
    const chunks = await this.prisma.simulationChunk.findMany({
      where: {
        status: 'done',
        // Phase 42: a chunk copied from the cache is the same games as the one it came from.
        cachedFrom: null,
        OR: [{ snapshotAId: { in: ids } }, { snapshotBId: { in: ids } }],
        job: { kind: { in: ['matrix', 'compare'] }, id: { notIn: confirmations.map((row) => row.id) } },
      },
      select: {
        snapshotAId: true,
        snapshotBId: true,
        winsA: true,
        winsB: true,
        ties: true,
        jobId: true,
        job: { select: { players: true, engineRev: true, gamesRev: true } },
      },
    })
    if (chunks.length === 0) return null
    // One engine and one bot pair, never mixed: the current deckgym first (after an update the old results stay
    // apart), then its newest games revision (phase 42), then the bot by default on both sides (D-029: g2 since
    // 23/10/2026, the same number «¿Cuál llevo hoy?» shows), then the pair with the most chunks and, at a tie, the one
    // with the newest job (a fixed order: the query has none).
    const currentRev = this.engine.engineRev()
    const byPlayers = new Map<string, typeof chunks>()
    for (const chunk of chunks) {
      const key = `${chunk.job.engineRev}|${chunk.job.gamesRev ?? -1}|${chunk.job.players.join(',')}`
      byPlayers.set(key, [...(byPlayers.get(key) ?? []), chunk])
    }
    const isCurrent = (key: string) => (key.startsWith(`${currentRev}|`) ? 1 : 0)
    const revisionOf = (key: string) => Number(key.split('|')[1])
    const isDefault = (key: string) => (key.split('|')[2] === DEFAULT_PLAYERS.join(',') ? 1 : 0)
    const newest = (group: typeof chunks) => Math.max(...group.map((chunk) => chunk.jobId))
    const [groupKey, chosen] = [...byPlayers].sort(
      (x, y) =>
        isCurrent(y[0]) - isCurrent(x[0]) ||
        revisionOf(y[0]) - revisionOf(x[0]) ||
        isDefault(y[0]) - isDefault(x[0]) ||
        y[1].length - x[1].length ||
        newest(y[1]) - newest(x[1]),
    )[0] as [string, typeof chunks]
    const pairKey = groupKey.split('|')[2] ?? ''
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

/** An optimize that ended well and whose confirmation is not queued yet (H-011.5). */
function confirmationPending(job: JobRow): boolean {
  const confirmation = (job.params as { confirmation?: { pending?: unknown } } | null)?.confirmation
  return job.kind === 'optimize' && job.status === 'done' && confirmation?.pending === true
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

/** A card of a snapshot as stored (`deck_snapshots.cards`). */
interface SnapshotCardRow {
  cardId: string
  playedAs: string
  count: number
}

/**
 * «Optimizar»'s deck without the cards taken out, one count for the preview, the job and its confirmation (H-050):
 * a card asked twice sums its requests, and never more than its copies come out.
 */
function optimizeBase(
  cards: readonly SnapshotCardRow[],
  remove: readonly { cardId: string; count: number }[],
  index: { cardById(id: string): { nameEn: string; expansionId: string; number: number | string } | undefined },
) {
  const asked = new Map<string, number>()
  for (const item of remove) asked.set(item.cardId, (asked.get(item.cardId) ?? 0) + item.count)
  const lines: string[] = []
  const keptByName = new Map<string, number>()
  const keptById = new Map<string, number>()
  let missing = 0
  for (const card of cards) {
    const take = Math.min(card.count, asked.get(card.cardId) ?? 0)
    asked.set(card.cardId, (asked.get(card.cardId) ?? 0) - take)
    missing += take
    const left = card.count - take
    if (left <= 0) continue
    keptById.set(card.cardId, (keptById.get(card.cardId) ?? 0) + left)
    const played = index.cardById(card.playedAs)
    if (played) {
      lines.push(`${left} ${played.nameEn} ${played.expansionId} ${played.number}`)
      keptByName.set(played.nameEn, (keptByName.get(played.nameEn) ?? 0) + left)
    }
  }
  return { lines, keptByName, keptById, missing }
}
