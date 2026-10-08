/** Response shapes of the tournaments API (docs/API.md «Torneos»). Rates are `WinRate` (percent, Wilson 95 %). */
import type { GameRecord, TournamentFormat, WinRate } from '@tcg/domain'

export interface RecordRowView {
  lists: number
  record: GameRecord
  rate: WinRate | null
  /** Share of the era's lists, 0–100. */
  share: number
}

export interface EraView {
  code: string
  nameEs: string
  /** YYYY-MM-DD; `to` is null for the current era. */
  from: string
  to: string | null
  current: boolean
}

export interface ScopeView {
  era: EraView
  format: TournamentFormat
  minPlayers: number
  tournaments: number
  lists: number
  games: number
  /** The era mean (ΣW / Σ(W+L+T)): the baseline, not 50 %. */
  mean: RecordRowView
  /** Tournaments whose lists carry a set newer than their day (pre-release, or a set missing from the table). */
  conflicts: { tournamentId: string; name: string; date: string; set: string }[]
  unknownCards: number
  /** «Datos de torneo: Limitless (play.limitlesstcg.com)». */
  attribution: string
}

export interface ArchetypeRefView {
  id: string | null
  name: string
  icons: string[]
}

export interface ArchetypeRowView extends RecordRowView {
  archetype: ArchetypeRefView
}

export interface CardLineView {
  /** Null when Limitless's set+number is not in the catalog yet. */
  groupId: string | null
  cardId: string | null
  nameEs: string
  nameEn: string
  set: string
  number: string
  count: number
  cardType: 'pokemon' | 'trainer' | null
}

export interface ListRowView extends RecordRowView {
  key: string
  kind: 'group' | 'name'
  archetype: ArchetypeRefView
  cards: CardLineView[]
  /** The same list under the other key (by name ↔ by functional card). */
  otherKey: string | null
}

export interface MissingCopiesView {
  groupId: string
  nameEs: string
  need: number
  have: number
}

export interface ListAgainstCollectionView extends ListRowView {
  missing: MissingCopiesView[]
  missingCopies: number
}

export interface ArchetypesView {
  scope: ScopeView
  rows: ArchetypeRowView[]
}

export interface ListsView {
  scope: ScopeView
  rows: ListRowView[]
  total: number
}

export interface CardUsageView {
  groupId: string
  nameEs: string
  lists: number
  share: number
  /** Lists by copies: [0, one copy, two copies]. */
  byCopies: number[]
  averageCopies: number
}

export interface WithWithoutView {
  card: { groupId: string; nameEs: string }
  minCount: number
  with: RecordRowView
  without: RecordRowView
}

export interface ArchetypeDetailView {
  scope: ScopeView
  archetype: ArchetypeRowView
  /** Limitless ids merged into this one by the owner. */
  merged: string[]
  lists: ListRowView[]
  cards: CardUsageView[]
  withWithout: WithWithoutView | null
}

export interface ListDetailView {
  scope: ScopeView
  list: ListAgainstCollectionView
  /** Most common energies of its entries (English, as Limitless). */
  energies: string[]
  /** Limitless clipboard text (also deckgym's): imports as a deck. */
  text: string
  entries: {
    tournamentId: string
    tournamentName: string
    date: string
    playerName: string
    placing: number | null
    record: GameRecord
  }[]
}

export interface BuildableView {
  scope: ScopeView
  buildable: ListAgainstCollectionView[]
  /** Lists missing 1 or 2 copies, the closest first. */
  near: ListAgainstCollectionView[]
}

export interface UnlockCardView {
  groupId: string
  nameEs: string
  have: number
  copies: number
  lists: number
  listsWithOneCopy: number
  entries: number
  record: GameRecord
  rate: WinRate | null
  unlocked: ListAgainstCollectionView[]
}

export interface UnlockView {
  scope: ScopeView
  cards: UnlockCardView[]
}

export interface TournamentRowView {
  id: string
  name: string
  date: string
  players: number
  lists: number
  organizerName: string | null
  conflict: string | null
}

export interface SyncStatusView {
  enabled: boolean
  running: boolean
  progress: {
    kind: string
    startedAt: string
    calls: number
    waitedMs: number
    listed: number
    done: number
    pending: number
    current: string | null
  } | null
  lastRun: {
    id: number
    kind: string
    status: string
    startedAt: string
    finishedAt: string | null
    calls: number
    tournamentsListed: number
    tournamentsDone: number
    error: string | null
  } | null
  /** Calls to Limitless in the last 5 minutes (the client keeps it ≤ 40). */
  callsInWindow: number
  counts: Record<'listed' | 'complete' | 'incomplete' | 'excluded' | 'failed', number>
  newestTournament: string | null
}

export interface StatusView {
  currentEra: EraView | null
  eras: EraView[]
  /** «Era nueva probable»: more than 35 days since the last release in the table. */
  newEra: { lastRelease: string; releaseDate: string; days: number; likely: boolean } | null
  minPlayers: number
  sync: SyncStatusView
}

export interface SetReleaseView {
  code: string
  nameEn: string
  nameEs: string | null
  releaseDate: string
  opensEra: boolean
}

export interface UnknownCardView {
  ref: string
  set: string
  number: string
  name: string
  occurrences: number
}

/** The «torneo» column of a deck (PLAN §3.6): exact list and archetype, separate rows, never one number. */
export interface DeckTournamentView {
  scope: ScopeView
  exactByGroup: RecordRowView | null
  exactByName: RecordRowView | null
  keyByGroup: string
  keyByName: string
  archetype: (ArchetypeRowView & { source: 'owner' | 'guessed'; swaps: number | null }) | null
}
