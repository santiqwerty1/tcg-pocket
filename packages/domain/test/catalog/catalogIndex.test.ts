import { describe, expect, it } from 'vitest'
import { builtCatalog, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const { catalog } = builtCatalog()

describe('CatalogIndex lookups', () => {
  it('resolves cards by id, internal id and engine id', () => {
    expect(index.cardById('A1-1')?.nameEn).toBe('Bulbasaur')
    expect(index.cardById('nope')).toBeUndefined()
    expect(index.cardsByInternalId(65600).map((c) => c.id)).toEqual(['A1-1', 'A4b-1'])
    expect(index.cardsByInternalId(79488).map((c) => c.id)).toEqual(['A1-218', 'A1a-63', 'A4b-312'])
    expect(index.cardsByInternalId(-1)).toEqual([])
    expect(index.cardByEngineId('P-A 022')?.id).toBe('P-A-22')
    expect(index.cardByEngineId('A1 001')?.id).toBe('A1-1')
  })

  it('resolves groups, stock units, expansions and packs', () => {
    expect(index.groupById('A1-1')?.cardIds).toContain('P-A-23')
    expect(index.groupOfCard('A4b-2')?.id).toBe('A1-1')
    expect(index.groupOfCard('nope')).toBeUndefined()
    expect(index.cardsOfGroup('B1-225').map((c) => c.id)).toEqual(['B1-225', 'B1-270', 'B4b-225', 'B4b-391', 'B4b-424'])
    expect(index.groupsByNameEn('Riolu')).toHaveLength(3)
    expect(index.groupsByNameEn('Eevee')).toHaveLength(12)
    expect(index.stockOfCard('A4b-1')).toMatchObject({ id: 'A1-1', internalId: 65600, cardIds: ['A1-1', 'A4b-1'] })
    expect(index.stockById('B4b-372')?.cardIds).toEqual(['B4b-372'])
    expect(index.expansionById('A4b')?.trackerInternalId).toBe(11)
    expect(index.cardsOfExpansion('A4b')).toHaveLength(379)
    expect(index.packById('A1/mewtwopack')?.cardIds).toHaveLength(126)
    expect(index.packsOfExpansion('A1').map((p) => p.name)).toEqual([
      'mewtwopack',
      'charizardpack',
      'pikachupack',
      'everypack',
    ])
    expect(index.catalog).toBe(catalog)
  })
})

describe('CatalogIndex.search', () => {
  it('finds the same group through the Spanish and the English name', () => {
    const es = index.search('Copiona')
    const en = index.search('Copycat')
    expect(es.length).toBeGreaterThan(0)
    expect(new Set(es.map((h) => h.card.functionalGroupId))).toEqual(new Set(['B1-225']))
    expect(new Set(en.map((h) => h.card.functionalGroupId))).toEqual(new Set(['B1-225']))
    expect(es.map((h) => h.card.id)).toEqual(en.map((h) => h.card.id))
    expect(es[0]?.matchedOn).toBe('name_exact')
  })

  it('is accent- and case-insensitive and finds Iono by her Spanish name e-Nigma', () => {
    expect(index.search('e-Nigma').map((h) => h.card.id)).toContain('B2a-89')
    expect(index.search('E-NIGMA')[0]?.matchedOn).toBe('name_exact')
    expect(index.search('ambar viejo').map((h) => h.card.id)).toContain('A1-218')
    expect(index.search('Ámbar Viejo')[0]?.matchedOn).toBe('name_exact')
    expect(index.search('codigo cero').map((h) => h.card.nameEn)).toContain('Type: Null')
  })

  it('matches by card id and engine id first', () => {
    expect(index.search('a1-1')[0]).toMatchObject({ matchedOn: 'id', card: { id: 'A1-1' } })
    expect(index.search('P-A 022')[0]?.card.id).toBe('P-A-22')
  })

  it('ranks exact names first and keeps editions of a group together', () => {
    const hits = index.search('Mew')
    expect(hits[0]?.card.nameEn).toBe('Mew')
    const firstGroup = hits[0]?.card.functionalGroupId
    const sameGroup = hits.filter((h) => h.card.functionalGroupId === firstGroup)
    expect(hits.slice(0, sameGroup.length).every((h) => h.card.functionalGroupId === firstGroup)).toBe(true)
    expect(hits.some((h) => h.card.nameEn === 'Mewtwo')).toBe(true)
    expect(hits.findIndex((h) => h.card.nameEn === 'Mewtwo')).toBeGreaterThan(
      hits.findIndex((h) => h.card.nameEn === 'Mew ex'),
    )
  })

  it('matches rules text, honours lang and limit, and ignores empty queries', () => {
    const byText = index.search('Draw a card for each card in your opponent')
    expect(byText.map((h) => h.card.functionalGroupId)).toContain('B1-225')
    expect(byText.every((h) => h.matchedOn === 'text')).toBe(true)
    // `lang` restricts name matching; the folded searchText still carries both names, so the other language
    // is reachable only as a low-ranked text match.
    expect(index.search('Copiona', { lang: 'en' }).every((h) => h.matchedOn === 'text')).toBe(true)
    expect(index.search('Copiona', { lang: 'en' })).toHaveLength(5)
    expect(index.search('Copycat', { lang: 'es' }).every((h) => h.matchedOn === 'text')).toBe(true)
    expect(index.search('Copiona', { lang: 'es' })).toHaveLength(5)
    expect(index.search('Copiona', { lang: 'es' }).every((h) => h.matchedOn === 'name_exact')).toBe(true)
    expect(index.search('Pikachu', { limit: 3 })).toHaveLength(3)
    expect(index.search('   ')).toEqual([])
  })

  it('searchGroups folds hits by functional group', () => {
    const groups = index.searchGroups('Riolu', { lang: 'en' })
    expect(groups.map((g) => g.group.id)).toEqual(['A2-91', 'A2b-42', 'B3-79'])
    expect(groups.every((g) => g.group.nameEn === 'Riolu')).toBe(true)
    expect(groups.find((g) => g.group.id === 'B3-79')?.cards.map((c) => c.id)).toEqual([
      'B3-79',
      'B3-169',
      'B4b-126',
      'B4b-318',
    ])
    expect(index.searchGroups('Copiona')).toHaveLength(1)
    expect(index.searchGroups('Pikachu', { limit: 2 })).toHaveLength(2)
  })
})
