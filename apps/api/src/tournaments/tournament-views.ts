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

/** One rival of an archetype (Fase 9): matches of the era's pairings, a match being a whole BO1 or BO3. */
export interface MatchupRowView {
  rival: ArchetypeRefView
  /** The rival's share of the era's lists (0–100). */
  share: number
  record: GameRecord
  rate: WinRate | null
}

/** What an archetype should score against the field, from its matchups weighted by meta share. */
export interface ExpectedVsMetaView {
  value: number
  /** Share of the meta (0–100) covered by rivals with enough matches. */
  coverage: number
  matches: number
  rivals: number
}

export interface ArchetypeMatchupsView {
  rows: MatchupRowView[]
  expected: ExpectedVsMetaView | null
  /** Tournaments of the scope with their pairings downloaded. */
  tournamentsWithPairings: number
}

/** Fase 11: one archetype or card this week against the week before. */
export interface ShareChangeView {
  now: { lists: number; share: number }
  before: { lists: number; share: number }
  delta: number
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
