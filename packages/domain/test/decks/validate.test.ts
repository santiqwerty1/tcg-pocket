import { describe, expect, it } from 'vitest'
import {
  copiesByName,
  countCards,
  type DeckCardEntry,
  type DeckDraft,
  defaultEvolutionAliases,
  validateDeck,
} from '../../src/decks/index.js'
import { deckDraft, parsedDecks } from '../helpers/loadDecks.js'
import { builtCatalog, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const { catalog } = builtCatalog()

function withEnergy(number: number): DeckDraft {
  const draft = deckDraft(number)
  return number === 10 ? { ...draft, energies: ['psychic'] } : draft
}

/** Replaces the entries of `draft` through `edit`, keeping the rest. */
function edit(draft: DeckDraft, fn: (cards: DeckCardEntry[]) => DeckCardEntry[]): DeckDraft {
  return { ...draft, cards: fn(draft.cards.map((c) => ({ ...c }))) }
}

function cardIdByNameEn(nameEn: string): string {
  const card = catalog.cards.find((c) => c.nameEn === nameEn)
  if (!card) throw new Error(`no card named ${nameEn}`)
  return card.id
}

describe('validateDeck over the 40 real decks', () => {
  it('returns ok with 0 errors for the 40 decks (deck 10 given Psychic)', () => {
    for (const deck of parsedDecks()) {
      const result = validateDeck(withEnergy(deck.number), index)
      expect(result.errors, `deck ${deck.number}`).toEqual([])
      expect(result.ok, `deck ${deck.number}`).toBe(true)
    }
  })

  it('deck 15 passes thanks to the Eevee ex alias and fails evolution_line without aliases', () => {
    expect(validateDeck(deckDraft(15), index).ok).toBe(true)
    const strict = validateDeck(deckDraft(15), index, { aliases: [] })
    expect(strict.ok).toBe(false)
    expect(strict.errors.map((e) => e.code)).toEqual(['evolution_line', 'evolution_line'])
    expect(strict.errors[0]?.message).toBe('Vaporeon (A1a-19) necesita a Eevee en el mazo')
    expect(strict.errors[1]?.message).toBe('Vaporeon ex (B3-37) necesita a Eevee en el mazo')
    expect(defaultEvolutionAliases(index).map((a) => a.cardId)).toEqual([
      'A3b-56',
      'A3b-83',
      'A3b-92',
      'A4b-287',
      'A4b-370',
      'P-A-109',
    ])
    expect(defaultEvolutionAliases(index).every((a) => a.countsAs === 'Eevee')).toBe(true)
  })

  it('deck 39 (one Pokémon + 19 trainers) is valid; deck 10 fails only energy_required until it picks one', () => {
    expect(validateDeck(deckDraft(39), index).ok).toBe(true)
    const empty = validateDeck(deckDraft(10), index)
    expect(empty.ok).toBe(false)
    expect(empty.errors).toEqual([
      { code: 'energy_required', level: 'error', message: 'Elegí al menos una energía para el mazo' },
    ])
    expect(empty.infos).toEqual([])
    const psychic = validateDeck({ ...deckDraft(10), energies: ['psychic'] }, index)
    expect(psychic.ok).toBe(true)
    expect(psychic.infos.map((i) => i.code)).toEqual(['energy_unused'])
  })

  it('reports informative splits and unusable attacks', () => {
    const deck2 = validateDeck(deckDraft(2), index)
    expect(deck2.infos).toEqual([
      {
        code: 'same_group_split',
        level: 'info',
        message: 'Mega-Blaziken ex: 2 copias (B1-36 + B1-284)',
        cardIds: ['B1-36', 'B1-284'],
      },
    ])
    const deck9 = validateDeck(deckDraft(9), index)
    expect(deck9.infos).toEqual([
      {
        code: 'energy_missing_for_card',
        level: 'info',
        message: 'Dratini (A1-183) no puede usar ningún ataque con las energías elegidas',
        cardIds: ['A1-183'],
      },
    ])
    expect(validateDeck(deckDraft(1), index).infos).toEqual([])
  })
})

describe('validateDeck: rules', () => {
  it('card_count with the exact Spanish messages', () => {
    const deck1 = deckDraft(1)
    const short = edit(deck1, (cards) => cards.map((c) => (c.cardId === 'B3b-1' ? { ...c, count: 1 } : c)))
    expect(countCards(short)).toBe(19)
    expect(validateDeck(short, index).errors).toEqual([
      { code: 'card_count', level: 'error', message: 'Tiene 19 cartas, falta 1' },
    ])
    const long = edit(deck1, (cards) => [...cards, { cardId: 'A1-225', count: 1 }])
    expect(validateDeck(long, index).errors[0]?.message).toBe('Tiene 21 cartas, sobra 1')
    const shorter = edit(deck1, (cards) => cards.slice(0, -2))
    expect(validateDeck(shorter, index).errors[0]?.message).toBe('Tiene 17 cartas, faltan 3')
    expect(validateDeck({ energies: ['fire'], cards: [] }, index).errors.map((e) => e.message)).toContain(
      'Tiene 0 cartas, faltan 20',
    )
  })

  it('copies_per_name sums editions and groups of the same English name', () => {
    // Deck 6: 1 Riolu (A2-91) + 1 Riolu (B3-79); make it 1 + 2 and drop a one-of trainer to stay at 20.
    const deck6 = deckDraft(6)
    const threeRiolu = edit(deck6, (cards) => {
      const out = cards.map((c) => (c.cardId === 'B3-79' ? { ...c, count: 2 } : c))
      const drop = out.findIndex((c) => c.count === 1 && index.cardById(c.cardId)?.cardType === 'trainer')
      out.splice(drop, 1)
      return out
    })
    expect(countCards(threeRiolu)).toBe(20)
    const result = validateDeck(threeRiolu, index)
    expect(result.errors).toEqual([
      {
        code: 'copies_per_name',
        level: 'error',
        message: 'Riolu tiene 3 copias (A2-91 ×1, B3-79 ×2); máximo 2',
        cardIds: ['A2-91', 'B3-79'],
      },
    ])
    expect(copiesByName(threeRiolu, index).get('Riolu')).toEqual({
      nameEn: 'Riolu',
      nameEs: 'Riolu',
      total: 3,
      editions: [
        { cardId: 'A2-91', count: 1 },
        { cardId: 'B3-79', count: 2 },
      ],
    })
    // Two entries of the same edition add up too.
    const twice = validateDeck(
      edit(deck6, (cards) => [...cards, { cardId: 'A2-91', count: 1 }, { cardId: 'A2-91', count: 1 }]),
      index,
    )
    expect(twice.errors.map((e) => e.message)).toContain('Riolu tiene 4 copias (A2-91 ×3, B3-79 ×1); máximo 2')
  })

  it('«Umbreon» and «Umbreon ex» are different names: 2 + 2 is fine', () => {
    // Deck 35: Umbreon ex ×2 (A4-112 + A4-208), Umbreon A3b-43 ×1 → make Umbreon ×2 and drop a one-of trainer.
    const deck35 = deckDraft(35)
    const draft = edit(deck35, (cards) => {
      const out = cards.map((c) => (c.cardId === 'A3b-43' ? { ...c, count: 2 } : c))
      const drop = out.findIndex((c) => c.count === 1 && index.cardById(c.cardId)?.cardType === 'trainer')
      out.splice(drop, 1)
      return out
    })
    expect(countCards(draft)).toBe(20)
    const result = validateDeck(draft, index)
    expect(result.errors).toEqual([])
    expect(copiesByName(draft, index).get('Umbreon')?.total).toBe(2)
    expect(copiesByName(draft, index).get('Umbreon ex')?.total).toBe(2)
  })

  it('evolution_line: Vaporeon with only Pikachu ex as a basic; stage 2 without stage 1 nor Rare Candy', () => {
    const pikachuEx = cardIdByNameEn('Pikachu ex')
    const vaporeon = validateDeck(
      {
        energies: ['water'],
        cards: [
          { cardId: 'A1a-19', count: 1 },
          { cardId: pikachuEx, count: 1 },
        ],
      },
      index,
    )
    expect(vaporeon.errors.map((e) => e.code)).toContain('evolution_line')
    expect(vaporeon.errors.find((e) => e.code === 'evolution_line')).toMatchObject({
      message: 'Vaporeon (A1a-19) necesita a Eevee en el mazo',
      cardIds: ['A1a-19'],
    })

    const noCandy = edit(deckDraft(2), (cards) => cards.filter((c) => c.cardId !== 'A3-144'))
    const result = validateDeck(noCandy, index)
    expect(result.errors.map((e) => e.code)).toEqual(['card_count', 'evolution_line'])
    expect(result.errors[1]).toEqual({
      code: 'evolution_line',
      level: 'error',
      message: 'Mega-Blaziken ex (B1-36, B1-284) necesita a Combusken en el mazo, o a Torchic con Caramelo Raro',
      cardIds: ['B1-36', 'B1-284'],
    })
    // With Combusken back (deck 22 layout) it passes without Rare Candy.
    const withCombusken = edit(noCandy, (cards) => [...cards, { cardId: 'B1-34', count: 2 }])
    expect(validateDeck(withCombusken, index).errors).toEqual([])
    // Rare Candy skips the stage 1 (deck 25: Gible + Rare Candy, no Gabite).
    expect(validateDeck(deckDraft(25), index).ok).toBe(true)
    // Fossils evolve from the fossil trainer card itself.
    const omanyte = cardIdByNameEn('Omanyte')
    const helix = cardIdByNameEn('Helix Fossil')
    const fossil = validateDeck(
      {
        energies: ['water'],
        cards: [
          { cardId: omanyte, count: 1 },
          { cardId: helix, count: 1 },
        ],
      },
      index,
    )
    expect(fossil.errors.map((e) => e.code)).not.toContain('evolution_line')
    expect(fossil.errors.map((e) => e.code)).toContain('no_basic')
  })

  it('no_basic ignores fossils; energy rules; no_attacker; unknown cards', () => {
    const onlyStage1 = validateDeck({ energies: ['water'], cards: [{ cardId: 'A1a-19', count: 2 }] }, index)
    expect(onlyStage1.errors.map((e) => e.code)).toContain('no_basic')
    expect(validateDeck(deckDraft(16), index).ok).toBe(true) // has Fósil Cráneo and real basics

    const dragon = validateDeck({ ...deckDraft(9), energies: ['dragon' as 'fire'] }, index)
    expect(dragon.errors).toEqual([
      {
        code: 'energy_not_selectable',
        level: 'error',
        message: 'La energía Dragón no se puede elegir en la Zona de Energía',
      },
    ])
    const colorless = validateDeck({ ...deckDraft(9), energies: ['fire', 'colorless' as 'fire'] }, index)
    expect(colorless.errors.map((e) => e.code)).toEqual(['energy_not_selectable'])

    const grassDeckWithFire = validateDeck({ ...deckDraft(1), energies: ['fire'] }, index)
    expect(grassDeckWithFire.errors.map((e) => e.code)).toEqual(['no_attacker'])
    expect(grassDeckWithFire.infos.filter((i) => i.code === 'energy_missing_for_card')).toHaveLength(6)
    expect(grassDeckWithFire.infos.map((i) => i.code)).toContain('energy_unused')

    const unknown = validateDeck(
      {
        energies: ['fire'],
        cards: [
          { cardId: 'Z9-1', count: 1 },
          { cardId: 'A1-1', count: -1 },
        ],
      },
      index,
    )
    expect(unknown.errors.map((e) => e.code).sort()).toEqual([
      'card_count',
      'invalid_count',
      'no_basic',
      'unknown_card',
    ])
    expect(unknown.errors.find((e) => e.code === 'unknown_card')?.message).toBe(
      'No existe la carta Z9-1 en el catálogo',
    )
  })
})
