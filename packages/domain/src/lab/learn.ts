/**
 * T-017 C4: what a search learns about each card change between rounds. Every variant measured against the list it
 * came from (game by game when there are per-game results) adds its difference to the estimate of each of its changes
 * («+Bulbasaur», «−Casco Pesado»), split evenly among them. The estimates then (a) make a card that helped come in
 * more often and one that hurt less (and the same for what goes out), and (b) suggest, each round, one variant that
 * joins the two best swaps measured so far. They only steer what is tried: what is accepted is still decided by the
 * screen, the verification and the confirmation (H-010).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { listKeyByGroup } from '../tournaments/dataset.js'
import { applySwap, cardChanges, type Variant, type VariantChange } from './mutate.js'
import { groupsOfCards } from './novelty.js'

export interface LearnedChange {
  /** Points of meta score summed over the variants that made the change (each one's share). */
  sum: number
  n: number
}

/** By change key: «+groupId» (came in) or «-groupId» (went out). */
export type Learned = Record<string, LearnedChange>

export function changeKey(sign: '+' | '-', groupId: CardId): string {
  return `${sign}${groupId}`
}

/** A measured swap of a round: the editions that came in, the functional cards that went out, the difference. */
export interface MeasuredSwap {
  add: CardId[]
  remove: CardId[]
  /** Points against the list it came from (0–100 scale). */
  difference: number
}

/** The swap a variant made against its parent, as `MeasuredSwap` (copies repeated). */
export function swapOf(
  parent: readonly DeckCardEntry[],
  variant: readonly DeckCardEntry[],
  index: CatalogIndex,
  difference: number,
): MeasuredSwap {
  const { add, remove } = cardChanges(parent, variant, index)
  const copies = (changes: VariantChange[], group: boolean) =>
    changes.flatMap((change) =>
      Array.from({ length: change.count }, () =>
        group ? (index.cardById(change.cardId)?.functionalGroupId ?? change.cardId) : change.cardId,
      ),
    )
  return { add: copies(add, false), remove: copies(remove, true), difference }
}

/** Adds a measured swap to the estimate of each of its changes, split evenly among them. */
export function learnSwap(learned: Learned, swap: MeasuredSwap, index: CatalogIndex): void {
  const keys = [
    ...swap.add.map((cardId) => changeKey('+', index.cardById(cardId)?.functionalGroupId ?? cardId)),
    ...swap.remove.map((groupId) => changeKey('-', groupId)),
  ]
  if (keys.length === 0) return
  const share = swap.difference / keys.length
  for (const key of keys) {
    const item = learned[key] ?? { sum: 0, n: 0 }
    item.sum += share
    item.n += 1
    learned[key] = item
  }
}

/** The estimate of a change, shrunk toward 0 by one pseudo-observation (one variant says little). */
export function learnedMean(learned: Learned, key: string): number {
  const item = learned[key]
  return item ? item.sum / (item.n + 1) : 0
}

/** How much more often a change is tried: ×2 for each 5 points it helped (×½ if it hurt), between ×¼ and ×4. */
export function learnedFactor(learned: Learned, key: string): number {
  return Math.min(4, Math.max(0.25, 2 ** (learnedMean(learned, key) / 5)))
}

/** The changes measured the most, best and worst first: what the screen shows («Lo que aprendió»). */
export function learnedChanges(
  learned: Learned,
  limit = 8,
): { sign: '+' | '-'; groupId: CardId; mean: number; n: number }[] {
  return Object.entries(learned)
    .map(([key, item]) => ({
      sign: key[0] as '+' | '-',
      groupId: key.slice(1),
      mean: learnedMean(learned, key),
      n: item.n,
    }))
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean) || b.n - a.n || a.groupId.localeCompare(b.groupId))
    .slice(0, limit)
}

/**
 * T-017 C5: a variant of `deck` that undoes one swap accepted earlier — the `pick`-th, cycling — so the search does not
 * stay tied to its first change (search #11 kept +Gible, and the second Bulbasaur it then could have needed was never
 * weighed against taking Gible out). The cards that came in go out, in their places, and the ones that went out come
 * back in the edition `editionOf` gives. Null when none applies, or the result is not valid or not new.
 */
