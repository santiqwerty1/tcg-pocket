/** Response shapes of the simulation API (docs/API.md «Simulación»). Rates are `WinRate` (percent, Wilson 95 %). */
import type { GameRecord, SimulationKind, SnapshotProblem, WinRate } from '@tcg/domain'
import type { EngineUpstreamView } from './engine-upstream.service.js'

export interface SnapshotView {
  id: number
  key: string
  label: string
  sourceType: 'deck_revision' | 'tournament_list' | 'text' | 'lab'
  sourceId: string | null
  deckId: string | null
  energies: string[]
  simulable: boolean
  problems: SnapshotProblem[]
  /** Cards played as another edition (B4b reprints the engine does not know yet). */
  remapped: { cardId: string; playedAs: string }[]
  deckgymText: string
}

export interface JobProgressView {
  totalGames: number
  gamesDone: number
  chunks: { total: number; done: number; running: number; failed: number }
  /** Seconds left at the pace of the finished chunks, split among the chunks playing now; null until one finishes. */
  etaSeconds: number | null
}

export interface JobSummaryView {
  id: number
  kind: SimulationKind
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  label: string
  players: [string, string]
  priority: number
  playersEs: [string, string]
  gamesPerPair: number
  baseSeed: string
  engineRev: string
  replaySample: number
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  error: string | null
  progress: JobProgressView
  /** A job of the Laboratorio (T-008): a test against the meta bank or an automatic search. */
  lab: 'test' | 'explore' | null
  /** Hidden from the list; its results still count. */
  archived: boolean
}

export interface CellView {
  rival: number
  record: GameRecord | null
  rate: WinRate | null
}

export interface MatrixRowView {
  snapshot: number
  total: GameRecord
  rate: WinRate | null
  cells: CellView[]
}

export interface OptimizeRowView {
  /** Cards added, as deckgym ids and Spanish names. */
  cards: { engineId: string; cardId: string | null; nameEs: string }[]
  record: GameRecord
  rate: WinRate | null
  perEnemy: { snapshot: number; record: GameRecord; rate: WinRate | null }[]
}

export interface OptimizeConfirmationView {
  /** The comparison that plays them; null while it is not queued yet (`pending`) or when there was nothing to play. */
  jobId: number | null
  /**
   * The comparison's status, or `pending` (it is queued when the optimize ends; a failed attempt is retried when the
   * optimize is read) or `skipped` (none of the best combinations makes a deck the engine plays).
   */
  status: JobSummaryView['status'] | 'pending' | 'skipped'
  /** Why the last attempt to queue it failed (it is retried), or why it was skipped. */
  error: string | null
  /** Rivals each combination plays. */
  rivals: number
  /** In the optimize's order (rank 1 first): what the confirmation measured with its own seeds. */
  rows: {
    rank: number
    cards: OptimizeRowView['cards']
    /** Rivals whose games all finished, and the ones the engine failed. */
    rivalsPlayed: number
    rivalsFailed: number
    /** Only once every rival was played: a rate over fewer rivals would not be the same measure. */
    record: GameRecord | null
    rate: WinRate | null
    /** False: the deck with this combination is not one the engine plays (it was left out of the confirmation). */
    playable: boolean
  }[]
}

export interface ConsistencyCurveView {
  turn: number
  ready: number
  games: number
  value: number
  ci95: [number, number]
}

/** A consistency job's result: P(ready by own turn N) going first, second and both (Fase 8). */
export interface ConsistencyView {
  /** goldfish: against a rival that does nothing; meta: real games against the meta bank (D-019). */
  mode: 'goldfish' | 'meta'
  /** meta: the era of the bank and the games against each rival. */
  era: string | null
  rivals: { label: string; share: number; games: number }[]
  deckId: string | null
  deck: string
  keyCards: { cardId: string; nameEs: string }[]
  bot: string
  botEs: string
  maxTurn: number
  ready: { first: ConsistencyCurveView[]; second: ConsistencyCurveView[]; all: ConsistencyCurveView[] }
  attack: { first: ConsistencyCurveView[]; second: ConsistencyCurveView[]; all: ConsistencyCurveView[] }
  games: { first: number; second: number; all: number }
}

export interface JobDetailView extends JobSummaryView {
  snapshots: SnapshotView[]
  sideA: number[]
  sideB: number[]
  rows: MatrixRowView[]
  optimize: OptimizeRowView[] | null
  /** optimize jobs: the best combinations played again with fresh seeds (H-011.5), once the optimize finished. */
  optimizeConfirmation: OptimizeConfirmationView | null
  /** consistency jobs: the curves (null until it finished). */
  consistency: ConsistencyView | null
  replays: ReplaySummaryView[]
  chunks: {
    id: number
    idx: number
    a: number | null
    b: number | null
    games: number
    gamesDone: number
    status: string
    seed: string
    /** Phase 42: the chunk its result was copied from (the exact cache); null when a worker played it. */
    cachedFrom: number | null
    attempt: number
    error: string | null
  }[]
}

export interface ReplaySummaryView {
  id: number
  chunkId: number
  a: number | null
  b: number | null
  gameIndex: number
  seed: string
  winner: 'a' | 'b' | 'tie'
  sizeBytes: number
}

export interface WorkerView {
  id: string
  name: string
  engineRev: string | null
  cliVersion: string | null
  cores: number
  version: string | null
  lastSeenAt: Date
  online: boolean
  /** The chunk it holds right now, if any. */
  current: { jobId: number; chunkId: number; gamesDone: number; games: number } | null
}

export interface EngineView {
  engineRev: string
  cards: number
  incomplete: number
  /**
   * worker = reported by `engine-cli status` for this engine; previous = reported for the engine a worker used last
   * (right after an engine update); fallback = the Fase 0 list (46 B4b reprints at fb792eb).
   */
  source: 'worker' | 'previous' | 'fallback' | 'none'
  /** Engine revision the card status comes from. */
  statusRev: string | null
  /** How far deckgym-core's `main` moved since the pinned commit (T-010); null when not checked or unreachable. */
  upstream: EngineUpstreamView | null
  workers: WorkerView[]
  bots: { code: string; label: string }[]
}

/** A stored replay: deckgym's JSON as the engine wrote it, Spanish names by engine id, and which game it was. */
export interface ReplayView {
  replay: unknown
  names: Record<string, string>
  /** Fase 22: engine id → catalog card id (images and the card sheet). */
  cardIds: Record<string, string>
  game: {
    jobId: number
    jobLabel: string
    engineRev: string
    gameIndex: number
    seed: string
    winner: 'a' | 'b' | 'tie'
    /** Labels of the decks of player 0 (side A) and player 1 (side B). */
    decks: [string | null, string | null]
    playersEs: [string, string]
  }
}
