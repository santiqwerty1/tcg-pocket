import { describe, expect, it } from 'vitest'
import {
  normalizeImportRows,
  parseTrackerCsv,
  TRACKER_CSV_COLUMNS,
  TRACKER_CSV_HEADER,
  writeTrackerCsv,
} from '../../src/collection/index.js'
import { realCsvBytes, realCsvNormalized, realCsvParsed, realCsvText } from '../helpers/collectionCsv.js'
import { builtCatalog, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const BOM = '﻿'

/** Header plus the first `n` data lines of the real file, without BOM. */
function head(n: number): string {
  return realCsvText()
    .slice(1)
    .split('\n')
    .slice(0, n + 1)
    .join('\n')
}

describe('parseTrackerCsv on the real export of 2026-10-06', () => {
  it('parses 4,317 rows with the exact header, BOM, LF, no trailing newline and no errors', () => {
    const parsed = realCsvParsed()
    expect(parsed.rows).toHaveLength(4317)
    expect(parsed.columns).toEqual([...TRACKER_CSV_COLUMNS])
    expect(TRACKER_CSV_HEADER).toBe('Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected')
    expect(parsed.bom).toBe(true)
    expect(parsed.lineEnding).toBe('LF')
    expect(parsed.trailingNewline).toBe(false)
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0]).toEqual({
      line: 2,
      id: 'A1-1',
      internalId: 65600,
      numberOwned: 2,
      collected: true,
      cardName: 'Bulbasaur',
      expansion: 'A1',
      pack: 'mewtwopack',
      rarity: '◊',
    })
    expect(parsed.rows.at(-1)?.line).toBe(4318)
  })

  it('parses the same rows from bytes, from CRLF input and from input without BOM', () => {
    const parsed = realCsvParsed()
    const fromBytes = parseTrackerCsv(realCsvBytes())
    expect(fromBytes).toEqual(parsed)
    const crlf = parseTrackerCsv(realCsvText().replace(/\n/g, '\r\n'))
    expect(crlf.lineEnding).toBe('CRLF')
    expect(crlf.rows).toEqual(parsed.rows)
    const noBom = parseTrackerCsv(realCsvText().slice(1))
    expect(noBom.bom).toBe(false)
    expect(noBom.rows).toEqual(parsed.rows)
    const trailing = parseTrackerCsv(`${realCsvText()}\n`)
    expect(trailing.trailingNewline).toBe(true)
    expect(trailing.rows).toEqual(parsed.rows)
    expect(trailing.errors).toEqual([])
  })

  it('reports mixed line endings', () => {
    const mixed = parseTrackerCsv(`${head(2)}\r\n${head(3).split('\n')[3]}`)
    expect(mixed.lineEnding).toBe('mixed')
    expect(mixed.rows).toHaveLength(3)
  })
})

