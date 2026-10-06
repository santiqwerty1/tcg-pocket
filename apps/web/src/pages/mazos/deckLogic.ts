/**
 * Pure helpers for the deck editor and the deck importer. The real validation lives in the API (@tcg/domain);
 * these only keep the running count and shape the payloads.
 */
import type {
  CardSearchHit,
  CardSummary,
  DeckCard,
  DeckInput,
  GroupSummary,
  ImportedDeckDraft,
  SelectableEnergy,
} from '@/api/schemas'

export const DECK_SIZE = 20
export const BUILT_IN_GAME_LIMIT = 25

export interface EditorCard {
  card: CardSummary
  group: GroupSummary
  count: number
}

export function totalCount(cards: readonly { count: number }[]): number {
  return cards.reduce((sum, entry) => sum + entry.count, 0)
}

/** «20/20» — the running count shown while editing. */
export function formatDeckCount(total: number): string {
  return `${total}/${DECK_SIZE}`
}

export function isDeckSizeOk(total: number): boolean {
  return total === DECK_SIZE
}

/** Adds one copy of the picked edition (or a new entry); never exceeds DECK_SIZE in total. */
export function addCard(cards: readonly EditorCard[], hit: CardSearchHit): EditorCard[] {
  if (totalCount(cards) >= DECK_SIZE) return [...cards]
  const index = cards.findIndex((entry) => entry.card.id === hit.card.id)
  if (index === -1) return [...cards, { card: hit.card, group: hit.group, count: 1 }]
  return cards.map((entry, i) => (i === index ? { ...entry, count: entry.count + 1 } : entry))
}

/** Sets the count of an edition; 0 removes it. The total never exceeds DECK_SIZE. */
export function setCount(cards: readonly EditorCard[], cardId: string, count: number): EditorCard[] {
  const others = cards.filter((entry) => entry.card.id !== cardId)
  if (count <= 0) return others
  const room = DECK_SIZE - totalCount(others)
  const clamped = Math.min(count, Math.max(room, 0))
  return cards.map((entry) => (entry.card.id === cardId ? { ...entry, count: clamped } : entry))
}

export function fromDeckCards(cards: readonly DeckCard[]): EditorCard[] {
  return cards.map((entry) => ({ card: entry.card, group: entry.group, count: entry.count }))
}

export interface EditorState {
  name: string
  energies: SelectableEnergy[]
  cards: readonly EditorCard[]
  tags: string
  notes: string
  variantOfId: string | null
  packPriority: 0 | 1 | 2 | 3 | null
}

export function parseTags(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

export function toDeckInput(state: EditorState): DeckInput {
  const input: DeckInput = {
    name: state.name.trim(),
    energies: state.energies,
    cards: state.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
    tags: parseTags(state.tags),
    notes: state.notes,
  }
  if (state.variantOfId) input.variantOfId = state.variantOfId
  if (state.packPriority !== null) input.packPriority = state.packPriority
  return input
}

export function groupByType<T extends { card: { cardType: 'pokemon' | 'trainer' } }>(cards: readonly T[]) {
  return {
    pokemon: cards.filter((entry) => entry.card.cardType === 'pokemon'),
    trainers: cards.filter((entry) => entry.card.cardType === 'trainer'),
  }
}

export function draftTitle(draft: ImportedDeckDraft, index: number): string {
  return draft.title ?? draft.draft?.name ?? `Mazo ${draft.number ?? index + 1}`
}

/** Drafts whose energy is still undecided (for example «Cualquiera» in the summary table) need a choice first. */
export function needsEnergyChoice(draft: ImportedDeckDraft): boolean {
  return draft.errors.some((issue) => issue.code === 'energy_choice_required' || issue.code === 'energy_missing')
}

/** Whether a draft can be committed, given the energies the user may have chosen in the preview. */
export function isDraftReady(draft: ImportedDeckDraft, energies: readonly SelectableEnergy[]): boolean {
  if (!draft.draft) return false
  const blocking = draft.errors.filter(
    (issue) => issue.code !== 'energy_choice_required' && issue.code !== 'energy_missing',
  )
  return blocking.length === 0 && energies.length > 0
}

export function draftToDeckInput(
  draft: ImportedDeckDraft,
  index: number,
  energies: readonly SelectableEnergy[],
): DeckInput | null {
  if (!draft.draft) return null
  const input: DeckInput = {
    name: draftTitle(draft, index),
    energies: [...energies],
    cards: draft.draft.cards.map((entry) => ({ cardId: entry.cardId, count: entry.count })),
  }
  if (draft.draft.notes) input.notes = draft.draft.notes
  return input
}
