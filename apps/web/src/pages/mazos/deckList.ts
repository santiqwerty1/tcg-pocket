/**
 * The deck list's filters live in the URL (`?etiqueta=…&armados=1&archivados=1`), so the deck page can step through
 * the same list, in the same order, with ‹ › and the keyboard arrows (pedido del 8/10/2026).
 */
import type { DeckSummary } from '@/api/schemas'

export interface DeckListFilters {
  tag: string | null
  onlyBuilt: boolean
  /** The archived decks instead of the active ones (the API lists one set or the other). */
  archived: boolean
}

export function readDeckListFilters(params: URLSearchParams): DeckListFilters {
  return {
    tag: params.get('etiqueta') || null,
    onlyBuilt: params.get('armados') === '1',
    archived: params.get('archivados') === '1',
  }
}

/** The query string for `filters`, without the «?»; empty when nothing is filtered. */
export function deckListSearch(filters: DeckListFilters): string {
  const params = new URLSearchParams()
  if (filters.tag) params.set('etiqueta', filters.tag)
  if (filters.onlyBuilt) params.set('armados', '1')
  if (filters.archived) params.set('archivados', '1')
  return params.toString()
}

/** `/mazos/13?armados=1`: the deck page, remembering the list it was opened from. */
export function deckPath(id: string, search: string): string {
  return `/mazos/${encodeURIComponent(id)}${search ? `?${search}` : ''}`
}

/** The filters the API does not apply (`archived` picks the request). */
export function filterDecks<T extends Pick<DeckSummary, 'builtInGame' | 'tags'>>(
  decks: readonly T[],
  filters: DeckListFilters,
): T[] {
  return decks.filter(
    (deck) => (!filters.onlyBuilt || deck.builtInGame) && (filters.tag === null || deck.tags.includes(filters.tag)),
  )
}

export interface DeckNeighbors<T> {
  prev: T | null
  next: T | null
  /** 1-based place in the list; null when the deck is not in it. */
  position: number | null
  total: number
}

/**
 * The decks before and after `id` in `decks`, which the API orders by id (the deck number). A deck that left the list
 * while open (unmarked as built, archived) keeps its place by number, so ‹ › still lead to its old neighbours.
 */
export function deckNeighbors<T extends { id: string }>(decks: readonly T[], id: string): DeckNeighbors<T> {
  const index = decks.findIndex((deck) => deck.id === id)
  if (index !== -1) {
    return { prev: decks[index - 1] ?? null, next: decks[index + 1] ?? null, position: index + 1, total: decks.length }
  }
  const after = decks.findIndex((deck) => compareDeckIds(deck.id, id) > 0)
  const insertAt = after === -1 ? decks.length : after
  return { prev: decks[insertAt - 1] ?? null, next: decks[insertAt] ?? null, position: null, total: decks.length }
}

function compareDeckIds(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true })
}
