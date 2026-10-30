import { describe, expect, it } from 'vitest'
import type { CollectionAdjustment } from '../../src/collection/adjustments.js'
import type { StockQuantities } from '../../src/collection/stock.js'
import {
  activePromoEvent,
  PROMO_EVENTS,
  PROMO_VOLUMES,
  type PromoEvent,
  type PromoVolume,
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

describe('winsToComplete', () => {
  it('is the coupon collector: n · H(m)', () => {
    expect(winsToComplete(5, 0)).toBe(0)
    expect(winsToComplete(5, 1)).toBe(5)
    expect(winsToComplete(5, 2)).toBeCloseTo(7.5, 10)
    expect(winsToComplete(5, 5)).toBeCloseTo(5 * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5), 10)
    expect(winsToComplete(7, 7)).toBeCloseTo(18.15, 2)
  })
})

describe('promoPlan on the export of 2026-10-06', () => {
  it('A vol. 7 lacks only Rayquaza ex: 1 in 5 per win, ~5 wins, and a coupon now saves them all', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    const a7 = plan.volumes.find((status) => status.id === 'A7')
    expect(a7).toMatchObject({
      missing: 1,
      chanceMissing: 0.2,
      chanceUseful: 0.2,
      winsToComplete: 5,
      couponSavesNow: 5,
    })
    expect(a7?.cards.filter((card) => card.missing).map((card) => card.cardId)).toEqual(['P-A-64'])
    // Rayquaza ex: no print owned (P-A-64 nor P-A-65); Exeggcute has A1a-1.
    expect(a7?.cards.find((card) => card.cardId === 'P-A-64')).toMatchObject({ nameEs: 'Rayquaza ex', newCard: true })
    expect(a7?.cards.find((card) => card.cardId === 'P-A-60')).toMatchObject({ owned: 1, newCard: false })
  })

  it('B vol. 1 lacks all 5, 4 of them in every print; B vol. 12 is complete', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    const b1 = plan.volumes.find((status) => status.id === 'B1')
    expect(b1).toMatchObject({ missing: 5, chanceMissing: 1, chanceUseful: 1, newCards: 4, deckCards: 0 })
    // Pidgey: B1-180 is owned.
    expect(b1?.cards.find((card) => card.cardId === 'P-B-5')).toMatchObject({ missing: true, newCard: false })
    expect(b1?.winsToComplete).toBeCloseTo(11.42, 2)
    // A coupon spent now saves one win (11.42 → 10.42); kept for the last card it saves 5.
    expect(b1?.couponSavesNow).toBe(1)
    expect(winsToComplete(5, 5) - winsToComplete(5, 4)).toBeCloseTo(1, 10)
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12).toMatchObject({
      missing: 0,
      chanceMissing: 0,
      chanceUseful: 0,
      winsToComplete: 0,
      couponSavesNow: null,
    })
  })

  it('every event volume where a win is sure to bring something ties, and one is picked at random', () => {
    const tied = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B13']
    const plan = promoPlan({ index, stock: stock(), now: DURING, random: () => 0 })
    expect([...plan.best].sort()).toEqual([...tied].sort())
    // The list still puts first the ones with more cards not owned in any print (4 of 5).
    expect(plan.volumes.slice(0, 5).map((status) => status.id)).toEqual(['B1', 'B3', 'B4', 'B9', 'B11'])
    expect(plan.best[0]).toBe('B1')
    expect(plan.pick).toBe('B1')
    expect(promoPlan({ index, stock: stock(), now: DURING, random: () => 0.999 }).pick).toBe(plan.best.at(-1))
    expect(promoPlan({ index, stock: stock(), now: DURING, random: () => 5 / 12 }).pick).toBe(plan.best[5])
    // By default Math.random: always one of them, not always the same.
    const picks = new Set(Array.from({ length: 60 }, () => promoPlan({ index, stock: stock(), now: DURING }).pick))
    for (const pick of picks) expect(tied).toContain(pick)
    expect(picks.size).toBeGreaterThan(1)
  })

  it('during the event its volumes come first and the best is one of them, with the most useful chance', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    expect(plan.event?.id).toBe('botin-bis-promo-2026')
    const event = new Set(plan.event?.volumes)
    const firstOutside = plan.volumes.findIndex((status) => !status.inEvent)
    expect(firstOutside).toBe(event.size)
    expect(plan.volumes.slice(0, firstOutside).every((status) => event.has(status.id))).toBe(true)
    expect(plan.best.length).toBeGreaterThan(0)
    const top = Math.max(...plan.volumes.filter((status) => status.inEvent).map((status) => status.chanceUseful))
    for (const id of plan.best) {
      const status = plan.volumes.find((item) => item.id === id)
      expect(status?.inEvent).toBe(true)
      expect(status?.chanceUseful).toBe(top)
    }
    // A vol. 9 has no battle now, even if a win there would surely bring something new.
    expect(plan.volumes.find((status) => status.id === 'A9')).toMatchObject({ inEvent: false, chanceMissing: 1 })
    expect(plan.best).not.toContain('A9')
    expect(plan.totals.volumes).toBe(event.size)
    expect(plan.totals.cards).toBe(70)
  })

  it('without an event every volume competes and none is marked as in the event', () => {
    const plan = promoPlan({ index, stock: stock(), now: AFTER })
    expect(plan.event).toBeNull()
    expect(plan.volumes.some((status) => status.inEvent)).toBe(false)
    expect(plan.totals.volumes).toBe(26)
    // A vol. 9 (no battle in the event) now ranks with the volumes where every win brings something new.
    const a9 = plan.volumes.findIndex((status) => status.id === 'A9')
    expect(a9).toBeLessThan(plan.volumes.findIndex((status) => status.chanceUseful < 1))
  })
})

