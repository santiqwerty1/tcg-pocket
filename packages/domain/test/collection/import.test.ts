import { describe, expect, it } from 'vitest'
import {
  applyImport,
  type CollectionAdjustment,
  diffImport,
  manualEdit,
  normalizeImportRows,
  parseTrackerCsv,
  type StockQuantities,
  writeTrackerCsv,
} from '../../src/collection/index.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const stock = (): StockQuantities => realCsvNormalized().units

describe('diffImport', () => {
  it('importing the CSV into an empty collection creates one change per unit with copies or collected', () => {
    const diff = diffImport(index, {}, stock())
    const meaningful = Object.values(stock()).filter((unit) => unit.amountOwned > 0 || unit.collected)
    expect(meaningful.length).toBeGreaterThan(0)
    expect(diff.changes).toHaveLength(meaningful.length)
    expect(diff.summary).toEqual({
      unitsChanged: meaningful.length,
      copiesDelta: 4714,
      newUnits: meaningful.length,
      zeroedUnits: 0,
      collectedChanged: 2083,
    })
    expect(diff.changes.every((change) => change.before === null)).toBe(true)
    expect(diff.changes[0]).toEqual({
      stockCardId: 'A1-1',
      cardIds: ['A1-1', 'A4b-1'],
      before: null,
      after: { amountOwned: 2, collected: true },
    })
    expect(diff.changes.find((change) => change.stockCardId === 'B1a-28')?.after).toEqual({
      amountOwned: 0,
      collected: true,
    })
    expect(diff.adjustmentsMatching).toEqual([])
    expect(diff.adjustmentsHidingChange).toEqual([])
  })

  it('re-importing the same CSV yields an empty diff', () => {
    const diff = diffImport(index, stock(), stock())
    expect(diff.changes).toEqual([])
    expect(diff.summary).toEqual({ unitsChanged: 0, copiesDelta: 0, newUnits: 0, zeroedUnits: 0, collectedChanged: 0 })
  })

  it('describes each kind of change and leaves units absent from the import alone', () => {
    const current = stock()
    const incoming: StockQuantities = {
      'A1-1': { stockCardId: 'A1-1', amountOwned: 0, collected: true },
      'A4a-36': { stockCardId: 'A4a-36', amountOwned: 3, collected: true },
      'B1a-28': { stockCardId: 'B1a-28', amountOwned: 0, collected: false },
      'A1-4': { stockCardId: 'A1-4', amountOwned: 0, collected: false },
    }
    const diff = diffImport(index, current, incoming)
    expect(diff.changes.map((change) => change.stockCardId)).toEqual(['A1-1', 'A4a-36', 'B1a-28'])
    expect(diff.changes[0]).toEqual({
      stockCardId: 'A1-1',
      cardIds: ['A1-1', 'A4b-1'],
      before: { amountOwned: 2, collected: true },
      after: { amountOwned: 0, collected: true },
    })
    expect(diff.summary).toEqual({ unitsChanged: 3, copiesDelta: -1, newUnits: 0, zeroedUnits: 1, collectedChanged: 1 })
    const merged = applyImport(current, incoming)
    expect(Object.keys(merged)).toHaveLength(3866)
    expect(merged['A1-1']).toEqual(incoming['A1-1'])
    expect(merged['A4a-36']).toEqual(incoming['A4a-36'])
    expect(merged['B2-113']).toEqual(current['B2-113'])
    expect(current['A1-1']?.amountOwned).toBe(2)
    expect(merged['A1-1']).not.toBe(incoming['A1-1'])
  })

  it('orders changes by catalog stock order, unknown units last', () => {
    const incoming: StockQuantities = {
      'ZZ-1': { stockCardId: 'ZZ-1', amountOwned: 1, collected: true },
      'B4b-372': { stockCardId: 'B4b-372', amountOwned: 5, collected: true },
      'A1-1': { stockCardId: 'A1-1', amountOwned: 5, collected: true },
    }
    const diff = diffImport(index, stock(), incoming)
    expect(diff.changes.map((change) => change.stockCardId)).toEqual(['A1-1', 'B4b-372', 'ZZ-1'])
    expect(diff.changes[2]?.cardIds).toEqual(['ZZ-1'])
  })

  it('carries the adjustment warnings of rules (a) and (b)', () => {
    const latias2: CollectionAdjustment = {
      id: 'latias-2',
      functionalGroupId: 'A4a-36',
      playableCopies: 2,
      reason: 'test',
      active: true,
      createdAt: '2026-10-06T00:00:00.000Z',
      resolvedAt: null,
      resolution: null,
    }
    const latios1 = { ...latias2, id: 'latios-1', functionalGroupId: 'A4a-37', playableCopies: 1 }
    const older = manualEdit(index, manualEdit(index, stock(), 'A4a-36', { amountOwned: 3 }).stock, 'A4a-37', {
      amountOwned: 3,
    }).stock
    const diff = diffImport(index, older, stock(), [latias2, latios1])
    expect(diff.adjustmentsMatching.map((m) => [m.adjustmentId, m.stockSum])).toEqual([['latias-2', 2]])
    expect(diff.adjustmentsHidingChange.map((h) => [h.adjustmentId, h.stockBefore, h.stockAfter])).toEqual([
      ['latios-1', 3, 2],
    ])
    expect(diff.summary.copiesDelta).toBe(-2)
  })

  it('import → export → re-import gives an empty diff', () => {
    const exported = writeTrackerCsv(index, stock())
    const again = normalizeImportRows(parseTrackerCsv(exported).rows, index)
    expect(again.conflicts).toEqual([])
    expect(again.unknownIds).toEqual([])
    expect(diffImport(index, stock(), again.units).changes).toEqual([])
    expect(again.units).toEqual(stock())
  })
})

