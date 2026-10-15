/** Response shapes of the matches API (docs/API.md «Partidas»). Numeric ids travel as strings. */
import type {
  ArchetypeFit,
  CoinAdjustedRate,
  GameRecord,
  MatchMode,
  MatchResult,
  MyMeta,
  RateSource,
  TurnOrderImpact,
  WentFirstKey,
  WinRate,
} from '@tcg/domain'
import type { ExpectedVsMetaView } from '../tournaments/tournament-views.js'

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
  /** 14/10: the rival's cards seen, one per name. */
  opponentCards: { cardId: string; count: number; nameEs: string }[]
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
  /** Fase 44: `coinAdjusted` = ½ going first + ½ going second, null without a match on each side. */
  byDeck: (RowView & { deck: MatchDeckRef; coinAdjusted: CoinAdjustedRate | null })[]
  byOpponent: (RowView & { key: string | null; label: string })[]
  byWentFirst: (RowView & { key: WentFirstKey; label: string })[]
  byMode: (RowView & { mode: MatchMode; label: string })[]
  /** Only with a `deckId` filter (newest revision first); `[]` otherwise. */
  byRevision: (RowView & { revision: number | null })[]
  /** Fase 25: going first against going second, with the gap and whether it is more than chance. */
  turnOrder: TurnOrderImpact
  /** Fase 44: the share adjusted by the coin over the selected matches. */
  coinAdjusted: CoinAdjustedRate | null
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

/** Fase 13: an own record against the expected rate (tournaments), in words. */
export interface LuckView {
  deck: MatchDeckRef
  opponent: string | null
  record: GameRecord
  /** Where the expected rate comes from: the matchup of the deck's archetype against the rival, or its record. */
  expected: {
    /** 0–100, per game (H-009). */
    value: number
    kind: 'matchup' | 'archetype'
    label: string
    /** Tournament matches behind it. */
    games: number
    /** The tournament record per game (fractional), whose uncertainty the check counts; null: taken as exact. */
    perGame: { wins: number; losses: number } | null
    /** The era of both sides: own games since `from` (ISO) count. */
    era: string | null
    from: string | null
  } | null
  check: {
    games: number
    actual: number
    expected: number
    lowerTail: number
    upperTail: number
    verdict: 'too_few' | 'normal' | 'unlucky' | 'lucky'
  } | null
  /** The current losing run of the deck (3 or more), at the expected rate. */
  streak: { losses: number; probability: number; somewhere: number; games: number } | null
  /** The verdict in Spanish, ready to show. */
  text: string
}

/** Fase 9: one rival of a deck, own matches and the tournament matchup side by side (never combined). */
export interface DeckMatchupRowView {
  /** Tournament archetype (id) or an opponent typed by hand that matches none (id null). */
  rival: { id: string | null; name: string }
  /** Share of the era's lists (0–100); null for a hand-typed opponent. */
  share: number | null
  mine: RowView | null
  tournament: { record: GameRecord; rate: WinRate | null } | null
  /**
   * Fase 13: own record against the tournament matchup (when both exist). H-009: own games of the era against the
   * matchup per game, with its uncertainty, and Holm's correction over the rivals of the deck.
   */
  luck: 'too_few' | 'normal' | 'unlucky' | 'lucky' | null
  /** Fase 25: own record going first and going second (matches with who went first noted). */
  turn: { first: GameRecord; second: GameRecord } | null
}

export interface DeckMatchupsView {
  deck: MatchDeckRef
  /** The deck's tournament archetype: chosen in the deck or suggested by the closest lists. */
  archetype: { id: string; name: string; source: 'owner' | 'guessed' } | null
  era: string
  tournamentsWithPairings: number
  /** What the archetype should score against the field (matchups weighted by meta share). */
  expected: ExpectedVsMetaView | null
  /** Fase 44: the same with the rivals weighted by «mi meta»; null until it has enough matches. */
  expectedMine: ExpectedVsMetaView | null
  myMeta: MyMetaSummary | null
  rows: DeckMatchupRowView[]
  attribution: string
}

/** Three separate columns, never combined into one number (PLAN §3.6, I9). */
export interface DeckComparisonView {
  deck: MatchDeckRef
  columns: ComparisonColumnView[]
}

/** Fase 44: «mi meta» — the rivals of my matches as shares of the era's tournament archetypes. */
export interface MyMetaView extends MyMeta {
  era: string
  /** First day counted: the era's start, or `days` ago when that is later. */
  from: string | null
  /** `modes`: the modes read (the one asked, or competitive and casual). */
  filters: { mode: MatchMode | null; modes: MatchMode[]; days: number | null }
}

export type MyMetaSummary = Pick<
  MyMeta,
  'text' | 'enough' | 'coverage' | 'matched' | 'effectiveMatches' | 'orientative'
>

/** 14/10: the current era's archetypes for the rival's cards seen. */
export interface RivalSuggestionsView {
  era: string
  lists: number
  suggestions: ArchetypeFit[]
}

/** 14/10: the matches to classify, grouped by similar cards, and the rivals typed that are no archetype. */
export interface UnclassifiedView {
  era: string
  groups: {
    matches: MatchView[]
    cards: { cardId: string; count: number; nameEs: string }[]
    text: string
    suggestions: ArchetypeFit[]
  }[]
  own: { key: string; label: string; games: number }[]
}
