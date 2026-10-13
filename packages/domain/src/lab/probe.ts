/**
 * T-017 C3: the «carta más floja» round. Before searching, each functional card of the deck has one copy swapped for a
 * fixed filler in its place (H-020: every other copy where it was), and the round measures what each copy is worth:
 * the cards whose copy out hurts least are the weakest. What it measures feeds what the search learns (C4: «−card»), and
 * the weakest third goes out more often in the rounds after it. Today what goes out is a draw: in deck 2 every card has
 * an archetype affinity of 80 % or more, and Torchic, its only line of Basics, went out in 17 of 96 variants.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { listKeyByGroup } from '../tournaments/dataset.js'
import { cardChanges, replaceSlot, slotGroups, type Variant } from './mutate.js'
import { groupsOfCards } from './novelty.js'

/**
 * Fillers in order of preference: cards that barely change a game for the bots (Hand Scope and Pokédex only show
 * cards; Potion and X Speed do a little). The first the engine plays and the deck can take one more copy of is used.
 */
export const PROBE_FILLERS: readonly CardId[] = ['P-A-3', 'P-A-4', 'P-A-1', 'P-A-2']

/** How much the weakest group gets drawn to go out, against the rest, in the rounds after the probe. */
export const WEAKEST_BOOST = 3

/**
 * One variant per functional card of `deck` (but the locked ones and the filler's): its first copy out, `filler` in its
 * place. Variants that `valid` refuses (two fillers already, an event rule) are left out.
 */
export function probeVariants(
  deck: readonly DeckCardEntry[],
  filler: CardId,
  index: CatalogIndex,
  options: { locked?: ReadonlySet<CardId> | undefined; valid: (cards: readonly DeckCardEntry[]) => boolean },
): (Variant & { probed: CardId })[] {
  const fillerGroup = index.cardById(filler)?.functionalGroupId ?? filler
  const slots = slotGroups(deck, index)
  const baseKey = listKeyByGroup(groupsOfCards(deck, index))
  const out: (Variant & { probed: CardId })[] = []
  for (const groupId of groupsOfCards(deck, index).keys()) {
    if (groupId === fillerGroup || options.locked?.has(groupId)) continue
    const cards = deck.map((entry) => ({ ...entry }))
    if (!replaceSlot(cards, slots.indexOf(groupId), filler) || !options.valid(cards)) continue
    const key = listKeyByGroup(groupsOfCards(cards, index))
    if (key === baseKey) continue
    const sorted = cards.filter((entry) => entry.count > 0)
    out.push({ cards: sorted, key, ...cardChanges(deck, sorted, index), probed: groupId })
  }
  return out
}

/**
 * The weakest third (at least one): the cards whose copy out hurt least — the highest difference of the variant
 * without it against the deck — most expendable first. Cards with no measure are left out.
 */
export function weakestThird(results: readonly { groupId: CardId; difference: number | null }[]): CardId[] {
  const measured = results
    .filter((result): result is { groupId: CardId; difference: number } => result.difference !== null)
    .sort((a, b) => b.difference - a.difference || a.groupId.localeCompare(b.groupId))
  if (measured.length === 0) return []
  return measured.slice(0, Math.max(1, Math.round(measured.length / 3))).map((result) => result.groupId)
}
