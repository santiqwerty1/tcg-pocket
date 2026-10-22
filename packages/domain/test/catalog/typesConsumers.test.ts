import { describe, expect, it } from 'vitest'
import {
  type CardEdition,
  cardBreaksEvent,
  checkEventDeck,
  type DrillPokemon,
  koDrill,
  typesInPlay,
  zoneRole,
} from '../../src/index.js'
import { inventedC1Index } from '../helpers/inventedC1.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

/** Uses of the type list (C1's dual types and Urshifu's «Double Type»). C1 cards: FIXTURE INVENTADO. */
const index = inventedC1Index()
const card = (id: string) => {
  const found = index.cardById(id)
  if (!found) throw new Error(`no ${id}`)
  return found
}
const mewtwo = card('C1-1') // psychic / fighting
const greninja = card('C1-2') // water / darkness

describe('typesInPlay', () => {
  it('a dual-type Pokémon counts as both; Urshifu adds the types its Ability grants while in play', () => {
    expect(typesInPlay(mewtwo)).toEqual(['psychic', 'fighting'])
    expect(typesInPlay(catalogIndex().cardById('B3-51') as CardEdition)).toEqual(['water', 'fighting'])
    expect(typesInPlay(catalogIndex().cardById('B3-113') as CardEdition)).toEqual(['darkness', 'fighting'])
    expect(typesInPlay(catalogIndex().cardById('A1-1') as CardEdition)).toEqual(['grass'])
    expect(typesInPlay(catalogIndex().cardById('P-A-1') as CardEdition)).toEqual([])
    // Only that Ability: another text with symbols does not grant a type.
    const other = {
      energy: 'water' as const,
      types: ['water' as const],
      ability: { effect: 'Heal 20 damage from [W].' },
    }
    expect(typesInPlay(other)).toEqual(['water'])
  })
})

describe('¿Llega al KO? with two attacker types', () => {
  const attacker: DrillPokemon = {
    nameEs: 'Mega-Mewtwo X ex',
    hp: 180,
    energy: 'psychic',
    types: ['psychic', 'fighting'],
    weakness: 'darkness',
    prizePoints: 3,
    attacks: [{ name: 'Golpe', damage: 100 }],
  }
  const weakToFighting: DrillPokemon = {
    nameEs: 'Pikachu',
    hp: 60,
    energy: 'lightning',
    weakness: 'fighting',
    prizePoints: 1,
    attacks: [{ name: 'Chispa', damage: 20 }],
  }

  it('hits the Weakness of either type: +20, and says which type and both of its own', () => {
    let damageQuestions = 0
    for (let seed = 1; seed <= 40; seed++) {
      const drill = koDrill([attacker], [weakToFighting], seed)
      expect(drill.facts[0]).toContain('(Psíquica y Lucha)')
      if (drill.prompt.startsWith('¿Cuánto daño')) {
        damageQuestions += 1
        expect(drill.choices[drill.answer]).toBe('120')
        expect(drill.explanation).toContain('+ 20, porque Pikachu es débil a Lucha')
      }
    }
    expect(damageQuestions).toBeGreaterThan(0)
    // Without the second type there is no Weakness to hit.
    const oneType = { ...attacker, types: undefined }
    const damageDrill = [...Array(40).keys()]
      .map((seed) => koDrill([oneType], [weakToFighting], seed + 1))
      .find((drill) => drill.prompt.startsWith('¿Cuánto daño'))
    expect(damageDrill?.choices[damageDrill.answer]).toBe('100')
    expect(damageDrill?.explanation).toContain('no es débil a Psíquica.')
  })

  it('practices the Weakness of the second type as often as any other (the weak defender comes up more)', () => {
    const notWeak: DrillPokemon = { ...weakToFighting, nameEs: 'Bulbasaur', energy: 'grass', weakness: 'fire' }
    let weakChosen = 0
    for (let seed = 1; seed <= 200; seed++) {
      if (koDrill([attacker], [weakToFighting, notWeak], seed).facts[1]?.startsWith('Pikachu')) weakChosen += 1
    }
    // 40 % of the time from the weak ones, else either of the two: about 70 %, not 50 %.
    expect(weakChosen).toBeGreaterThan(120)
    // Neither type weak: «ni a» in the explanation.
    const damageDrill = [...Array(60).keys()]
      .map((seed) => koDrill([attacker], [notWeak], seed + 1))
      .find((drill) => drill.prompt.startsWith('¿Cuánto daño'))
    expect(damageDrill?.explanation).toContain('Bulbasaur no es débil a Psíquica ni a Lucha.')
  })
})

describe('event rules with a dual-type Pokémon', () => {
  it('«solo tipo X» lets it in when either type is allowed, and names both when neither is', () => {
    expect(cardBreaksEvent(greninja, { types: ['darkness'] })).toBeNull()
    expect(cardBreaksEvent(greninja, { types: ['water'] })).toBeNull()
    expect(cardBreaksEvent(greninja, { types: ['fire'] })).toBe('es de tipo Agua y Oscuridad')
    expect(cardBreaksEvent(card('C1-3'), { types: ['darkness'] })).toBe('es de tipo Agua')
  })

  it('«al menos N de tipo X» counts it for either type', () => {
    const deck = [
      { cardId: 'C1-2', count: 2 },
      { cardId: 'C1-1', count: 2 },
    ]
    expect(checkEventDeck(deck, { minOfType: { type: 'darkness', count: 2 } }, index).ok).toBe(true)
    expect(checkEventDeck(deck, { minOfType: { type: 'fighting', count: 2 } }, index).ok).toBe(true)
    const short = checkEventDeck(deck, { minOfType: { type: 'water', count: 3 } }, index)
    expect(short.problems.map((problem) => problem.message)).toEqual([
      'Tiene 2 Pokémon de tipo Agua; el evento pide al menos 3.',
    ])
  })
})

describe('laboratory: a dual-type Pokémon is of the zone when either type is', () => {
  it('draws it on its own with only its second type in the zone', () => {
    // An attack the second type alone can pay (the invented one asks for both).
    const fightingOnly = { ...mewtwo, attacks: [{ ...mewtwo.attacks[0], cost: ['fighting', 'colorless'] }] }
    expect(zoneRole(fightingOnly as CardEdition, ['fighting'], index, false)).toBe('draw')
    // One type, the other one in the zone: not drawn alone (as before).
    const psychicOnly = { ...fightingOnly, types: ['psychic'] }
    expect(zoneRole(psychicOnly as CardEdition, ['fighting'], index, false)).toBeNull()
  })
})
