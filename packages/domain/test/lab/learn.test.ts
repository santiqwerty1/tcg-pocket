import { describe, expect, it } from 'vitest'
import { validateDeck } from '../../src/decks/index.js'
import type { SelectableEnergy } from '../../src/index.js'
import {
  applySwap,
  changeKey,
  comboVariant,
  groupsOfCards,
  type Learned,
  learnedChanges,
  learnedFactor,
  learnedMean,
  learnSwap,
  type MeasuredSwap,
  mutationPool,
  outBoost,
  poolCaps,
  poolForZone,
  probeVariants,
  replaceSlot,
  revertVariant,
  seededRandom,
  slotGroups,
  swapOf,
  variantOf,
  weakestThird,
} from '../../src/lab/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const deck = deckDraft(2) // Mega-Blaziken ex
const energies = deck.energies as SelectableEnergy[]
const pool = mutationPool({
  index,
  energies,
  edition: (groupId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null,
  maxCopies: () => 2,
})
const group = (cardId: string) => index.cardById(cardId)?.functionalGroupId ?? cardId
const valid = (cards: readonly { cardId: string; count: number }[]) =>
  validateDeck({ cards: [...cards], energies }, index).errors.length === 0

describe('what a search learns between rounds (T-017 C4)', () => {
  it('each measured swap splits its difference among its changes; one variant says little', () => {
    const learned: Learned = {}
    const variant = variantOf(deck.cards, energies, pool, index, seededRandom(3), { swaps: 1 })
    if (!variant) throw new Error('no variant')
    const swap = swapOf(deck.cards, variant.cards, index, 6)
    expect(swap.add).toHaveLength(swap.remove.length)
    learnSwap(learned, swap, index)
    const inKey = changeKey('+', group(swap.add[0] as string))
    const outKey = changeKey('-', swap.remove[0] as string)
    // 6 points split between the card in and the card out, shrunk by one pseudo-observation.
    expect(learnedMean(learned, inKey)).toBeCloseTo(6 / swap.add.length / 2 / 2, 8)
    expect(learnedFactor(learned, inKey)).toBeGreaterThan(1)
    expect(learnedFactor(learned, 'unknown')).toBe(1)
    expect(learnedFactor({ x: { sum: -100, n: 2 } }, 'x')).toBe(0.25)
    expect(learnedFactor({ x: { sum: 100, n: 2 } }, 'x')).toBe(4)
    expect(learnedChanges(learned).map((change) => `${change.sign}${change.groupId}`)).toEqual(
      expect.arrayContaining([inKey, outKey]),
    )
  })

  it('bots review, item 6: two copies of one card are two shares of one variant, not two variants', () => {
    const learned: Learned = {}
    const [x, a, b] = pool.map((card) => card.cardId)
    if (!x || !a || !b) throw new Error('pool')
    learnSwap(learned, { add: [x, x], remove: [group(a), group(b)], difference: 8 }, index)
    // 8 points over 4 copies: +X takes two shares (4) in one variant; each card out, one share (2).
    expect(learned[changeKey('+', group(x))]).toEqual({ sum: 4, n: 1 })
    expect(learned[changeKey('-', group(a))]).toEqual({ sum: 2, n: 1 })
    expect(learnedMean(learned, changeKey('+', group(x)))).toBeCloseTo(2, 8)
    // Review of #53: half a round (a variant out of a race) counts half.
    const half: Learned = {}
    learnSwap(half, { add: [x], remove: [group(a)], difference: 8 }, index, 0.5)
    expect(half[changeKey('+', group(x))]).toEqual({ sum: 2, n: 0.5 })
  })

  it('a card that helped comes in far more often', () => {
    const target = pool.find((card) => index.cardById(card.cardId)?.cardType === 'trainer' && card.weight > 0)
    if (!target) throw new Error('no trainer')
    const count = (boost?: (groupId: string) => number) => {
      const random = seededRandom(9)
      let hits = 0
      for (let i = 0; i < 300; i++) {
        const variant = variantOf(deck.cards, energies, pool, index, random, { swaps: 1, boostIn: boost })
        if (variant?.add.some((change) => group(change.cardId) === target.groupId)) hits += 1
      }
      return hits
    }
    expect(count((groupId) => (groupId === target.groupId ? 4 : 1))).toBeGreaterThan(count() * 2)
  })

  it('the combo joins the two best swaps that still apply', () => {
    const random = seededRandom(21)
    const swaps: MeasuredSwap[] = []
    for (let i = 0; swaps.length < 4 && i < 50; i++) {
      const variant = variantOf(deck.cards, energies, pool, index, random, { swaps: 1 })
      if (variant) swaps.push(swapOf(deck.cards, variant.cards, index, 10 - swaps.length * 3))
    }
    const combo = comboVariant(deck.cards, swaps, index, { pool: [], valid })
    if (!combo) throw new Error('no combo')
    expect(valid(combo.cards)).toBe(true)
    const added = combo.add.map((change) => group(change.cardId))
    // The two best (10 and 7 points) are in, unless they clash and the next pair is used.
    expect(added.length).toBeGreaterThanOrEqual(1)
    // Nothing worse than its parent is ever joined.
    const [first] = swaps
    if (!first) throw new Error('no swap')
    expect(comboVariant(deck.cards, [{ ...first, difference: -1 }], index, { pool: [], valid })).toBeNull()
    // Review of #15: with the collection's copies as the cap, a combo never asks for more than it has.
    const owned = (groupId: string) => (combo.add.some((change) => group(change.cardId) === groupId) ? 0 : 2)
    expect(comboVariant(deck.cards, swaps, index, { pool: [], valid, maxCopies: owned })?.key).not.toBe(combo.key)
    // And the order is the score's: the worst two by difference first when the score says so.
    const reversed = comboVariant(deck.cards, swaps, index, { pool: [], valid, score: (swap) => 20 - swap.difference })
    expect(reversed?.key).not.toBe(combo.key)
    // Review of the stack: a starting list above the collection (none of its own cards owned) still gets the combo;
    // only what goes up is checked.
    const had = groupsOfCards(deck.cards, index)
    const above = (groupId: string) => (had.has(groupId) && !added.includes(groupId) ? 0 : 2)
    expect(comboVariant(deck.cards, swaps, index, { pool: [], valid, maxCopies: above })?.key).toBe(combo.key)
  })

  it('review of the stack: undoing a swap that added a second copy puts the old card back in its own place', () => {
    // A card the list plays once gets a second copy in the place of the list's last card.
    const once = deck.cards.find((entry) => entry.count === 1 && index.cardById(entry.cardId)?.cardType === 'trainer')
    const last = deck.cards.at(-1)
    if (!once || !last || group(last.cardId) === group(once.cardId)) throw new Error('deck shape')
    const variant = deck.cards.map((entry) => ({ ...entry }))
    expect(applySwap(variant, { add: [once.cardId], remove: [group(last.cardId)] }, index)).toBe(true)
    const accepted = swapOf(deck.cards, variant, index, 5)
    expect(accepted.slots).toHaveLength(1)
    const editionOf = (groupId: string) =>
      deck.cards.find((entry) => group(entry.cardId) === groupId)?.cardId ?? groupId
    const back = revertVariant(variant, [accepted], 0, index, editionOf, { pool: [], valid: () => true })
    if (!back) throw new Error('no revert')
    // Every copy where it was: the second copy leaves, not the first one.
    expect(slotGroups(back.cards, index)).toEqual(slotGroups(deck.cards, index))
  })

  it('review of #35 (Codex): a chained combo (+B/−A, +C/−B) is undone in its places too', () => {
    // Two trainers the list plays once each, A before B; C, a trainer it does not play.
    const trainers = deck.cards.filter(
      (entry) => entry.count === 1 && index.cardById(entry.cardId)?.cardType === 'trainer',
    )
    const [a, b] = trainers
    const c = pool.find(
      (card) =>
        index.cardById(card.cardId)?.cardType === 'trainer' &&
        !deck.cards.some((entry) => group(entry.cardId) === card.groupId),
    )
    if (!a || !b || !c) throw new Error('deck shape')
    const slotOf = (cardId: string) => slotGroups(deck.cards, index).indexOf(group(cardId))
    const variant = deck.cards.map((entry) => ({ ...entry }))
    // A's place gets a B and the old B's place gets C: one card in (C), one out (A), two places changed.
    expect(replaceSlot(variant, slotOf(a.cardId), b.cardId)).toBe(true)
    expect(replaceSlot(variant, slotOf(b.cardId), c.cardId)).toBe(true)
    const accepted = swapOf(deck.cards, variant, index, 6)
    expect(accepted.add.map(group)).toEqual([c.groupId])
    expect(accepted.slots).toHaveLength(2)
    const editionOf = (groupId: string) =>
      deck.cards.find((entry) => group(entry.cardId) === groupId)?.cardId ?? groupId
    const back = revertVariant(variant, [accepted], 0, index, editionOf, { pool: [], valid: () => true })
    if (!back) throw new Error('no revert')
    expect(slotGroups(back.cards, index)).toEqual(slotGroups(deck.cards, index))
    // When those places hold something else now, it is no longer an undo: none (not a reshuffled list).
    const moved = variant.map((entry) => ({ ...entry }))
    expect(replaceSlot(moved, slotOf(a.cardId), a.cardId)).toBe(true)
    expect(revertVariant(moved, [accepted], 0, index, editionOf, { pool: [], valid: () => true })).toBeNull()
  })

  it('review of #35 (Codex): a combo keeps the collection cap of a card the Energy Zone no longer draws', () => {
    // Bulbasaur, owned once, in the pool frozen for every zone; the Fire zone leaves it out of the draws.
    const bulbasaur = group('A1-1')
    const full = mutationPool({
      index,
      energies: ['grass', 'fire'],
      edition: (groupId) => index.cardById(index.groupById(groupId)?.displayCardId ?? groupId) ?? null,
      maxCopies: (groupId) => (groupId === bulbasaur ? 1 : 2),
    })
    expect(full.some((card) => card.groupId === bulbasaur)).toBe(true)
    expect(poolForZone(full, ['fire'], index).some((card) => card.groupId === bulbasaur)).toBe(false)
    const [x, y] = deck.cards.filter((entry) => index.cardById(entry.cardId)?.cardType === 'trainer')
    if (!x || !y) throw new Error('deck shape')
    const swaps: MeasuredSwap[] = [
      { add: ['A1-1'], remove: [group(x.cardId)], difference: 5 },
      { add: ['A1-1'], remove: [group(y.cardId)], difference: 4 },
    ]
    const anyDeck = { pool: [], valid: () => true }
    // Caps from the zone's pool would let two in (Bulbasaur is not there: no cap); the frozen pool's keep one.
    const zoneCaps = new Map(poolForZone(full, ['fire'], index).map((card) => [card.groupId, card.maxCopies]))
    expect(
      comboVariant(deck.cards, swaps, index, { ...anyDeck, maxCopies: (g) => zoneCaps.get(g) ?? 2 }),
    ).not.toBeNull()
    expect(comboVariant(deck.cards, swaps, index, { ...anyDeck, maxCopies: poolCaps(full, 'collection') })).toBeNull()
    expect(poolCaps(full, 'collection')('nothing')).toBe(0)
    expect(poolCaps(full, 'all')('nothing')).toBe(2)
  })

  it('review of #15: what was learned changes the draws the same way every time for the same seed', () => {
    const learned: Learned = { [changeKey('+', group(pool[0]?.cardId ?? ''))]: { sum: 40, n: 2 } }
    const boostIn = (groupId: string) => learnedFactor(learned, changeKey('+', groupId))
    const run = () =>
      Array.from({ length: 6 }, (_, i) =>
        variantOf(deck.cards, energies, pool, index, seededRandom(70 + i), { swaps: 1, boostIn }),
      ).map((variant) => variant?.key)
    expect(run()).toEqual(run())
  })

  it('T-017 C5: a swap accepted earlier can be undone, putting the cards back where they were', () => {
    const variant = variantOf(deck.cards, energies, pool, index, seededRandom(31), { swaps: 1 })
    if (!variant) throw new Error('no variant')
    const accepted = swapOf(deck.cards, variant.cards, index, 8)
    const editionOf = (groupId: string) =>
      deck.cards.find((entry) => group(entry.cardId) === groupId)?.cardId ?? groupId
    const back = revertVariant(variant.cards, [accepted], 0, index, editionOf, { pool: [], valid })
    if (!back) throw new Error('no revert')
    // Bots' review, item 7: it says which accepted swap it undid, so that one leaves the history if it wins.
    expect(back.undoes).toBe(0)
    // Undoing it gives the starting list again, card by card and place by place.
    const slots = (cards: readonly { cardId: string; count: number }[]) =>
      cards.flatMap((entry) => Array.from({ length: entry.count }, () => group(entry.cardId)))
    expect(slots(back.cards)).toEqual(slots(deck.cards))
    // Already seen, or nothing accepted: no revert.
    expect(
      revertVariant(variant.cards, [accepted], 0, index, editionOf, { pool: [], valid, seen: new Set([back.key]) }),
    ).toBeNull()
    expect(revertVariant(variant.cards, [], 0, index, editionOf, { pool: [], valid })).toBeNull()
  })
})

describe('the «carta más floja» round (T-017 C3)', () => {
  it('one variant per card: its first copy out, the filler in its place; the weakest third by difference', () => {
    const variants = probeVariants(deck.cards, 'P-A-3', index, { valid })
    const groups = groupsOfCards(deck.cards, index)
    expect(variants.length).toBeGreaterThan(0)
    expect(variants.length).toBeLessThanOrEqual(groups.size)
    for (const variant of variants) {
      // Every copy where it was but one: the probed card's first copy is now the filler.
      const before = slotGroups(deck.cards, index)
      const after = slotGroups(variant.cards, index)
      const at = before.indexOf(variant.probed)
      expect(after[at]).toBe(group('P-A-3'))
      expect(after.filter((g, i) => g !== before[i])).toHaveLength(1)
      expect(variant.remove.map((change) => group(change.cardId))).toEqual([variant.probed])
    }
    // A locked card is not probed.
    const [first] = variants
    if (!first) throw new Error('no probe')
    const locked = probeVariants(deck.cards, 'P-A-3', index, { valid, locked: new Set([first.probed]) })
    expect(locked.map((variant) => variant.probed)).not.toContain(first.probed)
    const d = (value: number, se: number) => ({
      value,
      se,
      ci95: [value - 1.96 * se, value + 1.96 * se] as [number, number],
    })
    expect(
      weakestThird([
        { groupId: 'a', difference: d(-6, 1) },
        { groupId: 'b', difference: d(2, 1) },
        { groupId: 'c', difference: d(0.5, 1) },
        { groupId: 'd', difference: null },
        { groupId: 'e', difference: d(-1, 1) },
        { groupId: 'f', difference: d(3, 1) },
      ]),
    ).toEqual(['f', 'b'])
    // Review of #78: by the low end of the interval — a lucky +8 on a wide interval is not the weakest.
    expect(
      weakestThird([
        { groupId: 'lucky', difference: d(8, 6) },
        { groupId: 'sure', difference: d(2, 0.5) },
        { groupId: 'x', difference: d(0, 1) },
      ]),
    ).toEqual(['sure'])
    expect(weakestThird([])).toEqual([])
  })

  it('second review of #78: the weakest third is a floor of ×3 only while the probe is all that measured it', () => {
    const weakest = new Set(['w'])
    // Only the probe: a little harmful (−2 points) and still in the weakest third: ×3.
    const learned: Learned = { '-w': { sum: -2, n: 1 }, '-x': { sum: -2, n: 1 } }
    expect(outBoost(learned, weakest, 'w')).toBe(3)
    expect(outBoost(learned, weakest, 'x')).toBeCloseTo(learnedFactor(learned, '-x'), 9)
    // The probe said a lot (+40): what was learned (×4) is above the floor, not multiplied by it.
    expect(outBoost({ '-w': { sum: 40, n: 1 } }, weakest, 'w')).toBe(4)
    // Four variants of the next round took it out and lost (n 5, −13 points on average): what they learned decides.
    const after: Learned = { '-w': { sum: -13.3 * 5, n: 5 } }
    expect(outBoost(after, weakest, 'w')).toBe(0.25)
    expect(outBoost(after, weakest, 'w')).toBe(learnedFactor(after, '-w'))
    // Nothing learned yet: ×3 for the weakest, ×1 for the rest.
    expect(outBoost(undefined, weakest, 'w')).toBe(3)
    expect(outBoost(undefined, weakest, 'y')).toBe(1)
    expect(outBoost(undefined, undefined, 'w')).toBe(1)
  })
})
