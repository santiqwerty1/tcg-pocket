import { describe, expect, it } from 'vitest'
import {
  deckDrawBase,
  deckDrawGroup,
  drawOdds,
  type SearchDeckCard,
  searchDeckCards,
  searchKindOf,
  searchOdds,
} from '../../src/decks/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

/** 20 cards: the target (2 copies), `basics` other Basics, the search cards and fillers. */
function deck(target: { count: number; basic: boolean }, basics: number, search: Partial<Record<string, number>> = {}) {
  const cards: SearchDeckCard[] = [
    { groupId: 'target', count: target.count, pokemon: true, basic: target.basic, search: null },
    { groupId: 'basic', count: basics, pokemon: true, basic: true, search: null },
  ]
  for (const [kind, count] of Object.entries(search)) {
    cards.push({
      groupId: kind,
      count: count ?? 0,
      pokemon: false,
      basic: false,
      search: kind as SearchDeckCard['search'],
    })
  }
  const used = cards.reduce((sum, card) => sum + card.count, 0)
  cards.push({ groupId: 'filler', count: 20 - used, pokemon: false, basic: false, search: null })
  return cards
}

describe('draws counting the cards that search (Fase 44)', () => {
  it('knows the three search cards by their English name', () => {
    expect(searchKindOf('Poké Ball')).toBe('pokeball')
    expect(searchKindOf("Professor's Research")).toBe('research')
    expect(searchKindOf('Pokémon Communication')).toBe('communication')
    expect(searchKindOf('Rare Candy')).toBeNull()
  })

  it('without search cards it is the exact natural odds of Fase 10', () => {
    const cards = deck({ count: 2, basic: false }, 6)
    const odds = searchOdds({ cards, targets: ['target'], turns: 4 })
    const exact = drawOdds({ deckSize: 20, basics: 6, groups: [{ basic: 0, other: 2 }], turns: 4 })
    for (const row of odds.rows) {
      const expected = exact.rows[row.turn]?.each[0] ?? 0
      expect(Math.abs(row.probability - expected)).toBeLessThan(4 * row.se + 1e-9)
    }
    expect(odds.searchCards).toEqual({ pokeball: 0, research: 0, communication: 0 })
  })

  it('Poké Ball finds a Basic, Research digs two deeper: both raise the odds after the opening hand', () => {
    const plain = searchOdds({ cards: deck({ count: 2, basic: true }, 4), targets: ['target'], turns: 3 })
    const balls = searchOdds({
      cards: deck({ count: 2, basic: true }, 4, { pokeball: 2 }),
      targets: ['target'],
      turns: 3,
    })
    const research = searchOdds({
      cards: deck({ count: 2, basic: false }, 4, { research: 2 }),
      targets: ['target'],
      turns: 3,
    })
    const natural = searchOdds({ cards: deck({ count: 2, basic: false }, 4), targets: ['target'], turns: 3 })
    // The opening hand is the same: nothing is played before it.
    expect(Math.abs((balls.rows[0]?.probability ?? 0) - (plain.rows[0]?.probability ?? 0))).toBeLessThan(0.02)
    expect(balls.rows[1]?.probability).toBeGreaterThan((plain.rows[1]?.probability ?? 0) + 0.1)
    expect(research.rows[2]?.probability).toBeGreaterThan((natural.rows[2]?.probability ?? 0) + 0.05)
  })

  it('the opening Active is not in hand: with no other Pokémon, Communication has nothing to give', () => {
    // Codex on #52: one Basic in the deck, always in the opening hand and then Active. The target is a Stage 1; with
    // four Communications and no Pokémon left in hand they never play, so the odds are those of the same deck with
    // fillers in their place (the same seed, the same draws).
    const cards = deck({ count: 2, basic: false }, 1, { communication: 4 })
    const fillers = cards.map((card) => (card.search ? { ...card, search: null } : card))
    const withCommunication = searchOdds({ cards, targets: ['target'], turns: 3, runs: 4000 })
    const without = searchOdds({ cards: fillers, targets: ['target'], turns: 3, runs: 4000 })
    expect(withCommunication.rows.map((row) => row.probability)).toEqual(without.rows.map((row) => row.probability))
  })

  it('the same deck and seed give the same numbers', () => {
    const cards = deck({ count: 1, basic: false }, 5, { research: 2, communication: 1 })
    const a = searchOdds({ cards, targets: ['target'], runs: 3000 })
    const b = searchOdds({ cards, targets: ['target'], runs: 3000 })
    expect(a.rows).toEqual(b.rows)
    expect(searchOdds({ cards, targets: ['target'], runs: 3000, seed: 7 }).rows).not.toEqual(a.rows)
  })

  it('deck 4 (Mega-Manectric ex): two Poké Balls, two Research and a Communication', () => {
    const cards = deckDraft(4).cards
    const search = searchDeckCards(cards, index)
    const manectric = search.find((card) => index.groupById(card.groupId)?.nameEn === 'Mega Manectric ex')
    expect(manectric).toBeDefined()
    const odds = searchOdds({ cards: search, targets: [manectric?.groupId ?? ''], turns: 4 })
    expect(odds.searchCards).toEqual({ pokeball: 2, research: 2, communication: 1 })
    const base = deckDrawBase(cards, index)
    const group = deckDrawGroup(cards, [manectric?.groupId ?? ''], index)
    const exact = drawOdds({ ...base, groups: [group], turns: 4 })
    expect(odds.rows[3]?.probability).toBeGreaterThan(exact.rows[3]?.each[0] ?? 1)
  })
})
