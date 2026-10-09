import { describe, expect, it } from 'vitest'
import { buildCatalog, buildCatalogWithReport, type CardEdition, CatalogBuildError } from '../../src/index.js'
import { buildInput, builtCatalog, TRACKER_COMMIT } from '../helpers/loadFixtures.js'

const { catalog, report } = builtCatalog()
const cardById = new Map(catalog.cards.map((card) => [card.id, card]))
const groupById = new Map(catalog.groups.map((group) => [group.id, group]))
const card = (id: string): CardEdition => {
  const found = cardById.get(id)
  if (!found) throw new Error(`missing card ${id}`)
  return found
}
const groupOf = (id: string) => {
  const group = groupById.get(card(id).functionalGroupId)
  if (!group) throw new Error(`missing group of ${id}`)
  return group
}

describe('buildCatalog: cards and expansions', () => {
  it('has 4,317 cards in cards.json order with 24 expansions, promos last', () => {
    expect(catalog.cards).toHaveLength(4317)
    expect(report.counts.cards).toBe(4317)
    expect(catalog.cards[0]?.id).toBe('A1-1')
    expect(catalog.cards.at(-1)?.id).toBe('P-B-103')
    expect(catalog.expansions).toHaveLength(24)
    expect(catalog.expansions.map((e) => e.id)).toEqual([
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
    expect(catalog.expansions.map((e) => e.sortOrder)).toEqual(catalog.expansions.map((_, i) => i))
    expect(catalog.trackerCommit).toBe(TRACKER_COMMIT)
    expect(report.warnings).toEqual([])
  })

  it('maps expansion metadata from CardsDB.ts and the locale files', () => {
    const a4b = catalog.expansions.find((e) => e.id === 'A4b')
    expect(a4b).toMatchObject({
      trackerInternalId: 11,
      slug: 'deluxepackex',
      nameEn: 'Deluxe Pack: ex',
      nameEs: 'Sobre Deluxe ex',
      isPromo: false,
      tradeable: true,
      openableTracker: false,
      packStructure: { cardsPerPack: 4, containsLinkedCards: true, containsShinies: true, containsBabies: false },
      packIds: ['A4b/deluxepack'],
    })
    expect(catalog.expansions.find((e) => e.id === 'B4b')?.trackerInternalId).toBe(22)
    expect(catalog.expansions.find((e) => e.id === 'A1')).toMatchObject({
      nameEn: 'Genetic Apex',
      nameEs: 'Genes Formidables',
      sortOrder: 0,
    })
    expect(catalog.expansions.find((e) => e.id === 'P-A')).toMatchObject({
      trackerInternalId: 192,
      isPromo: true,
      packStructure: null,
      sortOrder: 22,
    })
    expect(catalog.expansions.find((e) => e.id === 'P-B')).toMatchObject({
      trackerInternalId: 193,
      isPromo: true,
      packStructure: null,
      sortOrder: 23,
    })
  })

  it('H-008: a pack size without known rates leaves the expansion out of the pack math, with a warning', () => {
    const input = buildInput()
    const source = input.cardsDbSource.replace('cardsPerPack: 5,', 'cardsPerPack: 6,')
    expect(source).not.toBe(input.cardsDbSource)
    const result = buildCatalogWithReport({ ...input, cardsDbSource: source })
    const changed = result.catalog.expansions.filter(
      (expansion) => expansion.packStructure === null && !expansion.isPromo,
    )
    expect(changed).toHaveLength(1)
    expect(result.report.warnings.some((w) => /packs of 6 cards have no known rates/.test(w))).toBe(true)
    expect(result.catalog.cards).toHaveLength(builtCatalog().catalog.cards.length)
  })

  it('keeps the crafting cost', () => {
    expect(catalog.craftingCost).toEqual({
      '◊': 35,
      '◊◊': 70,
      '◊◊◊': 150,
      '◊◊◊◊': 500,
      '☆': 400,
      '☆☆': 1250,
      '☆☆☆': 1500,
      'Crown Rare': 2500,
    })
  })

  it('fills the edition fields', () => {
    expect(card('A1-1')).toMatchObject({
      expansionId: 'A1',
      number: 1,
      internalId: 65600,
      nameEn: 'Bulbasaur',
      nameEs: 'Bulbasaur',
      nameEsSource: 'tracker',
      hp: 70,
      energy: 'grass',
      cardType: 'pokemon',
      evolutionType: 'basic',
      evolvesFrom: null,
      isFossil: false,
      ex: false,
      prizePoints: 1,
      rarity: '◊',
      pack: 'mewtwopack',
      artist: 'Narumi Sato',
      weakness: 'fire',
      retreat: 1,
      engineId: 'A1 001',
      // Fase 22: A1-1 has a Spanish image in the tracker's manifest.
      imageUrl: `https://raw.githubusercontent.com/marcelpanse/tcg-pocket-collection-tracker/${TRACKER_COMMIT}/frontend/public/images/es-ES/A1-1.webp`,
      alternateVersionsRaw: [65600, 80068, 406664, 721024, 12584400],
    })
    expect(card('A1-1').attacks).toEqual([
      { cost: ['grass', 'colorless'], name: 'Vine Whip', damage: '40', effect: null },
    ])
    expect(card('A1-2')).toMatchObject({ evolutionType: 'stage1', evolvesFrom: 'Bulbasaur' })
    expect(card('B1-225')).toMatchObject({
      cardType: 'trainer',
      evolutionType: 'supporter',
      energy: 'trainer',
      hp: null,
      weakness: null,
      retreat: null,
      prizePoints: 0,
      nameEs: 'Copiona',
    })
    expect(card('B1-225').ability).toEqual({
      name: '',
      effect: "Shuffle your hand into your deck. Draw a card for each card in your opponent's hand.",
    })
    expect(card('A1-218')).toMatchObject({ isFossil: true, hp: 40, nameEs: 'Ámbar Viejo' })
  })

  it('counts 762 ex cards, 156 Mega ex with 3 prize points, 395 trainers and 14 fossils', () => {
    expect(catalog.cards.filter((c) => c.ex)).toHaveLength(762)
    expect(catalog.cards.filter((c) => c.prizePoints === 3)).toHaveLength(156)
    expect(catalog.cards.filter((c) => c.prizePoints === 3).every((c) => c.ex && c.nameEn.startsWith('Mega '))).toBe(
      true,
    )
    expect(catalog.cards.filter((c) => c.prizePoints === 2)).toHaveLength(762 - 156)
    expect(catalog.cards.filter((c) => c.cardType === 'trainer')).toHaveLength(395)
    expect(catalog.cards.filter((c) => c.cardType === 'trainer').every((c) => c.prizePoints === 0)).toBe(true)
    expect(catalog.cards.filter((c) => c.isFossil)).toHaveLength(14)
    expect(
      catalog.cards.filter((c) => c.isFossil).every((c) => c.cardType === 'trainer' && c.evolutionType === 'item'),
    ).toBe(true)
    expect(report.counts).toMatchObject({ ex: 762, trainers: 395, pokemon: 3922, fossils: 14 })
  })

  it('has evolvesFrom for every stage1/stage2 and null for every basic and trainer', () => {
    const evolved = catalog.cards.filter((c) => c.evolutionType === 'stage1' || c.evolutionType === 'stage2')
    expect(evolved.length).toBe(1285 + 480)
    expect(evolved.every((c) => typeof c.evolvesFrom === 'string' && c.evolvesFrom.length > 0)).toBe(true)
    expect(catalog.cards.filter((c) => c.evolutionType === 'basic').every((c) => c.evolvesFrom === null)).toBe(true)
    expect(catalog.cards.filter((c) => c.cardType === 'trainer').every((c) => c.evolvesFrom === null)).toBe(true)
  })
})

describe('buildCatalog: stock units', () => {
  it('has 3,866 stock units, 450 of them with 2+ editions (449 pairs and the Old Amber trio)', () => {
    expect(catalog.stockUnits).toHaveLength(3866)
    expect(report.counts.stockUnits).toBe(3866)
    const linked = catalog.stockUnits.filter((s) => s.cardIds.length > 1)
    expect(linked).toHaveLength(450)
    expect(report.counts.linkedStockUnits).toBe(450)
    expect(linked.filter((s) => s.cardIds.length === 2)).toHaveLength(449)
    const trio = linked.filter((s) => s.cardIds.length === 3)
    expect(trio).toHaveLength(1)
    expect(trio[0]).toMatchObject({ id: 'A1-218', cardIds: ['A1-218', 'A1a-63', 'A4b-312'] })
    expect(new Set(catalog.stockUnits.map((s) => s.internalId)).size).toBe(3866)
  })

  it('assigns the earliest edition as stock id', () => {
    expect(card('A4b-1').stockCardId).toBe('A1-1')
    expect(card('A1-1').stockCardId).toBe('A1-1')
    expect(card('B4b-206').stockCardId).toBe('B3b-64')
    expect(card('B4b-372').stockCardId).toBe('B4b-372')
    expect(card('A1a-63').stockCardId).toBe('A1-218')
    for (const stock of catalog.stockUnits) {
      expect(stock.cardIds[0]).toBe(stock.id)
      for (const id of stock.cardIds) {
        expect(card(id).stockCardId).toBe(stock.id)
        expect(card(id).internalId).toBe(stock.internalId)
        expect(card(id).functionalGroupId).toBe(stock.functionalGroupId)
      }
    }
  })
})

describe('buildCatalog: functional groups', () => {
  it('has 2,319 groups whose ids are their earliest edition', () => {
    expect(catalog.groups).toHaveLength(2319)
    expect(report.counts.groups).toBe(2319)
    expect(catalog.groups.reduce((n, g) => n + g.cardIds.length, 0)).toBe(4317)
    for (const group of catalog.groups) {
      expect(group.cardIds[0]).toBe(group.id)
      expect(group.cardIds.includes(group.displayCardId)).toBe(true)
      expect(card(group.displayCardId).internalId).toBe(card(group.id).alternateVersionsRaw[0])
      expect(group.cardIds.filter((id) => card(id).isDisplayEdition)).toEqual([group.displayCardId])
      for (const id of group.cardIds) expect(card(id).functionalGroupId).toBe(group.id)
    }
  })

  it('groups Bulbasaur A1-1 with its reprints and Copycat with its five editions', () => {
    expect(groupOf('A1-1')).toMatchObject({
      id: 'A1-1',
      displayCardId: 'A1-1',
      cardIds: ['A1-1', 'A1-227', 'A3-210', 'A4b-1', 'A4b-2', 'P-A-23'],
    })
    expect(groupOf('A1-1').stockCardIds).toEqual(['A1-1', 'A1-227', 'A3-210', 'A4b-2', 'P-A-23'])
    expect(groupOf('B1-225').cardIds).toEqual(['B1-225', 'B1-270', 'B4b-225', 'B4b-391', 'B4b-424'])
    expect(groupOf('B4b-391').id).toBe('B1-225')
    expect(groupOf('A1-218').cardIds).toEqual(['A1-218', 'A1a-63', 'A4b-312', 'A4b-313'])
  })

  it('respects the three deck-building overrides of the tracker in displayCardId', () => {
    expect(groupOf('A1a-31')).toMatchObject({ id: 'A1-283', displayCardId: 'A1a-31', nameEn: 'Mew' })
    expect(groupOf('P-A-5')).toMatchObject({ displayCardId: 'P-A-5', nameEn: 'Poké Ball' })
    expect(groupOf('P-A-7')).toMatchObject({ displayCardId: 'P-A-7', nameEn: "Professor's Research" })
    expect(groupOf('P-A-5').id).not.toBe('P-A-5')
    expect(groupOf('P-A-7').id).not.toBe('P-A-7')
    expect(
      catalog.groups
        .filter((g) => g.displayCardId !== g.id)
        .map((g) => g.displayCardId)
        .sort(),
    ).toEqual(['A1a-31', 'P-A-5', 'P-A-7'])
  })

  it('has a single English name and a single rules hash per group', () => {
    expect(report.groupsWithMixedNames).toEqual([])
    expect(report.groupsWithMixedRules).toEqual([])
    for (const group of catalog.groups) {
      expect(new Set(group.cardIds.map((id) => card(id).nameEn)).size).toBe(1)
      expect(group.nameEn).toBe(card(group.id).nameEn)
      expect(group.nameEs).toBe(card(group.id).nameEs)
      expect(group.rulesHash).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('555 English names map to more than one group, each with different rules (Riolu A2-91 vs B3-79)', () => {
    const groupsByName = new Map<string, typeof catalog.groups>()
    for (const group of catalog.groups)
      groupsByName.set(group.nameEn, [...(groupsByName.get(group.nameEn) ?? []), group])
    const multi = [...groupsByName.values()].filter((groups) => groups.length > 1)
    expect(multi).toHaveLength(555)
    expect(multi.every((groups) => new Set(groups.map((g) => g.rulesHash)).size === groups.length)).toBe(true)
    expect(groupOf('A2-91').id).not.toBe(groupOf('B3-79').id)
    expect(groupOf('A2-91').nameEn).toBe('Riolu')
    expect(groupOf('B3-79').cardIds).toContain('B4b-126')
  })
})

describe('buildCatalog: packs', () => {
  it('creates one pack per declared pack with own cards plus everypack cards', () => {
    const mewtwo = catalog.packs.find((p) => p.id === 'A1/mewtwopack')
    expect(mewtwo).toMatchObject({ expansionId: 'A1', name: 'mewtwopack', nameEs: 'Mewtwo', color: '#c078bc' })
    expect(mewtwo?.cardIds).toHaveLength(126)
    expect(mewtwo?.cardIds.filter((id) => card(id).pack === 'mewtwopack')).toHaveLength(79)
    expect(mewtwo?.cardIds.filter((id) => card(id).pack === 'everypack')).toHaveLength(47)
    expect(catalog.packs.find((p) => p.id === 'A1/everypack')?.cardIds).toHaveLength(47)
    expect(catalog.expansions.find((e) => e.id === 'A1')?.packIds).toEqual([
      'A1/mewtwopack',
      'A1/charizardpack',
      'A1/pikachupack',
      'A1/everypack',
    ])
  })

  it('gives single-pack expansions whose cards are all everypack their declared pack with every card', () => {
    const a2b = catalog.packs.filter((p) => p.expansionId === 'A2b')
    expect(a2b).toHaveLength(1)
    expect(a2b[0]).toMatchObject({ id: 'A2b/shiningrevelrypack', nameEs: 'Festival Brillante' })
    expect(a2b[0]?.cardIds).toHaveLength(111)
    expect(catalog.cards.filter((c) => c.expansionId === 'A2b').every((c) => c.pack === 'everypack')).toBe(true)
    const b4b = catalog.packs.filter((p) => p.expansionId === 'B4b')
    expect(b4b.map((p) => p.cardIds.length)).toEqual([429])
    expect(catalog.packs.find((p) => p.id === 'P-A/everypack')?.cardIds).toHaveLength(117)
    expect(report.counts.packs).toBe(catalog.packs.length)
    for (const pack of catalog.packs)
      expect(catalog.expansions.find((e) => e.id === pack.expansionId)?.packIds).toContain(pack.id)
  })
})

describe('buildCatalog: contract and performance', () => {
  it('builds in under 2 seconds', () => {
    const start = performance.now()
    const built = buildCatalog(buildInput())
    expect(performance.now() - start).toBeLessThan(2000)
    expect(built.cards).toHaveLength(4317)
  })

  it('is deterministic', () => {
    const again = buildCatalogWithReport(buildInput())
    expect(again.catalog).toEqual(catalog)
    expect(again.report).toEqual(report)
  })

  it('falls back to slugs without en-US locale files and rejects invalid input', () => {
    const input = buildInput()
    const { enSets: _enSets, enPacks: _enPacks, ...withoutEnglish } = input
    const built = buildCatalog(withoutEnglish)
    expect(built.expansions.find((e) => e.id === 'A1')).toMatchObject({
      nameEn: 'geneticapex',
      nameEs: 'Genes Formidables',
    })
    expect(() => buildCatalog({ ...input, trackerCommit: '' })).toThrow(CatalogBuildError)
    expect(() => buildCatalog({ ...input, cardsJson: [{ card_id: 'A1-1' }] })).toThrow()
    expect(() => buildCatalog({ ...input, cardsDbSource: 'nothing here' })).toThrow()
  })
})
