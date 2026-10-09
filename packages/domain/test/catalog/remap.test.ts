import { describe, expect, it } from 'vitest'
import { type OwnerRefs, planCatalogRemap } from '../../src/catalog/remap.js'
import type { CardId, Catalog } from '../../src/catalog/types.js'
import { builtCatalog } from '../helpers/loadFixtures.js'

const prev = builtCatalog().catalog
const card = (catalog: Catalog, id: CardId) => {
  const found = catalog.cards.find((c) => c.id === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const empty: OwnerRefs = { stock: [], adjustments: [], deckCards: [], keyCards: [], eventBans: [] }
const stockRow = (cardId: CardId, amountOwned: number, collected = true) => ({
  cardId,
  amountOwned,
  collected,
  source: 'import',
  importId: 1,
})

/** A group with two stock units (two arts with different internal ids). */
const twoUnits = prev.groups.find((group) => new Set(group.cardIds.map((id) => card(prev, id).stockCardId)).size >= 2)
if (!twoUnits) throw new Error('no group with two stock units')
const [unitA, unitB] = [...new Set(twoUnits.cardIds.map((id) => card(prev, id).stockCardId))] as [CardId, CardId]
/** A stock unit with two editions (linked reprints sharing an internal id). */
const twins = prev.stockUnits.find((unit) => unit.cardIds.length >= 2)
if (!twins) throw new Error('no twin stock unit')
/** Two groups with the same name and different text (Riolu A2-91 / B3-79). */
const riolus = prev.groups.filter((group) => group.nameEn === 'Riolu')

describe('catalog remap (I12, Fase 21)', () => {
  it('an unchanged catalog changes nothing', () => {
    const remap = planCatalogRemap(prev, prev, {
      ...empty,
      stock: [stockRow(unitA, 2), stockRow(unitB, 1)],
      adjustments: [{ id: 1, groupId: twoUnits.id, active: true, createdAt: new Date() }],
      deckCards: [{ deckId: 1, cardId: twoUnits.displayCardId, count: 2, position: 0 }],
      keyCards: [{ deckId: 1, items: [{ functionalGroupId: twoUnits.id, role: 'attacker' }] }],
      eventBans: [{ eventId: 1, banned: [twoUnits.id] }],
    })
    expect(remap).toMatchObject({ empty: true, needsReview: false, notes: [] })
  })

  it('two stock units merged: equal values pass quietly; different ones keep the larger amount for review', () => {
    const next = structuredClone(prev)
    for (const c of next.cards) if (c.stockCardId === unitB) c.stockCardId = unitA
    const same = planCatalogRemap(prev, next, { ...empty, stock: [stockRow(unitA, 2), stockRow(unitB, 2)] })
    expect(same.stock).toEqual({ delete: [unitB], upsert: [] })
    expect(same.needsReview).toBe(false)
    const differ = planCatalogRemap(prev, next, {
      ...empty,
      stock: [stockRow(unitA, 1, false), stockRow(unitB, 3, true)],
    })
    expect(differ.stock).toEqual({ delete: [unitB], upsert: [{ ...stockRow(unitA, 3, true) }] })
    expect(differ.notes).toEqual([expect.objectContaining({ kind: 'stock_merge', review: true })])
    expect(differ.needsReview).toBe(true)
  })

  it('a stock unit split in two: both keep the value, for review', () => {
    const next = structuredClone(prev)
    const second = twins.cardIds[1] as CardId
    card(next, second).stockCardId = second
    const remap = planCatalogRemap(prev, next, { ...empty, stock: [stockRow(twins.id, 2)] })
    expect(remap.stock).toEqual({ delete: [], upsert: [stockRow(second, 2)] })
    expect(remap.notes.map((note) => note.kind)).toEqual(['stock_split'])
    expect(remap.needsReview).toBe(true)
  })

  it('groups merged: adjustments, key cards and bans follow; two active adjustments keep the newest', () => {
    expect(riolus.length).toBeGreaterThanOrEqual(2)
    const [keep, gone] = riolus as [(typeof riolus)[0], (typeof riolus)[0]]
    const next = structuredClone(prev)
    for (const c of next.cards) if (c.functionalGroupId === gone.id) c.functionalGroupId = keep.id
    next.groups = next.groups.filter((group) => group.id !== gone.id)
    const older = new Date('2026-10-01T00:00:00Z')
    const newer = new Date('2026-10-05T00:00:00Z')
    const remap = planCatalogRemap(prev, next, {
      ...empty,
      adjustments: [
        { id: 1, groupId: keep.id, active: true, createdAt: older },
        { id: 2, groupId: gone.id, active: true, createdAt: newer },
        { id: 3, groupId: gone.id, active: false, createdAt: older },
      ],
      keyCards: [
        {
          deckId: 7,
          items: [
            { functionalGroupId: gone.id, role: 'setup' },
            { functionalGroupId: keep.id, role: 'setup' },
          ],
        },
      ],
      eventBans: [{ eventId: 4, banned: [gone.id] }],
    })
    expect(remap.adjustments).toEqual({
      move: [
        { id: 2, groupId: keep.id },
        { id: 3, groupId: keep.id },
      ],
      resolve: [1],
      delete: [],
    })
    expect(remap.keyCards).toEqual([{ deckId: 7, items: [{ functionalGroupId: keep.id, role: 'setup' }] }])
    expect(remap.eventBans).toEqual([{ eventId: 4, banned: [keep.id] }])
    expect(remap.notes.map((note) => note.kind)).toEqual(['adjustment_merge'])
    expect(remap.needsReview).toBe(true)
  })

  it('a deck card that left the catalog: another edition of its group, or out of the deck', () => {
    const multi = prev.groups.find((group) => group.cardIds.length >= 2 && group.displayCardId !== group.cardIds.at(-1))
    const single = prev.groups.find((group) => group.cardIds.length === 1 && group.cardType === 'pokemon')
    if (!multi || !single) throw new Error('fixtures')
    const leaving = multi.cardIds.find((id) => id !== multi.displayCardId) as CardId
    const lone = single.cardIds[0] as CardId
    const next = structuredClone(prev)
    next.cards = next.cards.filter((c) => c.id !== leaving && c.id !== lone)
    next.groups = next.groups
      .filter((group) => group.id !== single.id)
      .map((group) =>
        group.id === multi.id ? { ...group, cardIds: group.cardIds.filter((id) => id !== leaving) } : group,
      )
    const remap = planCatalogRemap(prev, next, {
      ...empty,
      stock: [stockRow(card(prev, lone).stockCardId, 1)],
      adjustments: [{ id: 9, groupId: single.id, active: true, createdAt: new Date() }],
      deckCards: [
        { deckId: 3, cardId: leaving, count: 1, position: 4 },
        { deckId: 3, cardId: lone, count: 2, position: 5 },
      ],
    })
    expect(remap.deckCards).toEqual([
      { deckId: 3, from: leaving, to: multi.displayCardId, count: 1, position: 4 },
      { deckId: 3, from: lone, to: null, count: 2, position: 5 },
    ])
    expect(remap.stock.delete).toEqual([card(prev, lone).stockCardId])
    expect(remap.adjustments.delete).toEqual([9])
    expect(remap.notes.map((note) => [note.kind, note.review])).toEqual([
      ['stock_removed', true],
      ['adjustment_removed', true],
      ['deck_card_replaced', false],
      ['deck_card_removed', true],
    ])
    expect(remap.notes[2]?.text).toMatch(/^Mazo 3: .+ dejó el catálogo; ahora juega /)
  })
})
