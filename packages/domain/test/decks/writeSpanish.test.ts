import { describe, expect, it } from 'vitest'
import { DeckFormatError, parseSpanishDeckText, writeSpanishDeckText } from '../../src/decks/index.js'
import { deckDraft, deckLines, parsedDecks } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('writeSpanishDeckText', () => {
  it('regenerates the Pokémon and Entrenadores lines of the 40 decks byte for byte', () => {
    for (const deck of parsedDecks()) {
      const text = writeSpanishDeckText(deckDraft(deck.number), index)
      const lines = text.split('\n')
      const expected = deckLines(deck.number)
      expect(lines[1], `deck ${deck.number}`).toBe(expected.pokemon)
      expect(lines[2], `deck ${deck.number}`).toBe(expected.trainers)
    }
  })

  it('writes heading, Energía, Pokémon (always with code), Entrenadores (without code) and notes', () => {
    const text = writeSpanishDeckText(
      {
        name: 'Prueba',
        energies: ['fire', 'lightning'],
        cards: [
          { cardId: 'B1-33', count: 2 },
          { cardId: 'P-A-7', count: 2 },
          { cardId: 'B1-36', count: 1 },
          { cardId: 'B1-225', count: 1 },
        ],
        notes: 'línea 1\nlínea 2',
      },
      index,
      { heading: true, number: 7 },
    )
    expect(text).toBe(
      [
        '### 7. Prueba',
        '- Energía: Fuego + Rayo',
        '- Pokémon: 2 Torchic (B1-33), 1 Mega-Blaziken ex (B1-36)',
        '- Entrenadores: 2 Investigación de Profesores, 1 Copiona',
        '- Nota: línea 1',
        '- Nota: línea 2',
        '',
      ].join('\n'),
    )
  })

  it('writes «Cualquiera» for an empty energy selection and round-trips through the parser', () => {
    const draft = deckDraft(10)
    const text = writeSpanishDeckText(draft, index, { heading: true, number: 10 })
    expect(text.split('\n')[1]).toBe('- Energía: Cualquiera')
    const back = parseSpanishDeckText(text, index)
    expect(back.errors).toEqual([])
    expect(back.warnings.map((w) => w.code)).toEqual(['energy_choice_required'])
    expect(back.value?.cards).toEqual(draft.cards)
    expect(back.value?.name).toBe(draft.name)
  })

  it('round-trips the 40 decks through parse → write → parse', () => {
    for (const deck of parsedDecks()) {
      const draft = deckDraft(deck.number)
      const back = parseSpanishDeckText(writeSpanishDeckText(draft, index), index)
      expect(back.errors, `deck ${deck.number}`).toEqual([])
      expect(back.value?.cards, `deck ${deck.number}`).toEqual(draft.cards)
      expect(back.value?.energies, `deck ${deck.number}`).toEqual(draft.energies)
    }
  })

  it('throws DeckFormatError for an unknown edition', () => {
    expect(() => writeSpanishDeckText({ energies: [], cards: [{ cardId: 'Z9-1', count: 1 }] }, index)).toThrow(
      DeckFormatError,
    )
  })
})
