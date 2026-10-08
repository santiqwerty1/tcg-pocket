import { describe, expect, it } from 'vitest'
import { deckDrawBase, deckDrawGroup, drawOdds } from '../../src/decks/index.js'
import { seededRandom } from '../../src/lab/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

/** Monte Carlo of the same rule: deal 5, redeal until a Basic shows up, then draw one card per own turn. */
function simulate(
  deck: { basics: number; size: number; groups: { basic: number; other: number }[] },
  turn: number,
  trials: number,
  seed: number,
): { each: number[]; all: number } {
  const random = seededRandom(seed)
  const cards: number[] = []
  // Card codes: 0..groups-1 = group, -1 = other Basic, -2 = other card; basics tracked apart.
  const basicFlags: boolean[] = []
  deck.groups.forEach((group, g) => {
    for (let i = 0; i < group.basic; i++) {
      cards.push(g)
      basicFlags.push(true)
    }
    for (let i = 0; i < group.other; i++) {
      cards.push(g)
      basicFlags.push(false)
    }
  })
  const groupBasics = deck.groups.reduce((sum, group) => sum + group.basic, 0)
  for (let i = 0; i < deck.basics - groupBasics; i++) {
    cards.push(-1)
    basicFlags.push(true)
  }
  while (cards.length < deck.size) {
    cards.push(-2)
    basicFlags.push(false)
  }
  const order = cards.map((_, at) => at)
  const hits = new Array<number>(deck.groups.length).fill(0)
  let allHits = 0
  for (let t = 0; t < trials; t++) {
    do {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[order[i], order[j]] = [order[j] as number, order[i] as number]
      }
    } while (!order.slice(0, 5).some((at) => basicFlags[at]))
    const seen = new Set(order.slice(0, 5 + turn).map((at) => cards[at]))
    deck.groups.forEach((_, g) => {
      if (seen.has(g)) hits[g] = (hits[g] ?? 0) + 1
    })
    if (deck.groups.every((_, g) => seen.has(g))) allHits += 1
  }
  return { each: hits.map((h) => h / trials), all: allHits / trials }
}

describe('opening hand and natural draws (Fase 10)', () => {
  it('a 2-copy non-Basic card: the opening hand matches the plain hypergeometric when Basics are plenty', () => {
    // With 19 Basics among the other 18 cards… every hand has a Basic: no conditioning at all.
    const odds = drawOdds({ deckSize: 20, basics: 18, groups: [{ basic: 0, other: 2 }] })
    expect(odds.rows[0]?.each[0]).toBeCloseTo(1 - 8568 / 15504, 12)
    // By own turn 15 (all 20 cards seen) it is certain.
    expect(drawOdds({ deckSize: 20, basics: 18, groups: [{ basic: 0, other: 2 }], turns: 15 }).rows[15]?.each[0]).toBe(
      1,
    )
  })

  it('agrees with a simulation of the redeal rule (one group, two groups, Basic and not)', () => {
    const decks = [
      { size: 20, basics: 5, groups: [{ basic: 2, other: 0 }] },
      { size: 20, basics: 4, groups: [{ basic: 0, other: 2 }] },
      {
        size: 20,
        basics: 6,
        groups: [
          { basic: 2, other: 0 },
          { basic: 0, other: 2 },
        ],
      },
    ]
    decks.forEach((deck, at) => {
      const odds = drawOdds({ deckSize: deck.size, basics: deck.basics, groups: deck.groups })
      for (const turn of [0, 1, 3]) {
        const sim = simulate(deck, turn, 60_000, 100 + at * 10 + turn)
        const row = odds.rows[turn]
        expect(row?.cardsSeen).toBe(5 + turn)
        for (const [g, value] of (row?.each ?? []).entries()) {
          expect(Math.abs(value - (sim.each[g] ?? 0))).toBeLessThan(0.01)
        }
        if (deck.groups.length === 2) expect(Math.abs((row?.all ?? 0) - sim.all)).toBeLessThan(0.01)
        else expect(row?.all).toBeNull()
      }
    })
  })

  it('the Basics in the opening hand add up to 1 and start at one', () => {
    const odds = drawOdds({ deckSize: 20, basics: 4, groups: [{ basic: 2, other: 0 }] })
    expect(odds.basicsInHand.map((row) => row.count)).toEqual([1, 2, 3, 4, 5])
    expect(odds.basicsInHand.reduce((sum, row) => sum + row.probability, 0)).toBeCloseTo(1, 12)
    expect(odds.basicsInHand[4]?.probability).toBe(0)
    // The odds only grow turn by turn.
    for (let turn = 1; turn < odds.rows.length; turn++) {
      expect(odds.rows[turn]?.each[0]).toBeGreaterThanOrEqual(odds.rows[turn - 1]?.each[0] ?? 0)
    }
  })

  it('refuses counts that do not fit', () => {
    expect(() => drawOdds({ deckSize: 20, basics: 0, groups: [{ basic: 0, other: 2 }] })).toThrow(RangeError)
    expect(() => drawOdds({ deckSize: 20, basics: 2, groups: [{ basic: 3, other: 0 }] })).toThrow(RangeError)
    expect(() => drawOdds({ deckSize: 20, basics: 5, groups: [] })).toThrow(RangeError)
  })

  it('from a real deck: Mega-Blaziken ex (deck 2) and its Basic line', () => {
    const draft = deckDraft(2)
    const base = deckDrawBase(draft.cards, index)
    expect(base.deckSize).toBe(20)
    expect(base.basics).toBeGreaterThan(0)
    const mega = draft.cards.find((entry) => index.cardById(entry.cardId)?.nameEn.startsWith('Mega Blaziken'))
    const groupId = index.cardById(mega?.cardId ?? '')?.functionalGroupId ?? ''
    const group = deckDrawGroup(draft.cards, [groupId], index)
    const copies = draft.cards
      .filter((entry) => index.cardById(entry.cardId)?.functionalGroupId === groupId)
      .reduce((sum, entry) => sum + entry.count, 0)
    expect(group.basic + group.other).toBe(copies)
    expect(group.basic).toBe(0)
    const odds = drawOdds({ ...base, groups: [group] })
    expect(odds.rows[0]?.each[0]).toBeGreaterThan(0)
    expect(odds.rows[6]?.each[0]).toBeLessThan(1)
  })
})
