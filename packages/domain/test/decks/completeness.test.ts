import { describe, expect, it } from 'vitest'
import { deckCompleteness } from '../../src/decks/index.js'
import { deckDraft, parsedDecks, playableByGroupFromCsv } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const playable = playableByGroupFromCsv()
const groupOf = (cardId: string) => index.cardById(cardId)?.functionalGroupId ?? cardId

describe('deckCompleteness against the 6/10 collection', () => {
  it('the test-only playable copies match the fixtures of PLAN Appendix B', () => {
    expect(playable.get(groupOf('B2-113'))).toBe(2) // Mega-Mawile ex
    expect(playable.get(groupOf('B3b-64'))).toBe(3) // Globito
    expect(playable.get(groupOf('A1-1'))).toBe(3) // Bulbasaur, not doubled by A4b-1
    expect(playable.get(groupOf('A4a-36'))).toBe(2) // Latias
    expect(playable.get(groupOf('A4a-37'))).toBe(2) // Latios
    expect(playable.get(groupOf('B4-103'))).toBe(1) // Hoopa ex
    expect(playable.get(groupOf('A2-91'))).toBe(1) // Riolu A2-91
    expect(playable.get(groupOf('B3-79'))).toBe(9) // Riolu B3-79
  })

  it('the 40 decks are complete (0 missing) each against the whole collection', () => {
    for (const deck of parsedDecks()) {
      const result = deckCompleteness(deckDraft(deck.number), index, playable)
      expect(result.missing, `deck ${deck.number}`).toEqual([])
      expect(result.complete, `deck ${deck.number}`).toBe(true)
      expect(result.missingCount, `deck ${deck.number}`).toBe(0)
    }
  })

  it('reports the missing copies per functional group, summing editions', () => {
    // Deck 13 with the second Hoopa ex it lacks.
    const draft = deckDraft(13)
    const twoHoopa = { ...draft, cards: draft.cards.map((c) => (c.cardId === 'B4-103' ? { ...c, count: 2 } : c)) }
    expect(deckCompleteness(twoHoopa, index, playable)).toEqual({
      complete: false,
      missing: [{ groupId: groupOf('B4-103'), nameEs: 'Hoopa ex', need: 2, have: 1, cardIds: ['B4-103'] }],
      missingCount: 1,
    })
    // Two editions of Mega-Mawile ex (deck 8) need 2 copies of the group: owned 2 → complete; 3 → missing 1.
    const deck8 = deckDraft(8)
    const three = { ...deck8, cards: [...deck8.cards, { cardId: 'B2-201', count: 1 }] }
    const result = deckCompleteness(three, index, playable)
    expect(result.missing).toEqual([
      { groupId: groupOf('B2-113'), nameEs: 'Mega-Mawile ex', need: 3, have: 2, cardIds: ['B2-113', 'B2-201'] },
    ])
    expect(result.missingCount).toBe(1)
  })

  it('treats groups absent from the map as 0 and unknown ids as missing', () => {
    const result = deckCompleteness(
      {
        cards: [
          { cardId: 'A1-1', count: 2 },
          { cardId: 'Z9-1', count: 1 },
        ],
      },
      index,
      new Map(),
    )
    expect(result.missing).toEqual([
      { groupId: 'A1-1', nameEs: 'Bulbasaur', need: 2, have: 0, cardIds: ['A1-1'] },
      { groupId: 'Z9-1', nameEs: 'Z9-1', need: 1, have: 0, cardIds: ['Z9-1'] },
    ])
    expect(result.missingCount).toBe(3)
  })
})