describe('promoPlan, ranking', () => {
  const volumes = [byId('A7'), byId('B12')]
  const events = [{ ...EVENT, volumes: ['A7', 'B12'] }]

  it('a card a deck lacks makes an owned print useful; same chance, so both tie and it goes first', () => {
    // One Scyther del Team Rocket (P-B-88, a promo-only card) instead of two, and a deck that plays two.
    const units: StockQuantities = { ...stock() }
    const unit = index.cardById('P-B-88')?.stockCardId as string
    units[unit] = { stockCardId: unit, amountOwned: 1, collected: true }
    const decks = [{ name: '12. Team Rocket', groups: new Map([['P-B-88', 2]]) }]
    const plan = promoPlan({ index, stock: units, decks, now: DURING, volumes, events })
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12).toMatchObject({ missing: 0, chanceMissing: 0, chanceUseful: 0.2, deckCards: 1 })
    expect(b12?.cards.find((card) => card.cardId === 'P-B-88')?.decks).toEqual(['12. Team Rocket'])
    // Both give something 1 in 5 times: they tie, the deck's card first in the list.
    expect(plan.best).toEqual(['B12', 'A7'])
    expect(plan.volumes.map((status) => status.id)).toEqual(['B12', 'A7'])

    // Without the deck it is A vol. 7 alone.
    const alone = promoPlan({ index, stock: units, now: DURING, volumes, events, random: () => 0.9 })
    expect(alone.best).toEqual(['A7'])
    expect(alone.pick).toBe('A7')
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

  it('a volume outside the event never ties with the event ones, even with the same chance', () => {
    const plan = promoPlan({
      index,
      stock: stock(),
      now: DURING,
      volumes: [byId('A7'), byId('A8')],
      events: [{ ...EVENT, volumes: ['A7'] }],
      random: () => 0.99,
    })
    const a8 = plan.volumes.find((status) => status.id === 'A8')
    expect(a8?.chanceUseful).toBe(plan.volumes.find((status) => status.id === 'A7')?.chanceUseful)
    expect(plan.best).toEqual(['A7'])
    expect(plan.pick).toBe('A7')
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
    const plan = promoPlan({ index, stock: stock(), now: DURING, volumes, events: [{ ...EVENT, volumes: ['B12'] }] })
    expect(plan.best).toEqual([])
    expect(plan.pick).toBeNull()
    expect(plan.totals).toEqual({ volumes: 1, cards: 5, missing: 0, winsToComplete: 0 })
    // A vol. 7 still ranks, after the event's volume.
    expect(plan.volumes.map((status) => status.id)).toEqual(['B12', 'A7'])
  })

  it('a promo the catalog does not have yet counts as missing', () => {
    const future: PromoVolume = { id: 'B99', series: 'B', volume: 99, cardIds: ['P-B-88', 'P-B-999'] }
    const plan = promoPlan({ index, stock: stock(), now: AFTER, volumes: [future] })
    expect(plan.volumes[0]).toMatchObject({ missing: 1, chanceMissing: 0.5, winsToComplete: 2 })
    expect(plan.volumes[0]?.cards[1]).toEqual({
      cardId: 'P-B-999',
      groupId: 'P-B-999',
      nameEs: 'P-B-999',
      owned: 0,
      missing: true,
      newCard: true,
      decks: [],
    })
  })
})
