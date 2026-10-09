import { describe, expect, it } from 'vitest'
import { validateDeck } from '../../src/decks/index.js'
import type { SelectableEnergy } from '../../src/index.js'
import {
  changeKey,
  comboVariant,
  type Learned,
  learnedChanges,
  learnedFactor,
  learnedMean,
  learnSwap,
  type MeasuredSwap,
  mutationPool,
  seededRandom,
  swapOf,
  variantOf,
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
    const combo = comboVariant(deck.cards, swaps, index, { valid })
    if (!combo) throw new Error('no combo')
    expect(valid(combo.cards)).toBe(true)
    const added = combo.add.map((change) => group(change.cardId))
    // The two best (10 and 7 points) are in, unless they clash and the next pair is used.
    expect(added.length).toBeGreaterThanOrEqual(1)
    // Nothing worse than its parent is ever joined.
    const [first] = swaps
    if (!first) throw new Error('no swap')
    expect(comboVariant(deck.cards, [{ ...first, difference: -1 }], index, { valid })).toBeNull()
    // Review of #15: with the collection's copies as the cap, a combo never asks for more than it has.
    const owned = (groupId: string) => (combo.add.some((change) => group(change.cardId) === groupId) ? 0 : 2)
    expect(comboVariant(deck.cards, swaps, index, { valid, maxCopies: owned })?.key).not.toBe(combo.key)
    // And the order is the score's: the worst two by difference first when the score says so.
    const reversed = comboVariant(deck.cards, swaps, index, { valid, score: (swap) => 20 - swap.difference })
    expect(reversed?.key).not.toBe(combo.key)
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
})
