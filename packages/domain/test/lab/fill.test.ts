import { describe, expect, it } from 'vitest'
import { validateDeck } from '../../src/decks/index.js'
import type { SelectableEnergy } from '../../src/index.js'
import {
  bonferroniZ,
  FILL_CANDIDATES,
  fillMaxVariants,
  fillRound,
  groupsOfCards,
  mutationPool,
  type PoolCard,
  pairedTop,
  roundTop,
  slotGroups,
  verifyPick,
} from '../../src/lab/index.js'
import { normalCdf } from '../../src/stats/tests.js'
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
  usage: (groupId) => (groupId.length % 7) * 10,
})
const group = (cardId: string) => index.cardById(cardId)?.functionalGroupId ?? cardId
const valid = (cards: readonly { cardId: string; count: number }[]) =>
  validateDeck({ cards: [...cards], energies }, index).errors.length === 0
const difference = (value: number, se: number) => ({
  value,
  se,
  ci95: [value - 1.96 * se, value + 1.96 * se] as [number, number],
})

describe('filling the weakest places (T-017 C8)', () => {
  const slots = slotGroups(deck.cards, index)
  // Two cards of the deck, as the probe round would rank them: Heatmor and Casco Dentado (one copy each).
  const counts = groupsOfCards(deck.cards, index)
  const singles = [...counts.entries()].filter(([, count]) => count === 1).map(([groupId]) => groupId)
  const weakest = singles.slice(0, 3)

  it('every way to fill the two weakest places with the five favourites or what was there, on their places', () => {
    const round = fillRound(deck.cards, weakest, pool, index, { maxCopies: () => 2, valid })
    if (!round) throw new Error('no fill round')
    expect(round.out).toEqual(weakest.slice(0, 2))
    expect(round.candidates).toHaveLength(FILL_CANDIDATES)
    // The candidates: the pool's heaviest that the deck can take one more copy of, never the cards going out.
    const byWeight = [...pool].sort((a, b) => b.weight - a.weight || a.groupId.localeCompare(b.groupId))
    const top = byWeight.find((card) => (counts.get(card.groupId) ?? 0) < 2 && !round.out.includes(card.groupId))
    expect(round.candidates[0]).toBe(top?.cardId)
    for (const cardId of round.candidates) expect(round.out).not.toContain(group(cardId))
    // At most C(7 + 1, 2) − 1 = 27 lists, all different, none the deck itself.
    expect(fillMaxVariants()).toBe(27)
    expect(round.variants.length).toBeGreaterThan(10)
    expect(round.variants.length).toBeLessThanOrEqual(27)
    expect(new Set(round.variants.map((variant) => variant.key)).size).toBe(round.variants.length)
    const places = round.out.map((groupId) => slots.indexOf(groupId))
    for (const variant of round.variants) {
      expect(valid(variant.cards)).toBe(true)
      // Only the two places change (H-020): every other copy where it was.
      const after = slotGroups(variant.cards, index)
      const changed = after.flatMap((groupId, at) => (groupId === slots[at] ? [] : [at]))
      expect(changed.length).toBeGreaterThan(0)
      for (const at of changed) expect(places).toContain(at)
      // What comes in is one of the candidates or a card that was in the other place.
      for (const change of variant.add) {
        expect([...round.candidates.map(group), ...round.out]).toContain(group(change.cardId))
      }
    }
    // A list that changes only one place (the other keeps its card) is among them.
    expect(round.variants.some((variant) => variant.add.length === 1 && variant.add[0]?.count === 1)).toBe(true)
  })

  it('keeps the locked cards, skips the lists already played and the copies the pool does not allow', () => {
    const [first, second, third] = weakest as [string, string, string]
    const locked = fillRound(deck.cards, weakest, pool, index, {
      maxCopies: () => 2,
      valid,
      locked: new Set([first]),
    })
    expect(locked?.out).toEqual([second, third])
    const all = fillRound(deck.cards, weakest, pool, index, { maxCopies: () => 2, valid })
    const [seenOne] = all?.variants ?? []
    if (!seenOne) throw new Error('no variant')
    const again = fillRound(deck.cards, weakest, pool, index, {
      maxCopies: () => 2,
      valid,
      seen: new Set([seenOne.key]),
    })
    expect(again?.variants.map((variant) => variant.key)).not.toContain(seenOne.key)
    expect(again?.variants.length).toBe((all?.variants.length ?? 0) - 1)
    // One copy owned of each candidate: none comes in twice.
    const one = fillRound(deck.cards, weakest, pool, index, { maxCopies: () => 1, valid })
    for (const variant of one?.variants ?? []) {
      for (const change of variant.add) expect(change.count).toBe(1)
    }
    // One place only, by option.
    const single = fillRound(deck.cards, weakest, pool, index, { maxCopies: () => 2, valid, slots: 1 })
    expect(single?.out).toEqual([first])
    expect(single?.variants.length).toBeLessThanOrEqual(FILL_CANDIDATES)
    // Nothing to free: no round.
    expect(fillRound(deck.cards, ['ZZ-1'], pool, index, { maxCopies: () => 2, valid })).toBeNull()
    expect(
      fillRound(deck.cards, [first], pool, index, { maxCopies: () => 2, valid, locked: new Set([first]) }),
    ).toBeNull()
    // A small pool: fewer candidates, fewer lists.
    const small: PoolCard[] = pool.filter((card) => !counts.has(card.groupId)).slice(0, 2)
    const few = fillRound(deck.cards, weakest, small, index, { maxCopies: () => 2, valid })
    expect(few?.candidates).toHaveLength(2)
  })

  it('the three best of the screen go to the verification, which corrects for them (Bonferroni)', () => {
    // One-sided 5 %: 1,645; for three at once, 5 % / 3 → 2,128.
    expect(bonferroniZ(1.645, 1)).toBe(1.645)
    expect(bonferroniZ(1.645, 3)).toBeCloseTo(2.128, 2)
    expect(1 - normalCdf(bonferroniZ(1.645, 3))).toBeCloseTo((1 - normalCdf(1.645)) / 3, 6)
    const screened = [
      { id: 1, difference: difference(6, 2), complete: true },
      { id: 2, difference: difference(1, 2), complete: true },
      { id: 3, difference: difference(9, 2), complete: true },
      { id: 4, difference: difference(12, 2), complete: false },
      { id: 5, difference: difference(4, 2), complete: true },
      { id: 6, difference: difference(3, 2), complete: true },
      { id: 7, difference: null, complete: true },
    ]
    // Past 1 error, complete, best first, three at most.
    expect(pairedTop(screened, 1, 3)).toEqual([3, 1, 5])
    expect(pairedTop(screened, 4, 3)).toEqual([3])
    const score = (value: number, se: number) => ({
      value,
      se,
      ci95: [0, 0] as [number, number],
      games: 100,
      rivals: 3,
      coverage: 1,
    })
    expect(
      roundTop(
        score(50, 2),
        [
          { id: 1, score: score(56, 2), complete: true },
          { id: 2, score: score(51, 2), complete: true },
          { id: 3, score: score(60, 2), complete: true },
        ],
        1,
        3,
      ),
    ).toEqual([3, 1])
    expect(roundTop(null, [{ id: 9, score: score(40, 2), complete: true }], 1, 3)).toEqual([9])
    // The verification: 4 points with an error of 2 is past 1,645 alone, but not past 2,128 among three.
    const alone = [{ id: 1, difference: difference(4, 2), complete: true }]
    expect(verifyPick(alone, 1.645)).toBe(1)
    const three = [
      { id: 1, difference: difference(4, 2), complete: true },
      { id: 2, difference: difference(1, 2), complete: true },
      { id: 3, difference: difference(-2, 2), complete: true },
    ]
    expect(verifyPick(three, 1.645)).toBeNull()
    // The best past the corrected bar stays; an incomplete one never does.
    expect(
      verifyPick(
        [
          { id: 1, difference: difference(5, 2), complete: true },
          { id: 2, difference: difference(7, 2), complete: true },
          { id: 3, difference: difference(9, 2), complete: false },
        ],
        1.645,
      ),
    ).toBe(2)
    expect(verifyPick([], 1.645)).toBeNull()
  })
})
