import { describe, expect, it } from 'vitest'
import { BLIND_SPOT_ES, type BlindSpot, blindSpotsOf, listBlindSpots } from '../../src/simulation/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

/**
 * Real cards, what each one says and what it should get (review of #82: positives and negatives of every rule, chosen
 * by id, not by the function under test).
 */
const TABLE: [cardId: string, why: string, spots: BlindSpot[]][] = [
  // Variable damage: a printed «+» or «×», a coin that changes the damage, a random target, damage equal to damage.
  ['A2a-56', 'Mawile: «20+», 30 more against [M]', ['variable_damage']],
  ['B4-105', 'Mawile: «40+», a coin for 20 more', ['variable_damage']],
  ['A1-31', 'Skiddo: if tails, this attack does nothing', ['variable_damage']],
  ['B2-32', 'Delibird: if heads, this attack does 70 damage', ['variable_damage']],
  ['B2-48', 'Wellspring Mask Ogerpon: if heads, also 40 to the Bench', ['variable_damage']],
  ['A1-185', 'Dragonite: chosen at random 4 times, 50 each', ['variable_damage']],
  ['A2b-19', 'Wugtrio ex: chosen at random 3 times', ['variable_damage']],
  ['A4-31', 'Magcargo: either side, chosen at random', ['variable_damage']],
  ['B1-85', 'Mega Ampharos ex: Bench chosen at random', ['variable_damage']],
  ['B2a-78', 'Gholdengo ex: chosen at random per [M] Energy', ['variable_damage']],
  ['A4a-43', 'Phanpy: Flail, damage equal to the damage on it', ['variable_damage']],
  // A coin that does not change the damage dealt.
  ['A1-83', 'Articuno: a coin for Paralysis', []],
  ['A1-37', 'Vulpix: a coin so the Defending Pokémon cannot attack', []],
  ['A1-47', 'Moltres ex: coins for Energy, then a plain 70', []],
  ['A1a-50', 'Weezing: the opponent flips a coin for its attack', []],
  ['A1-140', 'Dugtrio: a coin to prevent damage', []],
  ['A3-24', 'Tapu Bulu: if tails, damage to itself', []],
  ['P-A-98', 'Blissey ex: a coin to heal', []],
  ['A3a-41', 'Krookodile: cards chosen at random from the hand, no damage', []],
  // A search of the deck.
  ['P-A-5', 'Poké Ball: a random Basic Pokémon from your deck', ['deck_search']],
  ['A2-146', 'Pokémon Communication: a random Pokémon in your deck', ['deck_search']],
  // «Discard a random Energy» (the engine always discards the last one), but not from the discard pile.
  ['A1-178', 'Mawile: a coin to discard a random Energy', ['random_energy']],
  ['A3a-43', 'Guzzlord ex: for each heads, discard a random Energy', ['random_energy']],
  ['A3a-69', 'Lusamine: 2 random Energy from your discard pile', []],
  // An evolution whose attacks do no damage, and Mythical Slab.
  ['B1a-2', 'Ivysaur: an evolution that only heals', ['stage_without_damage']],
  ['A1-2', 'Ivysaur: an evolution that attacks for 60', []],
  ['A1a-65', 'Mythical Slab', ['mythical_slab']],
]

describe('blind spots (T-017 A3)', () => {
  it.each(TABLE)('%s (%s)', (cardId, _why, spots) => {
    const card = index.cardById(cardId)
    if (!card) throw new Error(`no card ${cardId}`)
    expect(blindSpotsOf(card)).toEqual(spots)
  })

  it('every blind spot has its reason in Spanish', () => {
    for (const text of Object.values(BLIND_SPOT_ES)) expect(text.length).toBeGreaterThan(10)
  })

  it('lists a deck’s cards with blind spots once each', () => {
    const deck = deckDraft(40) // Mega-Venusaur ex: Ivysaur's Synthesis does no damage
    const spots = listBlindSpots(deck.cards, index)
    expect(spots.some((card) => card.spots.includes('stage_without_damage'))).toBe(true)
    expect(new Set(spots.map((card) => card.cardId)).size).toBe(spots.length)
  })
})
