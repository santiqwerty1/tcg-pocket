/**
 * Response shapes of the deck endpoints (docs/API.md «Mazos»). Numeric ids travel as strings.
 */
import type {
  DeckCompleteness,
  DeckDistance,
  DeckDraft,
  ParseIssue,
  SelectableEnergy,
  ValidationIssue,
} from '@tcg/domain'
import type { CardSummary, GroupSummary } from '../catalog/catalog-views.js'
import type { DeckSource } from '../generated/prisma/enums.js'

export interface IssueView {
  code: string
  message: string
  cardIds?: string[] | undefined
}

export interface ValidationView {
  ok: boolean
  errors: IssueView[]
  warnings: IssueView[]
  infos: IssueView[]
}

export interface DeckSummary {
  id: string
  name: string
  energies: SelectableEnergy[]
  tags: string[]
  builtInGame: boolean
  variantOfId: string | null
  packPriority: number
  /** Limitless archetype chosen for the «torneo» column (null = guessed). */
  tournamentArchetypeId: string | null
  archivedAt: Date | null
  valid: boolean
  errorCount: number
  complete: boolean
  missingCount: number
  cardCount: number
  createdAt: Date
  updatedAt: Date
  revisionNumber: number
}

export interface DeckCardView {
  card: CardSummary
  count: number
  group: GroupSummary
  /** Playable copies of the group (I4). */
  playable: number
  /** Copies of the group the collection lacks for this deck. */
  missing: number
}

export interface DeckRevisionView {
  number: number
  createdAt: Date
  source: DeckSource
  note: string
  cardCount: number
  energies: SelectableEnergy[]
}

export interface DeckChangeView {
  field: string
  old: unknown
  new: unknown
  at: Date
  source: DeckSource
}

export interface DeckDetail extends DeckSummary {
  notes: string
  cards: DeckCardView[]
  validation: ValidationView
  completeness: DeckCompleteness
  revisions: DeckRevisionView[]
  changes: DeckChangeView[]
  /** Best prints owned of every functional card (pedido del 7/10/2026). */
  bestVersions: BestVersionsView
}

export interface VersionPickView {
  cardId: string
  nameEs: string
  rarity: string
  holo: boolean
  count: number
}

/** Only the functional cards whose recommendation improves the list; `cards` is the whole list rewritten. */
export interface BestVersionsView {
  changed: boolean
  groups: {
    groupId: string
    nameEs: string
    need: number
    current: { cardId: string; count: number }[]
    recommended: VersionPickView[]
  }[]
  cards: { cardId: string; count: number }[]
}

export interface ValidateResult {
  draft: DeckDraft | null
  validation: ValidationView
  completeness: DeckCompleteness
}

/** One card of an imported draft, resolved against the catalog so the UI can show names. */
export interface ImportedCardView {
  cardId: string
  count: number
  nameEs: string
  nameEn: string
  cardType: 'pokemon' | 'trainer' | null
}

export interface ImportedDeckDraft {
  number: number | null
  title: string | null
  draft: DeckDraft | null
  /** Same entries as draft.cards with catalog names; empty when draft is null. Unknown ids keep the id as name. */
  cards: ImportedCardView[]
  errors: ParseIssue[]
  warnings: ParseIssue[]
  /** Null when the text did not parse (`draft` is null). */
  validation: ValidationView | null
  completeness: DeckCompleteness | null
}

export function toIssueView(issue: ValidationIssue): IssueView {
  return issue.cardIds
    ? { code: issue.code, message: issue.message, cardIds: issue.cardIds }
    : { code: issue.code, message: issue.message }
}

/** `POST /api/decks/closest`: the saved decks closest to a target list (pedido del 7/10/2026). */
export interface ClosestDecksResult {
  target: { deckId: string | null; name: string | null; cardCount: number }
  scope: 'built' | 'all'
  /** Decks compared (the target itself excluded). */
  candidates: number
  /** Active decks marked as built in the game, to tell «none marked» from «none close». */
  builtInGameDecks: number
  results: DeckDistance[]
}

/** `GET /api/decks/random`. */
/** Fase 10: odds of having cards of the deck by own turn, natural draws only. */
export interface DrawOddsView {
  deck: { id: string; name: string } | null
  deckSize: number
  basics: number
  groups: { cards: { groupId: string; nameEs: string }[]; copies: number; basicCopies: number }[]
  /** turn 0 = opening hand; N = own turn N. Probabilities 0–1. */
  rows: { turn: number; cardsSeen: number; each: number[]; all: number | null }[]
  basicsInHand: { count: number; probability: number }[]
  note: string
}

export interface RandomDeckResult {
  deck: DeckSummary
  /** Own matches logged with the picked deck. */
  games: number
  /** Decks the pick was drawn from (after the filters and leastPlayed). */
  candidates: number
}
