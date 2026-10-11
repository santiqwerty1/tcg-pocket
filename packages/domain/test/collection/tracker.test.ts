import { describe, expect, it } from 'vitest'
import { diffImport, normalizeImportRows, trackerDiffStats, trackerImportRows } from '../../src/collection/index.js'
import fixture from '../fixtures/tracker/public-collection.json'
import { realCsvParsed } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
describe('public tracker snapshot', () => {
  it('maps saved rows, zero-fills missing cards, reports unknowns and never duplicates reprints', () => {
    const normalized = normalizeImportRows(trackerImportRows(fixture, index), index)
    expect(normalized.units['A1-1']).toMatchObject({ amountOwned: 3, collected: true })
    expect(normalized.units['A4b-1']).toBeUndefined()
    expect(normalized.unknownIds).toEqual(['internal_id:2147483647'])
    expect(normalized.dedupTotal).toBe(3)
    expect(Object.keys(normalized.units)).toHaveLength(3866)
    expect(normalized.conflicts).toEqual([])
    expect(normalized.internalIdMismatches).toEqual([])
  })
  it('matches the real 4317-row CSV exactly from its sparse saved internal ids', () => {
    const csv = realCsvParsed()
    expect(csv.rows).toHaveLength(4317)
    const saved = new Map(
      csv.rows.map((row) => [
        row.internalId,
        { internal_id: row.internalId, amount_owned: row.numberOwned, collected: row.collected },
      ]),
    )
    expect(saved.size).toBe(3866)
    const sparse = [...saved.values()].filter((row) => row.amount_owned > 0 || row.collected)
    expect(sparse.length).toBeLessThan(saved.size)
    const api = normalizeImportRows(trackerImportRows(sparse, index), index)
    const file = normalizeImportRows(csv.rows, index)
    expect(api.units).toEqual(file.units)
    expect(api.dedupTotal).toBe(4714)
    expect(api.naiveTotal).toBe(4714)
    expect(file.naiveTotal).toBe(5844)
  })
  it('keeps carddex independent of ownership, treats null as the tracker default, rejects invalid and duplicate rows', () => {
    const rows = trackerImportRows([{ internal_id: 65600, amount_owned: null, collected: true }], index)
    expect(rows[0]).toMatchObject({ numberOwned: 0, collected: true })
    expect(() => trackerImportRows([...fixture, ...fixture], index)).toThrow('duplicado')
    expect(() => trackerImportRows([{ internal_id: 65600, amount_owned: -1, collected: false }], index)).toThrow(
      'inválida',
    )
    expect(() => trackerImportRows([{ internal_id: 65600, amount_owned: 1.5, collected: false }], index)).toThrow(
      'inválida',
    )
  })
  it('zeroes absent units and guards gross losses strictly above 10%, even with larger gains', () => {
    const unit = (stockCardId: string, amountOwned: number) => ({ stockCardId, amountOwned, collected: true })
    const current = { 'A1-1': unit('A1-1', 100), 'A1-2': unit('A1-2', 0) }
    const incoming = { 'A1-1': unit('A1-1', 89), 'A1-2': unit('A1-2', 100) }
    const diff = diffImport(index, current, incoming)
    expect(diff.summary.copiesDelta).toBe(89)
    expect(trackerDiffStats(diff, 100)).toMatchObject({
      removedCopies: 11,
      increased: 1,
      decreased: 1,
      requiresReview: true,
    })
    expect(trackerDiffStats(diffImport(index, current, { 'A1-1': unit('A1-1', 90) }), 100).requiresReview).toBe(false)
    const zeroes = diffImport(index, current, normalizeImportRows(trackerImportRows([], index), index).units)
    expect(zeroes.summary.zeroedUnits).toBe(1)
  })
})
