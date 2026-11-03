import { STAR_COUPON_TICKETS } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import type { StarCouponPackView, StarCouponView } from '../packs/pack-views.js'
import { starCouponJson } from './mcp-star-coupon-json.js'

const card = (cardId: string, nameEs: string, decks: string[], newEdition: boolean) => ({
  cardId,
  groupId: cardId,
  nameEs,
  owned: newEdition ? 0 : 1,
  decks,
  newEdition,
  belowGoal: newEdition,
})

const pack = (packId: string, nameEs: string, cards: ReturnType<typeof card>[]): StarCouponPackView => {
  const forDecks = cards.filter((item) => item.decks.length > 0).length
  const newEditions = cards.filter((item) => item.newEdition).length
  return {
    packId,
    nameEs,
    expansionId: packId.split('/')[0] ?? '',
    expansionNameEs: '',
    size: cards.length,
    forDecks,
    newEditions,
    belowGoal: newEditions,
    chanceDecks: (forDecks / cards.length) * 100,
    chanceNew: (newEditions / cards.length) * 100,
    chanceBelowGoal: (newEditions / cards.length) * 100,
    cards,
    limited: null,
  }
}

const view = (coupons: StarCouponView['coupons']): StarCouponView => ({
  rarity: '☆☆',
  today: '2026-11-03',
  deckTarget: 'saved',
  goalCopies: 1,
  goals: [{ id: '7', name: '7 Suicune ex', priority: 2, target: 'saved' }],
  lastImportAt: '2026-11-03T02:00:00.000Z',
  packs: [
    pack('A4a/suicunepack', 'Suicune', [
      card('A4a-79', 'Entei ex', ['7 Suicune ex'], true),
      card('A4a-80', 'Suicune ex', ['7 Suicune ex'], true),
      card('A4a-83', 'Blanca', [], false),
    ]),
    pack('A1/mewtwopack', 'Mewtwo', [card('A1-1', 'X', [], true)]),
    pack('A1/charizardpack', 'Charizard', [card('A1-2', 'Y', [], false)]),
  ],
  best: ['A4a/suicunepack'],
  coupons,
  known: [...STAR_COUPON_TICKETS],
})

describe('packs_star_coupon', () => {
  it('says each share as «k de n (p %)», the cards that count, and the deadline in Buenos Aires', () => {
    const json = starCouponJson(
      view({ importedAt: '2026-11-03T03:00:00.000Z', syncedAt: '2026-11-03T02:43:00.000Z', count: 2 }),
      2,
    )
    expect(json.best).toEqual(['Suicune (A4a)'])
    expect(json.morePacks).toBe(1)
    const packs = json.packs as Record<string, unknown>[]
    expect(packs).toHaveLength(2)
    expect(packs[0]).toMatchObject({
      pack: 'Suicune (A4a)',
      starCards: 3,
      forDecks: '2 de 3 (66,7 %)',
      newEditions: '2 de 3 (66,7 %)',
      cardsForDecks: [
        { card: 'Entei ex', cardId: 'A4a-79', decks: ['7 Suicune ex'] },
        { card: 'Suicune ex', cardId: 'A4a-80', decks: ['7 Suicune ex'] },
      ],
      newCards: ['Entei ex A4a-79', 'Suicune ex A4a-80'],
    })
    expect(json.coupons).toEqual({ status: 'known', gameReadAt: '2/11/2026, 23:43', count: 2 })
    expect(json.knownCoupons).toEqual([{ coupon: 'Cupón del 2.º aniversario', usableUntil: '15/12/2026, 03:59' }])
    // 0 is a count, not unknown.
    expect(
      starCouponJson(view({ importedAt: '2026-11-03T03:00:00.000Z', syncedAt: '2026-11-03T02:43:00.000Z', count: 0 }))
        .coupons,
    ).toMatchObject({ status: 'known', count: 0 })
  })

  it('an import that does not count them says so and how to fix it; no import, null', () => {
    const unknown = starCouponJson(
      view({ importedAt: '2026-11-02T03:00:00.000Z', syncedAt: '2026-11-02T02:43:00.000Z', count: null }),
    )
    expect(unknown.coupons).toMatchObject({ status: 'unknown', note: expect.stringContaining('marcador nuevo') })
    expect(unknown.coupons).not.toHaveProperty('count')
    expect(starCouponJson(view(null)).coupons).toBeNull()
  })
})
