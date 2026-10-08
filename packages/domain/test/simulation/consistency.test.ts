import { describe, expect, it } from 'vitest'
import { defaultKeyCards, mergeHistograms, readinessCurve } from '../../src/simulation/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('consistency (Fase 8)', () => {
  it('the curve is cumulative, with Wilson 95 % over every game (the ones never ready included)', () => {
    // Deck 2 measured with the real engine (seed 7, 1.000 games): going first and going second.
    const first = { games: 478, firstOnTurn: [0, 0, 66, 217, 155, 30, 9, 1], never: 0 }
    const second = { games: 522, firstOnTurn: [0, 79, 176, 178, 65, 20, 4, 0], never: 0 }
    const curve = readinessCurve(first)
    expect(curve.map((point) => point.ready)).toEqual([0, 0, 66, 283, 438, 468, 477, 478])
    expect(curve[2]?.value).toBeCloseTo((66 / 478) * 100, 10)
    expect(curve[2]?.ci95[0]).toBeLessThan(curve[2]?.value ?? 0)
    expect(curve[2]?.ci95[1]).toBeGreaterThan(curve[2]?.value ?? 0)
    expect(curve[7]?.value).toBe(100)

    const all = readinessCurve(mergeHistograms(first, second))
    expect(all[2]).toMatchObject({ turn: 3, ready: 66 + 79 + 176, games: 1000 })
    expect(all[2]?.value).toBeCloseTo(32.1, 10)

    // Games never ready count in n: the curve does not reach 100 %.
    const short = readinessCurve({ games: 10, firstOnTurn: [1, 2, 3], never: 4 })
    expect(short.at(-1)).toMatchObject({ ready: 6, games: 10, value: 60 })
    expect(readinessCurve({ games: 0, firstOnTurn: [0], never: 0 })[0]).toMatchObject({ value: 0, ci95: [0, 0] })
  })

  it('the default key attacker is the Pokémon worth the most points: deck 2 → both Mega-Blaziken ex', () => {
    const keys = defaultKeyCards(deckDraft(2).cards, index)
    expect(keys.sort()).toEqual(['B1-284', 'B1-36'])
    for (const number of [1, 13, 21]) {
      const cards = defaultKeyCards(deckDraft(number).cards, index)
      expect(cards.length).toBeGreaterThan(0)
      const prizes = cards.map((cardId) => index.cardById(cardId)?.prizePoints ?? 0)
      const best = Math.max(
        ...deckDraft(number)
          .cards.map((entry) => index.cardById(entry.cardId))
          .filter((card) => card?.cardType === 'pokemon')
          .map((card) => card?.prizePoints ?? 0),
      )
      expect(Math.min(...prizes)).toBe(best)
    }
    expect(defaultKeyCards([], index)).toEqual([])
  })
})
