import { describe, expect, it } from 'vitest'
import { cardNameByLang, cardNameEs, type NameTranslations, parseTranslationTable } from '../../src/index.js'
import { builtCatalog, loadCollectionCsv, loadFixtures } from '../helpers/loadFixtures.js'

function translations(): NameTranslations {
  const f = loadFixtures()
  return {
    pokemon: parseTranslationTable(f.pokemonTranslations),
    trainers: parseTranslationTable(f.trainersTranslations),
    tools: parseTranslationTable(f.toolsTranslations),
  }
}

describe('cardNameEs', () => {
  const t = translations()

  it('translates Pokémon through pokemon_translations and re-appends " ex"', () => {
    expect(
      cardNameEs({ name: 'Mega Charizard X ex', cardType: 'pokemon', evolutionType: 'stage2', ex: true }, t),
    ).toEqual({
      nameEs: 'Mega-Charizard X ex',
      source: 'tracker',
    })
    expect(cardNameEs({ name: 'Type: Null', cardType: 'pokemon', evolutionType: 'basic', ex: false }, t).nameEs).toBe(
      'Código Cero',
    )
    expect(cardNameEs({ name: 'Pikachu', cardType: 'pokemon', evolutionType: 'basic', ex: false }, t)).toEqual({
      nameEs: 'Pikachu',
      source: 'tracker',
    })
  })

  it('translates supporters through trainers_translations and items/tools/stadiums through tools_translations', () => {
    expect(cardNameEs({ name: 'Copycat', cardType: 'trainer', evolutionType: 'supporter', ex: false }, t).nameEs).toBe(
      'Copiona',
    )
    expect(cardNameEs({ name: 'Iono', cardType: 'trainer', evolutionType: 'supporter', ex: false }, t).nameEs).toBe(
      'e-Nigma',
    )
    expect(cardNameEs({ name: 'Old Amber', cardType: 'trainer', evolutionType: 'item', ex: false }, t).nameEs).toBe(
      'Ámbar Viejo',
    )
    expect(cardNameEs({ name: 'Rare Candy', cardType: 'trainer', evolutionType: 'item', ex: false }, t).nameEs).toBe(
      'Caramelo Raro',
    )
  })

  it('falls back to the English name when the key or the es-ES value is missing', () => {
    expect(cardNameEs({ name: 'Missingno', cardType: 'pokemon', evolutionType: 'basic', ex: false }, t)).toEqual({
      nameEs: 'Missingno',
      source: 'fallback_en',
    })
    expect(cardNameEs({ name: 'Missingno ex', cardType: 'pokemon', evolutionType: 'basic', ex: true }, t)).toEqual({
      nameEs: 'Missingno ex',
      source: 'fallback_en',
    })
    const sparse: NameTranslations = {
      pokemon: { pichu: { 'en-US': 'Pichu', 'es-ES': null } },
      trainers: {},
      tools: {},
    }
    expect(cardNameEs({ name: 'Pichu', cardType: 'pokemon', evolutionType: 'basic', ex: false }, sparse)).toEqual({
      nameEs: 'Pichu',
      source: 'fallback_en',
    })
    expect(
      cardNameEs({ name: 'Unknown Thing', cardType: 'trainer', evolutionType: 'supporter', ex: false }, t).source,
    ).toBe('fallback_en')
  })

  it('supports the other tracker locales', () => {
    expect(
      cardNameByLang({ name: 'Copycat', cardType: 'trainer', evolutionType: 'supporter', ex: false }, t, 'fr-FR').name,
    ).toBe('Copieuse')
    expect(
      cardNameByLang({ name: 'Bulbasaur', cardType: 'pokemon', evolutionType: 'basic', ex: false }, t, 'de-DE').name,
    ).toBe('Bisasam')
  })
})

describe('Spanish names of the whole catalog', () => {
  it('match the CardName column of the real collection CSV, 4,317/4,317, with 0 fallbacks', () => {
    const { catalog, report } = builtCatalog()
    const rows = loadCollectionCsv()
    expect(rows).toHaveLength(4317)
    const csvNameById = new Map(rows.map((row) => [row.Id, row.CardName]))
    const mismatches = catalog.cards
      .filter((card) => csvNameById.get(card.id) !== card.nameEs)
      .map((card) => [card.id, card.nameEs, csvNameById.get(card.id)])
    expect(mismatches).toEqual([])
    expect(report.nameFallbacks).toEqual([])
    expect(catalog.cards.every((card) => card.nameEsSource === 'tracker')).toBe(true)
  })

  it('have no collisions: two English names never share a Spanish name', () => {
    const { catalog } = builtCatalog()
    const englishBySpanish = new Map<string, Set<string>>()
    for (const card of catalog.cards) {
      const set = englishBySpanish.get(card.nameEs) ?? new Set<string>()
      set.add(card.nameEn)
      englishBySpanish.set(card.nameEs, set)
    }
    const collisions = [...englishBySpanish.entries()].filter(([, names]) => names.size > 1)
    expect(collisions).toEqual([])
  })
})
