import { describe, expect, it } from 'vitest'
import type { SelectableEnergy } from '../../src/index.js'
import { energyKey, energyOptions, energyVariant, groupsOfCards } from '../../src/lab/index.js'
import { listKeyByGroup } from '../../src/tournaments/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const decks = Array.from({ length: 40 }, (_, i) => deckDraft(i + 1))

describe('energy variants (T-017 C6)', () => {
  it('a deck with two types tries each one alone; the key tells the zones apart', () => {
    const two = decks.find((deck) => deck.energies.length === 2)
    if (!two) throw new Error('no deck with two types')
    const energies = two.energies as SelectableEnergy[]
    const options = energyOptions(two.cards, energies, index)
    for (const drop of energies) expect(options).toContainEqual(energies.filter((energy) => energy !== drop))
    const cardsKey = listKeyByGroup(groupsOfCards(two.cards, index))
    const first = energyVariant(two.cards, energies, 0, index)
    if (!first?.energies) throw new Error('no energy variant')
    expect(first.key).toBe(energyKey(cardsKey, first.energies))
    expect(first.key).not.toBe(cardsKey)
    expect(first.add).toEqual([])
    // Tried already: the next option comes; all tried: none.
    const second = energyVariant(two.cards, energies, 0, index, new Set([first.key]))
    expect(second?.energies).not.toEqual(first.energies)
    const all = new Set(options.map((option) => energyKey(cardsKey, option)))
    expect(energyVariant(two.cards, energies, 0, index, all)).toBeNull()
  })

  it('a type an attack asks for is added, up to three; never a type nothing asks for', () => {
    for (const deck of decks) {
      const energies = deck.energies as SelectableEnergy[]
      for (const option of energyOptions(deck.cards, energies, index)) {
        expect(option.length).toBeLessThanOrEqual(3)
        expect(option.length).toBeGreaterThanOrEqual(1)
        const added = option.filter((energy) => !energies.includes(energy))
        for (const type of added) {
          const asked = deck.cards.some((entry) =>
            index.cardById(entry.cardId)?.attacks.some((attack) => attack.cost.includes(type)),
          )
          expect(asked).toBe(true)
        }
      }
    }
  })
})
