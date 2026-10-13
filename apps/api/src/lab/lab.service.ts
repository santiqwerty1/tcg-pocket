/**
 * Laboratorio de mazos (T-008): the meta bank, tests of a deck against it and the automatic search of variants. Every
 * number here comes from bots playing (deckgym), weighted by the era's shares: a hint of what to try in the game,
 * never a verdict, and never mixed with tournaments or own matches. The search runs as an `explore` job: the worker
 * plays a round of chunks like any other job, and when the last chunk of a round lands, `advance` scores it and
 * queues the next round, the confirmation or the end.
 */
import { randomInt } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  UnprocessableEntityException,
} from '@nestjs/common'
import {
  archetypeRows,
  buildFromCore,
  buildSnapshot,
  type CardId,
  type CatalogIndex,
  CONFIRM_VERDICT_ES,
  type ConfirmVerdict,
  canPlayPerGame,
  cardBreaksEvent,
  cardChanges,
  cardUsage,
  changeKey,
  checkEventDeck,
  chunkSeed,
  comboVariant,
  confirmVerdict,
  customGauntlet,
  DEFAULT_CONSISTENCY_GAMES,
  DEFAULT_EXPLORE_CONFIG,
  DEFAULT_GAUNTLET_SIZE,
  type DeckCardEntry,
  describeEventRulesEs,
  describeProblems,
  differenceVerdict,
  type EventRules,
  EXPLORE_POOL_LABEL_ES,
  EXPLORE_STOP_ES,
  type ExploreConfig,
  type ExploreStop,
  energyFromNameEn,
  energyKey,
  energyVariant,
  engineEdition,
  estimateSeconds,
  eventRulesSchema,
  exploreConfig,
  exploreGames,
  exploreSeed,
  formatDifferenceEs,
  formatMetaScoreEs,
  type GameRecord,
  type Gauntlet,
  groupsOfCards,
  isBotCode,
  type LabObjective,
  type Learned,
  type ListRow,
  learnedChanges,
  learnedFactor,
  learnSwap,
  listKeyByGroup,
  listRows,
  MAX_BASE_SEED,
  type MeasuredSwap,
  type MetaScore,
  metaGauntlet,
  metaScore,
  mutationPool,
  NOVELTY_LABEL_ES,
  neighborhoodUsage,
  novelty,
  opponentKey,
  type PairedRival,
  type PerGameEntry,
  type PoolCard,
  PROBE_FILLERS,
  pairedDifference,
  pairedWinner,
  perGameEntries,
  perGameSummary,
  poolCaps,
  poolForZone,
  probeVariants,
  RACE_SEED_OFFSET,
  raceDrops,
  raceHalves,
  randomBaseSeed,
  readPerGame,
  revertVariant,
  robustnessEs,
  robustnessOf,
  roundGames,
  roundWinner,
  type ScoreDifference,
  SELECTABLE_ENERGIES,
  type SelectableEnergy,
  type SnapshotCard,
  scoreDifference,
  secondListsFor,
  seededRandom,
  simulationRate,
  splitGames,
  swapOf,
  swapScore,
  type TournamentDataset,
  type TournamentFormat,
  usableWith,
  type Variant,
  validateDeck,
  variantOf,
  verifyAccepts,
  WEAKEST_BOOST,
  weakestThird,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { CatalogService } from '../catalog/catalog.service.js'
import { ENV, type Env } from '../config/env.js'
import { parseDeckText } from '../decks/deck-formats.js'
import type { Prisma } from '../generated/prisma/client.js'
import { parseNumericId } from '../http/ids.js'
import { MatchesService } from '../matches/matches.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { JobSummaryView, SnapshotView } from '../simulation/simulation-views.js'
import { type CreateJobInput, labMode, SimulationsService } from '../simulation/simulations.service.js'
import { EngineStatusService, type SnapshotSource, SnapshotsService } from '../simulation/snapshots.service.js'
import { WorkerQueueService } from '../simulation/worker-queue.service.js'
import { LIMITLESS_ATTRIBUTION, type Scope, TournamentsService } from '../tournaments/tournaments.service.js'
import { type FrozenInputs, leftOutCards, whyCards } from './lab-explain.js'
import type {
  CardLineView,
  LabBankView,
  LabCoreView,
  LabDeckView,
  LabExploreView,
  LabGamesView,
  LabJobsView,
  LabJobView,
  LabNoveltyView,
  LabObjectiveView,
  LabRivalView,
  LabScoreView,
} from './lab-views.js'

export const LAB_NOTE =
  'Juegan bots del motor deckgym, no personas: el porcentaje depende del bot y del motor. Es una pista para probar en el juego, no un veredicto.'
export const MAX_TEST_DECKS = 10
const DEFAULT_TEST_GAMES = 100
/** Where the variant that brings in a card to try takes its seeds (T-017 E3). */
const INCLUDE_SEED_SALT = 7_919
/** Tries to queue a search's replay with another bot before giving it up (after the move's review). */
const REPLAY_ATTEMPTS = 5
/** T-017 D4: the default objective, and the one of jobs from before it. */
const META_OBJECTIVE: LabObjectiveView = { kind: 'meta', labelEs: 'el meta de los torneos' }

/** A deck for the Laboratorio: one of mine, an exact tournament list or a pasted list. */
export type LabDeckInput =
  | { deckId: string; energies?: SelectableEnergy[] | undefined }
  | {
      listKey: string
      era?: string | undefined
      format?: TournamentFormat | undefined
      energies?: SelectableEnergy[] | undefined
    }
  | { text: string; name?: string | undefined; energies?: SelectableEnergy[] | undefined }
  | { cards: DeckCardEntry[]; energies: SelectableEnergy[]; name?: string | undefined }

/** The latest Laboratorio score of a deck's current list (H-007). */
export interface DeckLabScore {
  jobId: number
  era: string
  finishedAt: Date | null
  score: LabScoreView
}

export interface LabScopeInput {
  era?: string | undefined
  format?: TournamentFormat | undefined
  /** Archetypes in the bank (5–20, default 10). */
  size?: number | undefined
  /** T-017 D4: against the era's most played (default), my own rivals («mi meta») or one archetype. */
  objective?: LabObjective['kind'] | undefined
  /** The archetype, with `objective: 'rival'`. */
  archetypeId?: string | undefined
}

export interface LabRunInput extends LabScopeInput {
  players?: [string, string] | undefined
  seed?: number | undefined
  label?: string | undefined
  cores?: number | undefined
  /** Only say what it would play (snapshots, games, time); queue nothing. */
  dryRun?: boolean | undefined
}

export interface LabTestInput extends LabRunInput {
  decks: LabDeckInput[]
  gamesPerRival?: number | undefined
}

export interface LabExploreInput extends LabRunInput {
  deck: LabDeckInput
  /** Card ids (any edition) that never go out. */
  locked?: string[] | undefined
  /**
   * T-017 E3: card ids (any edition) to try — «probar estas cartas», the opposite of `locked`: they enter the pool even
   * when the collection has none, drawn as often as the most played card, and each round one variant brings one in.
   */
  include?: string[] | undefined
  config?: Partial<ExploreConfig> | undefined
  /** Fase 16: an event whose rules every variant must keep (the starting deck too). */
  eventId?: string | undefined
}

/** Fase 19: 1–4 cards (any edition) to build a first list around. */
export interface LabCoreInput {
  cards: string[]
  energies?: SelectableEnergy[] | undefined
  /** «collection» (default): only what the collection has, at its playable copies; «all»: any card. */
  pool?: 'collection' | 'all' | undefined
  era?: string | undefined
  format?: TournamentFormat | undefined
  /** Fase 16: only cards an event's rules allow. */
  eventId?: string | undefined
}

/** A rival of the bank as a job stores it. */
interface LabRival {
  listKey: string
  archetypeId: string
  archetypeName: string
  share: number
  weight: number
  /** Snapshot id (explore jobs; tests find it by list key). */
  snapshot?: number
  /** T-017 D3: the archetype's second list in the bank. */
  second?: boolean
}

interface ExploreRound {
  /** Seed round (`exploreSeed`). */
  index: number
  /** H-010: a «verify» round replays the incumbent and the screened variant with fresh seeds. */
  kind: 'search' | 'verify' | 'confirm'
  incumbent: number
  candidates: number[]
  /** Chunk idx range [fromIdx, toIdx). */
  fromIdx: number
  toIdx: number
  accepted: number | null
  /** H-010: the search round's best variant that passed the screen and went to verification. */
  screened?: number | null
  decided: boolean
  /** Fase 42, carreras: 1 while its first half plays, 2 once the second half (of the variants left) is queued. */
  stage?: 1 | 2
  /** Where its second half starts (chunk idx). */
  stageIdx?: number
  /** The variants that left after the first half (clearly worse than the incumbent, or incomplete). */
  dropped?: number[]
  /** T-017 C3: the «carta más floja» round: it measures, it accepts nothing and it is no search round. */
  probe?: boolean
  /** T-017 D2: «Frenar y confirmar» cut this round short (its chunks no worker had taken went away). */
  stopped?: boolean
}

interface ExploreState {
  config: ExploreConfig
  /** Functional cards that never go out. */
  locked: string[]
  base: number
  incumbent: number
  /** Search rounds in a row without a change. */
  stall: number
  phase: 'search' | 'confirm' | 'done'
  stopReason: ExploreStop | null
  rounds: ExploreRound[]
  /** Snapshot id → round it was born in and its parent. */
  variants: Record<string, { round: number; parent: number }>
  /** List keys (by functional card) already played in this search. */
  seen: string[]
  /** Fase 16: the event's rules every variant keeps, and its name. */
  event?: { id: string; name: string; rules: EventRules }
  /** H-021: what the variants are drawn from, as it was when the search started (absent in older searches). */
  frozen?: FrozenInputs
  /** H-010: what the confirmation says of the list found against the starting one. */
  confirmed?: { verdict: ConfirmVerdict; difference: ScoreDifference } | null
  /** T-017 C4: what the rounds measured about each card change («+groupId», «-groupId»). */
  learned?: Learned
  /** The swaps measured in search rounds (the last 40), for the combo of each round; an accepted one leaves. */
  swaps?: (MeasuredSwap & { variant: number })[]
  /** Snapshot ids of the combo variants (the two best swaps joined). */
  combos?: number[]
  /** T-017 C5: the swaps accepted so far, in order, and the variants that undid one of them. */
  accepted?: (MeasuredSwap & { variant: number })[]
  reverts?: number[]
  /** By revert variant: the accepted swap (its variant id) it undoes (bots' review, item 7). */
  revertOf?: Record<string, number>
  /** T-017 D2: «Frenar y confirmar»: the round in play ends with what it has, then the confirmation. */
  stopRequested?: boolean
  /** Fase 42 (R-012): the confirmation played again with `config.confirmBot`, a job of its own. */
  /** `attempts`: failed tries to queue it; after `REPLAY_ATTEMPTS` it is given up (`failed`). */
  robustness?: { jobId: number | null; bot: string; error?: string; attempts?: number; failed?: boolean }
  /** T-017 E3: functional cards to try (one of them comes in, in a variant of every round). */
  include?: string[]
  /** T-017 C3: the weakest third the probe round found (they go out more often after it). */
  weakest?: string[]
  /** T-017 E4: lists added by hand to the search: the next search round plays them, then they are `added`. */
  pending?: number[]
  added?: number[]
  /** Added by hand but the search ended first (review of #64): they never played. */
  lost?: number[]
}

interface LabParams {
  mode: 'test' | 'explore'
  era: string
  format: TournamentFormat
  /** Fase 42: this test is the confirmation of search #N played again with another bot. */
  robustnessOf?: number
  /** T-017 D4: absent in jobs from before D4 (the meta). */
  objective?: LabObjectiveView
  size: number
  rivals: LabRival[]
  explore?: ExploreState
}

interface JobParams {
  sideA: number[]
  sideB: number[]
  bothOrders?: boolean
  /** Each game by index (`perGame`): the paired test of H-010 and what the games say (T-017 A2). */
  perGame?: boolean
  lab: LabParams
}

interface Bank {
  scope: Scope
  dataset: TournamentDataset
  objective: LabObjectiveView
  gauntlet: Gauntlet
  rows: ListRow[]
  usage: Map<CardId, number>
  sources: SnapshotSource[]
}

interface ChunkRow {
  idx: number
  snapshotAId: number | null
  snapshotBId: number | null
  status: string
  winsA: number | null
  winsB: number | null
  ties: number | null
  firstGame: number
  /** `perGame` (T-017 A2, H-010): each game by index, when the job asked for it. */
  extra: Prisma.JsonValue | null
}

/** Review of #7: a capable worker counts if seen this recently; the sweep runs this often. */
const PER_GAME_WORKER_WINDOW_MS = 30 * 60 * 1000
const PER_GAME_SWEEP_MS = 5 * 60 * 1000

@Injectable()
export class LabService implements OnApplicationBootstrap, OnApplicationShutdown {
  private sweepTimer: NodeJS.Timeout | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tournaments: TournamentsService,
    private readonly snapshots: SnapshotsService,
    private readonly engine: EngineStatusService,
    private readonly simulations: SimulationsService,
    private readonly queue: WorkerQueueService,
    private readonly matches: MatchesService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.logger.setContext(LabService.name)
    this.queue.onExploreRound((jobId) => this.advance(jobId))
  }

  /** A search whose round ended while the app was restarting is picked up again. */
  async onApplicationBootstrap(): Promise<void> {
    // A CLI shares the database with the API that is running: this is the server's start-up work, not its own.
    if (this.env.cli) return
    const jobs = await this.prisma.simulationJob.findMany({
      where: { kind: 'explore', status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    for (const job of jobs) {
      const pending = await this.prisma.simulationChunk.count({
        where: { jobId: job.id, status: { in: ['queued', 'leased'] } },
      })
      if (pending === 0) await this.advance(job.id)
    }
    await this.sweepRobustness().catch((error: unknown) => this.logger.error({ err: error }, 'replay sweep failed'))
    this.sweepTimer = setInterval(() => {
      this.sweepPerGame().catch((error: unknown) => this.logger.error({ err: error }, 'perGame sweep failed'))
      this.sweepRobustness().catch((error: unknown) => this.logger.error({ err: error }, 'replay sweep failed'))
    }, PER_GAME_SWEEP_MS)
    this.sweepTimer.unref()
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Meta bank
  // ---------------------------------------------------------------------------------------------------------------

  private async bankOf(input: LabScopeInput): Promise<Bank> {
    const { scope, dataset } = await this.tournaments.scopedDataset({ era: input.era, format: input.format })
    const engine = await this.engine.status()
    const size = input.size ?? DEFAULT_GAUNTLET_SIZE
    const check = (list: ListRow, energies: string[]) => {
      const unknown = list.cards.filter((card) => card.cardId === null)
      if (unknown.length > 0) {
        return `cartas que el catálogo no conoce: ${unknown.map((card) => `${card.set}-${card.number}`).join(', ')}`
      }
      const draft = buildSnapshot({
        label: list.key,
        cards: list.cards.map((card) => ({ cardId: card.cardId as string, count: card.count })),
        energies: selectableEnergies(energies),
        index: scope.index,
        engine,
      })
      return draft.simulable ? null : describeProblems(draft.problems)
    }
    let gauntlet: Gauntlet
    let objective: LabObjectiveView
    if (input.objective === 'mine') {
      // T-017 D4: «mi meta» as fase 44 measures it (MatchesService.myMeta: the same rivals, links, modes and half-life
      // as «¿Cuál llevo hoy?», in the bank's era), its shares as the bank's weights. Review of #47: under 10 effective
      // matches against archetypes it is too thin to weigh a bank with.
      const mine = await this.matches.myMeta({ era: scope.era })
      if (!mine.enough || mine.shares.length === 0) {
        throw new UnprocessableEntityException({ code: 'empty_bank', message: mine.text })
      }
      const targets = mine.shares.map((share) => ({ archetypeId: share.archetypeId, weight: share.share }))
      // T-017 D3: the first ones bring a second list (banks of 10 or more).
      gauntlet = customGauntlet(dataset, targets, { size, secondLists: secondListsFor(size), check })
      objective = {
        kind: 'mine',
        labelEs: `mi meta (${mine.matched} ${mine.matched === 1 ? 'partida' : 'partidas'})`,
        halfLifeDays: mine.halfLifeDays,
        matched: mine.matched,
        effectiveMatches: Math.round(mine.effectiveMatches * 10) / 10,
        orientative: mine.orientative,
        coverage: mine.coverage,
        unmatched: mine.unmatched.reduce((sum, rival) => sum + rival.games, 0),
        unmatchedNames: mine.unmatched.slice(0, 5).map((rival) => rival.label),
        games: Object.fromEntries(mine.shares.map((share) => [share.archetypeId, share.games])),
      }
    } else if (input.objective === 'rival') {
      // T-017 D4: one archetype, played by its two most representative lists.
      const archetypeId = input.archetypeId
      if (!archetypeId) throw new BadRequestException({ code: 'validation', message: 'Elegí el arquetipo rival.' })
      const rows = archetypeRows(dataset)
      const key = opponentKey(archetypeId)
      const row =
        rows.find((item) => item.archetype?.id === archetypeId) ??
        rows.find((item) => key !== null && opponentKey(item.archetype?.name) === key)
      if (!row?.archetype) {
        throw new NotFoundException(`El arquetipo ${archetypeId} no aparece en los torneos de la era ${scope.era}.`)
      }
      gauntlet = customGauntlet(dataset, [{ archetypeId: row.archetype.id, weight: 1 }], {
        size: 1,
        secondLists: 1,
        check,
      })
      objective = { kind: 'rival', archetypeId: row.archetype.id, labelEs: `solo ${row.archetype.name}` }
    } else {
      // T-017 D3: the 3 most played archetypes with two lists each (banks of 10 or more).
      gauntlet = metaGauntlet(dataset, { size, secondLists: secondListsFor(size), check })
      objective = META_OBJECTIVE
    }
    return {
      scope,
      dataset,
      objective,
      gauntlet,
      rows: listRows(dataset, 'group'),
      usage: new Map(cardUsage(dataset.entries).map((row) => [row.groupId, row.share])),
      sources: gauntlet.rivals.map((rival) => ({
        listKey: rival.list.key,
        era: scope.era,
        format: scope.format,
        kind: 'group' as const,
      })),
    }
  }

  async bank(input: LabScopeInput): Promise<LabBankView> {
    const bank = await this.bankOf(input)
    const index = bank.scope.index
    return {
      era: bank.scope.era,
      format: bank.scope.format,
      objective: bank.objective,
      // Archetypes, not lists: the most played ones bring two (T-017 D3; bots' review, item 8).
      size: new Set(bank.gauntlet.rivals.map((rival) => rival.archetypeId)).size,
      lists: bank.gauntlet.lists,
      coverage: bank.gauntlet.coverage,
      rivals: bank.gauntlet.rivals.map((rival) => ({
        archetypeId: rival.archetypeId,
        archetypeName: rival.archetypeName,
        share: rival.share,
        weight: rival.weight,
        listKey: rival.list.key,
        listLists: rival.list.lists,
        listRate: rival.list.rate,
        rank: rival.rank,
        second: rival.second,
        energies: rival.energies,
        cards: rival.list.cards.map((card) => ({
          cardId: card.cardId ?? `${card.set}-${card.number}`,
          nameEs: (card.cardId ? index.cardById(card.cardId)?.nameEs : null) ?? card.name,
          count: card.count,
        })),
      })),
      skipped: bank.gauntlet.skipped,
      engineRev: this.engine.engineRev(),
      attribution: LIMITLESS_ATTRIBUTION,
    }
  }

  private labParams(bank: Bank, mode: 'test' | 'explore'): LabParams {
    return {
      mode,
      era: bank.scope.era,
      format: bank.scope.format,
      objective: bank.objective,
      // Archetypes, not lists: the most played ones bring two (T-017 D3).
      size: new Set(bank.gauntlet.rivals.map((rival) => rival.archetypeId)).size,
      rivals: bank.gauntlet.rivals.map((rival) => ({
        listKey: rival.list.key,
        archetypeId: rival.archetypeId,
        archetypeName: rival.archetypeName,
        share: rival.share,
        weight: rival.weight,
        ...(rival.second ? { second: true } : {}),
      })),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Decks
  // ---------------------------------------------------------------------------------------------------------------

  private source(input: LabDeckInput, scope: Scope): SnapshotSource {
    const energies = input.energies && input.energies.length > 0 ? input.energies : undefined
    if ('deckId' in input) return { deckId: input.deckId, energies }
    if ('cards' in input) {
      return {
        cards: input.cards,
        energies: input.energies,
        label: input.name?.trim() || 'Lista del laboratorio',
        origin: 'text',
      }
    }
    if ('listKey' in input) {
      return {
        listKey: input.listKey,
        era: input.era ?? scope.era,
        format: input.format ?? scope.format,
        kind: 'group',
        energies,
      }
    }
    const parsed = parseDeckText(input.text, 'auto', scope.index)[0]
    if (!parsed?.draft) {
      const errors = parsed?.errors.map((issue) => issue.message) ?? ['No encontré ningún mazo en el texto.']
      throw new BadRequestException({ code: 'parse_error', message: `La lista no se pudo leer: ${errors.join('; ')}` })
    }
    return {
      cards: parsed.draft.cards,
      energies: energies ?? parsed.draft.energies,
      label: input.name?.trim() || parsed.title || 'Lista pegada',
      origin: 'text',
    }
  }

  private players(input: LabRunInput): [string, string] {
    const players = input.players ?? ['e2', 'e2']
    for (const code of players) {
      if (!isBotCode(code)) throw new BadRequestException({ code: 'validation', message: `Bot «${code}» desconocido.` })
    }
    return players
  }

  private baseSeed(input: LabRunInput): number {
    const seed = input.seed ?? randomBaseSeed(() => randomInt(0, 2 ** 32 - 1) >>> 0)
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_BASE_SEED - 50 * 1000) {
      throw new BadRequestException({ code: 'validation', message: 'Semilla: un entero de 0 a 2^52.' })
    }
    return seed
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Test against the meta
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * How soon a deck has its key attacker ready in real games against the meta (D-019, «Las dos»): the games
   * (1.000 by default) split among the bank's rivals by their weight, both sides played by the same bot.
   */
  async consistency(
    input: LabScopeInput & {
      deckId: string
      keyCards?: string[] | undefined
      games?: number | undefined
      bot?: string | undefined
      seed?: number | undefined
    },
  ): Promise<JobSummaryView> {
    // Against the era's meta (T-017 D4 is for the tests and searches).
    const bank = await this.bankOf({ era: input.era, format: input.format, size: input.size })
    if (bank.gauntlet.rivals.length === 0) {
      throw new UnprocessableEntityException({ code: 'empty_bank', message: 'No hay listas del meta para medir.' })
    }
    const total = input.games ?? DEFAULT_CONSISTENCY_GAMES
    if (!Number.isInteger(total) || total < 10 || total > 10_000) {
      throw new BadRequestException({ code: 'validation', message: 'Partidas: de 10 a 10.000.' })
    }
    const games = splitGames(
      total,
      bank.gauntlet.rivals.map((rival) => rival.weight),
    )
    const saved = await Promise.all(bank.sources.map((source) => this.snapshots.save(source)))
    const rivals = bank.gauntlet.rivals.map((rival, at) => ({
      snapshot: saved[at]?.id ?? 0,
      // T-017 D3: an archetype's second list says so (review of #28).
      label: rival.second ? `${rival.archetypeName} (2.ª lista)` : rival.archetypeName,
      listKey: rival.list.key,
      share: rival.share,
      weight: rival.weight,
      games: games[at] ?? 0,
    }))
    return this.simulations.createConsistency({
      deckId: input.deckId,
      keyCards: input.keyCards,
      bot: input.bot,
      seed: input.seed,
      meta: { era: bank.scope.era, format: bank.scope.format, rivals },
    })
  }

  /** Decks against the meta bank: a «comparar» job whose rivals are the bank, scored with the bank's weights. */
  async test(input: LabTestInput): Promise<
    | JobSummaryView
    | {
        preview: Awaited<ReturnType<SimulationsService['preview']>>
        bank: LabBankView
      }
  > {
    if (input.decks.length === 0 || input.decks.length > MAX_TEST_DECKS) {
      throw new BadRequestException({ code: 'validation', message: `De 1 a ${MAX_TEST_DECKS} mazos.` })
    }
    const bank = await this.bankOf(input)
    if (bank.gauntlet.rivals.length === 0) {
      throw new BadRequestException({ code: 'validation', message: 'La era no tiene arquetipos simulables.' })
    }
    const sideA = input.decks.map((deck) => this.source(deck, bank.scope))
    const labels = await Promise.all(sideA.map(async (source) => (await this.snapshots.preview(source)).label))
    const job: CreateJobInput = {
      kind: 'compare',
      label: input.label?.trim() || `Contra ${objectiveLabel(bank)}: ${labels.join(' · ')}`,
      sideA,
      sideB: bank.sources,
      gamesPerPair: input.gamesPerRival ?? DEFAULT_TEST_GAMES,
      players: this.players(input),
      seed: input.seed,
      replaySample: 1,
      cores: input.cores,
      lab: this.labParams(bank, 'test') as unknown as Prisma.InputJsonValue,
      ...((await this.perGameReady()) ? { perGame: true } : {}),
    }
    if (input.dryRun) return { preview: await this.simulations.preview(job), bank: await this.bank(input) }
    return this.simulations.create(job)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Automatic search
  // ---------------------------------------------------------------------------------------------------------------

  private async pool(
    bank: Bank,
    energies: readonly SelectableEnergy[],
    which: 'collection' | 'all',
    affinity: ReadonlyMap<CardId, number>,
    rules?: EventRules,
  ) {
    const index = bank.scope.index
    const engine = await this.engine.status()
    const playable = which === 'collection' ? await this.tournaments.playable(index) : null
    return mutationPool({
      index,
      energies,
      edition: (groupId) => {
        const group = index.groupById(groupId)
        const display = group ? index.cardById(group.displayCardId) : undefined
        return display ? engineEdition(display, index, engine) : null
      },
      maxCopies: (groupId) => (playable ? playable(groupId) : 2),
      usage: (groupId) => bank.usage.get(groupId) ?? 0,
      affinity: (groupId) => affinity.get(groupId) ?? 0,
      allow: rules ? (card) => cardBreaksEvent(card, rules) === null : undefined,
    })
  }

  /** An event's rules, read straight from the table (the events module depends on tournaments, not the other way). */
  private async eventRules(rawId: string): Promise<{ id: string; name: string; rules: EventRules }> {
    const id = Number.parseInt(rawId, 10)
    const event = Number.isSafeInteger(id) ? await this.prisma.event.findUnique({ where: { id } }) : null
    if (!event) throw new NotFoundException(`Evento ${rawId} no encontrado.`)
    return { id: String(event.id), name: event.name, rules: eventRulesSchema.parse(event.rules) }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Build from a core (Fase 19)
  // ---------------------------------------------------------------------------------------------------------------

  /** A first list around 1–4 cards, from what the era's lists that play them also play. Queues nothing. */
  async core(input: LabCoreInput): Promise<LabCoreView> {
    const { scope, dataset } = await this.tournaments.scopedDataset({ era: input.era, format: input.format })
    const index = scope.index
    const engine = await this.engine.status()
    const pool = input.pool ?? 'collection'
    const playable = pool === 'collection' ? await this.tournaments.playable(index) : null
    const event = input.eventId ? await this.eventRules(input.eventId) : null
    const core = [...this.lockedGroups(index, input.cards)]
    const played = (groupId: CardId) => {
      const group = index.groupById(groupId)
      const display = group ? index.cardById(group.displayCardId) : undefined
      return display ? engineEdition(display, index, engine) : null
    }
    const build = buildFromCore({
      dataset,
      index,
      core,
      energies: input.energies,
      edition: (groupId) => {
        const card = played(groupId)
        return card && (!event || cardBreaksEvent(card, event.rules) === null) ? card : null
      },
      maxCopies: (groupId) => (playable ? playable(groupId) : 2),
    })
    const nameEs = (cardId: CardId) => index.cardById(cardId)?.nameEs ?? cardId
    const coreNames = core
      .filter((groupId) => !build.left.some((item) => item.groupId === groupId))
      .map((groupId) => nameEs(index.groupById(groupId)?.displayCardId ?? groupId))
    const lists = (n: number) => `${n} ${n === 1 ? 'lista' : 'listas'}`
    const basisText =
      build.basis.kind === 'together'
        ? `Lo que juegan las ${lists(build.basis.lists)} de la era con ${joinEs(coreNames)}`
        : build.basis.kind === 'partial'
          ? `Casi ninguna lista juega todo el núcleo junto: lo que juegan las ${lists(build.basis.lists)} con alguna de esas cartas`
          : `Ninguna lista de la era juega estas cartas: lo más jugado de la era (${lists(build.basis.lists)})`
    return {
      era: scope.era,
      format: scope.format,
      pool,
      event: event ? { id: event.id, name: event.name } : null,
      basis: { ...build.basis, text: basisText },
      energies: build.energies,
      cards: build.picks.map((pick) => ({
        cardId: pick.cardId,
        groupId: pick.groupId,
        nameEs: nameEs(pick.cardId),
        count: pick.copies,
        reason: pick.reason,
        share: pick.share,
      })),
      left: build.left.map((item) => {
        const cardId = index.groupById(item.groupId)?.displayCardId ?? item.groupId
        return {
          cardId,
          nameEs: nameEs(cardId),
          reason:
            item.reason === 'not_owned'
              ? 'No la tenés en la colección'
              : played(item.groupId) === null
                ? 'El motor todavía no la juega'
                : `No entra en las reglas de «${event?.name ?? 'el evento'}»`,
        }
      }),
      problems: build.problems,
      total: build.cards.reduce((sum, card) => sum + card.count, 0),
      attribution: LIMITLESS_ATTRIBUTION,
    }
  }

  private lockedGroups(index: CatalogIndex, cardIds: readonly string[]): Set<CardId> {
    const groups = new Set<CardId>()
    for (const cardId of cardIds) {
      const card = index.cardById(cardId)
      if (!card) throw new BadRequestException({ code: 'validation', message: `Carta ${cardId} desconocida.` })
      groups.add(card.functionalGroupId)
    }
    return groups
  }

  /** T-017 C3: the first filler the engine plays and `cards` can take one more copy of, or null. */
  private async probeFiller(index: CatalogIndex, cards: readonly DeckCardEntry[]): Promise<CardId | null> {
    const engine = await this.engine.status()
    const groups = groupsOfCards(cards, index)
    for (const cardId of PROBE_FILLERS) {
      const card = index.cardById(cardId)
      if (!card || !engineEdition(card, index, engine)) continue
      if ((groups.get(card.functionalGroupId) ?? 0) < 2) return cardId
    }
    return null
  }

  /**
   * T-017 E3: a variant that brings in one of the cards to try — the `pick`-th not yet in the list, cycling — in the
   * place of a random copy (with its pre-evolution when missing), or null when none can come in.
   */
  private includeVariant(
    cards: readonly DeckCardEntry[],
    energies: readonly SelectableEnergy[],
    pool: readonly PoolCard[],
    include: readonly string[],
    pick: number,
    seed: number,
    locked: ReadonlySet<CardId>,
    seen: Set<string>,
    index: CatalogIndex,
    rules?: EventRules,
    affinity?: ReadonlyMap<CardId, number>,
  ): Variant | null {
    const inList = groupsOfCards(cards, index)
    const wanted = include.filter((groupId) => !inList.has(groupId))
    // Its own seeds (review of #64: `seed + 7` was the common variants' seed seven rounds later).
    const random = seededRandom(chunkSeed(seed, INCLUDE_SEED_SALT))
    for (let k = 0; k < wanted.length; k++) {
      const groupId = wanted[(pick + k) % wanted.length] as CardId
      const card = pool.find((item) => item.groupId === groupId)
      if (!card) continue
      // Review of #64: its pre-evolution comes along when the list lacks it (never drawn on its own: weight 0).
      const pre = index.cardById(card.cardId)?.evolvesFrom
      const helpers = pre ? pool.filter((item) => item.nameEn === pre).map((item) => ({ ...item, weight: 0 })) : []
      const variant = variantOf(cards, energies, [card, ...helpers], index, random, {
        locked,
        seen,
        affinity: (id) => affinity?.get(id) ?? 0,
        accept: rules ? (next) => checkEventDeck(next, rules, index).ok : undefined,
      })
      if (!variant) continue
      seen.add(variant.key)
      return variant
    }
    return null
  }

  /**
   * T-017 E4: a list added to a search in play (the best of a test, for example): its next search round plays it
   * against the incumbent like one more variant. While the round in play lasts it waits in `pending`.
   */
  async addCandidate(rawId: string, deck: LabDeckInput): Promise<LabJobView> {
    const id = parseNumericId(rawId, 'Simulación')
    const current = await this.prisma.simulationJob.findUnique({ where: { id } })
    if (current?.kind !== 'explore') throw new NotFoundException(`Búsqueda ${rawId} no encontrada.`)
    const lab = (current.params as unknown as JobParams).lab
    const { scope } = await this.tournaments.scopedDataset({ era: lab.era, format: lab.format })
    const snapshot = await this.snapshots.save(this.source(deck, scope))
    if (!snapshot.simulable) {
      throw new UnprocessableEntityException({
        code: 'not_simulable',
        message: `No se puede simular ${snapshot.label}: ${describeProblems(snapshot.problems)}.`,
      })
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM simulation_jobs WHERE id = ${id} FOR UPDATE`
      const job = await tx.simulationJob.findUniqueOrThrow({ where: { id } })
      const params = job.params as unknown as JobParams
      const state = params.lab.explore
      if (
        (job.status !== 'queued' && job.status !== 'running') ||
        !state ||
        state.phase !== 'search' ||
        state.stopRequested
      ) {
        throw new BadRequestException({ code: 'validation', message: 'Esa búsqueda ya no está buscando.' })
      }
      const searchRounds = state.rounds.filter((round) => round.kind === 'search' && !round.probe).length
      if (searchRounds >= state.config.maxRounds) {
        throw new BadRequestException({
          code: 'validation',
          message: 'Esa búsqueda ya está en su última ronda: probala con una prueba suelta.',
        })
      }
      // Review of #64: «already in» by the list (functional cards and energies), not by snapshot id, here under the
      // job's lock: the same list sent as a deck and as cards, or twice at once, plays once.
      const index = this.catalog.requireIndex()
      const row = await tx.deckSnapshot.findUniqueOrThrow({
        where: { id: snapshot.id },
        select: { cards: true, energies: true },
      })
      const cards = slotsOfSnapshot(row.cards as unknown as SnapshotCard[])
      const energies = row.energies as SelectableEnergy[]
      const keyOf = (list: readonly DeckCardEntry[], zone: readonly string[]) =>
        energyKey(listKeyByGroup(groupsOfCards(list, index)), zone as SelectableEnergy[])
      const known = await tx.deckSnapshot.findMany({
        where: {
          id: {
            in: [
              state.base,
              state.incumbent,
              ...(state.pending ?? []),
              ...state.rounds.flatMap((round) => round.candidates),
            ],
          },
        },
        select: { id: true, cards: true, energies: true },
      })
      const key = keyOf(cards, energies)
      const incumbent = known.find((item) => item.id === state.incumbent)
      const sameZone = !!incumbent && sameEnergies(incumbent.energies as string[], energies)
      const seenKey = sameZone ? listKeyByGroup(groupsOfCards(cards, index)) : key
      if (
        known.some(
          (item) => keyOf(slotsOfSnapshot(item.cards as unknown as SnapshotCard[]), item.energies as string[]) === key,
        ) ||
        state.seen.includes(seenKey)
      ) {
        throw new BadRequestException({ code: 'validation', message: 'Esa lista ya está en la búsqueda.' })
      }
      // Review of #64: what a variant of the search has to keep — a valid list, the event's rules, the locked cards.
      const problems = validateDeck({ cards: [...cards], energies }, index).errors
      if (problems.length > 0) {
        throw new BadRequestException({ code: 'validation', message: `La lista no valida: ${problems[0]?.message}` })
      }
      if (state.event && !checkEventDeck(cards, state.event.rules, index).ok) {
        throw new BadRequestException({
          code: 'validation',
          message: `La lista no cumple las reglas de «${state.event.name}».`,
        })
      }
      const groups = groupsOfCards(cards, index)
      const missing = state.locked.filter((groupId) => !groups.has(groupId))
      if (missing.length > 0) {
        throw new BadRequestException({
          code: 'validation',
          message: `A la lista le faltan cartas que la búsqueda no toca: ${missing.map((groupId) => index.groupById(groupId)?.nameEs ?? groupId).join(', ')}.`,
        })
      }
      state.seen = [...state.seen, seenKey]
      state.pending = [...(state.pending ?? []), snapshot.id]
      params.sideA = [...new Set([...params.sideA, snapshot.id])]
      await tx.simulationJob.update({ where: { id }, data: { params: params as unknown as Prisma.InputJsonValue } })
    })
    return this.job(rawId)
  }

  private variants(
    cards: readonly DeckCardEntry[],
    energies: readonly SelectableEnergy[],
    pool: readonly PoolCard[],
    index: CatalogIndex,
    seed: number,
    count: number,
    locked: ReadonlySet<CardId>,
    seen: Set<string>,
    affinity: ReadonlyMap<CardId, number>,
    rules?: EventRules,
    learned?: Learned,
    weakest?: ReadonlySet<CardId>,
  ): Variant[] {
    const random = seededRandom(seed)
    const out: Variant[] = []
    for (let tries = 0; out.length < count && tries < count * 3; tries++) {
      const variant = variantOf(cards, energies, pool, index, random, {
        locked,
        seen,
        affinity: (groupId) => affinity.get(groupId) ?? 0,
        accept: rules ? (cards) => checkEventDeck(cards, rules, index).ok : undefined,
        // T-017 C4: a card change that helped in earlier rounds comes up more often, one that hurt less.
        ...(learned || weakest
          ? {
              boostIn: (groupId: CardId) => (learned ? learnedFactor(learned, changeKey('+', groupId)) : 1),
              // T-017 C3: the weakest third of the probe round goes out more often.
              boostOut: (groupId: CardId) =>
                (learned ? learnedFactor(learned, changeKey('-', groupId)) : 1) *
                (weakest?.has(groupId) ? WEAKEST_BOOST : 1),
            }
          : {}),
      })
      if (!variant) continue
      seen.add(variant.key)
      out.push(variant)
    }
    return out
  }

  /** Saves the variants as snapshots (simulable ones only), labelled «v<round>.<n>». */
  private async saveVariants(
    variants: readonly Variant[],
    energies: SelectableEnergy[],
    baseLabel: string,
    round: number,
  ): Promise<SnapshotView[]> {
    const saved: SnapshotView[] = []
    for (const [at, variant] of variants.entries()) {
      const snapshot = await this.snapshots.save({
        cards: variant.cards,
        energies: variant.energies ?? energies,
        label: `${shortLabel(baseLabel)} · v${round}.${at + 1}`,
        origin: 'lab',
      })
      if (snapshot.simulable) saved.push(snapshot)
    }
    return saved
  }

  async explore(input: LabExploreInput): Promise<
    | JobSummaryView
    | {
        base: Omit<SnapshotView, 'id'>
        /** T-017 E3: the starting list's cards (to lock some, whatever the source). */
        baseCards: CardLineView[]
        bank: LabBankView
        pool: number
        firstRound: { add: CardLineView[]; remove: CardLineView[] }[]
        config: ExploreConfig
        /** H-021: sent back, the search starts with these same first-round variants. */
        seed: number
        /** Fase 42: `robustness`, the replay of the confirmation with `confirmBot` when it backs what was found. */
        games: { perRound: number; max: number; robustness: number }
        estimatedSeconds: { perRound: number; max: number; robustness: number }
      }
  > {
    const config = exploreConfig(input.config)
    const players = this.players(input)
    const bank = await this.bankOf(input)
    const index = bank.scope.index
    if (bank.gauntlet.rivals.length === 0) {
      throw new BadRequestException({ code: 'validation', message: 'La era no tiene arquetipos simulables.' })
    }
    const baseSource = this.source(input.deck, bank.scope)
    const { draft } = await this.snapshots.draft(baseSource)
    if (!draft.simulable) {
      throw new UnprocessableEntityException({
        code: 'not_simulable',
        message: `No se puede simular ${draft.label}: ${describeProblems(draft.problems)}.`,
      })
    }
    const baseCards = slotsOfSnapshot(draft.cards)
    const event = input.eventId ? await this.eventRules(input.eventId) : null
    if (event) {
      const check = checkEventDeck(baseCards, event.rules, index)
      if (!check.ok) {
        throw new UnprocessableEntityException({
          code: 'event_rules',
          message: `La lista de partida no cumple las reglas de «${event.name}»: ${check.problems.map((problem) => problem.message).join('; ')}.`,
        })
      }
    }
    const locked = this.lockedGroups(index, input.locked ?? [])
    // T-017 E3: «probar estas cartas».
    const include = this.lockedGroups(index, input.include ?? [])
    const affinity = neighborhoodUsage(bank.dataset, baseCards, index)
    // Review of #27: the pool is frozen for every Energy Zone and filtered with the one in play, round by round.
    let fullPool = await this.pool(bank, SELECTABLE_ENERGIES, config.pool, affinity, event?.rules)
    if (include.size > 0) {
      // T-017 E3: what was asked for enters even without copies in the collection (and even if no list plays it), as
      // often as the most played card. Review of #64: each refusal says why.
      const engine = await this.engine.status()
      const top = Math.max(1, ...fullPool.map((card) => card.weight))
      const asked: PoolCard[] = []
      for (const groupId of include) {
        const group = index.groupById(groupId)
        const display = group ? index.cardById(group.displayCardId) : undefined
        const card = display ? engineEdition(display, index, engine) : null
        const refuse = (why: string) =>
          new BadRequestException({
            code: 'validation',
            message: `No se puede probar ${group?.nameEs ?? groupId}: ${why}.`,
          })
        if (!card) throw refuse('el motor no la juega')
        if (event && cardBreaksEvent(card, event.rules) !== null)
          throw refuse(`el evento «${event.name}» no la permite`)
        if (!usableWith(card, draft.energies)) throw refuse('las energías de la lista no pagan ninguno de sus ataques')
        asked.push({ cardId: card.id, groupId, nameEn: card.nameEn, maxCopies: 2, weight: top })
      }
      fullPool = [...fullPool.filter((card) => !include.has(card.groupId)), ...asked]
    }
    const pool = poolForZone(fullPool, draft.energies, index)
    const baseSeed = this.baseSeed(input)
    const seen = new Set([listKeyByGroup(groupsOfCards(baseCards, index))])
    // T-017 C3: with a probe round, the first round measures what each card is worth (one copy out, a filler in).
    const filler = config.probe ? await this.probeFiller(index, baseCards) : null
    const probes = filler
      ? probeVariants(baseCards, filler, index, {
          locked,
          valid: (cards) =>
            validateDeck({ cards: [...cards], energies: draft.energies }, index).errors.length === 0 &&
            (!event || checkEventDeck(cards, event.rules, index).ok),
        })
      : []
    for (const probe of probes) seen.add(probe.key)
    const probing = probes.length > 0
    // T-017 E3: one variant of the first round brings in a card to try.
    const firstInclude = probing
      ? null
      : this.includeVariant(
          baseCards,
          draft.energies,
          pool,
          [...include],
          0,
          baseSeed,
          locked,
          seen,
          index,
          event?.rules,
          affinity,
        )
    const drawn = probing
      ? []
      : this.variants(
          baseCards,
          draft.energies,
          pool,
          index,
          baseSeed,
          config.variantsPerRound - (firstInclude ? 1 : 0),
          locked,
          seen,
          affinity,
          event?.rules,
        )
    const first = probing ? probes : [...(firstInclude ? [firstInclude] : []), ...drawn]
    const rivals = bank.gauntlet.rivals.length
    const games = exploreGames(config, rivals)
    const robustnessGames = config.confirmBot && config.confirmGames > 0 ? 2 * rivals * config.confirmGames : 0
    if (input.dryRun) {
      const cores = input.cores ?? (await this.workerCores())
      return {
        base: (await this.snapshots.preview(baseSource)) as Omit<SnapshotView, 'id'>,
        baseCards: lines(index, mergeLines(baseCards)),
        bank: await this.bank(input),
        pool: pool.length,
        firstRound: first.map((variant) => ({
          add: lines(index, variant.add),
          remove: lines(index, variant.remove),
        })),
        config,
        seed: baseSeed,
        games: { ...games, robustness: robustnessGames },
        estimatedSeconds: {
          perRound: Math.round(estimateSeconds(games.perRound, players, cores)),
          max: Math.round(estimateSeconds(games.max, players, cores)),
          robustness:
            robustnessGames > 0 && config.confirmBot
              ? Math.round(estimateSeconds(robustnessGames, [config.confirmBot, config.confirmBot], cores))
              : 0,
        },
      }
    }
    if (first.length === 0) {
      throw new BadRequestException({
        code: 'no_variants',
        message:
          'No encontré variantes válidas del mazo con esas cartas: probá con todas las cartas o sin bloquear tantas.',
      })
    }
    const base = await this.snapshots.save(baseSource)
    const rivalSnapshots: SnapshotView[] = []
    for (const source of bank.sources) rivalSnapshots.push(await this.snapshots.save(source))
    const variants = await this.saveVariants(first, draft.energies, base.label, 0)
    const lab = this.labParams(bank, 'explore')
    lab.rivals = lab.rivals.map((rival, at) => ({ ...rival, snapshot: rivalSnapshots[at]?.id as number }))
    const decks = [base.id, ...variants.map((variant) => variant.id)]
    const chunks = roundChunks(
      decks,
      rivalSnapshots.map((rival) => rival.id),
      // Fase 42: each rival's games by its weight; with carreras, the first half. T-017 C3: a probe round, half.
      probing
        ? roundGames(
            config,
            Math.max(10, Math.round(config.gamesPerRival / 2)),
            lab.rivals.map((rival) => rival.weight),
          )
        : searchGames(
            config,
            lab.rivals.map((rival) => rival.weight),
          ),
      baseSeed,
      0,
      0,
    )
    lab.explore = {
      config,
      locked: [...locked],
      base: base.id,
      incumbent: base.id,
      stall: 0,
      phase: 'search',
      stopReason: null,
      rounds: [
        {
          index: 0,
          kind: 'search',
          incumbent: base.id,
          candidates: variants.map((variant) => variant.id),
          fromIdx: 0,
          toIdx: chunks.length,
          accepted: null,
          decided: false,
          ...(probing ? { probe: true } : config.race && variants.length > 1 ? { stage: 1 as const } : {}),
        },
      ],
      variants: Object.fromEntries(variants.map((variant) => [String(variant.id), { round: 0, parent: base.id }])),
      seen: [...seen],
      ...(event ? { event } : {}),
      ...(include.size > 0 ? { include: [...include] } : {}),
      frozen: freezeInputs(fullPool, affinity),
    }
    const params: JobParams = {
      sideA: decks,
      sideB: rivalSnapshots.map((rival) => rival.id),
      bothOrders: false,
      ...((await this.perGameReady()) ? { perGame: true } : {}),
      lab,
    }
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.simulationJob.create({
        data: {
          kind: 'explore',
          label:
            input.label?.trim() ||
            `Explorar ${base.label}${event ? ` para «${event.name}»` : ''}${bank.objective.kind === 'meta' ? '' : ` contra ${objectiveLabel(bank)}`}`,
          params: params as unknown as Prisma.InputJsonValue,
          engineRev: this.engine.engineRev(),
          players,
          gamesPerPair: config.gamesPerRival,
          baseSeed: BigInt(baseSeed),
          cores: input.cores ?? null,
          replaySample: 0,
          totalGames: chunks.reduce((sum, chunk) => sum + chunk.games, 0),
        },
      })
      await tx.simulationChunk.createMany({ data: chunks.map((chunk) => ({ ...chunk, jobId: created.id })) })
      return created
    })
    this.queue.notifyQueued()
    return this.simulations.progressOf(String(job.id))
  }

  /**
   * Whether to ask for per-game results: a worker that plays them (`canPlayPerGame`: its engine says so) was seen in the
   * last `PER_GAME_WORKER_WINDOW_MS`. Without one, a job that asks for them would wait in the queue; the lab then
   * falls back to independent scores. Asked again before every round of a search (review of #7).
   */
  private async perGameReady(): Promise<boolean> {
    const since = new Date(Date.now() - PER_GAME_WORKER_WINDOW_MS)
    const workers = await this.prisma.workerNode.findMany({
      where: { lastSeenAt: { gte: since } },
      select: { version: true, cliVersion: true, engineFeatures: true },
    })
    // The queue's own rule (`canPlayPerGame`, #16): the engine's features, or the versions for engines without them.
    return workers.some(canPlayPerGame)
  }

  /**
   * Review of #7: when no worker that plays per-game results has been seen for `PER_GAME_WORKER_WINDOW_MS`, the lab
   * jobs still waiting stop asking for them, so their chunks go to whoever is there instead of waiting in silence.
   */
  async sweepPerGame(): Promise<number> {
    if (await this.perGameReady()) return 0
    return this.prisma.$executeRaw`
      UPDATE simulation_jobs SET params = params - 'perGame'
      WHERE status IN ('queued', 'running') AND params ? 'lab' AND params->>'perGame' = 'true'`
  }

  /**
   * T-017 D2: «Frenar y confirmar». The chunks of the search round in play that no worker took yet go away; when the
   * ones being played come back (or right away, if none), the round ends with what it has — an incomplete candidate
   * cannot win, and a complete one that wins is verified first — and the search goes to its confirmation as if it had
   * run out of rounds. Nothing found: it just ends.
   * A verification in play is left to finish (review of #22): cutting it would throw away the variant it is checking.
   */
  async stop(rawId: string): Promise<LabJobView> {
    const id = parseNumericId(rawId, 'Simulación')
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM simulation_jobs WHERE id = ${id} FOR UPDATE`
      const job = await tx.simulationJob.findUnique({ where: { id } })
      if (job?.kind !== 'explore') throw new NotFoundException(`Búsqueda ${rawId} no encontrada.`)
      const params = job.params as unknown as JobParams
      const state = params.lab.explore
      const round = state?.rounds.at(-1)
      if ((job.status !== 'queued' && job.status !== 'running') || !state || !round || state.phase !== 'search') {
        throw new BadRequestException({ code: 'validation', message: 'Esa búsqueda ya no está buscando.' })
      }
      if (state.stopRequested) {
        throw new BadRequestException({
          code: 'validation',
          message: 'Ya la frenaste: termina lo que se está jugando.',
        })
      }
      state.stopRequested = true
      let removed = 0
      if (round.kind === 'search') {
        round.stopped = true
        // Review of #22: only what is still queued at delete time (a worker may take a chunk meanwhile).
        const deleted = await tx.$queryRaw<{ games: number }[]>`
          DELETE FROM simulation_chunks
          WHERE job_id = ${id} AND status = 'queued' AND idx >= ${round.fromIdx}
          RETURNING games`
        removed = deleted.reduce((sum, chunk) => sum + chunk.games, 0)
      }
      await tx.simulationJob.update({
        where: { id },
        data: { params: params as unknown as Prisma.InputJsonValue, totalGames: job.totalGames - removed },
      })
    })
    // Review of #22: always — it does nothing while chunks are in play (their last result advances the search), and a
    // result that landed during the transaction may have found the round still pending.
    await this.advance(id)
    return this.job(rawId)
  }

  /**
   * Fase 42 (R-012): the confirmation of search `parentId` played again with `config.confirmBot` (both sides) — the
   * list found and the starting one against the same rivals' snapshots, with fresh seeds and each rival's games by its
   * weight, as a test of its own («Confirmación con e3 de #N») that waits behind the rest (priority −1, D-024). The
   * search marks it pending in the transaction that decides the confirmation; this queues it, now or from the sweep
   * (review of #49), and a failure leaves it pending with the error for the next sweep.
   */
  private async enqueueRobustness(parentId: number): Promise<void> {
    try {
      const job = await this.prisma.simulationJob.findUniqueOrThrow({ where: { id: parentId } })
      const params = job.params as unknown as JobParams
      const state = params.lab.explore
      const replay = state?.robustness
      if (!state || !replay || replay.jobId !== null) return
      const rivals = params.lab.rivals.filter((rival) => typeof rival.snapshot === 'number')
      const { explore: _explore, ...lab } = params.lab
      const child = await this.simulations.create({
        kind: 'compare',
        label: `Confirmación con ${replay.bot} de #${parentId}`,
        sideA: [{ snapshotId: state.incumbent }, { snapshotId: state.base }],
        sideB: rivals.map((rival) => ({ snapshotId: rival.snapshot as number })),
        gamesPerPair: state.config.confirmGames,
        // Review of #49: by weight, as the confirmation it replays.
        gamesByRival: roundGames(
          state.config,
          state.config.confirmGames,
          rivals.map((rival) => rival.weight),
        ),
        players: [replay.bot, replay.bot],
        seed: chunkSeed(Number(job.baseSeed), 7_777_777),
        replaySample: 0,
        priority: -1,
        lab: { ...lab, mode: 'test', robustnessOf: parentId } as unknown as Prisma.InputJsonValue,
        ...(params.perGame ? { perGame: true } : {}),
      })
      const kept = await this.setRobustness(parentId, { jobId: child.id, bot: replay.bot })
      // After the move's review: the sweep and `advance` may both have queued one; the second is cancelled.
      if (!kept) await this.simulations.cancel(String(child.id)).catch(() => undefined)
    } catch (error) {
      this.logger.error({ err: error, job: parentId }, 'robustness confirmation not queued')
      const message = error instanceof Error ? error.message : String(error)
      await this.setRobustness(parentId, null, message.slice(0, 300)).catch(() => undefined)
    }
  }

  /**
   * Records the replay's job on its search — false when another one got there first (then that one stays) — or, with
   * `error`, a failed try: after `REPLAY_ATTEMPTS` the replay is given up instead of tried every few minutes forever.
   */
  private async setRobustness(
    parentId: number,
    replay: { jobId: number; bot: string } | null,
    error?: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM simulation_jobs WHERE id = ${parentId} FOR UPDATE`
      const fresh = await tx.simulationJob.findUniqueOrThrow({ where: { id: parentId } })
      const params = fresh.params as unknown as JobParams
      const state = params.lab.explore
      if (!state?.robustness) return false
      if (replay) {
        if (state.robustness.jobId !== null) return false
        state.robustness = replay
      } else {
        // A replay already queued (by the other path) is not a failed try.
        if (state.robustness.jobId !== null) return false
        const attempts = (state.robustness.attempts ?? 0) + 1
        state.robustness = {
          ...state.robustness,
          attempts,
          ...(error ? { error } : {}),
          ...(attempts >= REPLAY_ATTEMPTS ? { failed: true } : {}),
        }
      }
      await tx.simulationJob.update({
        where: { id: parentId },
        data: { params: params as unknown as Prisma.InputJsonValue },
      })
      return true
    })
  }

  /** Fase 42: the replays a search marked pending and that are not queued yet (the app restarted, or it failed). */
  async sweepRobustness(): Promise<number> {
    const pending = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM simulation_jobs
      WHERE kind = 'explore' AND params->'lab'->'explore'->'robustness' IS NOT NULL
        AND params->'lab'->'explore'->'robustness'->>'jobId' IS NULL
        AND params->'lab'->'explore'->'robustness'->>'failed' IS NULL`
    for (const { id } of pending) await this.enqueueRobustness(id)
    return pending.length
  }

  /** Fase 42: what the replay with another bot says of the list found against the starting one, once played. */
  private async robustnessView(
    state: ExploreState,
    rivals: readonly { snapshot: number; weight: number }[],
  ): Promise<LabExploreView['robustness']> {
    const replay = state.robustness
    if (!replay) return null
    const empty = {
      bot: replay.bot,
      jobId: replay.jobId,
      verdict: null,
      verdictEs: null,
      differenceText: null,
      robustness: null,
      robustnessEs: null,
      error: replay.error ?? null,
    }
    if (replay.jobId === null) return { ...empty, status: replay.failed ? 'failed' : 'pending' }
    const job = await this.prisma.simulationJob.findUnique({ where: { id: replay.jobId }, select: { status: true } })
    if (!job) return { ...empty, status: 'failed' }
    const playing = { ...empty, status: job.status as string }
    if (job.status !== 'done') return playing
    const chunks = await this.prisma.simulationChunk.findMany({ where: { jobId: replay.jobId }, select: CHUNK_SELECT })
    const all = () => true
    const z = state.config.verifyZ ?? DEFAULT_EXPLORE_CONFIG.verifyZ
    const paired = pairedOf(chunks, rivals, state.incumbent, state.base, all)
    const found = paired
      ? { verdict: differenceVerdict(paired, z), difference: paired }
      : confirmVerdict(scoreOf(chunks, rivals, state.incumbent, all), scoreOf(chunks, rivals, state.base, all), z)
    if (!found) return playing
    const robustness = robustnessOf(found.verdict)
    return {
      ...playing,
      verdict: found.verdict,
      verdictEs: CONFIRM_VERDICT_ES[found.verdict],
      differenceText: formatDifferenceEs(found.difference),
      robustness,
      robustnessEs: robustnessEs(robustness, replay.bot),
    }
  }

  private async workerCores(): Promise<number> {
    const worker = await this.prisma.workerNode.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { cores: true } })
    return worker?.cores ?? 2
  }

  /**
   * The end of a round of an explore job (WorkerQueueService.settle, once no chunk is queued or playing): scores it,
   * keeps the incumbent or the variant that beat it, and queues the next round, the confirmation or the end. The job
   * row is locked so two results landing together advance it once.
   */
  async advance(jobId: number): Promise<void> {
    // Fase 42: set when the confirmation backs the list found and the search plays it again with another bot.
    let robust = false
    try {
      const queued = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM simulation_jobs WHERE id = ${jobId} FOR UPDATE`
          const job = await tx.simulationJob.findUnique({ where: { id: jobId } })
          if (job?.kind !== 'explore' || (job.status !== 'queued' && job.status !== 'running')) return false
          const pending = await tx.simulationChunk.count({ where: { jobId, status: { in: ['queued', 'leased'] } } })
          if (pending > 0) return false
          const params = job.params as unknown as JobParams
          const state = params.lab.explore
          const round = state?.rounds.at(-1)
          if (!state || !round) throw new Error('explore job without state')
          const chunks = await tx.simulationChunk.findMany({ where: { jobId }, select: CHUNK_SELECT })
          const rivals = params.lab.rivals
          const finish = async (stop: ExploreStop | null) => {
            state.phase = 'done'
            if (stop) state.stopReason = stop
            const failed = chunks.filter((chunk) => chunk.status === 'failed').length
            await tx.simulationJob.update({
              where: { id: jobId },
              data: {
                params: params as unknown as Prisma.InputJsonValue,
                status: 'done',
                finishedAt: new Date(),
                error: failed > 0 ? `${failed} cruces fallaron en el motor; el resto quedó.` : null,
              },
            })
            return false
          }
          const thisRound = (chunk: ChunkRow) => chunk.idx >= round.fromIdx && chunk.idx < round.toIdx
          if (round.kind === 'confirm') {
            round.decided = true
            // H-010: the search says it found a better list only when the confirmation's fresh games back it.
            const z = state.config.verifyZ ?? DEFAULT_EXPLORE_CONFIG.verifyZ
            const paired = pairedOf(chunks, rivals, state.incumbent, state.base, thisRound)
            state.confirmed = paired
              ? { verdict: differenceVerdict(paired, z), difference: paired }
              : confirmVerdict(
                  scoreOf(chunks, rivals, state.incumbent, thisRound),
                  scoreOf(chunks, rivals, state.base, thisRound),
                  z,
                )
            // Fase 42 (R-012): is the improvement the bot's? Played again with another one, unless it is the same.
            const bot = state.config.confirmBot
            robust =
              state.confirmed?.verdict === 'better' &&
              !!bot &&
              !(job.players[0] === bot && job.players[1] === bot) &&
              !state.robustness
            // Review of #49: marked here, in the transaction; queued right after it (or by the sweep).
            if (robust && bot) state.robustness = { jobId: null, bot }
            return finish(null)
          }

          // Fase 42, carreras: after a search round's first half, the clearly worse variants leave and the rest play the
          // second half (seeds of their own, the same for every list). With «Frenar», what it has is decided now.
          if (round.kind === 'search' && round.stage === 1 && !state.stopRequested) {
            round.stage = 2
            const difference = (id: number) => {
              const x = scoreOf(chunks, rivals, id, thisRound)
              const y = scoreOf(chunks, rivals, round.incumbent, thisRound)
              return pairedOf(chunks, rivals, id, round.incumbent, thisRound) ?? (x && y ? scoreDifference(x, y) : null)
            }
            // Review of #53: if the incumbent missed a pairing, nobody can be compared with it: nobody leaves.
            const incumbentWhole = complete(chunks, rivals, round.incumbent, thisRound)
            round.dropped = incumbentWhole
              ? raceDrops(
                  round.candidates.map((id) => {
                    const whole = complete(chunks, rivals, id, thisRound)
                    return { id, complete: whole, difference: whole ? difference(id) : null }
                  }),
                )
              : []
            const survivors = round.candidates.filter((id) => !round.dropped?.includes(id))
            if (survivors.length > 0) {
              const [first, second] = raceHalves(
                roundGames(
                  state.config,
                  state.config.gamesPerRival,
                  rivals.map((rival) => rival.weight),
                ),
              )
              const fromIdx = Math.max(round.toIdx, Math.max(-1, ...chunks.map((chunk) => chunk.idx)) + 1)
              const half = roundChunks(
                [round.incumbent, ...survivors],
                rivals.map((rival) => rival.snapshot as number),
                second,
                Number(job.baseSeed),
                round.index,
                fromIdx,
                { seedOffset: RACE_SEED_OFFSET, firstGame: first },
              )
              round.stageIdx = fromIdx
              round.toIdx = fromIdx + half.length
              await tx.simulationChunk.createMany({ data: half.map((chunk) => ({ ...chunk, jobId })) })
              await tx.simulationJob.update({
                where: { id: jobId },
                data: {
                  params: params as unknown as Prisma.InputJsonValue,
                  totalGames: job.totalGames + half.reduce((sum, chunk) => sum + chunk.games, 0),
                },
              })
              return true
            }
          }
          // The first half of a race: what the variants that left were measured on.
          const firstHalf = (chunk: ChunkRow) =>
            chunk.idx >= round.fromIdx && chunk.idx < (round.stageIdx ?? round.toIdx)
          const left = new Set(round.dropped ?? [])

          let accepted: number | null = null
          let verifyNext: number | null = null
          if (round.kind === 'verify') {
            // H-010: fresh seeds for both; the variant stays only if it wins there too.
            const [candidate] = round.candidates
            const paired =
              candidate === undefined ? null : pairedOf(chunks, rivals, candidate, round.incumbent, thisRound)
            // An incomplete verification (failed chunks; «Frenar» lets it finish) never accepts.
            const ok =
              candidate !== undefined &&
              complete(chunks, rivals, candidate, thisRound) &&
              complete(chunks, rivals, round.incumbent, thisRound) &&
              (paired
                ? differenceVerdict(paired, state.config.verifyZ) === 'better'
                : verifyAccepts(
                    scoreOf(chunks, rivals, candidate, thisRound),
                    scoreOf(chunks, rivals, round.incumbent, thisRound),
                    state.config.verifyZ,
                  ))
            accepted = ok ? (candidate as number) : null
          } else if (round.probe) {
            // T-017 C3: it measures what each card is worth; nothing is accepted.
            round.screened = null
          } else {
            // The screen: each candidate with this round's games; the incumbent without the round that picked it.
            const incumbentScore = scoreOf(chunks, rivals, state.incumbent, unbiasedGames(state, state.incumbent))
            // Fase 42, carreras: those that left after the first half are out of the screen.
            const candidates = round.candidates
              .filter((id) => !left.has(id))
              .map((id) => ({
                id,
                score: scoreOf(chunks, rivals, id, thisRound),
                complete: complete(chunks, rivals, id, thisRound),
              }))
            // With per-game results, each candidate against the incumbent game by game in this same round (same seeds).
            const paired = candidates.map((candidate) => ({
              ...candidate,
              difference: pairedOf(chunks, rivals, candidate.id, state.incumbent, thisRound),
            }))
            // Those without per-game results (a chunk played by a worker without them) sit this screen out.
            const screened = paired.some((candidate) => candidate.difference)
              ? pairedWinner(paired, state.config.acceptZ)
              : roundWinner(incumbentScore, candidates, state.config.acceptZ)
            round.screened = screened
            if (screened !== null && (state.config.verifyGames ?? 0) > 0) verifyNext = screened
            else accepted = screened
          }
          // T-017 C4: what this round says about each card change, for the rounds to come.
          const measured = await tx.deckSnapshot.findMany({
            where: { id: { in: [round.incumbent, ...round.candidates] } },
            select: { id: true, cards: true },
          })
          const cardsOf = (id: number) =>
            slotsOfSnapshot(measured.find((row) => row.id === id)?.cards as unknown as SnapshotCard[])
          const differenceOf =
            // Review of #15: only what both played in full (a failed chunk would compare different rivals). Fase 42: the
            // variants that left a race, on its first half (what both played).
            (id: number): number | null => {
              const games = left.has(id) ? firstHalf : thisRound
              return complete(chunks, rivals, id, games) && complete(chunks, rivals, round.incumbent, games)
                ? (pairedOf(chunks, rivals, id, round.incumbent, games)?.value ??
                    independentDifference(chunks, rivals, id, round.incumbent, games))
                : null
            }
          learnRound(state, round, cardsOf, differenceOf, this.catalog.requireIndex())
          // T-017 C3: after the probe round, the weakest third goes out more often.
          if (round.probe) {
            const index = this.catalog.requireIndex()
            state.weakest = weakestThird(
              round.candidates.map((id) => ({
                groupId: swapOf(cardsOf(round.incumbent), cardsOf(id), index, 0).remove[0] ?? '',
                difference: differenceOf(id),
              })),
            )
          }
          // Review of #15: a swap the verification rejected leaves the combo list (its round flattered it).
          const [verified] = round.kind === 'verify' ? round.candidates : []
          if (verified !== undefined && accepted === null) {
            state.swaps = (state.swaps ?? []).filter((swap) => swap.variant !== verified)
          }
          if (accepted !== null) {
            const undone = state.revertOf?.[String(accepted)]
            if (undone !== undefined) {
              // Bots' review, item 7: an undo that wins takes the swap it undid out of the history (and is not one).
              state.accepted = (state.accepted ?? []).filter((item) => item.variant !== undone)
            } else {
              // T-017 C5: an accepted swap can be undone in later rounds. Taken from the lists themselves (a combo's two
              // swaps together; combos are not in `swaps`, review of the stack); an Energy change alone is not a swap.
              const measuredBefore = (state.swaps ?? []).find((item) => item.variant === accepted)?.difference ?? 0
              const swap = swapOf(
                cardsOf(round.incumbent),
                cardsOf(accepted),
                this.catalog.requireIndex(),
                measuredBefore,
              )
              if (swap.add.length > 0) state.accepted = [...(state.accepted ?? []), { ...swap, variant: accepted }]
            }
            state.swaps = (state.swaps ?? []).filter((item) => item.variant !== accepted)
          }
          round.accepted = accepted
          round.decided = true
          if (verifyNext === null && !round.probe) {
            if (accepted !== null) {
              state.incumbent = accepted
              state.stall = 0
            } else state.stall += 1
          }

          const searchRounds = state.rounds.filter((item) => item.kind === 'search' && !item.probe).length
          // T-017 D2: stopped by hand, what was accepted goes to the confirmation. A complete variant that won the stopped
          // round is still verified first (bots' review, item 5; H-010): nothing is accepted without fresh games.
          let stop: ExploreStop | null =
            verifyNext !== null
              ? null
              : state.stopRequested
                ? 'user'
                : searchRounds >= state.config.maxRounds
                  ? 'rounds'
                  : state.stall >= state.config.patience && !(state.pending?.length ?? 0)
                    ? 'patience'
                    : null
          const index = this.catalog.requireIndex()
          // Review of #22: never inside the round just played, whose last chunks «Frenar» may have deleted.
          const nextIdx = Math.max(round.toIdx, Math.max(-1, ...chunks.map((chunk) => chunk.idx)) + 1)
          const rivalIds = rivals.map((rival) => rival.snapshot as number)
          const baseSeed = Number(job.baseSeed)
          let decks: number[] = []
          let games = state.config.gamesPerRival
          let kind: ExploreRound['kind'] = 'search'
          if (verifyNext !== null) {
            kind = 'verify'
            decks = [state.incumbent, verifyNext]
            games = state.config.verifyGames
          } else if (!stop) {
            const incumbent = await tx.deckSnapshot.findUniqueOrThrow({ where: { id: state.incumbent } })
            const energies = incumbent.energies as SelectableEnergy[]
            const incumbentCards = slotsOfSnapshot(incumbent.cards as unknown as SnapshotCard[])
            let affinity: ReadonlyMap<CardId, number>
            let pool: PoolCard[]
            // The copies the collection allows, from the pool before the zone's filter (review of #35 by Codex).
            let capsPool: PoolCard[]
            if (state.frozen) {
              affinity = new Map(state.frozen.affinity)
              // Review of #27: frozen for every zone; filtered with the one in play (an Energy variant may change it).
              capsPool = thawPool(state.frozen, index)
              pool = poolForZone(capsPool, energies, index)
            } else {
              // A search queued before H-021: today's tournaments and collection, as it always did.
              const bank = await this.usageBank(params.lab)
              affinity = neighborhoodUsage(bank.dataset, incumbentCards, index)
              pool = await this.pool(bank, energies, state.config.pool, affinity, state.event?.rules)
              capsPool = pool
            }
            const seen = new Set(state.seen)
            // T-017 C4: one variant joins the two best swaps measured so far; the draws lean on what was learned.
            const rules = state.event?.rules
            const caps = poolCaps(capsPool, state.config.pool)
            const learned = state.learned ?? {}
            const combo = comboVariant(incumbentCards, state.swaps ?? [], index, {
              seen,
              locked: new Set(state.locked),
              // Review of #15: within the copies the pool allows (the collection's), ordered by what was learned.
              maxCopies: caps,
              score: (swap) => swapScore(learned, swap, index),
              valid: (cards) =>
                validateDeck({ cards: [...cards], energies }, index).errors.length === 0 &&
                (!rules || checkEventDeck(cards, rules, index).ok),
            })
            if (combo) seen.add(combo.key)
            // T-017 C5: one variant undoes a swap accepted earlier (a different one each round).
            const baseSnapshot = await tx.deckSnapshot.findUniqueOrThrow({ where: { id: state.base } })
            const baseCards = slotsOfSnapshot(baseSnapshot.cards as unknown as SnapshotCard[])
            // The last one accepted was just verified: undo only the ones before it.
            const revert = revertVariant(
              incumbentCards,
              (state.accepted ?? []).slice(0, -1),
              searchRounds,
              index,
              (groupId) => {
                const inBase = baseCards.find((entry) => index.cardById(entry.cardId)?.functionalGroupId === groupId)
                return inBase?.cardId ?? index.groupById(groupId)?.displayCardId ?? groupId
              },
              {
                seen,
                locked: new Set(state.locked),
                valid: (cards) =>
                  validateDeck({ cards: [...cards], energies }, index).errors.length === 0 &&
                  (!rules || checkEventDeck(cards, rules, index).ok),
              },
            )
            if (revert) seen.add(revert.key)
            // T-017 C6: one variant tries another Energy Zone with the same cards (a different option each round).
            seen.add(energyKey(listKeyByGroup(groupsOfCards(incumbentCards, index)), energies))
            const energyChange = energyVariant(incumbentCards, energies, searchRounds, index, seen)
            if (energyChange) seen.add(energyChange.key)
            // Review of the stack: the combo, the undo and the Energy variant never go past `variantsPerRound`.
            // T-017 E3: one variant brings in a card to try (a different one each round).
            const asked = this.includeVariant(
              incumbentCards,
              energies,
              pool,
              state.include ?? [],
              searchRounds,
              baseSeed + searchRounds,
              new Set(state.locked),
              seen,
              index,
              rules,
              affinity,
            )
            const fixed = [
              ...(combo ? [combo] : []),
              ...(revert ? [revert] : []),
              ...(asked ? [asked] : []),
              ...(energyChange ? [energyChange] : []),
            ].slice(0, state.config.variantsPerRound)
            for (const left of [combo, revert, asked, energyChange]) {
              if (left && !fixed.includes(left)) seen.delete(left.key)
            }
            const keptCombo = combo && fixed.includes(combo) ? combo : null
            const keptRevert = revert && fixed.includes(revert) ? revert : null
            const fresh = [
              ...fixed,
              ...this.variants(
                incumbentCards,
                energies,
                pool,
                index,
                baseSeed + searchRounds,
                Math.max(0, state.config.variantsPerRound - fixed.length),
                new Set(state.locked),
                seen,
                affinity,
                rules,
                state.learned,
                new Set(state.weakest ?? []),
              ),
            ]
            const base = await tx.deckSnapshot.findUniqueOrThrow({ where: { id: state.base }, select: { label: true } })
            const saved = await this.saveVariants(fresh, energies, base.label, searchRounds)
            state.seen = [...seen]
            // The combo goes first and the revert after it, labelled «v<round>.1» and «.2» when they were simulable.
            const at = (n: number) => saved.find((snapshot) => snapshot.label.endsWith(`v${searchRounds}.${n}`))
            const comboSaved = keptCombo ? at(1) : undefined
            const revertSaved = keptRevert ? at(keptCombo ? 2 : 1) : undefined
            if (comboSaved) state.combos = [...(state.combos ?? []), comboSaved.id]
            if (revertSaved && keptRevert) {
              state.reverts = [...(state.reverts ?? []), revertSaved.id]
              const undone = state.accepted?.[keptRevert.undoes]
              if (undone) state.revertOf = { ...state.revertOf, [String(revertSaved.id)]: undone.variant }
            }
            // T-017 E4: the lists added by hand play this round too (on top of `variantsPerRound`).
            const handed = (state.pending ?? []).filter(
              (sid) => sid !== state.incumbent && !saved.some((variant) => variant.id === sid),
            )
            state.pending = []
            state.added = [...(state.added ?? []), ...handed]
            if (saved.length === 0 && handed.length === 0) stop = 'no_variants'
            else {
              for (const sid of [...handed, ...saved.map((variant) => variant.id)]) {
                state.variants[String(sid)] = { round: searchRounds, parent: state.incumbent }
              }
              decks = [state.incumbent, ...handed, ...saved.map((variant) => variant.id)]
            }
          }
          // Review of #64: lists added by hand that will never play (the search ends) leave the job, and it says so.
          if (stop && state.pending?.length) {
            const lost = state.pending
            state.lost = [...(state.lost ?? []), ...lost]
            params.sideA = params.sideA.filter((sid) => !lost.includes(sid))
            state.pending = []
          }
          if (stop) {
            state.stopReason = stop
            if (state.incumbent === state.base || state.config.confirmGames === 0) return finish(stop)
            state.phase = 'confirm'
            kind = 'confirm'
            decks = [state.base, state.incumbent]
            games = state.config.confirmGames
          }
          const seedRound = state.rounds.length
          const weights = rivals.map((rival) => rival.weight)
          // Fase 42, carreras: a search round with two or more variants plays its first half first.
          const racing = kind === 'search' && !!state.config.race && decks.length > 2
          const next = roundChunks(
            decks,
            rivalIds,
            racing ? searchGames(state.config, weights) : roundGames(state.config, games, weights),
            baseSeed,
            seedRound,
            nextIdx,
          )
          state.rounds.push({
            index: seedRound,
            kind,
            incumbent: state.incumbent,
            candidates: kind === 'confirm' ? [] : decks.slice(1),
            fromIdx: nextIdx,
            toIdx: nextIdx + next.length,
            accepted: null,
            decided: false,
            ...(racing ? { stage: 1 as const } : {}),
          })
          params.sideA = [...new Set([...params.sideA, ...decks])]
          // Review of #7: per-game results only while a worker that plays them is around, round by round.
          if (await this.perGameReady()) params.perGame = true
          else delete params.perGame
          await tx.simulationChunk.createMany({ data: next.map((chunk) => ({ ...chunk, jobId })) })
          await tx.simulationJob.update({
            where: { id: jobId },
            data: {
              params: params as unknown as Prisma.InputJsonValue,
              status: 'running',
              totalGames: job.totalGames + next.reduce((sum, chunk) => sum + chunk.games, 0),
            },
          })
          return true
        },
        { timeout: 60_000 },
      )
      if (queued) this.queue.notifyQueued()
      if (robust) await this.enqueueRobustness(jobId)
    } catch (error) {
      this.logger.error({ err: error, job: jobId }, 'explore round failed')
      await this.prisma.simulationJob.updateMany({
        where: { id: jobId, status: { in: ['queued', 'running'] } },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: `La búsqueda se cortó entre rondas: ${error instanceof Error ? error.message : String(error)}`.slice(
            0,
            2000,
          ),
        },
      })
    }
  }

  /** What the next round's variants need of the job's era: the catalog and how much each card is played (weights). */
  private async usageBank(lab: LabParams): Promise<Bank> {
    const { scope, dataset } = await this.tournaments.scopedDataset({ era: lab.era, format: lab.format })
    return {
      scope,
      dataset,
      objective: lab.objective ?? META_OBJECTIVE,
      gauntlet: { rivals: [], skipped: [], coverage: 0, lists: dataset.entries.length },
      rows: [],
      usage: new Map(cardUsage(dataset.entries).map((row) => [row.groupId, row.share])),
      sources: [],
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Fase 15: the latest finished Laboratorio score of a deck's current list (a test against the meta, or the
   * starting list of a search), with its job; null when the list was never tested.
   */
  async deckScore(deckId: number): Promise<DeckLabScore | null> {
    return (await this.deckScores([deckId])).get(deckId) ?? null
  }

  /**
   * The latest Laboratorio score of each deck's current list (H-007, Fase 36): found by the list itself (the snapshot
   * key, so a restored revision or a copy of the list finds its tests too), only among jobs of the current engine
   * (a score of another engine is another game), with one query for the jobs and each job's view built once.
   */
  async deckScores(deckIds: readonly number[]): Promise<Map<number, DeckLabScore>> {
    const result = new Map<number, DeckLabScore>()
    const keys = new Map<number, string>()
    for (const deckId of deckIds) {
      const current = await this.snapshots.preview({ deckId: String(deckId) }).catch(() => null)
      if (current) keys.set(deckId, current.key)
    }
    if (keys.size === 0) return result
    const snapshots = await this.prisma.deckSnapshot.findMany({
      where: { key: { in: [...new Set(keys.values())] } },
      select: { id: true, key: true },
    })
    const idsByKey = new Map<string, Set<number>>()
    for (const row of snapshots) {
      const ids = idsByKey.get(row.key) ?? new Set<number>()
      ids.add(row.id)
      idsByKey.set(row.key, ids)
    }
    if (idsByKey.size === 0) return result
    const jobs = (
      await this.prisma.simulationJob.findMany({
        where: { status: 'done', engineRev: this.engine.engineRev() },
        orderBy: { id: 'desc' },
        select: { id: true, params: true, finishedAt: true },
      })
    )
      // A deck's score is against the meta (T-017 D4: a test against one rival or «mi meta» says something else), and a
      // search's replay with another bot is not a test of the deck (fase 42: its search already is).
      .filter((job) => {
        const lab = (job.params as unknown as JobParams).lab
        return labMode(job.params) !== null && (lab.objective?.kind ?? 'meta') === 'meta' && !lab.robustnessOf
      })
    const views = new Map<number, LabJobView>()
    for (const [deckId, key] of keys) {
      const ids = idsByKey.get(key)
      if (!ids) continue
      for (const job of jobs) {
        const params = job.params as unknown as JobParams
        if (!params.sideA.some((sid) => ids.has(sid))) continue
        let view = views.get(job.id)
        if (!view) {
          view = await this.job(String(job.id))
          views.set(job.id, view)
        }
        const row = view.decks.find((item) => ids.has(item.snapshot))
        const score = row ? (row.confirm?.score ? row.confirm : row.search) : null
        if (score?.score) {
          result.set(deckId, { jobId: job.id, era: params.lab.era, finishedAt: job.finishedAt, score })
          break
        }
      }
    }
    return result
  }

  async jobs(limit = 50): Promise<LabJobsView> {
    const jobs = await this.prisma.simulationJob.findMany({
      orderBy: { id: 'desc' },
      take: 500,
      select: { id: true, params: true },
    })
    const lab = jobs.filter((job) => labMode(job.params) !== null).slice(0, limit)
    const summaries = new Map(
      (await this.simulations.summariesOf(lab.map((job) => job.id))).map((summary) => [summary.id, summary]),
    )
    return {
      items: lab
        .map((job) => {
          const summary = summaries.get(job.id)
          if (!summary) return null
          return {
            ...summary,
            mode: labMode(job.params) as 'test' | 'explore',
            era: (job.params as unknown as JobParams).lab?.era ?? null,
            // Review of #64: only a search still searching takes a list added by hand.
            phase: (job.params as unknown as JobParams).lab?.explore?.phase ?? null,
            // Review of #47: what it was measured against («el meta», «mi meta», a rival).
            against: againstEs((job.params as unknown as JobParams).lab?.objective ?? META_OBJECTIVE),
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    }
  }

  async job(rawId: string): Promise<LabJobView> {
    const id = parseNumericId(rawId, 'Simulación')
    const job = await this.prisma.simulationJob.findUnique({ where: { id } })
    if (!job) throw new NotFoundException(`Simulación ${rawId} no encontrada.`)
    const mode = labMode(job.params)
    if (!mode) throw new NotFoundException(`La simulación ${rawId} no es del laboratorio.`)
    const params = job.params as unknown as JobParams
    const lab = params.lab
    const [summary, chunks, snapshots, scoped] = await Promise.all([
      this.simulations.progressOf(rawId),
      this.prisma.simulationChunk.findMany({ where: { jobId: id }, select: CHUNK_SELECT }),
      this.prisma.deckSnapshot.findMany({ where: { id: { in: [...params.sideA, ...params.sideB] } } }),
      this.tournaments.scopedDataset({ era: lab.era, format: lab.format }).catch(() => null),
    ])
    const index = this.catalog.requireIndex()
    // T-017 E2: the collection's playable copies, for «te falta» and what the search could not try.
    const playable = await this.tournaments.playable(index)
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
    // Rivals: explore jobs store their snapshot; tests find it by the list key among side B.
    const rivals = lab.rivals.map((rival) => ({
      ...rival,
      snapshot:
        rival.snapshot ??
        params.sideB.find((sid) => {
          const snapshot = byId.get(sid)
          return snapshot?.sourceType === 'tournament_list' && snapshot.sourceId === rival.listKey
        }) ??
        null,
    }))
    const scored = rivals.filter((rival): rival is typeof rival & { snapshot: number } => rival.snapshot !== null)
    const rows = scoped ? listRows(scoped.dataset, 'group') : []
    const archetypeName = (archetypeId: string | null) =>
      archetypeId === null ? null : (scoped?.dataset.archetypes.get(archetypeId)?.name ?? archetypeId)
    const state = lab.explore ?? null
    const confirm = state?.rounds.find((round) => round.kind === 'confirm') ?? null
    const searchFilter = (chunk: ChunkRow) => !confirm || chunk.idx < confirm.fromIdx
    const confirmFilter = (chunk: ChunkRow) => !!confirm && chunk.idx >= confirm.fromIdx && chunk.idx < confirm.toIdx
    const baseCards = state ? cardsOfSnapshot(byId.get(state.base)?.cards as unknown as SnapshotCard[]) : null

    const decks: LabDeckView[] = params.sideA
      .map((sid): LabDeckView | null => {
        const snapshot = byId.get(sid)
        if (!snapshot) return null
        const cards = cardsOfSnapshot(snapshot.cards as unknown as SnapshotCard[])
        const search = scoreView(scoreOf(chunks, scored, sid, searchFilter), lab.objective)
        const confirmed =
          confirm && (sid === state?.base || sid === state?.incumbent)
            ? scoreView(scoreOf(chunks, scored, sid, confirmFilter), lab.objective)
            : null
        const headline = confirmed?.score ? confirmFilter : searchFilter
        const found = novelty(rows, groupsOfCards(cards, index))
        const noveltyView: LabNoveltyView = {
          kind: found.kind,
          label: NOVELTY_LABEL_ES[found.kind],
          swaps: found.closest?.swaps ?? null,
          closestArchetype: archetypeName(found.closest?.archetypeId ?? null),
          closestLists: found.closest?.lists ?? 0,
          nearbyLists: found.nearbyLists,
          nearbyEntries: found.nearbyEntries,
        }
        const role: LabDeckView['role'] = !state
          ? 'deck'
          : sid === state.base
            ? 'base'
            : sid === state.incumbent
              ? 'best'
              : 'variant'
        const changes = baseCards && sid !== state?.base ? cardChanges(baseCards, cards, index) : null
        const vsParent = state ? parentDifference(state, chunks, scored, sid) : null
        return {
          snapshot: sid,
          label: snapshot.label,
          deckId: snapshot.deckId === null ? null : String(snapshot.deckId),
          role,
          round: state?.variants[String(sid)]?.round ?? null,
          search,
          confirm: confirmed,
          games: gamesOf(chunks, sid, headline, hasStage2(snapshot.cards as unknown as SnapshotCard[], index)),
          perRival: scored.map((rival) => {
            const record = recordOf(chunks, sid, rival.snapshot, headline)
            return { rival: rival.snapshot, record, rate: simulationRate(record) }
          }),
          changes: changes ? { add: lines(index, changes.add), remove: lines(index, changes.remove) } : null,
          vsParent: vsParent
            ? {
                text: vsParent.playing
                  ? 'jugando'
                  : vsParent.main.difference
                    ? formatDifferenceEs(vsParent.main.difference)
                    : 'incompleta: faltan cruces de esa ronda',
                value: vsParent.main.difference?.value ?? null,
                ci95: vsParent.main.difference?.ci95 ?? null,
                paired: vsParent.main.paired,
                measuredIn: vsParent.measuredIn,
                complete: vsParent.main.complete,
                selectionText: vsParent.selection?.difference
                  ? formatDifferenceEs(vsParent.selection.difference)
                  : null,
              }
            : null,
          why: changes ? whyCards(changes.add, cards, state?.frozen, index, playable) : [],
          energyChange: (() => {
            const from = state ? (byId.get(state.base)?.energies ?? []) : []
            const to = snapshot.energies
            const same = from.length === to.length && from.every((energy) => to.includes(energy))
            return state && !same ? { from, to } : null
          })(),
          novelty: noveltyView,
          cards: lines(index, cards),
          energies: snapshot.energies,
          simulable: snapshot.simulable,
        }
      })
      .filter((deck): deck is LabDeckView => deck !== null)

    const roleOrder = { best: 0, base: 1, deck: 2, variant: 3 } as const
    decks.sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        (b.confirm?.score?.value ?? b.search.score?.value ?? -1) -
          (a.confirm?.score?.value ?? a.search.score?.value ?? -1),
    )
    const rivalViews: LabRivalView[] = rivals.map((rival) => ({
      snapshot: rival.snapshot,
      label: rival.snapshot === null ? rival.archetypeName : (byId.get(rival.snapshot)?.label ?? rival.archetypeName),
      archetypeId: rival.archetypeId,
      archetypeName: rival.archetypeName,
      share: rival.share,
      weight: rival.weight,
      listKey: rival.listKey,
      second: rival.second ?? false,
    }))
    const robustness = state ? await this.robustnessView(state, scored) : null
    // T-017 C3: what each card is worth, from the probe round (one copy out, the filler in), most expendable first.
    const probeRound = state?.rounds.find((round) => round.probe)
    const probe = probeRound
      ? probeRound.candidates
          .map((id) => {
            const parent = slotsOfSnapshot(byId.get(probeRound.incumbent)?.cards as unknown as SnapshotCard[])
            const cards = slotsOfSnapshot(byId.get(id)?.cards as unknown as SnapshotCard[])
            const groupId = swapOf(parent, cards, index, 0).remove[0] ?? ''
            const inRound = (chunk: ChunkRow) => chunk.idx >= probeRound.fromIdx && chunk.idx < probeRound.toIdx
            const result = measured(chunks, scored, id, probeRound.incumbent, inRound)
            return {
              cardId: groupId,
              nameEs: index.groupById(groupId)?.nameEs ?? groupId,
              value: result.difference?.value ?? null,
              text: !probeRound.decided
                ? 'jugando'
                : result.difference
                  ? formatDifferenceEs(result.difference)
                  : 'incompleta',
            }
          })
          .sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY))
      : []
    return {
      job: summary,
      mode,
      era: lab.era,
      format: lab.format,
      objective: lab.objective ?? META_OBJECTIVE,
      size: lab.size,
      rivals: rivalViews,
      decks,
      explore: state
        ? {
            config: state.config,
            poolEs: EXPLORE_POOL_LABEL_ES[state.config.pool],
            phase: state.phase,
            stopReason: state.stopReason,
            stopReasonEs: state.stopReason ? EXPLORE_STOP_ES[state.stopReason] : null,
            stopRequested: state.stopRequested ?? false,
            base: state.base,
            best: state.incumbent,
            roundsDone: state.rounds.filter((round) => round.kind === 'search' && !round.probe && round.decided).length,
            rounds: state.rounds.map(({ fromIdx: _from, toIdx: _to, ...round }) => ({
              ...round,
              screened: round.screened ?? null,
              stopped: round.stopped ?? false,
              dropped: round.dropped ?? [],
              probe: round.probe ?? false,
            })),
            leftOut: leftOutCards(state.frozen, state.config.pool, index, playable),
            learned: learnedChanges(state.learned ?? {}).map((change) => ({
              sign: change.sign,
              cardId: change.groupId,
              nameEs: index.groupById(change.groupId)?.nameEs ?? change.groupId,
              mean: change.mean,
              n: change.n,
            })),
            combos: state.combos ?? [],
            reverts: state.reverts ?? [],
            probe,
            weakest: (state.weakest ?? []).map((groupId) => ({
              cardId: groupId,
              nameEs: index.groupById(groupId)?.nameEs ?? groupId,
              count: 0,
            })),
            include: (state.include ?? []).map((groupId) => ({
              cardId: groupId,
              nameEs: index.groupById(groupId)?.nameEs ?? groupId,
              count: 0,
            })),
            added: state.added ?? [],
            pending: state.pending ?? [],
            lost: state.lost ?? [],
            confirmation: confirmationView(state, () =>
              confirm?.decided
                ? confirmVerdict(
                    scoreOf(chunks, scored, state.incumbent, confirmFilter),
                    scoreOf(chunks, scored, state.base, confirmFilter),
                    DEFAULT_EXPLORE_CONFIG.verifyZ,
                  )
                : null,
            ),
            robustness,
            locked: state.locked.map((groupId) => ({
              cardId: groupId,
              nameEs: index.groupById(groupId)?.nameEs ?? groupId,
              count: 0,
            })),
            event: state.event
              ? { id: state.event.id, name: state.event.name, rules: describeEventRulesEs(state.event.rules, index) }
              : null,
          }
        : null,
      note: LAB_NOTE,
    }
  }
}

const CHUNK_SELECT = {
  idx: true,
  snapshotAId: true,
  snapshotBId: true,
  status: true,
  winsA: true,
  winsB: true,
  ties: true,
  firstGame: true,
  extra: true,
} as const

function selectableEnergies(words: readonly string[]): SelectableEnergy[] {
  return words
    .map((word) => energyFromNameEn(word))
    .filter((energy): energy is SelectableEnergy => energy !== undefined)
}

/** H-021: the pool and the archetype usage of a search as it starts, kept in its state for every later round. */
function freezeInputs(pool: readonly PoolCard[], affinity: ReadonlyMap<CardId, number>): FrozenInputs {
  return {
    pool: pool.map((card) => [card.cardId, card.maxCopies, card.weight]),
    affinity: [...affinity].filter(([, share]) => share > 0),
  }
}

/** A search round's games by rival: by weight (fase 42), and only the first half with carreras. */
function searchGames(config: ExploreConfig, weights: readonly number[]): number[] {
  const games = roundGames(config, config.gamesPerRival, weights)
  return config.race ? raceHalves(games)[0] : games
}

/** «el meta B4a», «mi meta B4a (12 partidas)», «solo Mega Altaria ex (B4a)» (T-017 D4). */
function objectiveLabel(bank: Bank): string {
  if (bank.objective.kind === 'meta') return `el meta ${bank.scope.era}`
  if (bank.objective.kind === 'mine') return `mi meta ${bank.scope.era} (${bank.objective.matched ?? 0} partidas)`
  return `${bank.objective.labelEs} (${bank.scope.era})`
}

/** The frozen pool back as pool cards (a card the catalog no longer has is left out). */
function thawPool(frozen: FrozenInputs, index: CatalogIndex): PoolCard[] {
  return frozen.pool.flatMap(([cardId, maxCopies, weight]) => {
    const card = index.cardById(cardId)
    return card ? [{ cardId, groupId: card.functionalGroupId, nameEn: card.nameEn, maxCopies, weight }] : []
  })
}

/**
 * A snapshot's cards line by line, in the order the engine plays them (H-020): what a search builds variants from, so
 * each variant keeps its parent's places. A card can have more than one line.
 */
function slotsOfSnapshot(cards: readonly SnapshotCard[] | null | undefined): DeckCardEntry[] {
  return (cards ?? []).map((card) => ({ cardId: card.cardId, count: card.count }))
}

/** A snapshot's cards as deck entries (the deck's own editions, one entry per edition). */
function cardsOfSnapshot(cards: readonly SnapshotCard[] | null | undefined): DeckCardEntry[] {
  const entries = new Map<string, number>()
  for (const card of cards ?? []) entries.set(card.cardId, (entries.get(card.cardId) ?? 0) + card.count)
  return [...entries].map(([cardId, count]) => ({ cardId, count }))
}

/** The same Energy Zone (order apart). */
function sameEnergies(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((energy) => b.includes(energy))
}

/** A list's lines of the same edition together (a search keeps a card's copies on separate lines, H-020). */
function mergeLines(cards: readonly DeckCardEntry[]): DeckCardEntry[] {
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + card.count)
  return [...counts].map(([cardId, count]) => ({ cardId, count }))
}

function lines(index: CatalogIndex, cards: readonly { cardId: string; count: number }[]): CardLineView[] {
  return cards.map((card) => ({
    cardId: card.cardId,
    nameEs: index.cardById(card.cardId)?.nameEs ?? card.cardId,
    count: card.count,
  }))
}

/** «#2 Mega-Blaziken ex (rev. 1)» → «Mega-Blaziken ex»: what a variant's label starts with. */
function shortLabel(label: string): string {
  return label
    .replace(/^#\d+\s+/u, '')
    .replace(/^\d+\.\s+/u, '')
    .replace(/\s*\(rev\. \d+\)$/u, '')
    .replace(/\s*·\s*v\d+\.\d+$/u, '')
    .trim()
}

/** Chunks of one round: every deck against every rival, the same seed per rival (common random numbers). */
function roundChunks(
  decks: readonly number[],
  rivals: readonly number[],
  /** By rival (fase 42: by weight); the same for every list, so the lists of a round share each rival's seeds. */
  games: readonly number[],
  baseSeed: number,
  round: number,
  fromIdx: number,
  /** Fase 42, carreras: the second half's seeds (`RACE_SEED_OFFSET`) and where its games start, by rival. */
  half?: { seedOffset: number; firstGame: readonly number[] },
): { idx: number; snapshotAId: number; snapshotBId: number; games: number; firstGame: number; seed: bigint }[] {
  const chunks: ReturnType<typeof roundChunks> = []
  for (const deck of decks) {
    for (const [at, rival] of rivals.entries()) {
      if (deck === rival || (games[at] ?? 0) <= 0) continue
      chunks.push({
        idx: fromIdx + chunks.length,
        snapshotAId: deck,
        snapshotBId: rival,
        games: games[at] ?? 0,
        firstGame: half?.firstGame[at] ?? 0,
        seed: BigInt(exploreSeed(baseSeed, round, at + (half?.seedOffset ?? 0))),
      })
    }
  }
  return chunks
}

function recordOf(
  chunks: readonly ChunkRow[],
  deck: number,
  rival: number,
  filter: (chunk: ChunkRow) => boolean,
): GameRecord {
  const record: GameRecord = { wins: 0, losses: 0, ties: 0 }
  for (const chunk of chunks) {
    if (chunk.status !== 'done' || !filter(chunk)) continue
    if (chunk.snapshotAId === deck && chunk.snapshotBId === rival) {
      record.wins += chunk.winsA ?? 0
      record.losses += chunk.winsB ?? 0
      record.ties += chunk.ties ?? 0
    }
  }
  return record
}

/** H-010: the confirmation's verdict (a search before H-010 gets it from its confirmation games). */
function confirmationView(
  state: ExploreState,
  fallback: () => { verdict: ConfirmVerdict; difference: ScoreDifference } | null,
): LabExploreView['confirmation'] {
  const found = state.confirmed !== undefined ? state.confirmed : fallback()
  if (!found) return null
  return {
    verdict: found.verdict,
    verdictEs: CONFIRM_VERDICT_ES[found.verdict],
    differenceText: formatDifferenceEs(found.difference),
    difference: found.difference,
  }
}

/**
 * H-010: the games of `id` that did not pick it — every search and verification round except the search round where
 * it won as a candidate (the best of K noisy measures flatters it), and never the confirmation.
 */
function unbiasedGames(state: ExploreState, id: number): (chunk: ChunkRow) => boolean {
  const picked = state.rounds.filter((round) => round.kind === 'search' && round.candidates.includes(id))
  const confirm = state.rounds.find((round) => round.kind === 'confirm')
  return (chunk) =>
    (!confirm || chunk.idx < confirm.fromIdx) &&
    !picked.some((round) => chunk.idx >= round.fromIdx && chunk.idx < round.toIdx)
}

/** Whether a list plays a Stage 2 Pokémon (so «reached Stage 2» means something). */
function hasStage2(cards: readonly SnapshotCard[] | null | undefined, index: CatalogIndex): boolean {
  return (cards ?? []).some((card) => index.cardById(card.cardId)?.evolutionType === 'stage2')
}

/**
 * T-017 E1: a variant against the list it came from, on the games of the round it was born in (paired when both have
 * per-game results there), or null for lists that were never a search candidate.
 */
function parentDifference(
  state: ExploreState,
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null; weight: number }[],
  id: number,
): { main: Measured; measuredIn: 'verify' | 'round'; selection: Measured | null; playing: boolean } | null {
  const search = state.rounds.find((item) => item.kind === 'search' && item.candidates.includes(id))
  if (!search) return null
  const range = (round: ExploreRound) => (chunk: ChunkRow) => chunk.idx >= round.fromIdx && chunk.idx < round.toIdx
  // Fase 42, carreras: a variant that left after the first half is compared on that half (what both played).
  const searchRange = search.dropped?.includes(id)
    ? (chunk: ChunkRow) => chunk.idx >= search.fromIdx && chunk.idx < (search.stageIdx ?? search.toIdx)
    : range(search)
  const selection = measured(chunks, rivals, id, search.incumbent, searchRange)
  // Review of #20: the round that picked it flatters it (the best of K); its verification, on fresh seeds, does not.
  const verify = state.rounds.find((item) => item.kind === 'verify' && item.candidates.includes(id))
  // Review of the stack: a round still in play is «jugando», not «incompleta».
  if (verify) {
    const main = measured(chunks, rivals, id, verify.incumbent, range(verify))
    return { main, measuredIn: 'verify', selection, playing: !verify.decided }
  }
  return {
    main: selection,
    measuredIn: 'round',
    selection: null,
    playing: !search.decided && !search.dropped?.includes(id),
  }
}

interface Measured {
  difference: ScoreDifference | null
  paired: boolean
  /** Both lists played every rival of the round (a failed chunk or «Frenar» leave it incomplete). */
  complete: boolean
}

/** `a − b` on the chunks `filter` keeps, game by game when it can; only when both played every rival in full. */
function measured(
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null; weight: number }[],
  a: number,
  b: number,
  filter: (chunk: ChunkRow) => boolean,
): Measured {
  if (!complete(chunks, rivals, a, filter) || !complete(chunks, rivals, b, filter)) {
    return { difference: null, paired: false, complete: false }
  }
  const paired = pairedOf(chunks, rivals, a, b, filter)
  if (paired) return { difference: paired, paired: true, complete: true }
  const x = scoreOf(chunks, rivals, a, filter)
  const y = scoreOf(chunks, rivals, b, filter)
  return { difference: x && y ? scoreDifference(x, y) : null, paired: false, complete: true }
}

/** T-017 C4: each candidate's swap against the round's incumbent and its measured difference go into `state`. */
function learnRound(
  state: ExploreState,
  round: ExploreRound,
  cardsOf: (id: number) => DeckCardEntry[],
  differenceOf: (id: number) => number | null,
  index: CatalogIndex,
): void {
  const parent = cardsOf(round.incumbent)
  const learned = state.learned ?? {}
  const swaps = state.swaps ?? []
  for (const id of round.candidates) {
    // Review of #64: a list added by hand is no change of a card or two (it may differ in a dozen): nothing to learn.
    if (state.added?.includes(id)) continue
    const difference = differenceOf(id)
    if (difference === null) continue
    const swap = swapOf(parent, cardsOf(id), index, difference)
    // Review of #53: a variant that left a race was measured on half the round (and truncated there): it counts half.
    learnSwap(learned, swap, index, round.dropped?.includes(id) ? 0.5 : 1)
    // A verification replays a swap already measured: it adds to the estimates, not to the swaps. Combos and undos
    // neither (review of the stack): a combo built on them would stack three or more changes, against C7.
    const special = state.combos?.includes(id) || state.reverts?.includes(id)
    // T-017 C3: a probe swaps a card for the filler: what it learns goes to the estimates, never into a combo.
    if (round.kind === 'search' && !special && !round.probe) swaps.push({ ...swap, variant: id })
  }
  state.learned = learned
  state.swaps = swaps.slice(-40)
}

/** `a − b` in points from their scores on the chunks `filter` keeps (no per-game results), or null. */
function independentDifference(
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null; weight: number }[],
  a: number,
  b: number,
  filter: (chunk: ChunkRow) => boolean,
): number | null {
  const x = scoreOf(chunks, rivals, a, filter)
  const y = scoreOf(chunks, rivals, b, filter)
  return x && y ? x.value - y.value : null
}

/** A list's games against a rival in the chunks `filter` keeps, in game order (1 a win); null when one has no `perGame`. */
function outcomesOf(
  chunks: readonly ChunkRow[],
  deck: number,
  rival: number,
  filter: (chunk: ChunkRow) => boolean,
): number[] | null {
  const mine = chunks
    .filter(
      (chunk) => chunk.status === 'done' && chunk.snapshotAId === deck && chunk.snapshotBId === rival && filter(chunk),
    )
    .sort((x, y) => x.firstGame - y.firstGame)
  const out: number[] = []
  for (const chunk of mine) {
    const results = readPerGame(chunk.extra)
    if (!results) return null
    for (const winner of results.winners) out.push(winner === 'A' ? 1 : 0)
  }
  return out
}

/**
 * H-010: `a − b` game by game over the rivals both played in the chunks `filter` keeps (same seeds); null when a chunk
 * has no per-game results or the two lists did not play the same games.
 */
function pairedOf(
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null; weight: number }[],
  a: number,
  b: number,
  filter: (chunk: ChunkRow) => boolean,
): ScoreDifference | null {
  const rows: PairedRival[] = []
  for (const rival of rivals) {
    if (typeof rival.snapshot !== 'number') continue
    const x = outcomesOf(chunks, a, rival.snapshot, filter)
    const y = outcomesOf(chunks, b, rival.snapshot, filter)
    if (!x || !y || x.length !== y.length) return null
    rows.push({ weight: rival.weight, a: x, b: y })
  }
  return pairedDifference(rows)
}

/** T-017 A2: what a list's games say beyond its rate, over the chunks `filter` keeps; null without per-game results. */
function gamesOf(
  chunks: readonly ChunkRow[],
  deck: number,
  filter: (chunk: ChunkRow) => boolean,
  hasStage2: boolean,
): LabGamesView | null {
  const mine = chunks.filter((chunk) => chunk.status === 'done' && chunk.snapshotAId === deck && filter(chunk))
  const entries: PerGameEntry[] = []
  let total = 0
  for (const chunk of mine) {
    total += (chunk.winsA ?? 0) + (chunk.winsB ?? 0) + (chunk.ties ?? 0)
    // Review of #7: a chunk without per-game results (an older worker) is left out; `total` says how many games.
    const results = readPerGame(chunk.extra)
    if (results) entries.push(...perGameEntries(results))
  }
  if (entries.length === 0) return null
  const summary = perGameSummary(entries)
  const rate = (split: { wins: number; games: number }) =>
    simulationRate({ wins: split.wins, losses: split.games - split.wins, ties: 0 })
  return { ...summary, total, hasStage2, firstRate: rate(summary.first), secondRate: rate(summary.second) }
}

function scoreOf(
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null; weight: number }[],
  deck: number,
  filter: (chunk: ChunkRow) => boolean,
): MetaScore | null {
  return metaScore(
    rivals
      .filter((rival) => typeof rival.snapshot === 'number')
      .map((rival) => ({ weight: rival.weight, record: recordOf(chunks, deck, rival.snapshot as number, filter) })),
  )
}

/** Every pairing of the deck in the round finished (a failed chunk leaves it incomplete). */
function complete(
  chunks: readonly ChunkRow[],
  rivals: readonly { snapshot?: number | null }[],
  deck: number,
  filter: (chunk: ChunkRow) => boolean,
): boolean {
  const mine = chunks.filter((chunk) => chunk.snapshotAId === deck && filter(chunk))
  return (
    mine.length > 0 &&
    mine.every((chunk) => chunk.status === 'done') &&
    rivals.every((rival) => rival.snapshot === deck || mine.some((chunk) => chunk.snapshotBId === rival.snapshot))
  )
}

/** A score and its text, «contra» what the job measured against (review of #47: not always the meta). */
function scoreView(score: MetaScore | null, objective: LabObjectiveView = META_OBJECTIVE): LabScoreView {
  return { score, text: formatMetaScoreEs(score, againstEs(objective)) }
}

/** «el meta», «mi meta», «Mega Altaria ex» (T-017 D4). */
export function againstEs(objective: LabObjectiveView): string {
  if (objective.kind === 'meta') return 'el meta'
  if (objective.kind === 'mine') return 'mi meta'
  return objective.labelEs.replace(/^solo /, '')
}

/** «a», «a y b», «a, b y c». */
function joinEs(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}
