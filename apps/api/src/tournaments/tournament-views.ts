/** Response shapes of the tournaments API (docs/API.md «Torneos»). Rates are `WinRate` (percent, Wilson 95 %). */
import type { GameRecord, TopConversion, TournamentFormat, WinRate } from '@tcg/domain'

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
  /** H-006: tournaments left out of the era: they play a set the era table does not know. */
  newSetTournaments: { tournamentId: string; name: string; date: string; set: string }[]
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
  /** Fase 9: against each rival in the era's pairings, the most played first. */
  matchups: ArchetypeMatchupsView
}

/** Fase 44: a difference between two rates, in points, with its bootstrap interval (resampling lists). */
export interface RateDifferenceView {
  value: number
  ci95: [number, number]
  p: number
  /** Passes Benjamini–Hochberg at 5 % over the rows of its table. */
  clear: boolean
  /** The smaller side has fewer than 30 lists. */
  orientative: boolean
  text: string
}

export interface CardRefView {
  groupId: string
  nameEs: string
}

/** Fase 44: núcleo, techs, copies and conversion to the top of an archetype. */
export interface ArchetypeCardsView {
  scope: ScopeView
  archetype: ArchetypeRefView
  lists: number
  /** Lists left out: a card of theirs does not map to the catalog yet. */
  incomplete: number
  resamples: number
  core: (CardRefView & { lists: number; share: number; averageCopies: number; byCopies: number[] })[]
  coreSlots: number
  freeSlots: number
  techs: (CardRefView & {
    lists: number
    share: number
    averageCopies: number
    with: RecordRowView
    without: RecordRowView
    difference: RateDifferenceView | null
  })[]
  copies: (CardRefView & {
    lists: number
    share: number
    one: RecordRowView
    two: RecordRowView
    difference: RateDifferenceView | null
  })[]
  conversion: TopConversion | null
  note: string
}

/** One rival of an archetype (Fase 9): matches of the era's pairings, a match being a whole BO1 or BO3. */
export interface MatchupRowView {
  rival: ArchetypeRefView
  /** The rival's share of the era's lists (0–100). */
  share: number
  record: GameRecord
  rate: WinRate | null
  /** H-009: the same matches per game (each phase's BO1/BO3/BO5 converted), ties out; fractional. */
  perGame: { wins: number; losses: number } | null
}

/** What an archetype should score against the field, from its matchups weighted by meta share. */
export interface ExpectedVsMetaView {
  value: number
  /** H-011: approximate 95 % interval (delta method), 0–100. */
  ci95: [number, number]
  /** Share of the meta (0–100) covered by rivals with enough matches. */
  coverage: number
  matches: number
  rivals: number
}

export interface ArchetypeMatchupsView {
  rows: MatchupRowView[]
  /** H-009: the archetype against everyone, per game. */
  fieldPerGame: { wins: number; losses: number } | null
  expected: ExpectedVsMetaView | null
  /** Tournaments of the scope with their pairings downloaded. */
  tournamentsWithPairings: number
}

/** Fase 11: one archetype or card this week against the week before. */
export interface ShareChangeView {
  now: { lists: number; share: number }
  before: { lists: number; share: number }
  delta: number
  /** H-011: two-sided p of the change (clustered by tournament). */
  p: number
  /** Benjamini–Hochberg at 5 % over every archetype and card of the comparison. */
  clear: boolean
}

export interface MetaTrendsView {
  scope: ScopeView
  days: number
  now: { from: string; to: string; tournaments: number; lists: number }
  before: { from: string; to: string; tournaments: number; lists: number }
  archetypes: (ShareChangeView & {
    archetype: ArchetypeRefView
    record: GameRecord
    rate: WinRate | null
    isNew: boolean
  })[]
  cards: (ShareChangeView & { groupId: string; nameEs: string })[]
  attribution: string
}

export interface MatchupMatrixView {
  scope: ScopeView
  coverage: {
    tournaments: number
    tournamentsWithPairings: number
    matches: number
    skipped: { byes: number; doubleLosses: number; noArchetype: number }
  }
  /** The most played archetypes, in order: rows and columns of the table. */
  archetypes: {
    archetype: ArchetypeRefView
    share: number
    lists: number
    /** Its record against everyone in the pairings. */
    field: { record: GameRecord; rate: WinRate | null }
    expected: ExpectedVsMetaView | null
  }[]
  /** a → b for every pair of the table that met (both directions). */
  cells: { a: string; b: string; record: GameRecord; rate: WinRate | null }[]
  attribution: string
}

export interface SubstituteView {
  groupId: string
  /** The card shown (display edition). */
  cardId: string
  nameEs: string
  reason: 'same_name' | 'replaces' | 'archetype'
  /** «otra versión de la misma carta (otro texto)», «la juegan 7 de 19 listas del arquetipo sin ella»… */
  reasonEs: string
  lists: number
  of: number
  have: number
}

export interface ListDetailView {
  scope: ScopeView
  list: ListAgainstCollectionView
  /** For each card the collection lacks, what can take its place (Fase 8). */
  substitutes: { groupId: string; nameEs: string; need: number; have: number; options: SubstituteView[] }[]
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
    pairingsDone: number
    pairingsPending: number
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
  /** Fase 9: complete tournaments with their pairings downloaded, and without them yet. */
  pairings: { fetched: number; missing: number }
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

/**
 * Fase 40 (H-006): a row the era table lacks, proposed from the tournaments that play the set: the date of the first
 * one, «opens an era» unless the catalog calls the set a Deluxe pack, the names from the catalog when it has the set.
 */
export interface SetProposalView extends SetReleaseView {
  tournaments: number
  firstTournament: { id: string; name: string; date: string }
  /** The loaded catalog has the set (if not, update the catalog first: the lists' cards are unknown to it). */
  inCatalog: boolean
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

export interface CardChangeView {
  groupId: string
  nameEs: string
  count: number
}

/** A deck's «versión de torneo» (DECISIONES 6.16): the list of its archetype worth aiming at, and the way there. */
export interface DeckVersionView {
  deckId: string
  deckName: string
  /** Archetype chosen in the deck or guessed from the closest lists; null when no list is close (> 6 changes). */
  archetype: (ArchetypeRefView & { source: 'owner' | 'guessed'; swaps: number | null }) | null
  version: {
    list: ListRowView
    swaps: number
    /** Cards to put in and take out (by functional card). */
    add: CardChangeView[]
    remove: CardChangeView[]
    /** What the collection lacks for the list; empty = it can be built today. */
    missing: MissingCopiesView[]
    missingCopies: number
    /** Other lists of the archetype, best first (only on the single-deck endpoint). */
    alternatives: ListRowView[]
  } | null
}

export interface DeckVersionsView {
  scope: ScopeView
  decks: DeckVersionView[]
}

export interface DeckVersionDetailView extends DeckVersionView {
  scope: ScopeView
}

/** Fase 44: «¿qué mazo armo después?» — per archetype, its closest list and what finishing it costs. */
export interface NextBuildView {
  scope: ScopeView
  maxMissing: number
  rows: {
    archetype: ArchetypeRowView
    closest: ListAgainstCollectionView
    /** Pack points for every missing copy (cheapest print); null when some copy has no point price. */
    points: number | null
    unpriced: number
    tradeable: number
    built: boolean
  }[]
  note: string
}
