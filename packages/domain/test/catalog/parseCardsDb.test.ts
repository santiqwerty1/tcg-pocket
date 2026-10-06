import { describe, expect, it } from 'vitest'
import {
  CardsDbParseError,
  parseCraftingCostFromCardsDb,
  parseExpansionIds,
  parseExpansionsFromCardsDb,
} from '../../src/index.js'
import { loadFixtures } from '../helpers/loadFixtures.js'

describe('parseExpansionsFromCardsDb', () => {
  const expansions = parseExpansionsFromCardsDb(loadFixtures().cardsDbSource)
  const byId = new Map(expansions.map((expansion) => [expansion.id, expansion]))

  it('returns the 24 expansions of CardsDB.ts @ 3ab58f1 in declaration order', () => {
    expect(expansions).toHaveLength(24)
    expect(expansions[0]?.id).toBe('A1')
    expect(expansions.map((expansion) => expansion.id)).toEqual([
      'A1',
      'A1a',
      'A2',
      'A2a',
      'A2b',
      'A3',
      'A3a',
      'A3b',
      'A4',
      'A4a',
      'A4b',
      'B1',
      'B1a',
      'B2',
      'B2a',
      'B2b',
      'B3',
      'B3a',
      'B3b',
      'B4',
      'B4a',
      'B4b',
      'P-A',
      'P-B',
    ])
  })

  it('reads A4b as a 4-card Deluxe pack with linked cards that the tracker marks as not openable', () => {
    const a4b = byId.get('A4b')
    expect(a4b).toMatchObject({
      internalId: 11,
      name: 'deluxepackex',
      tradeable: true,
      openable: false,
      promo: false,
      packStructure: { cardsPerPack: 4, containsLinkedCards: true, containsShinies: true, containsBabies: false },
    })
  })

  it('reads the pinned internal ids of B4b, P-A and P-B', () => {
    expect(byId.get('B4b')?.internalId).toBe(22)
    expect(byId.get('P-A')?.internalId).toBe(192)
    expect(byId.get('P-B')?.internalId).toBe(193)
    expect(byId.get('A1')?.internalId).toBe(1)
  })

  it('reads packs with name and color, and promos without pack structure', () => {
    expect(byId.get('A1')?.packs).toEqual([
      { name: 'mewtwopack', color: '#c078bc' },
      { name: 'charizardpack', color: '#c08c78' },
      { name: 'pikachupack', color: '#c0af78' },
      { name: 'everypack', color: '#c0c0c0' },
    ])
    expect(byId.get('P-A')).toMatchObject({ promo: true, packStructure: null, packs: [{ name: 'everypack' }] })
    expect(byId.get('P-B')).toMatchObject({ promo: true, packStructure: null })
    for (const expansion of expansions) {
      if (!expansion.promo) expect(expansion.packStructure).not.toBeNull()
    }
  })

  it('does not depend on the exact type annotation or on CRLF line endings', () => {
    const source =
      "export const expansions: ReadonlyArray<Expansion> = [\n  { name: 'x', id: 'X1', internalId: 7, packs: [{ name: 'everypack', color: '#000' }], tradeable: true, openable: true }, // c\n]\n"
    expect(parseExpansionsFromCardsDb(source)).toEqual([
      {
        id: 'X1',
        internalId: 7,
        name: 'x',
        packs: [{ name: 'everypack', color: '#000' }],
        tradeable: true,
        openable: true,
        promo: false,
        packStructure: null,
      },
    ])
    expect(parseExpansionsFromCardsDb(source.replace(/\n/g, '\r\n'))).toHaveLength(1)
  })

  it('fails loudly when the declaration is missing, invalid or duplicated', () => {
    expect(() => parseExpansionsFromCardsDb('const nothing = 1')).toThrow(CardsDbParseError)
    expect(() => parseExpansionsFromCardsDb('export const expansions = [\n  { id: 1 },\n]\n')).toThrow()
    const duplicated =
      "export const expansions = [\n  { name: 'x', id: 'X1', internalId: 7, packs: [{ name: 'p', color: '' }], tradeable: true, openable: true },\n  { name: 'y', id: 'X1', internalId: 8, packs: [{ name: 'p', color: '' }], tradeable: true, openable: true },\n]\n"
    expect(() => parseExpansionsFromCardsDb(duplicated)).toThrow(/duplicate id X1/)
  })
})

describe('parseCraftingCostFromCardsDb', () => {
  it('returns the pack-point cost per rarity, without ✵ rarities', () => {
    const cost = parseCraftingCostFromCardsDb(loadFixtures().cardsDbSource)
    expect(cost).toEqual({
      '◊': 35,
      '◊◊': 70,
      '◊◊◊': 150,
      '◊◊◊◊': 500,
      '☆': 400,
      '☆☆': 1250,
      '☆☆☆': 1500,
      'Crown Rare': 2500,
    })
    expect(cost['✵']).toBeUndefined()
    expect(cost['✵✵']).toBeUndefined()
    expect(cost.P).toBeUndefined()
  })

  it('rejects unknown rarities', () => {
    expect(() => parseCraftingCostFromCardsDb("export const craftingCost = {\n  '???': 1,\n}\n")).toThrow()
  })
})

describe('parseExpansionIds', () => {
  it('returns the 24 ids of types/index.ts, newest first and promos last', () => {
    const ids = parseExpansionIds(loadFixtures().typesIndexSource)
    expect(ids).toHaveLength(24)
    expect(ids[0]).toBe('B4b')
    expect(ids.slice(-2)).toEqual(['P-B', 'P-A'])
    expect(new Set(ids)).toEqual(new Set(parseExpansionsFromCardsDb(loadFixtures().cardsDbSource).map((e) => e.id)))
  })

  it('fails when the declaration is missing', () => {
    expect(() => parseExpansionIds('export const other = [] as const')).toThrow(CardsDbParseError)
  })
})
