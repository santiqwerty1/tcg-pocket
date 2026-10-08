/** Response shapes of the matches API (docs/API.md «Partidas»). Numeric ids travel as strings. */
import type { GameRecord, MatchMode, MatchResult, RateSource, WentFirstKey, WinRate } from '@tcg/domain'

export interface MatchDeckRef {
  id: string
  name: string
  archived: boolean
}

export interface MatchView {
  id: string
  deck: MatchDeckRef
  /** Number of the deck revision the match was played with. */
  deckRevision: number
  result: MatchResult
  opponent: string | null
  wentFirst: boolean | null
  mode: MatchMode
  note: string
  playedAt: Date
  source: 'ui' | 'mcp'
  createdAt: Date
  updatedAt: Date
}

/** A W/L/T record with its rate (PLAN I9); `rate` is null without games. */
export interface RowView {
  record: GameRecord
  rate: WinRate<'matches'> | null
}

export interface MatchStatsView {
  filters: { deckId: string | null; mode: MatchMode | null; from: string | null; to: string | null }
  overall: RowView
  byDeck: (RowView & { deck: MatchDeckRef })[]
  byOpponent: (RowView & { key: string | null; label: string })[]
  byWentFirst: (RowView & { key: WentFirstKey; label: string })[]
  byMode: (RowView & { mode: MatchMode; label: string })[]
  /** Only with a `deckId` filter (newest revision first); `[]` otherwise. */
  byRevision: (RowView & { revision: number | null })[]
}

export interface PickerDeckView {
  id: string
  name: string
  energies: string[]
  builtInGame: boolean
  lastPlayedAt: Date | null
  games: number
}

export interface MatchSuggestionsView {
  /** Active decks in picker order: played (most recent first), built in the game, the rest by name. */
  decks: PickerDeckView[]
  /** Deck of the last logged match when it is still active: the sheet preselects it. */
  lastDeckId: string | null
  lastMode: MatchMode
  opponents: { key: string; label: string; games: number; lastPlayedAt: Date }[]
  /** Archetypes of the current Standard era with ≥ 5 tournament lists (Fase 5), most played first. */
  tournamentArchetypes: { name: string; lists: number }[]
}

export interface ComparisonColumnView {
  source: RateSource
  label: string
  available: boolean
  record: GameRecord | null
  rate: WinRate | null
  /** Where the column comes from, or why it has no data yet. */
  note: string
  /** Separate rows of the same source (tournament: exact list and archetype), each with its own n and interval. */
  rows?: { label: string; record: GameRecord; rate: WinRate | null; note?: string }[]
}

/** Fase 9: one rival of a deck, own matches and the tournament matchup side by side (never combined). */
export interface DeckMatchupRowView {
  /** Tournament archetype (id) or an opponent typed by hand that matches none (id null). */
  rival: { id: string | null; name: string }
  /** Share of the era's lists (0–100); null for a hand-typed opponent. */
  share: number | null
  mine: RowView | null
  tournament: { record: GameRecord; rate: WinRate | null } | null
}

export interface DeckMatchupsView {
  deck: MatchDeckRef
  /** The deck's tournament archetype: chosen in the deck or suggested by the closest lists. */
  archetype: { id: string; name: string; source: 'owner' | 'guessed' } | null
  era: string
  tournamentsWithPairings: number
  /** What the archetype should score against the field (matchups weighted by meta share). */
  expected: { value: number; coverage: number; matches: number; rivals: number } | null
  rows: DeckMatchupRowView[]
  attribution: string
}

/** Three separate columns, never combined into one number (PLAN §3.6, I9). */
export interface DeckComparisonView {
  deck: MatchDeckRef
  columns: ComparisonColumnView[]
}
