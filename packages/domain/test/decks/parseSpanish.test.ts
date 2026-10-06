import { describe, expect, it } from 'vitest'
import {
  ANY_ENERGY,
  countCards,
  parseEnergyWords,
  parseSpanishDeckText,
  parseSummaryTable,
  splitDeckSections,
} from '../../src/decks/index.js'
import { deckDraft, loadDecksMarkdown, parsedDecks } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('parseSpanishDeckFile: the 40 real decks', () => {
  const decks = parsedDecks()

  it('parses the 40 sections with 0 errors and no ambiguous or unknown names', () => {
    expect(decks).toHaveLength(40)
    expect(decks.map((d) => d.number)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    const failing = decks.filter((d) => d.errors.length > 0).map((d) => [d.number, d.errors])
    expect(failing).toEqual([])
    const codes = decks.flatMap((d) => [...d.errors, ...d.warnings].map((i) => i.code))
    expect(codes).not.toContain('ambiguous_name')
    expect(codes).not.toContain('unknown_card')
    expect(codes).not.toContain('name_mismatch')
    expect(codes).not.toContain('invalid_line')
    expect(decks.every((d) => d.draft !== null)).toBe(true)
  })

  it('gives every deck exactly 20 cards, its title and its note', () => {
    for (const deck of decks) expect(countCards(deck.draft ?? { cards: [] }), `deck ${deck.number}`).toBe(20)
    expect(decks[0]?.title).toBe('Butterfree / Mega-Sceptile ex')
    expect(deckDraft(1).name).toBe('Butterfree / Mega-Sceptile ex')
    expect(deckDraft(1).notes?.startsWith('Caterpie evoluciona sola')).toBe(true)
    expect(deckDraft(1).source).toBe('spanish_text')
  })

  it('keeps the written order and resolves trainers without code to the display edition', () => {
    const deck2 = deckDraft(2)
    expect(deck2.cards.slice(0, 5)).toEqual([
      { cardId: 'B1-33', count: 2 },
      { cardId: 'B1-36', count: 1 },
      { cardId: 'B1-284', count: 1 },
      { cardId: 'B1-44', count: 1 },
      { cardId: 'B3-24', count: 1 },
    ])
    expect(deck2.cards.slice(5, 9)).toEqual([
      { cardId: 'P-A-7', count: 2 },
      { cardId: 'B1-225', count: 2 },
      { cardId: 'P-A-5', count: 2 },
      { cardId: 'A3-144', count: 2 },
    ])
    expect(deckDraft(10).cards.find((c) => c.cardId === 'A3a-60')?.count).toBe(2)
    expect(deckDraft(13).cards.some((c) => c.cardId === 'B3b-64')).toBe(true)
  })

  it('takes the energy from the summary table; deck 10 («Cualquiera») has to choose', () => {
    expect(deckDraft(1).energies).toEqual(['grass'])
    expect(deckDraft(9).energies).toEqual(['fire', 'lightning'])
    expect(deckDraft(11).energies).toEqual(['grass', 'fighting'])
    expect(deckDraft(30).energies).toEqual(['psychic', 'lightning'])
    const deck10 = decks.find((d) => d.number === 10)
    expect(deck10?.draft?.energies).toEqual([])
    expect(deck10?.warnings.map((w) => w.code)).toEqual(['energy_choice_required'])
    const others = decks.filter((d) => d.number !== 10)
    expect(others.flatMap((d) => d.warnings)).toEqual([])
  })
})

describe('parseSummaryTable', () => {
  it('reads the energies of the 40 rows', () => {
    const { energiesByDeckNumber, issues } = parseSummaryTable(loadDecksMarkdown())
    expect(issues).toEqual([])
    expect(energiesByDeckNumber.size).toBe(40)
    expect(energiesByDeckNumber.get(1)).toEqual(['grass'])
    expect(energiesByDeckNumber.get(9)).toEqual(['fire', 'lightning'])
    expect(energiesByDeckNumber.get(10)).toBe(ANY_ENERGY)
    expect(energiesByDeckNumber.get(32)).toEqual(['grass', 'lightning'])
  })

  it('reports an unreadable energy cell and leaves the row out', () => {
    const { energiesByDeckNumber, issues } = parseSummaryTable(
      '| # | Mazo | Energía |\n|---|---|---|\n| 3 | X | Fuegoo |\n',
    )
    expect(energiesByDeckNumber.size).toBe(0)
    expect(issues).toEqual([{ number: 3, issue: expect.objectContaining({ code: 'unknown_energy', line: 3 }) }])
  })

  it('parseEnergyWords accepts +, commas, English names and «Cualquiera»', () => {
    expect(parseEnergyWords('Fuego + Rayo')).toEqual({ energies: ['fire', 'lightning'], unknown: [] })
    expect(parseEnergyWords('Fire, Lightning')).toEqual({ energies: ['fire', 'lightning'], unknown: [] })
    expect(parseEnergyWords('psiquico')).toEqual({ energies: ['psychic'], unknown: [] })
    expect(parseEnergyWords('Cualquiera')).toEqual({ energies: ANY_ENERGY, unknown: [] })
    expect(parseEnergyWords('Agua, Agua')).toEqual({ energies: ['water'], unknown: [] })
    expect(parseEnergyWords('Fuego + Dragón')).toEqual({ energies: ['fire'], unknown: ['Dragón'] })
  })
})

describe('parseSpanishDeckText', () => {
  it('reads one deck with heading, Energía line and note', () => {
    const text = [
      '### 7. Prueba',
      '- Energía: Fuego + Rayo',
      '- Pokémon: 2 Torchic (B1-33), 1 Mega-Blaziken ex (B1-36)',
      '- Entrenadores: 2 Investigación de Profesores, 1 Copiona',
      '- Nota: algo',
    ].join('\n')
    const result = parseSpanishDeckText(text, index)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.number).toBe(7)
    expect(result.title).toBe('Prueba')
    expect(result.value).toEqual({
      name: 'Prueba',
      energies: ['fire', 'lightning'],
      cards: [
        { cardId: 'B1-33', count: 2 },
        { cardId: 'B1-36', count: 1 },
        { cardId: 'P-A-7', count: 2 },
        { cardId: 'B1-225', count: 1 },
      ],
      notes: 'algo',
      source: 'spanish_text',
    })
  })

  it('accepts an English Energy line, CRLF, no bullets and «Cualquiera»', () => {
    const text = 'Energy: Fire, Lightning\r\nPokémon: 2 Torchic (B1-33)\r\nEntrenadores: 1 Copycat\r\n'
    const result = parseSpanishDeckText(text, index)
    expect(result.errors).toEqual([])
    expect(result.value?.energies).toEqual(['fire', 'lightning'])
    expect(result.value?.cards).toEqual([
      { cardId: 'B1-33', count: 2 },
      { cardId: 'B1-225', count: 1 },
    ])
    const any = parseSpanishDeckText('- Energía: Cualquiera\n- Pokémon: 1 Furfrou (B2-141)', index)
    expect(any.value?.energies).toEqual([])
    expect(any.warnings.map((w) => w.code)).toEqual(['energy_choice_required'])
  })

  it('falls back to the summary energies by deck number, else warns energy_missing', () => {
    const text = '### 9. X\n- Pokémon: 2 Dratini (A1-183)'
    const withTable = parseSpanishDeckText(text, index, { energiesByDeckNumber: new Map([[9, ['fire', 'lightning']]]) })
    expect(withTable.value?.energies).toEqual(['fire', 'lightning'])
    expect(withTable.warnings).toEqual([])
    const withAny = parseSpanishDeckText(text, index, { energiesByDeckNumber: new Map([[9, ANY_ENERGY]]) })
    expect(withAny.value?.energies).toEqual([])
    expect(withAny.warnings.map((w) => w.code)).toEqual(['energy_choice_required'])
    const without = parseSpanishDeckText(text, index)
    expect(without.value?.energies).toEqual([])
    expect(without.warnings.map((w) => w.code)).toEqual(['energy_missing'])
  })

  it('«1 Riolu» without code is ambiguous and lists the candidate editions', () => {
    const result = parseSpanishDeckText('- Pokémon: 1 Riolu', index)
    expect(result.value).toBeNull()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      code: 'ambiguous_name',
      line: 1,
      candidates: ['Riolu (A2-91)', 'Riolu (A2b-42)', 'Riolu (B3-79)'],
    })
    expect(result.errors[0]?.message).toContain('Riolu (A2-91)')
  })

  it('«2 Copionaa» is unknown and suggests Copiona; «2 Copiona (B1-226)» warns name_mismatch and uses B1-226', () => {
    const unknown = parseSpanishDeckText('- Entrenadores: 2 Copionaa', index)
    expect(unknown.value).toBeNull()
    expect(unknown.errors[0]).toMatchObject({ code: 'unknown_card', line: 1 })
    expect(unknown.errors[0]?.candidates).toContain('Copiona')
    expect(unknown.errors[0]?.message).toContain('Copiona')

    const mismatch = parseSpanishDeckText('- Energía: Fuego\n- Entrenadores: 2 Copiona (B1-226)', index)
    expect(mismatch.errors).toEqual([])
    expect(mismatch.warnings).toHaveLength(1)
    expect(mismatch.warnings[0]).toMatchObject({ code: 'name_mismatch', line: 2 })
    expect(mismatch.warnings[0]?.message).toContain('Ariana')
    expect(mismatch.value?.cards).toEqual([{ cardId: 'B1-226', count: 2 }])
  })

  it('is case- and accent-insensitive and accepts English names and «2x»', () => {
    const result = parseSpanishDeckText(
      '- Energía: Fuego\n- Entrenadores: 2x investigacion de profesores, 1 Rare Candy, 1 MEGA-BLAZIKEN EX',
      index,
    )
    expect(result.errors).toEqual([])
    expect(result.value?.cards).toEqual([
      { cardId: 'P-A-7', count: 2 },
      { cardId: 'A3-144', count: 1 },
      { cardId: 'B1-36', count: 1 },
    ])
    expect(result.warnings.map((w) => w.code)).toEqual(['wrong_section'])
    // «Código Cero» (Type: Null) exists with two different texts: without a code it is ambiguous.
    const typeNull = parseSpanishDeckText('- Pokémon: 2 Código Cero', index)
    expect(typeNull.errors[0]).toMatchObject({
      code: 'ambiguous_name',
      candidates: ['Código Cero (A3a-60)', 'Código Cero (B4-143)'],
    })
  })

  it('reports unknown codes, unknown energies, bad counts and empty input', () => {
    expect(parseSpanishDeckText('- Pokémon: 1 Riolu (Z9-1)', index).errors[0]).toMatchObject({ code: 'unknown_card' })
    expect(parseSpanishDeckText('- Energía: Fuegoo\n- Pokémon: 1 Riolu (A2-91)', index).errors[0]).toMatchObject({
      code: 'unknown_energy',
      line: 1,
    })
    expect(parseSpanishDeckText('- Pokémon: 0 Riolu (A2-91)', index).errors[0]).toMatchObject({ code: 'invalid_count' })
    expect(parseSpanishDeckText('### 1. Solo título\n', index).errors[0]).toMatchObject({ code: 'empty' })
    const ignored = parseSpanishDeckText('- Pokémon: 1 Riolu (A2-91)\nlínea suelta', index)
    expect(ignored.errors).toEqual([])
    expect(ignored.warnings[0]).toMatchObject({ code: 'invalid_line', line: 2 })
  })

  it('splitDeckSections finds the 40 sections and stops at the next heading', () => {
    const sections = splitDeckSections(loadDecksMarkdown())
    expect(sections).toHaveLength(40)
    expect(sections[39]?.text).not.toContain('Cartas que destrabarían')
    expect(sections[0]?.line).toBeGreaterThan(50)
  })
})
