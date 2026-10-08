/**
 * Novelty of a list (T-008): how far it is from every exact list of the era, by functional card. «Jugada en torneo»:
 * someone played exactly these 20 cards; «conocida»: a tournament list is at most 6 changes away (the distance that
 * guesses a deck's archetype); «nueva»: farther than that from every list of the era.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { ARCHETYPE_GUESS_MAX_SWAPS, deckInTournaments, listSwaps } from '../tournaments/buildable.js'
import type { TournamentDataset } from '../tournaments/dataset.js'
import { cardUsage, entriesOfArchetype, type ListRow } from '../tournaments/stats.js'

export const NOVELTY_MAX_SWAPS = ARCHETYPE_GUESS_MAX_SWAPS

export type NoveltyKind = 'played' | 'known' | 'new'

export const NOVELTY_LABEL_ES: Record<NoveltyKind, string> = {
  played: 'jugada en torneo',
  known: 'conocida',
  new: 'nueva',
}

export interface Novelty {
  kind: NoveltyKind
  /** The closest exact list of the era (the most played one on ties); null when the era has none. */
  closest: { key: string; archetypeId: string | null; swaps: number; lists: number } | null
  /** Exact lists at most `NOVELTY_MAX_SWAPS` changes away, and how many times they were played. */
  nearbyLists: number
  nearbyEntries: number
}

/** Copies per functional card of a deck (unknown cards left out). */
export function groupsOfCards(cards: readonly DeckCardEntry[], index: CatalogIndex): Map<CardId, number> {
  const groups = new Map<CardId, number>()
  for (const entry of cards) {
    const groupId = index.cardById(entry.cardId)?.functionalGroupId
    if (groupId) groups.set(groupId, (groups.get(groupId) ?? 0) + entry.count)
  }
  return groups
}

/** `rows`: the era's exact lists by functional card (`listRows(dataset, 'group')`). */
export function novelty(rows: readonly ListRow[], groups: ReadonlyMap<CardId, number>): Novelty {
  let closest: Novelty['closest'] = null
  let nearbyLists = 0
  let nearbyEntries = 0
  for (const row of rows) {
    const swaps = listSwaps(groups, row.groups)
    if (swaps <= NOVELTY_MAX_SWAPS) {
      nearbyLists += 1
      nearbyEntries += row.lists
    }
    if (!closest || swaps < closest.swaps || (swaps === closest.swaps && row.lists > closest.lists)) {
      closest = { key: row.key, archetypeId: row.archetypeId, swaps, lists: row.lists }
    }
  }
  const kind: NoveltyKind =
    closest?.swaps === 0 ? 'played' : closest && closest.swaps <= NOVELTY_MAX_SWAPS ? 'known' : 'new'
  return { kind, closest, nearbyLists, nearbyEntries }
}

/** Lists farther than this from a deck with no archetype do not count as «like it». */
export const NEIGHBORHOOD_MAX_SWAPS = 10

/**
 * Share (0–100) of the lists like a deck that play each card: its archetype's lists (guessed from the closest ones,
 * as for a deck's archetype), or, when no list is within 6 changes, the lists at most 10 changes away. Empty when
 * nothing in the era is close: a truly new deck gets no hints.
 */
export function neighborhoodUsage(
  dataset: TournamentDataset,
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
): Map<CardId, number> {
  const guessed = deckInTournaments(dataset, cards, index).guessed?.archetypeId ?? null
  const groups = groupsOfCards(cards, index)
  const entries =
    guessed !== null
      ? entriesOfArchetype(dataset, guessed)
      : dataset.entries.filter((entry) => listSwaps(groups, entry.groups) <= NEIGHBORHOOD_MAX_SWAPS)
  return new Map(cardUsage(entries).map((row) => [row.groupId, row.share]))
}
