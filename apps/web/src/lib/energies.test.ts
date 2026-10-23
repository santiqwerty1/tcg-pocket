import { typesInPlay, typesOf } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import { editionTypes, editionTypesInPlay, energyLabel, weaknessHint } from './energies'

describe('the types of an edition (C1: two for the dual-type Pokémon)', () => {
  it('reads the list when it starts with energy, else energy alone; trainers have none', () => {
    expect(editionTypes({ energy: 'psychic', types: ['psychic', 'fighting'] })).toEqual(['psychic', 'fighting'])
    expect(editionTypes({ energy: 'grass' })).toEqual(['grass'])
    expect(editionTypes({ energy: 'grass', types: [] })).toEqual(['grass'])
    expect(editionTypes({ energy: 'fire', types: ['grass'] })).toEqual(['fire'])
    expect(editionTypes({ energy: 'trainer', types: [] })).toEqual([])
    expect(editionTypes({})).toEqual([])
  })

  it('in play, Urshifu also counts as the types its «Double Type» grants', () => {
    const urshifu = {
      energy: 'water',
      types: ['water'],
      ability: { effect: 'As long as this Pokémon is in play, it is [W] and [F] type.' },
    }
    expect(editionTypesInPlay(urshifu)).toEqual(['water', 'fighting'])
    expect(editionTypesInPlay({ energy: 'psychic', types: ['psychic', 'fighting'], ability: null })).toEqual([
      'psychic',
      'fighting',
    ])
    expect(editionTypesInPlay({ energy: 'water', ability: { effect: 'Heal 20 damage.' } })).toEqual(['water'])
  })
})

describe('the web follows the domain rule', () => {
  it('editionTypes and editionTypesInPlay give what typesOf and typesInPlay give', () => {
    type Input = Parameters<typeof typesInPlay>[0]
    const cases: Input[] = [
      { energy: 'psychic', types: ['psychic', 'fighting'] },
      { energy: 'grass' },
      { energy: 'grass', types: [] },
      { energy: 'fire', types: ['grass'] },
      { energy: 'trainer', types: [] },
      {
        energy: 'water',
        types: ['water'],
        ability: { effect: 'As long as this Pokémon is in play, it is [W] and [F] type.' },
      },
      { energy: 'darkness', ability: { effect: 'As long as this Pokemon is in play, it is [F] and [D] type.' } },
      { energy: 'water', ability: { effect: 'As long as this Pokémon is in play, it is [X] and [W] type.' } },
      { energy: 'water', ability: { effect: 'Heal 20 damage from [W].' } },
      { energy: 'water', ability: null },
    ]
    for (const input of cases) {
      expect(editionTypes(input), JSON.stringify(input)).toEqual(typesOf(input))
      expect(editionTypesInPlay(input), JSON.stringify(input)).toEqual(typesInPlay(input))
    }
  })

  it('names Dragon and Colorless in Spanish too', () => {
    expect(energyLabel('dragon')).toBe('Dragón')
    expect(energyLabel('colorless')).toBe('Incoloro')
    expect(energyLabel('psychic')).toBe('Psíquico')
  })
})

describe('the «+20 por debilidad» hint against the bot', () => {
  it('counts any type of the attacker in play, and stays quiet without a match or without the editions', () => {
    const mewtwo = { energy: 'psychic', types: ['psychic', 'fighting'] }
    expect(weaknessHint(mewtwo, { weakness: 'fighting' }, 'Pikachu')).toBe('+20 por debilidad de Pikachu')
    expect(weaknessHint(mewtwo, { weakness: 'psychic' }, 'Pikachu')).toBe('+20 por debilidad de Pikachu')
    expect(weaknessHint(mewtwo, { weakness: 'darkness' }, 'Pikachu')).toBeNull()
    const urshifu = {
      energy: 'water',
      types: ['water'],
      ability: { effect: 'As long as this Pokémon is in play, it is [W] and [F] type.' },
    }
    // A type only the Ability grants: the board does not say whether an effect stripped it (Budew's Prickly Powder).
    expect(weaknessHint(urshifu, { weakness: 'fighting' }, 'Lucario')).toBe(
      '+20 por debilidad de Lucario, si su habilidad no está anulada',
    )
    // Suppressed: no +20 for the granted type (Codex on #151); its printed Water still counts.
    expect(weaknessHint(urshifu, { weakness: 'fighting' }, 'Lucario', { abilitiesDisabled: true })).toBeNull()
    expect(weaknessHint(urshifu, { weakness: 'water' }, 'Charizard', { abilitiesDisabled: true })).toBe(
      '+20 por debilidad de Charizard',
    )
    expect(weaknessHint(urshifu, { weakness: 'fighting' }, 'Lucario', { abilitiesDisabled: false })).toBe(
      '+20 por debilidad de Lucario',
    )
    // A printed second type (C1) never depends on an Ability.
    expect(weaknessHint(mewtwo, { weakness: 'fighting' }, 'Pikachu', { abilitiesDisabled: true })).toBe(
      '+20 por debilidad de Pikachu',
    )
    expect(weaknessHint({ energy: 'water' }, { weakness: 'fighting' }, 'Lucario')).toBeNull()
    expect(weaknessHint(null, { weakness: 'fighting' }, 'Lucario')).toBeNull()
    expect(weaknessHint(mewtwo, { weakness: null }, 'Lucario')).toBeNull()
  })
})
