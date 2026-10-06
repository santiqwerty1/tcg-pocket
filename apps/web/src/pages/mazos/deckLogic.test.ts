import { describe, expect, it } from 'vitest'
import type { CardSearchHit, ImportedDeckDraft } from '@/api/schemas'
import {
  addCard,
  DECK_SIZE,
  draftToDeckInput,
  type EditorCard,
  formatDeckCount,
  isDeckSizeOk,
  isDraftReady,
  parseTags,
  setCount,
  toDeckInput,
  totalCount,
} from './deckLogic'

function hit(id: string, nameEs: string, groupId = id): CardSearchHit {
  const [expansionId = '', number = '0'] = [id.slice(0, id.lastIndexOf('-')), id.slice(id.lastIndexOf('-') + 1)]
  return {
    card: {
      id,
      nameEs,
      nameEn: nameEs,
      expansionId,
      number: Number(number),
      rarity: '◊◊◊◊',
      cardType: 'pokemon',
      evolutionType: 'basic',
      ex: true,
      prizePoints: 3,
      imageUrl: null,
      functionalGroupId: groupId,
      stockCardId: id,
      isDisplayEdition: true,
    },
    group: { id: groupId, nameEs, nameEn: nameEs, cardType: 'pokemon', displayCardId: groupId, editionCount: 2 },
    score: 1,
  }
}

describe('deck count', () => {
  it('formats the running count as N/20', () => {
    expect(formatDeckCount(0)).toBe('0/20')
    expect(formatDeckCount(20)).toBe('20/20')
    expect(isDeckSizeOk(19)).toBe(false)
    expect(isDeckSizeOk(DECK_SIZE)).toBe(true)
  })

  it('adds copies per edition and keeps the two editions of one group apart', () => {
    let cards: EditorCard[] = []
    cards = addCard(cards, hit('B2-113', 'Mega-Mawile ex'))
    cards = addCard(cards, hit('B2-113', 'Mega-Mawile ex'))
    cards = addCard(cards, hit('B2-201', 'Mega-Mawile ex', 'B2-113'))
    expect(cards.map((c) => [c.card.id, c.count])).toEqual([
      ['B2-113', 2],
      ['B2-201', 1],
    ])
    expect(totalCount(cards)).toBe(3)
  })

  it('never exceeds 20 cards in total', () => {
    let cards: EditorCard[] = []
    for (let i = 0; i < 25; i++) cards = addCard(cards, hit('B3b-64', 'Globito'))
    expect(totalCount(cards)).toBe(20)
    expect(formatDeckCount(totalCount(cards))).toBe('20/20')
    cards = setCount(cards, 'B3b-64', 18)
    cards = addCard(cards, hit('A1-1', 'Bulbasaur'))
    cards = setCount(cards, 'A1-1', 5)
    expect(totalCount(cards)).toBe(20)
    expect(cards.find((c) => c.card.id === 'A1-1')?.count).toBe(2)
  })

  it('removes an entry when its count drops to zero', () => {
    const cards = setCount(addCard([], hit('A2-91', 'Riolu')), 'A2-91', 0)
    expect(cards).toEqual([])
  })
})

describe('payloads', () => {
  it('parses tags and builds the DeckInput', () => {
    expect(parseTags(' competitivo, casual ,, competitivo ')).toEqual(['competitivo', 'casual'])
    const input = toDeckInput({
      name: ' Mega-Mawile ex solo ',
      energies: ['metal'],
      cards: addCard([], hit('B2-113', 'Mega-Mawile ex')),
      tags: 'misión',
      notes: '',
      variantOfId: null,
      packPriority: 2,
    })
    expect(input).toEqual({
      name: 'Mega-Mawile ex solo',
      energies: ['metal'],
      cards: [{ cardId: 'B2-113', count: 1 }],
      tags: ['misión'],
      notes: '',
      packPriority: 2,
    })
  })

  it('blocks drafts that still need an energy choice until the user picks one', () => {
    const draft: ImportedDeckDraft = {
      number: 10,
      title: 'Mega-Kangaskhan ex / Silvally',
      draft: { energies: [], cards: [{ cardId: 'B2-127', count: 1 }] },
      errors: [{ code: 'energy_choice_required', message: 'La tabla dice «Cualquiera»: elegí la energía.' }],
      warnings: [],
      validation: null,
      completeness: null,
    }
    expect(isDraftReady(draft, [])).toBe(false)
    expect(isDraftReady(draft, ['psychic'])).toBe(true)
    expect(draftToDeckInput(draft, 9, ['psychic'])).toEqual({
      name: 'Mega-Kangaskhan ex / Silvally',
      energies: ['psychic'],
      cards: [{ cardId: 'B2-127', count: 1 }],
    })
    const broken: ImportedDeckDraft = {
      ...draft,
      errors: [{ code: 'unknown_card', message: 'No existe «Riolu» sin código.' }],
    }
    expect(isDraftReady(broken, ['psychic'])).toBe(false)
  })
})
