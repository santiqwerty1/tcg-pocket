import { describe, expect, it } from 'vitest'
import { type CandidateDeck, closestDecks, countCards, deckDistance, pickRandomDeck } from '../../src/decks/index.js'
import { deckDraft, parsedDecks } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

function candidate(number: number, overrides: Partial<CandidateDeck> = {}): CandidateDeck {
  const draft = deckDraft(number)
  return {
    id: String(number),
    name: `Mazo ${number}`,
    builtInGame: false,
    cards: draft.cards,
    energies: draft.energies,
    ...overrides,
  }
}

const allDecks = (): CandidateDeck[] => parsedDecks().map((deck) => candidate(deck.number ?? 0))

describe('deckDistance', () => {
  it('a deck is at distance 0 from itself', () => {
    const deck13 = candidate(13)
    const distance = deckDistance(deck13, deck13, index)
    expect(distance).toMatchObject({ swaps: 0, keep: 20, toAdd: [], toRemove: [], otherEdition: [] })
    expect(distance.energies.change).toBe(false)
  })

  it('counts swaps by functional card: another edition of the same card is not a change', () => {
    const deck13 = candidate(13)
    // Hoopa ex B4-103 → its Deluxe reprint B4b-149 (same functional card).
    const reprint = deck13.cards.map((entry) =>
      entry.cardId === 'B4-103' ? { cardId: 'B4b-149', count: entry.count } : entry,
    )
    const distance = deckDistance({ cards: reprint, energies: deck13.energies }, deck13, index)
    expect(distance.swaps).toBe(0)
    expect(distance.otherEdition).toEqual([{ groupId: 'B4-103', nameEs: 'Hoopa ex', count: 1, cardIds: ['B4b-149'] }])
  })

  it('lists what to take out and what to put in, and flags an Energy Zone change', () => {
    const deck13 = candidate(13)
    // Target: deck 13 without Darkrai ex (A2-110) and with a second Hoopa ex, on Psychic.
    const cards = deck13.cards
      .filter((entry) => entry.cardId !== 'A2-110')
      .map((entry) => (entry.cardId === 'B4-103' ? { cardId: 'B4-103', count: 2 } : entry))
    expect(countCards({ cards })).toBe(20)
    const distance = deckDistance({ cards, energies: ['psychic'] }, deck13, index)
    expect(distance.swaps).toBe(1)
    expect(distance.keep).toBe(19)
    expect(distance.toAdd).toEqual([{ groupId: 'B4-103', nameEs: 'Hoopa ex', count: 1, cardIds: ['B4-103'] }])
    expect(distance.toRemove).toEqual([
      { groupId: index.groupOfCard('A2-110')?.id, nameEs: 'Darkrai ex', count: 1, cardIds: ['A2-110'] },
    ])
    expect(distance.energies).toEqual({ from: ['darkness'], to: ['psychic'], change: true })
  })
})

describe('closestDecks', () => {
  it('ranks the real 40 decks consistently and excludes the target itself', () => {
    const target = candidate(19)
    const ranked = closestDecks(target, allDecks(), index, { limit: 40, excludeId: '19' })
    expect(ranked).toHaveLength(39)
    expect(ranked.some((distance) => distance.deckId === '19')).toBe(false)
    for (const distance of ranked) {
      const added = distance.toAdd.reduce((sum, change) => sum + change.count, 0)
      const removed = distance.toRemove.reduce((sum, change) => sum + change.count, 0)
      expect(distance.keep + added).toBe(20)
      expect(distance.keep + removed).toBe(20)
      expect(distance.swaps).toBe(Math.max(added, removed))
    }
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i]?.swaps).toBeGreaterThanOrEqual(ranked[i - 1]?.swaps ?? 0)
    }
    // Deck 13 shares Hoopa ex and Mega-Absol ex with deck 19: it is closer than a deck with nothing in common.
    const at = (id: string) => ranked.findIndex((distance) => distance.deckId === id)
    expect(ranked[at('13')]?.keep).toBeGreaterThan(0)
  })

  it('a variant two swaps away wins; ties prefer the same energies, then decks built in the game', () => {
    const base = candidate(6)
    const variant = { ...base, cards: [...base.cards] }
    const decks = [
      candidate(2, { builtInGame: true }),
      { ...base, id: 'a', name: 'Otro color', energies: ['psychic' as const] },
      { ...base, id: 'b', name: 'Mismo color', builtInGame: false },
      { ...base, id: 'c', name: 'Mismo color armado', builtInGame: true },
    ]
    const ranked = closestDecks(variant, decks, index, { limit: 4 })
    expect(ranked.map((distance) => distance.deckId)).toEqual(['c', 'b', 'a', '2'])
    expect(ranked[0]?.swaps).toBe(0)
    expect(closestDecks(variant, decks, index)).toHaveLength(3)
  })
})

describe('pickRandomDeck', () => {
  const decks = [
    { id: '1', games: 3 },
    { id: '2', games: 0 },
    { id: '3', games: 0 },
    { id: '4', games: 10 },
  ]

  it('picks uniformly with the given random source', () => {
    expect(pickRandomDeck(decks, { random: () => 0 })).toEqual({ deck: decks[0], candidates: 4 })
    expect(pickRandomDeck(decks, { random: () => 0.99 })).toEqual({ deck: decks[3], candidates: 4 })
    expect(pickRandomDeck(decks, { random: () => 0.5 })?.deck.id).toBe('3')
  })

  it('with leastPlayed only the decks with the fewest matches take part', () => {
    expect(pickRandomDeck(decks, { leastPlayed: true, random: () => 0.99 })).toEqual({ deck: decks[2], candidates: 2 })
  })

  it('excludes the previous pick when re-rolling, unless it is the only one', () => {
    expect(pickRandomDeck(decks, { leastPlayed: true, excludeId: '2', random: () => 0 })?.deck.id).toBe('3')
    expect(pickRandomDeck([{ id: '9', games: 1 }], { excludeId: '9' })?.deck.id).toBe('9')
    expect(pickRandomDeck([])).toBeNull()
  })
})
