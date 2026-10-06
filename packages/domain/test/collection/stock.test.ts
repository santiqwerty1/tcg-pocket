import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv, stockValueOf, totalCopies } from '../../src/collection/index.js'
import { realCsvNormalized, realCsvParsed } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('normalizeImportRows on the real export of 2026-10-06', () => {
  it('matches the verified totals: 0 unknown ids, 451 twin rows, 0 conflicts, 5,844 naive vs 4,714 deduplicated', () => {
    const normalized = realCsvNormalized()
    expect(normalized.unknownIds).toEqual([])
    expect(normalized.internalIdMismatches).toEqual([])
    expect(normalized.twinRows).toBe(451)
    expect(normalized.conflicts).toEqual([])
    expect(normalized.naiveTotal).toBe(5844)
    expect(normalized.dedupTotal).toBe(4714)
    expect(totalCopies(normalized.units)).toBe(4714)
  })

  it('yields 3,866 stock units, 2,083 of them collected, every one in the catalog', () => {
    const units = Object.values(realCsvNormalized().units)
    expect(units).toHaveLength(3866)
    expect(units).toHaveLength(index.catalog.stockUnits.length)
    expect(units.filter((unit) => unit.collected)).toHaveLength(2083)
    expect(units.every((unit) => index.stockById(unit.stockCardId)?.id === unit.stockCardId)).toBe(true)
    expect(units.every((unit) => Number.isInteger(unit.amountOwned) && unit.amountOwned >= 0)).toBe(true)
  })

  it('keeps B1a-28 at 0 copies and collected: the flag does not derive from the amount', () => {
    const { units } = realCsvNormalized()
    expect(units['B1a-28']).toEqual({ stockCardId: 'B1a-28', amountOwned: 0, collected: true })
    expect(stockValueOf(units, 'B1a-28')).toEqual({ amountOwned: 0, collected: true })
    expect(stockValueOf(units, 'nope')).toEqual({ amountOwned: 0, collected: false })
  })

  it('folds twins into the stock unit of the earliest edition', () => {
    const { units } = realCsvNormalized()
    expect(units['A4b-1']).toBeUndefined()
    expect(units['A1-1']).toEqual({ stockCardId: 'A1-1', amountOwned: 2, collected: true })
    expect(units['B4b-157']).toBeUndefined()
    expect(units['B2-113']?.amountOwned).toBe(1)
  })
})

describe('normalizeImportRows validation', () => {
  const header = 'Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected'

  it('reports twins with different values as a conflict naming both card ids (first row wins)', () => {
    const parsed = parseTrackerCsv(
      [header, 'A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE', 'A4b-1,Bulbasaur,65600,3,A4b,everypack,◊,TRUE'].join(
        '\n',
      ),
    )
    const normalized = normalizeImportRows(parsed.rows, index)
    expect(normalized.conflicts).toEqual([
      {
        stockCardId: 'A1-1',
        rows: [
          { cardId: 'A1-1', line: 2, amountOwned: 2, collected: true },
          { cardId: 'A4b-1', line: 3, amountOwned: 3, collected: true },
        ],
      },
    ])
    expect(normalized.twinRows).toBe(1)
    expect(normalized.units['A1-1']?.amountOwned).toBe(2)
    expect(normalized.naiveTotal).toBe(5)
    expect(normalized.dedupTotal).toBe(2)
  })

  it('treats a differing Collected flag as a conflict too, and identical twins as none', () => {
    const differing = parseTrackerCsv(
      [header, 'A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE', 'A4b-1,Bulbasaur,65600,2,A4b,everypack,◊,FALSE'].join(
        '\n',
      ),
    )
    expect(normalizeImportRows(differing.rows, index).conflicts.map((c) => c.rows.map((r) => r.cardId))).toEqual([
      ['A1-1', 'A4b-1'],
    ])
    const identical = parseTrackerCsv(
      [header, 'A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE', 'A4b-1,Bulbasaur,65600,2,A4b,everypack,◊,TRUE'].join(
        '\n',
      ),
    )
    expect(normalizeImportRows(identical.rows, index).conflicts).toEqual([])
  })

  it('reports ids outside the catalog without throwing and leaves them out of the stock', () => {
    const parsed = parseTrackerCsv(
      [
        header,
        'Z9-999,Nadie,1,4,Z9,everypack,◊,TRUE',
        'A1-1,Bulbasaur,65600,2,A1,mewtwopack,◊,TRUE',
        'Z9-999,Nadie,1,4,Z9,everypack,◊,TRUE',
      ].join('\n'),
    )
    const normalized = normalizeImportRows(parsed.rows, index)
    expect(normalized.unknownIds).toEqual(['Z9-999'])
    expect(Object.keys(normalized.units)).toEqual(['A1-1'])
    expect(normalized.naiveTotal).toBe(10)
    expect(normalized.dedupTotal).toBe(2)
    expect(normalized.twinRows).toBe(0)
  })

  it('imports by Id and reports an InternalId that disagrees with the catalog', () => {
    const parsed = parseTrackerCsv([header, 'A1-1,Bulbasaur,123,2,A1,mewtwopack,◊,TRUE'].join('\n'))
    const normalized = normalizeImportRows(parsed.rows, index)
    expect(normalized.units['A1-1']?.amountOwned).toBe(2)
    expect(normalized.internalIdMismatches).toEqual([
      { cardId: 'A1-1', line: 2, csvInternalId: 123, catalogInternalId: 65600 },
    ])
  })

  it('is a pure function of the rows: the parsed rows are not mutated', () => {
    const parsed = realCsvParsed()
    const snapshot = JSON.stringify(parsed.rows.slice(0, 50))
    normalizeImportRows(parsed.rows, index)
    expect(JSON.stringify(parsed.rows.slice(0, 50))).toBe(snapshot)
  })
})