describe('manualEdit', () => {
  it('edits A4b-1 through the stock unit of A1-1 and reports the twin', () => {
    const before = stock()
    const result = manualEdit(index, before, 'A4b-1', { amountOwned: 5 })
    expect(result).toMatchObject({
      stockCardId: 'A1-1',
      cardIds: ['A1-1', 'A4b-1'],
      affectedTwinIds: ['A1-1'],
      before: { stockCardId: 'A1-1', amountOwned: 2, collected: true },
      after: { stockCardId: 'A1-1', amountOwned: 5, collected: true },
    })
    expect(result.stock['A1-1']).toEqual(result.after)
    expect(result.stock['A4b-1']).toBeUndefined()
    const changed = Object.keys(result.stock).filter((id) => result.stock[id] !== before[id])
    expect(changed).toEqual(['A1-1'])
    expect(Object.keys(result.stock)).toHaveLength(3866)
    expect(before['A1-1']?.amountOwned).toBe(2)
    expect(manualEdit(index, before, 'B4b-372', { amountOwned: 1 }).affectedTwinIds).toEqual([])
  })

  it('turns collected on when the amount rises from 0, keeps it when it drops to 0, honours explicit values', () => {
    const base = stock()
    const risen = manualEdit(index, base, 'A1-4', { amountOwned: 1 })
    expect(risen.before).toEqual({ stockCardId: 'A1-4', amountOwned: 0, collected: false })
    expect(risen.after).toEqual({ stockCardId: 'A1-4', amountOwned: 1, collected: true })
    const dropped = manualEdit(index, risen.stock, 'A1-4', { amountOwned: 0 })
    expect(dropped.after).toEqual({ stockCardId: 'A1-4', amountOwned: 0, collected: true })
    const unflagged = manualEdit(index, risen.stock, 'A1-4', { amountOwned: 0, collected: false })
    expect(unflagged.after).toEqual({ stockCardId: 'A1-4', amountOwned: 0, collected: false })
    const explicitOff = manualEdit(index, base, 'A1-4', { amountOwned: 2, collected: false })
    expect(explicitOff.after).toEqual({ stockCardId: 'A1-4', amountOwned: 2, collected: false })
    const flagOnly = manualEdit(index, base, 'A1-4', { collected: true })
    expect(flagOnly.after).toEqual({ stockCardId: 'A1-4', amountOwned: 0, collected: true })
    const noop = manualEdit(index, base, 'A1-1', {})
    expect(noop.after).toEqual(base['A1-1'])
    const fresh = manualEdit(index, {}, 'A4b-1', { amountOwned: 1 })
    expect(fresh.before).toBeNull()
    expect(fresh.stock).toEqual({ 'A1-1': { stockCardId: 'A1-1', amountOwned: 1, collected: true } })
  })

  it('throws on unknown cards and invalid amounts', () => {
    expect(() => manualEdit(index, stock(), 'nope', { amountOwned: 1 })).toThrow(/Unknown card id: nope/)
    expect(() => manualEdit(index, stock(), 'A1-1', { amountOwned: -1 })).toThrow(RangeError)
    expect(() => manualEdit(index, stock(), 'A1-1', { amountOwned: 1.5 })).toThrow(RangeError)
  })
})
