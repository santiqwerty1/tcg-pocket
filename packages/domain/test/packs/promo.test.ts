import { describe, expect, it } from 'vitest'
import type { CollectionAdjustment } from '../../src/collection/adjustments.js'
import type { StockQuantities } from '../../src/collection/stock.js'
import type { TradeDeck } from '../../src/collection/trades.js'
import {
  activePromoEvent,
  couponSavesNow,
  PROMO_EVENTS,
  PROMO_GOAL,
  PROMO_VOLUMES,
  type PromoEvent,
  type PromoVolume,
  type PromoVolumeStatus,
  promoPlan,
  winsToComplete,
} from '../../src/packs/promo.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const stock = () => realCsvNormalized().units
/** During the «botín bis PROMO 2026» event. */
const DURING = new Date('2026-10-31T12:00:00Z')
const AFTER = new Date('2026-11-20T12:00:00Z')

const byId = (id: string) => PROMO_VOLUMES.find((promo) => promo.id === id) as PromoVolume
const EVENT: PromoEvent = {
  id: 'test',
  nameEs: 'Prueba',
  from: '2026-01-01T00:00:00Z',
  until: '2026-12-31T23:59:59Z',
  volumes: [],
}

describe('promo volumes', () => {
  it('are the 13 volumes of each series, 5 cards each (7 in A vol. 9), each promo in one volume only', () => {
    expect(PROMO_VOLUMES.map((promo) => promo.id)).toEqual([
      ...Array.from({ length: 13 }, (_, i) => `A${i + 1}`),
      ...Array.from({ length: 13 }, (_, i) => `B${i + 1}`),
    ])
    for (const promo of PROMO_VOLUMES) expect(promo.cardIds).toHaveLength(promo.id === 'A9' ? 7 : 5)
    const all = PROMO_VOLUMES.flatMap((promo) => promo.cardIds)
    expect(new Set(all).size).toBe(all.length)
  })

  it('name promo prints of their own series that the catalog has', () => {
    for (const promo of PROMO_VOLUMES) {
      for (const cardId of promo.cardIds) {
        const card = index.cardById(cardId)
        expect(card, cardId).toBeDefined()
        expect(card?.rarity).toBe('P')
        expect(card?.expansionId).toBe(`P-${promo.series}`)
      }
    }
  })

  it('match the game: A vol. 7 is Exeggcute … Rayquaza ex, B vol. 7 the Zygarde event, B vol. 13 Mega-Garchomp ex', () => {
    const names = (id: string) => byId(id).cardIds.map((cardId) => index.cardById(cardId)?.nameEn)
    expect(names('A7')).toEqual(['Exeggcute', 'Froakie', "Farfetch'd", 'Rayquaza', 'Rayquaza ex'])
    expect(names('A9')).toEqual([
      'Kartana',
      'Blacephalon',
      'Xurkitree',
      'Dawn Wings Necrozma',
      'Dusk Mane Necrozma',
      'Stakataka',
      'Ultra Necrozma ex',
    ])
    expect(names('B1')).toEqual(['Petilil', 'Froakie', 'Luxray', 'Pidgey', 'Mega Pidgeot ex'])
    expect(names('B7')).toEqual(['Meloetta', 'Zygarde', 'Zygarde', 'Zygarde ex', 'Eevee'])
    expect(names('B13')).toEqual(['Falinks', 'Gible', 'Gabite', 'Mega Garchomp ex', 'Delcatty'])
  })

  it('the event lists volumes that exist', () => {
    const ids = new Set(PROMO_VOLUMES.map((promo) => promo.id))
    for (const event of PROMO_EVENTS) for (const id of event.volumes) expect(ids.has(id), id).toBe(true)
  })
})

