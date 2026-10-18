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
import {
  applySwap,
  cardChanges,
  type PoolCard,
  replaceSlot,
  slotGroups,
  strandsPreEvolution,
  type Variant,
  type VariantChange,
} from './mutate.js'
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
  /**
   * The copies that changed: their position in deck order and the functional card that was there (review of the stack:
   * undoing a swap that added a second copy puts the old card back in that place, not in the first copy's line).
   */
  slots?: { at: number; was: CardId; now?: CardId }[]
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
  return {
    add: copies(add, false),
    remove: copies(remove, true),
    difference,
    slots: changedSlots(parent, variant, index),
  }
}

/** Where `variant` differs from `parent`, copy by copy in deck order (a search keeps every other copy in place). */
export function changedSlots(
  parent: readonly DeckCardEntry[],
  variant: readonly DeckCardEntry[],
  index: CatalogIndex,
): { at: number; was: CardId; now: CardId }[] {
  const before = slotGroups(parent, index)
  const after = slotGroups(variant, index)
  if (before.length !== after.length) return []
  const out: { at: number; was: CardId; now: CardId }[] = []
  for (const [at, was] of before.entries()) {
    const now = after[at]
    if (now !== undefined && now !== was) out.push({ at, was, now })
  }
  return out
}

/**
 * Undoes a swap at the positions it changed. «done»: done, in place. «stale»: it knows what it put in each place
 * (`now`) and those places hold something else today, so it is no longer an undo (review of #35 by Codex: a chained
 * combo, +B/−A and +C/−B, changes two places for one card in). «none»: a history without places, or without `now`
 * that is not a plain swap: undo it card by card, as a swap is replayed.
 */
function undoAtSlots(
  cards: DeckCardEntry[],
  swap: MeasuredSwap,
  index: CatalogIndex,
  editionOf: (groupId: CardId) => CardId,
  locked: ReadonlySet<CardId> | undefined,
): 'done' | 'stale' | 'none' {
  const slots = swap.slots ?? []
  if (slots.length === 0) return 'none'
  const added = new Set(swap.add.map((cardId) => index.cardById(cardId)?.functionalGroupId ?? cardId))
  const current = slotGroups(cards, index)
  if (slots.every((slot) => slot.now !== undefined)) {
    for (const { at, now } of slots) {
      const group = current[at]
      if (group === undefined || group !== now || (added.has(group) && locked?.has(group))) return 'stale'
    }
  } else {
    // A history from before `now`: only a plain swap, one place per card in.
    if (slots.length !== swap.add.length) return 'none'
    for (const { at } of slots) {
      const group = current[at]
      if (group === undefined || !added.has(group) || locked?.has(group)) return 'none'
    }
  }
  for (const { at, was } of slots) replaceSlot(cards, at, editionOf(was))
  return 'done'
}

/**
 * Adds a measured swap to the estimate of each of its changes, split evenly among the copies that moved. A change
 * counts one variant however many copies it moved (bots' review, item 6): two copies take two shares, not two variants.
 */
export function learnSwap(learned: Learned, swap: MeasuredSwap, index: CatalogIndex, weight = 1): void {
  const keys = [
    ...swap.add.map((cardId) => changeKey('+', index.cardById(cardId)?.functionalGroupId ?? cardId)),
    ...swap.remove.map((groupId) => changeKey('-', groupId)),
  ]
  if (keys.length === 0) return
  const share = swap.difference / keys.length
  const copies = new Map<string, number>()
  for (const key of keys) copies.set(key, (copies.get(key) ?? 0) + 1)
  // `weight` < 1: a measure worth less than a whole round's (a variant that left a race after its first half).
  for (const [key, count] of copies) {
    const item = learned[key] ?? { sum: 0, n: 0 }
    item.sum += share * count * weight
    item.n += weight
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
 * back in the edition `editionOf` gives. Null when none applies, or the result is not valid or not new. `undoes` is the
 * position in `accepted` of the swap it undoes. Review of #113: never leaves alone a pre-evolution of `pool` that only
 * comes along (undoing «+Polteageist» while Sinistea came in on its own).
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
    /** The search's pool: its weight-0 cards are the pre-evolutions that only come along. */
    pool: readonly PoolCard[]
  },
): (Variant & { undoes: number }) | null {
  if (accepted.length === 0) return null
  const baseKey = listKeyByGroup(groupsOfCards(deck, index))
  for (let k = 0; k < accepted.length; k++) {
    const undoes = (pick + k) % accepted.length
    const swap = accepted[undoes] as MeasuredSwap
    const back = {
      add: swap.remove.map(editionOf),
      remove: swap.add.map((cardId) => index.cardById(cardId)?.functionalGroupId ?? cardId),
    }
    // In the places it changed when they still hold what it put there; a history without places, card by card.
    let cards = deck.map((entry) => ({ ...entry }))
    const undone = undoAtSlots(cards, swap, index, editionOf, options.locked)
    if (undone === 'stale') continue
    if (undone === 'none') {
      cards = deck.map((entry) => ({ ...entry }))
      if (!applySwap(cards, back, index, options.locked)) continue
    }
    const key = listKeyByGroup(groupsOfCards(cards, index))
    if (key === baseKey || options.seen?.has(key) || !options.valid(cards)) continue
    if (strandsPreEvolution(deck, cards, options.pool, index)) continue
    const sorted = cards.filter((entry) => entry.count > 0)
    return { cards: sorted, key, ...cardChanges(deck, sorted, index), undoes }
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
 * default its measured difference), when both still apply (their cards are still in the deck), it is valid, what it
 * adds stays within `maxCopies` (the copies the collection has, with the pool «colección»; a card the list already
 * played above that may stay) and it is new; else null. Review of #113: never leaves alone a pre-evolution of `pool`
 * that only comes along (two swaps «−Polteageist» that pass one by one take both out together).
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
    /** The search's pool: its weight-0 cards are the pre-evolutions that only come along. */
    pool: readonly PoolCard[]
  },
): Variant | null {
  const score = options.score ?? ((swap: MeasuredSwap) => swap.difference)
  const best = [...swaps]
    .filter((swap) => score(swap) > 0 && swap.add.length > 0 && swap.add.length === swap.remove.length)
    .sort((a, b) => score(b) - score(a))
  const had = groupsOfCards(deck, index)
  const withinCopies = (cards: readonly DeckCardEntry[]) => {
    if (!options.maxCopies) return true
    for (const [groupId, count] of groupsOfCards(cards, index)) {
      // Review of the stack: only what goes up, so a starting list above the collection still gets combos.
      if (count > Math.max(options.maxCopies(groupId), had.get(groupId) ?? 0)) return false
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
      if (strandsPreEvolution(deck, cards, options.pool, index)) continue
      const sorted = cards.filter((entry) => entry.count > 0)
      return { cards: sorted, key, ...cardChanges(deck, sorted, index) }
    }
  }
  return null
}
