/** Response shapes of the simulation API (docs/API.md «Simulación»). Rates are `WinRate` (percent, Wilson 95 %). */
import type { GameRecord, SimulationKind, SnapshotProblem, WinRate } from '@tcg/domain'
import type { EngineUpstreamView } from './engine-upstream.service.js'

export interface SnapshotView {
  id: number
  key: string
  label: string
  sourceType: 'deck_revision' | 'tournament_list' | 'text'
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

export interface JobDetailView extends JobSummaryView {
  snapshots: SnapshotView[]
  sideA: number[]
  sideB: number[]
  rows: MatrixRowView[]
  optimize: OptimizeRowView[] | null
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
  /** worker = reported by `engine-cli status`; fallback = the Fase 0 list (46 B4b reprints). */
  source: 'worker' | 'fallback' | 'none'
  /** How far deckgym-core's `main` moved since the pinned commit (T-010); null when not checked or unreachable. */
  upstream: EngineUpstreamView | null
  workers: WorkerView[]
  bots: { code: string; label: string }[]
}

/** A stored replay: deckgym's JSON as the engine wrote it, Spanish names by engine id, and which game it was. */
export interface ReplayView {
  replay: unknown
  names: Record<string, string>
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
