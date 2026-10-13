import { describe, expect, it } from 'vitest'
import { BLIND_SPOT_ES, blindSpotsOf, listBlindSpots } from '../../src/simulation/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const byName = (nameEn: string) => index.catalog.cards.find((card) => card.nameEn === nameEn)

describe('blind spots (T-017 A3)', () => {
  it('reads them from the catalog texts', () => {
    const ivysaur = index.catalog.cards.find(
      (card) => card.nameEn === 'Ivysaur' && card.attacks.every((a) => !a.damage),
    )
    expect(ivysaur && blindSpotsOf(ivysaur)).toContain('stage_without_damage')
    const ball = byName('Poké Ball')
    expect(ball && blindSpotsOf(ball)).toContain('deck_search')
    const slab = byName('Mythical Slab')
    if (slab) expect(blindSpotsOf(slab)).toContain('mythical_slab')
    const coins = index.catalog.cards.find((card) => card.attacks.some((attack) => /x$/i.test(attack.damage ?? '')))
    expect(coins && blindSpotsOf(coins)).toContain('variable_damage')
    // A plain attacker has none.
    const plain = index.catalog.cards.find(
      (card) =>
        card.cardType === 'pokemon' &&
        card.ability === null &&
        card.attacks.length === 1 &&
        /^\d+$/.test(card.attacks[0]?.damage ?? '') &&
        !card.attacks[0]?.effect,
    )
    expect(plain && blindSpotsOf(plain)).toEqual([])
    for (const text of Object.values(BLIND_SPOT_ES)) expect(text.length).toBeGreaterThan(10)
  })

  it('lists a deck’s cards with blind spots once each', () => {
    const deck = deckDraft(40) // Mega-Venusaur ex: Ivysaur's Synthesis does no damage
    const spots = listBlindSpots(deck.cards, index)
    expect(spots.some((card) => card.spots.includes('stage_without_damage'))).toBe(true)
    expect(new Set(spots.map((card) => card.cardId)).size).toBe(spots.length)
  })
})
