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
  it('A vol. 7 lacks only Rayquaza ex: 1 in 5 per win, ~5 wins, and one coupon saves them all', () => {
    const plan = promoPlan({ index, stock: stock(), now: DURING })
    const a7 = plan.volumes.find((status) => status.id === 'A7')
    expect(a7).toMatchObject({ missing: 1, chanceMissing: 0.2, chanceUseful: 0.2, winsToComplete: 5, winsPerCoupon: 5 })
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
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12).toMatchObject({ missing: 0, chanceMissing: 0, chanceUseful: 0, winsToComplete: 0, winsPerCoupon: null })
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

  it('a card a deck lacks makes an owned print useful, and breaks the tie for that volume', () => {
    // One Scyther del Team Rocket (P-B-88, a promo-only card) instead of two, and a deck that plays two.
    const units: StockQuantities = { ...stock() }
    const unit = index.cardById('P-B-88')?.stockCardId as string
    units[unit] = { stockCardId: unit, amountOwned: 1, collected: true }
    const decks = [{ name: '12. Team Rocket', groups: new Map([['P-B-88', 2]]) }]
    const plan = promoPlan({ index, stock: units, decks, now: DURING, volumes, events })
    const b12 = plan.volumes.find((status) => status.id === 'B12')
    expect(b12).toMatchObject({ missing: 0, chanceMissing: 0, chanceUseful: 0.2, deckCards: 1 })
    expect(b12?.cards.find((card) => card.cardId === 'P-B-88')?.decks).toEqual(['12. Team Rocket'])
    // Both give something 1 in 5 times; the deck's card decides.
    expect(plan.best).toEqual(['B12'])
    expect(plan.volumes.map((status) => status.id)).toEqual(['B12', 'A7'])

    // Without the deck it is A vol. 7 alone.
    expect(promoPlan({ index, stock: units, now: DURING, volumes, events }).best).toEqual(['A7'])
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
