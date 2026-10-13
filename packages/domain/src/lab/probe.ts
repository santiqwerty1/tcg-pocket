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
import { changeKey, type Learned, learnedFactor } from './learn.js'
import { cardChanges, replaceSlot, slotGroups, type Variant } from './mutate.js'
import { groupsOfCards } from './novelty.js'
import type { ScoreDifference } from './score.js'

/**
 * Fillers in order of preference: cards that barely change a game for the bots (Hand Scope and Pokédex only show
 * cards; Potion and X Speed do a little). The first the engine plays and the deck can take one more copy of is used.
 */
export const PROBE_FILLERS: readonly CardId[] = ['P-A-3', 'P-A-4', 'P-A-1', 'P-A-2']

/**
 * How often, at least, the weakest third gets drawn to go out against the rest in the rounds after the probe. A floor,
 * not a factor on top of what was learned (review of #78: both together went up to ×12).
 */
export const WEAKEST_BOOST = 3

/**
 * How much more often a card is drawn to go out: what was learned about taking it out (C4), with the weakest third's
 * floor while the probe is all that measured it (n ≤ 1). Second review of #78: once later rounds measure it, what they
 * learned decides — four variants that took a «weak» card out and lost (n 5, −13 points) left it at ×¼, not ×3.
 */
export function outBoost(
  learned: Learned | undefined,
  weakest: ReadonlySet<CardId> | undefined,
  groupId: CardId,
): number {
  const key = changeKey('-', groupId)
  const factor = learned ? learnedFactor(learned, key) : 1
  const onlyProbe = (learned?.[key]?.n ?? 0) <= 1
  return weakest?.has(groupId) && onlyProbe ? Math.max(WEAKEST_BOOST, factor) : factor
}

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

export interface ProbeResult {
  groupId: CardId
  /** The variant without one copy of the card against the deck, or null when it has no measure. */
  difference: ScoreDifference | null
}

/**
 * Most expendable first: by the low end of the interval of the difference — a copy out that, even on the low end, costs
 * little — and then by the difference itself (review of #78: by the point value, a lucky round decided it). Cards with
 * no measure go last.
 */
export function byExpendable(a: ProbeResult, b: ProbeResult): number {
  if (!a.difference || !b.difference) return (a.difference ? -1 : 0) + (b.difference ? 1 : 0)
  return (
    b.difference.ci95[0] - a.difference.ci95[0] ||
    b.difference.value - a.difference.value ||
    a.groupId.localeCompare(b.groupId)
  )
}

/** The weakest third (at least one) in `byExpendable` order. Cards with no measure are left out. */
export function weakestThird(results: readonly ProbeResult[]): CardId[] {
  const measured = results.filter((result) => result.difference !== null).sort(byExpendable)
  if (measured.length === 0) return []
  return measured.slice(0, Math.max(1, Math.round(measured.length / 3))).map((result) => result.groupId)
}
