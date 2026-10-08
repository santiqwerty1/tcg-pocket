import { describe, expect, it } from 'vitest'
import {
  cardBreaksEvent,
  checkEventDeck,
  describeEventRulesEs,
  eventRulesSchema,
  fittingEdition,
} from '../../src/events/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const blaziken = deckDraft(2)

describe('eventos con restricciones (Fase 16)', () => {
  it('a deck without rules complies; the rules parse and read in Spanish', () => {
    expect(checkEventDeck(blaziken.cards, {}, index)).toEqual({ ok: true, problems: [] })
    expect(describeEventRulesEs({}, index)).toEqual(['Sin restricciones: cualquier mazo legal.'])
    const rules = eventRulesSchema.parse({ types: ['fire'], noEx: true, minOfType: { type: 'fire', count: 8 } })
    expect(describeEventRulesEs(rules, index)).toEqual([
      'Solo Pokémon de tipo Fuego.',
      'Al menos 8 Pokémon de tipo Fuego.',
      'Sin Pokémon ex.',
    ])
    expect(() => eventRulesSchema.parse({ types: ['plasma'] })).toThrow()
  })

  it('«sin ex»: the Mega-Blaziken ex of deck 2 breaks it, card by card', () => {
    const check = checkEventDeck(blaziken.cards, { noEx: true }, index)
    expect(check.ok).toBe(false)
    expect(check.problems.length).toBeGreaterThan(0)
    expect(check.problems.every((problem) => problem.message.includes('es un Pokémon ex'))).toBe(true)
    expect(check.problems.some((problem) => problem.message.startsWith('Mega-Blaziken ex'))).toBe(true)
  })

  it('types and counts: off-type Pokémon are named, and «al menos N» counts copies', () => {
    const fire = checkEventDeck(blaziken.cards, { types: ['fire'] }, index)
    const offType = blaziken.cards.filter((entry) => {
      const card = index.cardById(entry.cardId)
      return card?.cardType === 'pokemon' && card.energy !== 'fire'
    })
    expect(fire.problems).toHaveLength(offType.length)
    const firePokemon = blaziken.cards
      .filter((entry) => {
        const card = index.cardById(entry.cardId)
        return card?.cardType === 'pokemon' && card.energy === 'fire'
      })
      .reduce((sum, entry) => sum + entry.count, 0)
    expect(checkEventDeck(blaziken.cards, { minOfType: { type: 'fire', count: firePokemon } }, index).ok).toBe(true)
    const short = checkEventDeck(blaziken.cards, { minOfType: { type: 'fire', count: firePokemon + 1 } }, index)
    expect(short.problems).toEqual([
      {
        cardId: null,
        message: `Tiene ${firePokemon} Pokémon de tipo Fuego; el evento pide al menos ${firePokemon + 1}.`,
        alternative: null,
      },
    ])
  })

  it('rarities and expansions look at the edition played, and suggest another edition that fits', () => {
    // Bulbasaur A1-1 (◊) and its reprint A4b-1: an expansion rule can be met by switching editions.
    const a1 = index.cardById('A1-1')
    if (!a1) throw new Error('A1-1')
    expect(cardBreaksEvent(a1, { expansions: ['A4b'] })).toBe('es de A1')
    expect(fittingEdition(a1, { expansions: ['A4b'] }, index)?.id).toBe('A4b-1')
    const check = checkEventDeck([{ cardId: 'A1-1', count: 2 }], { expansions: ['A4b'] }, index)
    expect(check.problems[0]).toMatchObject({ cardId: 'A1-1', alternative: 'A4b-1' })
    expect(check.problems[0]?.message).toContain('sirve A4b-1')
    // A banned card is banned in every edition.
    expect(cardBreaksEvent(a1, { banned: [a1.functionalGroupId] })).toBe('está prohibida en el evento')
    expect(checkEventDeck(blaziken.cards, { rarities: ['◊'] }, index).ok).toBe(false)
  })
})

describe('tournament lists: any edition that fits counts', () => {
  it('an expansion rule met by another edition is not a problem with anyEdition', () => {
    expect(
      checkEventDeck([{ cardId: 'A1-1', count: 2 }], { expansions: ['A4b'] }, index, { anyEdition: true }).ok,
    ).toBe(true)
    expect(checkEventDeck([{ cardId: 'A1-1', count: 2 }], { expansions: ['B1'] }, index, { anyEdition: true }).ok).toBe(
      false,
    )
  })
})
