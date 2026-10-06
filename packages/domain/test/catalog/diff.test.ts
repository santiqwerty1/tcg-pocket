import { describe, expect, it } from 'vitest'
import { type Catalog, diffCatalog, isEmptyDiff } from '../../src/index.js'
import { builtCatalog } from '../helpers/loadFixtures.js'

const { catalog } = builtCatalog()

/** A structural copy with a few cards altered, as a new tracker commit would produce. */
function mutated(): Catalog {
  const cards = catalog.cards.map((card) => ({ ...card }))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const a1 = byId.get('A1-1')
  const iono = byId.get('B2a-89')
  const mew = byId.get('A1a-31')
  if (!a1 || !iono || !mew) throw new Error('fixture cards missing')
  a1.internalId = 65601
  iono.nameEs = 'Iono'
  iono.nameEsSource = 'fallback_en'
  mew.functionalGroupId = 'A1a-31'
  mew.stockCardId = 'A1a-31'
  const removed = new Set(['P-B-103', 'P-B-102'])
  const added = {
    ...a1,
    id: 'B5-1',
    expansionId: 'B5',
    nameEn: 'Future Card',
    nameEs: 'Carta Futura',
    internalId: 99_999_999,
  }
  return {
    ...catalog,
    cards: [...cards.filter((card) => !removed.has(card.id)), added],
    expansions: [
      ...catalog.expansions,
      { ...(catalog.expansions[0] as Catalog['expansions'][number]), id: 'B5', slug: 'b5', sortOrder: 24 },
    ],
  }
}

describe('diffCatalog', () => {
  it('is empty when comparing a catalog with itself', () => {
    const diff = diffCatalog(catalog, catalog)
    expect(diff).toEqual({
      added: [],
      removed: [],
      internalIdChanged: [],
      stockChanged: [],
      groupChanged: [],
      nameChanged: [],
      expansionsAdded: [],
      expansionsRemoved: [],
    })
    expect(isEmptyDiff(diff)).toBe(true)
    expect(isEmptyDiff(diffCatalog(catalog, structuredClone(catalog)))).toBe(true)
  })

  it('reports added and removed cards, changed internal ids, stock, groups and names', () => {
    const diff = diffCatalog(catalog, mutated())
    expect(isEmptyDiff(diff)).toBe(false)
    expect(diff.added).toEqual(['B5-1'])
    expect(diff.removed).toEqual(['P-B-102', 'P-B-103'])
    expect(diff.internalIdChanged).toEqual([{ cardId: 'A1-1', from: 65600, to: 65601 }])
    expect(diff.stockChanged).toEqual(
      [{ cardId: 'A1a-31', from: 'A1a-31', to: 'A1a-31' }].filter((c) => c.from !== c.to),
    )
    expect(diff.groupChanged).toEqual([{ cardId: 'A1a-31', from: 'A1-283', to: 'A1a-31' }])
    expect(diff.nameChanged).toEqual([{ cardId: 'B2a-89', field: 'nameEs', from: 'e-Nigma', to: 'Iono' }])
    expect(diff.expansionsAdded).toEqual(['B5'])
    expect(diff.expansionsRemoved).toEqual([])
  })

  it('is directional', () => {
    const forward = diffCatalog(catalog, mutated())
    const backward = diffCatalog(mutated(), catalog)
    expect(backward.added).toEqual(forward.removed)
    expect(backward.removed).toEqual(forward.added)
    expect(backward.internalIdChanged).toEqual([{ cardId: 'A1-1', from: 65601, to: 65600 }])
    expect(backward.expansionsRemoved).toEqual(['B5'])
  })
})