describe('parseTrackerCsv validation', () => {
  it('keeps a row with NumberOwned=x out and reports its line number; the other rows parse', () => {
    const lines = head(4).split('\n')
    lines[3] = (lines[3] as string).replace(',1,A1,', ',x,A1,')
    const parsed = parseTrackerCsv(lines.join('\n'))
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0]).toMatchObject({ line: 4, code: 'invalid_number_owned', column: 'NumberOwned' })
    expect(parsed.errors[0]?.message).toContain('A1-3')
    expect(parsed.rows.map((row) => row.id)).toEqual(['A1-1', 'A1-2', 'A1-4'])
  })

  it('rejects negative, decimal and empty NumberOwned, and anything but TRUE/FALSE in Collected', () => {
    const body = ['A1-1,Bulbasaur,65600,-1,A1,mewtwopack,◊,TRUE', 'A1-2,Ivysaur,65665,1.5,A1,mewtwopack,◊◊,TRUE']
    const parsed = parseTrackerCsv(
      [
        TRACKER_CSV_HEADER,
        ...body,
        'A1-3,Venusaur,65730,,A1,mewtwopack,◊◊◊,TRUE',
        'A1-4,Venusaur ex,65795,0,A1,mewtwopack,◊◊◊◊,yes',
        'A1-5,Caterpie,65856,2,A1,pikachupack,◊,',
        'A1-6,Metapod,abc,4,A1,pikachupack,◊,TRUE',
        ',Butterfree,65986,0,A1,pikachupack,◊◊◊,FALSE',
        'A1-8,Weedle,66048,2,A1,charizardpack,◊,true',
        'A1-9,Kakuna,66113,1,A1,charizardpack,◊◊,False',
      ].join('\n'),
    )
    expect(parsed.errors.map((error) => [error.line, error.code])).toEqual([
      [2, 'invalid_number_owned'],
      [3, 'invalid_number_owned'],
      [4, 'invalid_number_owned'],
      [5, 'invalid_collected'],
      [6, 'invalid_collected'],
      [7, 'invalid_internal_id'],
      [8, 'empty_id'],
    ])
    expect(parsed.rows.map((row) => [row.id, row.collected])).toEqual([
      ['A1-8', true],
      ['A1-9', false],
    ])
  })

  it('fails with a clear error when a mandatory column is missing', () => {
    const parsed = parseTrackerCsv('Id,CardName,InternalId,NumberOwned\nA1-1,Bulbasaur,65600,2')
    expect(parsed.rows).toEqual([])
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0]).toMatchObject({ line: 1, code: 'missing_column' })
    expect(parsed.errors[0]?.message).toContain('Collected')
    expect(parseTrackerCsv('').errors[0]?.code).toBe('empty_file')
    expect(parseTrackerCsv(`${BOM}\n\n`).errors[0]?.code).toBe('empty_file')
  })

  it('accepts only the four mandatory columns, in any order, and ignores unknown ones', () => {
    const parsed = parseTrackerCsv(
      'Collected,Foo,NumberOwned,Id,InternalId\ntrue,bar,3,A1-1,65600\nFALSE,,0,A4b-1,65600',
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([
      {
        line: 2,
        id: 'A1-1',
        internalId: 65600,
        numberOwned: 3,
        collected: true,
        cardName: null,
        expansion: null,
        pack: null,
        rarity: null,
      },
      {
        line: 3,
        id: 'A4b-1',
        internalId: 65600,
        numberOwned: 0,
        collected: false,
        cardName: null,
        expansion: null,
        pack: null,
        rarity: null,
      },
    ])
  })

  it('reports rows with too few fields and handles quoted fields', () => {
    const parsed = parseTrackerCsv(
      [TRACKER_CSV_HEADER, 'A1-1,Bulbasaur,65600', 'A1-2,"Ivy, ""saur""",65665,1,A1,mewtwopack,◊◊,TRUE'].join('\n'),
    )
    expect(parsed.errors).toEqual([
      { line: 2, code: 'missing_field', column: 'NumberOwned', message: expect.stringContaining('Line 2') },
    ])
    expect(parsed.rows[0]).toMatchObject({ id: 'A1-2', cardName: 'Ivy, "saur"', numberOwned: 1 })
  })
})

describe('writeTrackerCsv', () => {
  it('reproduces the real export byte for byte from its own normalized stock', () => {
    const written = writeTrackerCsv(index, realCsvNormalized().units)
    const original = realCsvText()
    expect(written.length).toBe(original.length)
    expect(written).toBe(original)
    expect(writeTrackerCsv(builtCatalog().catalog, realCsvNormalized().units)).toBe(original)
  })

  it('round-trips: parse(write(normalize(parse(csv)))) equals parse(csv)', () => {
    const parsed = realCsvParsed()
    const again = parseTrackerCsv(writeTrackerCsv(index, normalizeImportRows(parsed.rows, index).units))
    expect(again).toEqual(parsed)
  })

  it('writes every card with 0 / FALSE when the stock is empty, twins identical', () => {
    const parsed = parseTrackerCsv(writeTrackerCsv(index, {}))
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(4317)
    expect(parsed.rows.every((row) => row.numberOwned === 0 && !row.collected)).toBe(true)
    const twins = parseTrackerCsv(
      writeTrackerCsv(index, { 'A1-1': { stockCardId: 'A1-1', amountOwned: 3, collected: true } }),
    ).rows.filter((row) => row.internalId === 65600)
    expect(twins.map((row) => [row.id, row.numberOwned, row.collected])).toEqual([
      ['A1-1', 3, true],
      ['A4b-1', 3, true],
    ])
  })

  it('honours the formatting options', () => {
    const stock = realCsvNormalized().units
    const crlf = writeTrackerCsv(index, stock, { bom: false, lineEnding: 'CRLF', trailingNewline: true })
    expect(crlf.startsWith(BOM)).toBe(false)
    expect(crlf.endsWith('\r\n')).toBe(true)
    const parsed = parseTrackerCsv(crlf)
    expect(parsed).toMatchObject({ bom: false, lineEnding: 'CRLF', trailingNewline: true })
    expect(parsed.rows).toEqual(realCsvParsed().rows)
    const english = parseTrackerCsv(writeTrackerCsv(index, stock, { lang: 'en' }))
    expect(english.rows[0]?.cardName).toBe('Bulbasaur')
    expect(english.rows.find((row) => row.id === 'P-A-1')?.cardName).toBe('Potion')
    expect(realCsvParsed().rows.find((row) => row.id === 'P-A-1')?.cardName).toBe('Poción')
  })
})