describe('activePromoEvent', () => {
  it('is on from 30/10 03:00 to 13/11 02:59 in Buenos Aires', () => {
    expect(activePromoEvent(new Date('2026-10-30T05:59:59Z'))).toBeNull()
    expect(activePromoEvent(new Date('2026-10-30T06:00:00Z'))?.id).toBe('botin-bis-promo-2026')
    expect(activePromoEvent(new Date('2026-11-13T05:59:59Z'))?.id).toBe('botin-bis-promo-2026')
    // The last second counts entirely: the battles close at 03:00.
    expect(activePromoEvent(new Date('2026-11-13T05:59:59.500Z'))?.id).toBe('botin-bis-promo-2026')
    expect(activePromoEvent(new Date('2026-11-13T06:00:00Z'))).toBeNull()
  })
})

/**
 * The same expectation by another road: Poissonized, size · ∫₀^∞ (1 − Π_i P(Poisson(x) ≥ needs_i)) dx, integrated
 * with Simpson's rule.
 */
function poissonWins(size: number, needs: readonly number[]): number {
  const unfinished = (x: number) => {
    let done = 1
    for (const need of needs) {
      let below = 0
      let term = Math.exp(-x)
      for (let k = 0; k < need; k++) {
        below += term
        term *= x / (k + 1)
      }
      done *= 1 - below
    }
    return 1 - done
  }
  const step = 1e-3
  let sum = 0
  for (let x = 0; x < 80; x += step) {
    sum += ((unfinished(x) + 4 * unfinished(x + step / 2) + unfinished(x + step)) * step) / 6
  }
  return size * sum
}

