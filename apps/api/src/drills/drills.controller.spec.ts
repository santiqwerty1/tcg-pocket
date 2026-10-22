import type { CardEdition } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import { pokemonOf } from './drills.controller.js'

/** Only the fields `pokemonOf` reads; the rest of the edition does not matter here. */
function edition(fields: Partial<CardEdition>): CardEdition {
  return {
    nameEs: 'Carta',
    cardType: 'pokemon',
    energy: 'water',
    types: ['water'],
    hp: 100,
    weakness: 'lightning',
    prizePoints: 1,
    attacks: [{ cost: ['water'], name: 'Golpe', damage: '60', effect: null }],
    ability: null,
    ...fields,
  } as CardEdition
}

describe('pokemonOf: a deck card as a Pokémon of «¿Llega al KO?»', () => {
  it('carries the types it counts as in play: both of a dual-type Pokémon (C1) and those of Urshifu’s «Double Type»', () => {
    expect(pokemonOf(edition({ energy: 'psychic', types: ['psychic', 'fighting'] }))?.types).toEqual([
      'psychic',
      'fighting',
    ])
    const urshifu = edition({
      ability: { name: 'Double Type', effect: 'As long as this Pokémon is in play, it is [W] and [F] type.' },
    })
    expect(pokemonOf(urshifu)?.types).toEqual(['water', 'fighting'])
    expect(pokemonOf(edition({}))).toMatchObject({ energy: 'water', types: ['water'], attacks: [{ damage: 60 }] })
  })

  it('leaves out trainers and Pokémon without HP', () => {
    expect(pokemonOf(edition({ cardType: 'trainer', energy: 'trainer', types: [] }))).toBeNull()
    expect(pokemonOf(edition({ hp: null }))).toBeNull()
  })
})