export function revertVariant(
  deck: readonly DeckCardEntry[],
  accepted: readonly MeasuredSwap[],
  pick: number,
  index: CatalogIndex,
  editionOf: (groupId: CardId) => CardId,
  options: {
    seen?: ReadonlySet<string> | undefined
    locked?: ReadonlySet<CardId> | undefined
    valid: (cards: readonly DeckCardEntry[]) => boolean
  },
): Variant | null {
  if (accepted.length === 0) return null
  const baseKey = listKeyByGroup(groupsOfCards(deck, index))
  for (let k = 0; k < accepted.length; k++) {
    const swap = accepted[(pick + k) % accepted.length] as MeasuredSwap
    const back = {
      add: swap.remove.map(editionOf),
      remove: swap.add.map((cardId) => index.cardById(cardId)?.functionalGroupId ?? cardId),
    }
    const cards = deck.map((entry) => ({ ...entry }))
    if (!applySwap(cards, back, index, options.locked)) continue
    const key = listKeyByGroup(groupsOfCards(cards, index))
    if (key === baseKey || options.seen?.has(key) || !options.valid(cards)) continue
    const sorted = cards.filter((entry) => entry.count > 0)
    return { cards: sorted, key, ...cardChanges(deck, sorted, index) }
  }
  return null
}

/**
 * What a swap is worth by what the search learned of its changes (review of #15): the round that measured it flatters
 * the variant that won it (the best of K noisy measures), and a verification that rejected it lowered its changes'
 * estimates since; the raw difference of that round is not a good order.
 */
export function swapScore(learned: Learned, swap: MeasuredSwap, index: CatalogIndex): number {
  const keys = [
    ...swap.add.map((cardId) => changeKey('+', index.cardById(cardId)?.functionalGroupId ?? cardId)),
    ...swap.remove.map((groupId) => changeKey('-', groupId)),
  ]
  return keys.reduce((sum, key) => sum + learnedMean(learned, key), 0)
}

/**
 * A variant of `deck` that makes the two best swaps measured so far (each worth more than nothing by `score`, by
 * default its measured difference), when both still apply (their cards are still in the deck), it is valid, it keeps
 * every card within `maxCopies` (the copies the collection has, with the pool «colección») and it is new; else null.
 */
export function comboVariant(
  deck: readonly DeckCardEntry[],
  swaps: readonly MeasuredSwap[],
  index: CatalogIndex,
  options: {
    seen?: ReadonlySet<string> | undefined
    locked?: ReadonlySet<CardId> | undefined
    valid: (cards: readonly DeckCardEntry[]) => boolean
    maxCopies?: ((groupId: CardId) => number) | undefined
    score?: ((swap: MeasuredSwap) => number) | undefined
  },
): Variant | null {
  const score = options.score ?? ((swap: MeasuredSwap) => swap.difference)
  const best = [...swaps]
    .filter((swap) => score(swap) > 0 && swap.add.length > 0 && swap.add.length === swap.remove.length)
    .sort((a, b) => score(b) - score(a))
  const withinCopies = (cards: readonly DeckCardEntry[]) => {
    if (!options.maxCopies) return true
    for (const [groupId, count] of groupsOfCards(cards, index)) {
      if (count > options.maxCopies(groupId)) return false
    }
    return true
  }
  const baseKey = listKeyByGroup(groupsOfCards(deck, index))
  for (let i = 0; i < best.length; i++) {
    for (let j = i + 1; j < best.length; j++) {
      const first = best[i] as MeasuredSwap
      const second = best[j] as MeasuredSwap
      const cards = deck.map((entry) => ({ ...entry }))
      if (!applySwap(cards, first, index, options.locked) || !applySwap(cards, second, index, options.locked)) continue
      const key = listKeyByGroup(groupsOfCards(cards, index))
      if (key === baseKey || options.seen?.has(key) || !options.valid(cards) || !withinCopies(cards)) continue
      const sorted = cards.filter((entry) => entry.count > 0)
      return { cards: sorted, key, ...cardChanges(deck, sorted, index) }
    }
  }
  return null
}