describe('winsToComplete', () => {
  it('with one copy to go per print is the coupon collector: n · H(m)', () => {
    expect(winsToComplete(5, [])).toBe(0)
    expect(winsToComplete(5, [0, 0, 0, 0, 0])).toBe(0)
    expect(winsToComplete(5, [1, 0, 0, 0, 0])).toBe(5)
    expect(winsToComplete(5, [1, 1, 0, 0, 0])).toBeCloseTo(7.5, 10)
    expect(winsToComplete(5, [1, 1, 1, 1, 1])).toBeCloseTo(5 * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5), 10)
    expect(winsToComplete(7, [1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(18.15, 2)
  })

  it('with two copies to go is exact (worked by hand for small volumes, and the Poisson integral)', () => {
    expect(winsToComplete(1, [2])).toBe(2)
    // 2 prints, 2 copies each: 1 + (2 + 4 + 3) / 2.
    expect(winsToComplete(2, [2, 2])).toBeCloseTo(5.5, 10)
    // A second Exeggcute and two Rayquaza ex: (5 + 10 + 7.5) / 2.
    expect(winsToComplete(5, [1, 0, 0, 0, 2])).toBeCloseTo(11.25, 10)
    expect(winsToComplete(5, [2, 0, 0, 0, 1])).toBeCloseTo(11.25, 10)
    expect(winsToComplete(5, [2, 2, 2, 2, 2])).toBeCloseTo(19.04, 2)
    for (const [size, needs] of [
      [5, [2, 2, 2, 2, 2]],
      [7, [2, 2, 2, 2, 2, 2, 2]],
      [5, [2, 1, 1, 0, 0]],
      [5, [3, 2, 1, 0, 0]],
    ] as const) {
      expect(winsToComplete(size, needs)).toBeCloseTo(poissonWins(size, needs), 6)
    }
  })
})

describe('couponSavesNow', () => {
  it('is what the best print to take now saves; null when nothing is missing', () => {
    expect(couponSavesNow(5, [0, 0, 0, 0, 0])).toBeNull()
    // The volume's last copy: all n.
    expect(couponSavesNow(5, [1, 0, 0, 0, 0])).toBe(5)
    // One of two Rayquaza ex (11.25 → 7.5) saves more than the second Exeggcute (11.25 → 10).
    expect(couponSavesNow(5, [1, 0, 0, 0, 2])).toBeCloseTo(3.75, 10)
    expect(couponSavesNow(5, [2, 0, 0, 0, 1])).toBeCloseTo(3.75, 10)
    // Everything to go: the first win always brings a missing copy, so taking one now saves just that win.
    expect(couponSavesNow(5, [2, 2, 2, 2, 2])).toBeCloseTo(1, 10)
    expect(couponSavesNow(7, [1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(1, 10)
    // Never more than keeping it for the last copy.
    for (const needs of [
      [2, 1, 1, 0, 0],
      [2, 0, 0, 0, 0],
      [1, 1, 0, 0, 0],
    ]) {
      expect(couponSavesNow(5, needs)).toBeLessThanOrEqual(5)
    }
  })
})

describe('promoPlan on the export of 2026-10-06', () => {
  it('the goal is two copies of each print (Santi, 2/11)', () => {
    expect(PROMO_GOAL).toBe(2)
    expect(promoPlan({ index, stock: stock(), now: DURING }).goal).toBe(2)
  })

  it('A vol. 7 lacks a second Exeggcute and both Rayquaza ex: 2 in 5 per win, ~11 wins', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    const a7 = plan.volumes.find((status) => status.id === 'A7')
    expect(a7).toMatchObject({
      missing: 2,
      copiesMissing: 3,
      chanceMissing: 0.4,
      chanceUseful: 0.4,
      winsToComplete: 11.25,
      couponSavesNow: 3.75,
    })
    expect(a7?.cards.filter((card) => card.missing).map((card) => [card.cardId, card.needed])).toEqual([
      ['P-A-60', 1],
      ['P-A-64', 2],
    ])
    // Rayquaza ex: no print owned (P-A-64 nor P-A-65); Exeggcute has A1a-1, and one copy of its promo.
    expect(a7?.cards.find((card) => card.cardId === 'P-A-64')).toMatchObject({
      nameEs: 'Rayquaza ex',
      owned: 0,
      needed: 2,
      newCard: true,
    })
    expect(a7?.cards.find((card) => card.cardId === 'P-A-60')).toMatchObject({
      owned: 1,
      needed: 1,
      missing: true,
      newCard: false,
    })
    // Exactly the goal, and more than it: nothing missing.
    expect(a7?.cards.find((card) => card.cardId === 'P-A-63')).toMatchObject({ owned: 2, needed: 0, missing: false })
    expect(a7?.cards.find((card) => card.cardId === 'P-A-61')).toMatchObject({ owned: 4, needed: 0, missing: false })
  })

  it('B vol. 1 lacks two copies of all 5, 4 of them in every print; B vol. 12 has two or more of each', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    const b1 = plan.volumes.find((status) => status.id === 'B1')
    expect(b1).toMatchObject({
      missing: 5,
      copiesMissing: 10,
      chanceMissing: 1,
      chanceUseful: 1,
      newCards: 4,
      deckCards: 0,
    })
    // Pidgey: B1-180 is owned.
    expect(b1?.cards.find((card) => card.cardId === 'P-B-5')).toMatchObject({ missing: true, newCard: false })
    expect(b1?.winsToComplete).toBeCloseTo(19.04, 2)
    // A coupon spent now saves one win (19.04 → 18.04); kept for the last copy it saves 5.
    expect(b1?.couponSavesNow).toBeCloseTo(1, 10)
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12?.cards.map((card) => card.owned)).toEqual([2, 2, 5, 4, 2])
    expect(b12).toMatchObject({
      missing: 0,
      copiesMissing: 0,
      chanceMissing: 0,
      chanceUseful: 0,
      winsToComplete: 0,
      couponSavesNow: null,
    })
  })

  it('during the event the most cards not owned in any print win (B vol. 1, 3, 4, 9 and 11), one at random', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING, random: () => 0 })
    expect(plan.best).toEqual(['B1', 'B3', 'B4', 'B9', 'B11'])
    for (const id of plan.best) {
      expect(plan.volumes.find((status) => status.id === id)).toMatchObject({
        chanceDecks: 0,
        chanceNew: 0.8,
        chanceMissing: 1,
        reason: 'new',
      })
    }
    // B vol. 2 also gives a missing print every time, but fewer cards not owned in any print.
    const b2 = plan.volumes.find((status) => status.id === 'B2')
    expect(b2?.chanceMissing).toBe(1)
    expect(b2?.chanceNew).toBeLessThan(0.8)
    expect(plan.best).not.toContain('B2')
    expect(plan.pick).toBe('B1')
    expect(promoPlan({ index, stock: stock(), now: DURING, random: () => 0.999 }).pick).toBe('B11')
    expect(promoPlan({ index, stock: stock(), now: DURING, random: () => 0.5 }).pick).toBe('B4')
    // By default Math.random: always one of them, not always the same.
    const picks = new Set(Array.from({ length: 40 }, () => promoPlan({ index, stock: stock(), now: DURING }).pick))
    for (const pick of picks) expect(plan.best).toContain(pick)
    expect(picks.size).toBeGreaterThan(1)
  })

  it('during the event its volumes come first and the best are the top ones among them', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    expect(plan.event?.id).toBe('botin-bis-promo-2026')
    const event = new Set(plan.event?.volumes)
    const firstOutside = plan.volumes.findIndex((status) => !status.inEvent)
    expect(firstOutside).toBe(event.size)
    expect(plan.volumes.slice(0, firstOutside).every((status) => event.has(status.id))).toBe(true)
    // The best are the first ones of the list.
    expect(plan.volumes.slice(0, plan.best.length).map((status) => status.id)).toEqual(plan.best)
    // A vol. 9 has no battle now, even if a win there would surely bring a missing print.
    expect(plan.volumes.find((status) => status.id === 'A9')).toMatchObject({ inEvent: false, chanceMissing: 1 })
    expect(plan.best).not.toContain('A9')
    expect(plan.totals.volumes).toBe(event.size)
    expect(plan.totals.cards).toBe(70)
  })

  it('without an event there is no battle: no best and no pick, only the ranking of the 26 volumes', () => {
    const plan = promoPlan({ index, stock: stock(), now: AFTER, random: () => 0 })
    expect(plan.event).toBeNull()
    expect(plan.best).toEqual([])
    expect(plan.pick).toBeNull()
    expect(plan.volumes.some((status) => status.inEvent)).toBe(false)
    expect(plan.totals.volumes).toBe(26)
    // Still ranked tier by tier.
    const key = (status: PromoVolumeStatus) => [status.chanceDecks, status.chanceNew, status.chanceMissing]
    for (let i = 1; i < plan.volumes.length; i++) {
      const [a, b] = [key(plan.volumes[i - 1] as PromoVolumeStatus), key(plan.volumes[i] as PromoVolumeStatus)]
      const first = a.findIndex((value, tier) => value !== b[tier])
      if (first >= 0) expect(a[first]).toBeGreaterThan(b[first] as number)
    }
  })
})

describe('promoPlan, ranking (Santi, 30/10: decks, then new cards, then prints, then at random)', () => {
  const volumes = [byId('A7'), byId('B12')]
  const events = [{ ...EVENT, volumes: ['A7', 'B12'] }]
  const custom = (id: string, cardIds: string[]): PromoVolume => ({
    id,
    series: 'B',
    volume: Number(id.slice(1)),
    cardIds,
  })
  const all = (ids: string[]) => [{ ...EVENT, volumes: ids }]
  /** One Scyther del Team Rocket (P-B-88, a promo-only card) instead of two, and a deck that plays two. */
  function scytherShort(): { units: StockQuantities; decks: TradeDeck[] } {
    const units: StockQuantities = { ...stock() }
    const unit = index.cardById('P-B-88')?.stockCardId as string
    units[unit] = { stockCardId: unit, amountOwned: 1, collected: true }
    return { units, decks: [{ name: '12. Team Rocket', groups: new Map([['P-B-88', 2]]) }] }
  }

  it('a card a deck lacks wins first, even over a volume where every win brings a missing print', () => {
    const { units, decks } = scytherShort()
    const plan = promoPlan({
      index,
      stock: units,
      decks,
      now: DURING,
      volumes: [byId('B1'), byId('B12')],
      events: all(['B1', 'B12']),
    })
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12).toMatchObject({
      missing: 1,
      copiesMissing: 1,
      chanceDecks: 0.2,
      chanceUseful: 0.2,
      deckCards: 1,
      reason: 'decks',
    })
    expect(b12?.cards.find((card) => card.cardId === 'P-B-88')?.decks).toEqual(['12. Team Rocket'])
    expect(plan.volumes.find((status) => status.id === 'B1')).toMatchObject({ chanceMissing: 1, reason: 'new' })
    expect(plan.best).toEqual(['B12'])
    expect(plan.pick).toBe('B12')
    expect(plan.volumes.map((status) => status.id)).toEqual(['B12', 'B1'])

    // Without the deck, B vol. 1.
    expect(
      promoPlan({ index, stock: units, now: DURING, volumes: [byId('B1'), byId('B12')], events: all(['B1', 'B12']) })
        .best,
    ).toEqual(['B1'])
  })

  it('with no deck cards, a card not owned in any print wins over more missing prints; then the missing prints', () => {
    // A vol. 7: Rayquaza ex is missing and new, Exeggcute has one copy. Y: Pidgey P-B-5 missing (B1-180 owned).
    // Z: Pidgey, Arcanine P-B-13 (B1-29 owned) and a second Alolan Exeggutor P-A-69.
    const y = custom('B91', ['P-B-5', 'P-A-61', 'P-A-62', 'P-A-63', 'P-B-90'])
    const z = custom('B92', ['P-B-5', 'P-A-69', 'P-B-89', 'P-B-90', 'P-B-13'])
    const plan = promoPlan({
      index,
      stock: stock(),
      now: DURING,
      volumes: [y, z, byId('A7')],
      events: all(['A7', 'B91', 'B92']),
    })
    const at = (id: string) => plan.volumes.find((status) => status.id === id)
    // Preconditions from the export: Pidgey and Arcanine are owned in another print.
    expect(at('B91')).toMatchObject({ newCards: 0, missing: 1, reason: 'missing' })
    // A print with one copy is still below the goal.
    expect(at('B92')).toMatchObject({ newCards: 0, missing: 3, copiesMissing: 5, reason: 'missing' })
    expect(at('B92')?.cards.find((card) => card.cardId === 'P-A-69')).toMatchObject({ owned: 1, needed: 1 })
    expect(at('A7')).toMatchObject({ newCards: 1, missing: 2, reason: 'new' })
    expect(plan.volumes.map((status) => status.id)).toEqual(['A7', 'B92', 'B91'])
    expect(plan.best).toEqual(['A7'])
  })

  it('a tie in new cards is broken by the missing prints: only the one with more is best', () => {
    // Both have one card not owned in any print (Rayquaza ex) and one Exeggcute; W also lacks Pidgey's promo.
    const w = custom('B93', ['P-A-64', 'P-B-5', 'P-A-60', 'P-A-61', 'P-A-62'])
    const plan = promoPlan({ index, stock: stock(), now: DURING, volumes: [byId('A7'), w], events: all(['A7', 'B93']) })
    expect(plan.volumes.map((status) => [status.id, status.newCards, status.missing])).toEqual([
      ['B93', 1, 3],
      ['A7', 1, 2],
    ])
    expect(plan.best).toEqual(['B93'])
  })

  it('the reason is the first tier: a deck card that is also new says «decks»', () => {
    const decks = [{ name: '7. Pidgeot', groups: new Map([['P-B-6', 1]]) }]
    const plan = promoPlan({ index, stock: stock(), decks, now: DURING, volumes: [byId('B1')], events: all(['B1']) })
    expect(plan.volumes[0]).toMatchObject({ deckCards: 1, newCards: 4, reason: 'decks' })
    expect(plan.volumes[0]?.cards.find((card) => card.cardId === 'P-B-6')).toMatchObject({
      newCard: true,
      decks: ['7. Pidgeot'],
    })
  })

  it('compares the chances as fractions: 1 of 5 ties 2 of 10 and beats 1 of 7', () => {
    // Two or more copies of each.
    const owned = ['P-A-61', 'P-A-62', 'P-A-63', 'P-B-88', 'P-B-89', 'P-B-90', 'P-B-91', 'P-B-92']
    const five = custom('B95', ['P-A-64', ...owned.slice(0, 4)])
    const ten = custom('B96', ['P-A-64', 'P-B-6', ...owned])
    const seven = custom('B97', ['P-A-64', ...owned.slice(0, 6)])
    const plan = promoPlan({
      index,
      stock: stock(),
      now: DURING,
      volumes: [seven, ten, five],
      events: all(['B95', 'B96', 'B97']),
    })
    expect(plan.volumes.find((status) => status.id === 'B96')).toMatchObject({ newCards: 2, missing: 2 })
    expect([...plan.best].sort()).toEqual(['B95', 'B96'])
    expect(plan.volumes.at(-1)?.id).toBe('B97')
  })

  it('a deck with exactly the copies it plays lacks nothing; one more and it does', () => {
    // Exeggcute: A1a-1 ×3 and P-A-60 ×1 in the export.
    const deck = (count: number) => [{ name: 'Mazo', groups: new Map([['A1a-1', count]]) }]
    const exeggcute = (count: number) =>
      promoPlan({ index, stock: stock(), decks: deck(count), now: DURING, volumes, events })
        .volumes.find((status) => status.id === 'A7')
        ?.cards.find((card) => card.cardId === 'P-A-60')
    expect(exeggcute(4)?.decks).toEqual([])
    expect(exeggcute(5)?.decks).toEqual(['Mazo'])
  })

  it('a volume outside the event never ties with the event ones, even with the same chances', () => {
    const plan = promoPlan({
      index,
      stock: stock(),
      now: DURING,
      volumes: [byId('A2'), byId('A5')],
      events: all(['A2']),
      random: () => 0.99,
    })
    const at = (id: string) => plan.volumes.find((status) => status.id === id)
    expect([at('A5')?.chanceDecks, at('A5')?.chanceNew, at('A5')?.chanceMissing]).toEqual([
      at('A2')?.chanceDecks,
      at('A2')?.chanceNew,
      at('A2')?.chanceMissing,
    ])
    expect(plan.best).toEqual(['A2'])
    expect(plan.pick).toBe('A2')
  })

  it('an adjustment counts for decks and for «new card», not for the print', () => {
    const adjustment: CollectionAdjustment = {
      id: '1',
      functionalGroupId: 'P-A-64',
      playableCopies: 2,
      reason: 'test',
      active: true,
      createdAt: '2026-10-30T00:00:00Z',
      resolvedAt: null,
      resolution: null,
    }
    const plan = promoPlan({ index, stock: stock(), adjustments: [adjustment], now: DURING, volumes, events })
    const rayquaza = plan.volumes.find((status) => status.id === 'A7')?.cards.find((card) => card.cardId === 'P-A-64')
    expect(rayquaza).toMatchObject({ owned: 0, missing: true, newCard: false })
  })

  it('nothing to win when the event volumes are complete', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING, volumes, events: all(['B12']) })
    expect(plan.best).toEqual([])
    expect(plan.pick).toBeNull()
    expect(plan.volumes.find((status) => status.id === 'B12')?.reason).toBeNull()
    expect(plan.totals).toEqual({ volumes: 1, cards: 5, missing: 0, copiesMissing: 0, winsToComplete: 0 })
    // A vol. 7 still ranks, after the event's volume.
    expect(plan.volumes.map((status) => status.id)).toEqual(['B12', 'A7'])
  })

  it('a promo the catalog does not have yet counts as missing', () => {
    const future: PromoVolume = { id: 'B99', series: 'B', volume: 99, cardIds: ['P-B-88', 'P-B-999'] }
    const plan = promoPlan({ index, stock: stock(), now: AFTER, volumes: [future] })
    // Two copies of 1 in 2: 2 wins for the first, 2 more for the second.
    expect(plan.volumes[0]).toMatchObject({ missing: 1, copiesMissing: 2, chanceMissing: 0.5, winsToComplete: 4 })
    expect(plan.volumes[0]?.cards[1]).toEqual({
      cardId: 'P-B-999',
      groupId: 'P-B-999',
      nameEs: 'P-B-999',
      inCatalog: false,
      owned: 0,
      needed: 2,
      missing: true,
      newCard: true,
      decks: [],
    })
    expect(plan.volumes[0]?.cards[0]?.inCatalog).toBe(true)
  })
})
