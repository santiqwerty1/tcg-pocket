// ptcgpocket.gg (DotGG) export (T-020). Synthetic files in the real format: header `Normal,Foil,Name,Set,Number`,
// numbers unquoted, strings quoted, LF and a trailing newline (what the «Permanent export link» answers).
import { describe, expect, it } from 'vitest'
import { CatalogIndex } from '../../src/catalog/index.js'
import {
  DOTGG_CSV_COLUMNS,
  diffImport,
  dotggCardId,
  dotggGapCoverage,
  dotggListedExpansions,
  dotggMissingExpansions,
  dotggNameKey,
  dotggNewSet,
  dotggUnits,
  dotggUnplaced,
  mapDotggRows,
  maskDotggExportLink,
  normalizeImportRows,
  parseDotggCsv,
  parseDotggExportLink,
  redactDotggLink,
  type StockQuantities,
} from '../../src/collection/index.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const TOKEN = 'k3y-For_TESTS.0123456789abcdef'
const LINK = `https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=${TOKEN}`

function exportFile(rows: [number, number, string, string, string][]): string {
  return `Normal,Foil,Name,Set,Number\n${rows.map(([n, f, name, set, num]) => `${n},${f},"${name}","${set}","${num}"`).join('\n')}\n`
}

describe('parseDotggExportLink', () => {
  it('accepts the permanent export link and normalizes it (fragment dropped, parameters kept)', () => {
    expect(parseDotggExportLink(`  ${LINK}  `)).toEqual({ ok: true, url: LINK, token: TOKEN })
    const reordered = parseDotggExportLink(
      `https://API.dotgg.gg/cgfw/exportcollection?token=${TOKEN}&game=pokepocket&v=2#top`,
    )
    expect(reordered).toEqual({
      ok: true,
      url: `https://api.dotgg.gg/cgfw/exportcollection?token=${TOKEN}&game=pokepocket&v=2`,
      token: TOKEN,
    })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['api.dotgg.gg/cgfw/exportcollection', 'not_url'],
    [LINK.replace('https:', 'http:'), 'wrong_place'],
    [LINK.replace('api.dotgg.gg', 'api.dotgg.gg.evil.example'), 'wrong_place'],
    [LINK.replace('api.dotgg.gg', 'dotgg.gg'), 'wrong_place'],
    [LINK.replace('api.dotgg.gg', 'api.dotgg.gg:8443'), 'wrong_place'],
    [LINK.replace('https://', `https://user:${TOKEN}@`), 'wrong_place'],
    [LINK.replace('/cgfw/exportcollection', '/cgfw/exportcollection/'), 'wrong_place'],
    [LINK.replace('/cgfw/exportcollection', '/cgfw/getcollection'), 'wrong_place'],
    ['https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket', 'no_token'],
    ['https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=short', 'no_token'],
    [`${LINK}&token=${TOKEN}`, 'no_token'],
    [`https://api.dotgg.gg/cgfw/exportcollection?token=${TOKEN}`, 'wrong_game'],
    [LINK.replace('pokepocket', 'pokemon'), 'wrong_game'],
    [`${LINK}${'x'.repeat(1000)}`, 'too_long'],
  ])('rejects %j (%s) without repeating what was pasted', (text, code) => {
    const check = parseDotggExportLink(text)
    expect(check).toMatchObject({ ok: false, code })
    if (check.ok) throw new Error('unexpected')
    expect(check.message).not.toContain(TOKEN)
    expect(check.message).not.toContain('evil')
    expect(check.message.length).toBeGreaterThan(10)
  })

  it('takes the link and its token (also URL-encoded) out of any text', () => {
    const encoded = encodeURIComponent('a b/c+d=efgh1234')
    const other = `https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=${encoded}`
    expect(redactDotggLink(`fetch failed: ${LINK} (token ${TOKEN})`, LINK)).toBe('fetch failed: •••• (token ••••)')
    expect(redactDotggLink(`bad ${encoded} and a b/c+d=efgh1234`, other)).toBe('bad •••• and ••••')
    expect(redactDotggLink('nada que sacar', LINK)).toBe('nada que sacar')
    expect(redactDotggLink(`sin link ${TOKEN}`, null)).toBe(`sin link ${TOKEN}`)
  })

  it('masks a stored link down to the last four characters of the token', () => {
    const masked = maskDotggExportLink(LINK)
    expect(masked).toBe('…/exportcollection?…token=••••cdef')
    expect(masked).not.toContain(TOKEN.slice(0, -4))
    expect(maskDotggExportLink('not a url')).toBe('…/exportcollection?…token=••••')
  })
})

describe('parseDotggCsv', () => {
  it('reads the real format: quoted strings, numbers without leading zeros, LF and a trailing newline', () => {
    const parsed = parseDotggCsv(
      exportFile([
        [2, 0, 'Bulbasaur', 'A1', '1'],
        [1, 0, "Professor's Research", 'P-A', '7'],
        [3, 0, 'Small Balloon', 'B4b', '372'],
      ]),
    )
    expect(parsed).toMatchObject({ errors: [], fatal: false, bom: false, lineEnding: 'LF' })
    expect(parsed.columns).toEqual([...DOTGG_CSV_COLUMNS])
    expect(parsed.rows).toEqual([
      { line: 2, copies: 2, name: 'Bulbasaur', set: 'A1', number: 1 },
      { line: 3, copies: 1, name: "Professor's Research", set: 'P-A', number: 7 },
      { line: 4, copies: 3, name: 'Small Balloon', set: 'B4b', number: 372 },
    ])
  })

  it('accepts bytes, a BOM, CRLF, columns in another order, no Foil column and leading zeros', () => {
    const text = '﻿Set,Number,Normal,Name\r\n"A1","001",2,"Bulbasaur"\r\n"A1a","10",1,"x"\r\n'
    const parsed = parseDotggCsv(new TextEncoder().encode(text))
    expect(parsed).toMatchObject({ errors: [], bom: true, lineEnding: 'CRLF' })
    expect(parsed.rows.map((row) => [row.set, row.number, row.copies])).toEqual([
      ['A1', 1, 2],
      ['A1a', 10, 1],
    ])
  })

  it('counts foil copies as copies', () => {
    expect(parseDotggCsv(exportFile([[1, 2, 'Bulbasaur', 'A1', '1']])).rows[0]?.copies).toBe(3)
  })

  it('a file with only the header has no rows and no errors', () => {
    expect(parseDotggCsv('Normal,Foil,Name,Set,Number\n')).toMatchObject({ rows: [], errors: [], fatal: false })
  })

  it('is fatal without a header or a required column, and does not repeat what came instead', () => {
    expect(parseDotggCsv('')).toMatchObject({ fatal: true, errors: [{ code: 'empty_file' }] })
    const html = parseDotggCsv(`<html><body>Invalid token ${TOKEN}</body></html>`)
    expect(html).toMatchObject({ fatal: true, rows: [], columns: [], errors: [{ code: 'missing_column' }] })
    expect(JSON.stringify(html)).not.toContain(TOKEN)
    const tracker = parseDotggCsv(
      'Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected\nA1-1,x,1,1,A1,p,◊,TRUE',
    )
    expect(tracker.errors[0]?.message).toContain('Normal, Set, Number')
  })

  it('reports bad rows by line and keeps the good ones', () => {
    const parsed = parseDotggCsv(
      [
        'Normal,Foil,Name,Set,Number',
        '1,0,"ok","A1","1"',
        '-1,0,"neg","A1","2"',
        '1.5,0,"half","A1","3"',
        '1,x,"foil","A1","4"',
        '1,0,"set","A 1","5"',
        '1,0,"zero","A1","0"',
        '1,0,"big","A1","10000"',
        '1,0,"short","A1"',
        '1,0,"dup","a1","001"',
        '2,0,"ok2","P-A","12"',
      ].join('\n'),
    )
    expect(parsed.rows.map((row) => `${row.set}-${row.number}`)).toEqual(['A1-1', 'P-A-12'])
    expect(parsed.errors.map((error) => [error.line, error.code])).toEqual([
      [3, 'invalid_count'],
      [4, 'invalid_count'],
      [5, 'invalid_count'],
      [6, 'invalid_set'],
      [7, 'invalid_number'],
      [8, 'invalid_number'],
      [9, 'missing_field'],
      [10, 'duplicate_card'],
    ])
    expect(parsed.errors.find((error) => error.code === 'duplicate_card')?.message).toContain('línea 2')
    expect(parsed.fatal).toBe(false)
  })
})

describe('mapDotggRows', () => {
  it('maps by expansion and number, including promos, three-digit numbers and another case of the code', () => {
    const { rows, unmatched } = mapDotggRows(
      parseDotggCsv(
        exportFile([
          [2, 0, 'Bulbasaur', 'A1', '1'],
          [1, 0, "Professor's Research", 'P-A', '7'],
          [1, 0, 'Pikachu', 'P-B', '1'],
          [3, 0, 'Small Balloon', 'B4b', '372'],
          [1, 0, 'Exeggcute', 'a1A', '1'],
        ]),
      ).rows,
      index,
    )
    expect(unmatched).toEqual([])
    expect(rows.map((row) => [row.id, row.internalId, row.numberOwned, row.collected])).toEqual([
      ['A1-1', 65600, 2, true],
      ['P-A-7', 12583376, 1, true],
      ['P-B-1', 12648528, 1, true],
      ['B4b-372', 1465601, 3, true],
      ['A1a-1', 131136, 1, true],
    ])
    expect(dotggCardId('A1', 286, index)).toBe('A1-286')
    expect(dotggCardId('A1', 287, index)).toBeNull()
  })

  it('lists rows the catalog does not have (a new set, a number past the end) instead of dropping them', () => {
    const mapped = mapDotggRows(
      parseDotggCsv(
        exportFile([
          [1, 0, 'Bulbasaur', 'A1', '1'],
          [2, 0, 'New Card', 'C1', '5'],
          [1, 0, 'Future Promo', 'P-B', '999'],
        ]),
      ).rows,
      index,
    )
    expect(mapped.unmatched).toEqual([
      { line: 3, set: 'C1', number: 5, name: 'New Card', copies: 2 },
      { line: 4, set: 'P-B', number: 999, name: 'Future Promo', copies: 1 },
    ])
    const normalized = normalizeImportRows(mapped.rows, index)
    expect(normalized.unknownIds).toEqual(['C1-5', 'P-B-999'])
    expect(normalized.dedupTotal).toBe(1)
    expect(normalized.naiveTotal).toBe(4)
  })

  it('flags rows whose name is another card’s (another numbering) and keeps mapping them', () => {
    const mapped = mapDotggRows(
      parseDotggCsv(
        exportFile([
          [1, 0, 'Venusaur', 'A1', '1'],
          [2, 0, 'PROFESSOR’S RESEARCH', 'P-A', '7'],
          [1, 0, '', 'A1', '2'],
          [1, 0, 'Pokémon Center Lady', 'A2b', '111'],
          [1, 0, 'FLABEBE', 'A1a', '36'],
        ]),
      ).rows,
      index,
    )
    expect(mapped.unmatched).toEqual([])
    expect(mapped.rows.map((row) => row.id)).toEqual(['A1-1', 'P-A-7', 'A1-2', 'A2b-111', 'A1a-36'])
    expect(mapped.renamed).toEqual([
      { line: 2, cardId: 'A1-1', name: 'Venusaur', catalogName: 'Bulbasaur', copies: 1 },
      { line: 5, cardId: 'A2b-111', name: 'Pokémon Center Lady', catalogName: 'Poké Ball', copies: 1 },
    ])
    expect(dotggNameKey('Professor’s Research')).toBe(dotggNameKey("professor's research"))
    expect(dotggNameKey('Flabébé')).toBe(dotggNameKey('Flabebe'))
  })

  it('folds twins into one stock unit and reports twins with different counts', () => {
    const same = normalizeImportRows(
      mapDotggRows(
        parseDotggCsv(
          exportFile([
            [2, 0, 'Bulbasaur', 'A1', '1'],
            [2, 0, 'Bulbasaur', 'A4b', '1'],
          ]),
        ).rows,
        index,
      ).rows,
      index,
    )
    expect(same).toMatchObject({ twinRows: 1, conflicts: [], dedupTotal: 2 })
    const different = normalizeImportRows(
      mapDotggRows(
        parseDotggCsv(
          exportFile([
            [2, 0, 'Bulbasaur', 'A1', '1'],
            [1, 0, 'Bulbasaur', 'A4b', '1'],
          ]),
        ).rows,
        index,
      ).rows,
      index,
    )
    expect(different.conflicts).toHaveLength(1)
    expect(different.conflicts[0]?.stockCardId).toBe('A1-1')
  })

  it('every catalog card id is «expansion-number», the rule the mapping relies on', () => {
    const wrong = index.catalog.cards.filter((card) => card.id !== `${card.expansionId}-${card.number}`)
    expect(wrong).toEqual([])
  })

  it('an export of the 6/10 collection maps back to exactly the units of that CSV', () => {
    const units = realCsvNormalized().units
    const owned = Object.values(units).filter((unit) => unit.amountOwned > 0)
    // The game lists each card once: here, by the last edition of the unit (another id than the stock unit's).
    const file = exportFile(
      owned.map((unit) => {
        const editions = index.stockById(unit.stockCardId)?.cardIds ?? [unit.stockCardId]
        const card = index.cardById(editions[editions.length - 1] ?? unit.stockCardId)
        if (!card) throw new Error(unit.stockCardId)
        return [unit.amountOwned, 0, card.nameEn, card.expansionId, String(card.number)]
      }),
    )
    const mapped = mapDotggRows(parseDotggCsv(file).rows, index)
    expect(mapped.unmatched).toEqual([])
    expect(mapped.renamed).toEqual([])
    const normalized = normalizeImportRows(mapped.rows, index)
    expect(normalized.conflicts).toEqual([])
    expect(normalized.dedupTotal).toBe(4714)
    const back = dotggUnits(normalized.units, index, units)
    for (const unit of index.catalog.stockUnits) {
      expect(back[unit.id]?.amountOwned ?? 0, unit.id).toBe(units[unit.id]?.amountOwned ?? 0)
    }
  })
})

describe('dotggUnplaced (S-D)', () => {
  it('a named row of a new set or past the last number is left out; a hole in a known set or no name stops the file', () => {
    // The real catalog numbers every set without holes (A1 goes from 1 to 286): here A1-5 is missing.
    expect(index.cardsOfExpansion('A1').length).toBe(286)
    const holed = new CatalogIndex({
      ...index.catalog,
      cards: index.catalog.cards.filter((card) => card.id !== 'A1-5'),
    })
    const mapped = mapDotggRows(
      parseDotggCsv(
        exportFile([
          [2, 0, 'Bulbasaur', 'A1', '1'],
          // The special pack «Primeros Compañeros» before the tracker loads it (29/10/2026).
          [1, 0, 'Bulbasaur', 'SP1', '1'],
          [1, 0, 'Charmander', 'sp1', '4'],
          [0, 0, 'Squirtle', 'SP1', '7'],
          // Past the last number of A1: a new card (as a new promo before the tracker loads it).
          [1, 0, 'Pikachu', 'A1', '287'],
          // A hole inside A1: another numbering may hide a known A1 card.
          [1, 0, 'Mystery Card', 'A1', '5'],
          // No name: nothing says which card it is.
          [1, 0, '', 'SP1', '2'],
          [1, 0, '', 'A1', '900'],
          // Another card's name (A1-2 is Ivysaur).
          [1, 0, 'Venusaur', 'A1', '2'],
        ]),
      ).rows,
      holed,
    )
    const unplaced = dotggUnplaced(mapped, holed)
    const codes = (rows: { set: string; number: number }[]) => rows.map((row) => `${row.set}-${row.number}`)
    expect(codes(unplaced.newSet)).toEqual(['SP1-1', 'sp1-4', 'SP1-7'])
    expect(codes(unplaced.newNumber)).toEqual(['A1-287'])
    expect(codes(unplaced.otherNumber)).toEqual(['A1-5'])
    expect(codes(unplaced.nameless)).toEqual(['SP1-2', 'A1-900'])
    // The names of the rows with copies that are not compared as themselves; a row with 0 copies hides no copy.
    expect([...unplaced.names].sort()).toEqual(['bulbasaur', 'charmander', 'mysterycard', 'pikachu', 'venusaur'])
    // In the whole catalog, A1-5 is no row to place.
    const whole = exportFile([[1, 0, index.cardById('A1-5')?.nameEn ?? '', 'A1', '5']])
    expect(dotggUnplaced(mapDotggRows(parseDotggCsv(whole).rows, index), index)).toEqual({
      newSet: [],
      newNumber: [],
      otherNumber: [],
      nameless: [],
      names: new Set(),
    })
  })

  it('an expansion the catalog lists with no card yet is a new set; one with cards, in any case, is not', () => {
    expect(dotggNewSet('SP1', index)).toBe(true)
    expect(dotggNewSet('A1', index)).toBe(false)
    expect(dotggNewSet('a1A', index)).toBe(false)
    const first = index.catalog.expansions[0]
    if (!first) throw new Error('no expansions')
    const withSp1 = new CatalogIndex({
      ...index.catalog,
      expansions: [...index.catalog.expansions, { ...first, id: 'SP1', packIds: [] }],
    })
    expect(withSp1.expansionById('SP1')).toBeDefined()
    expect(dotggNewSet('SP1', withSp1)).toBe(true)
    const unplaced = dotggUnplaced(
      mapDotggRows(parseDotggCsv(exportFile([[1, 0, 'Bulbasaur', 'SP1', '1']])).rows, withSp1),
      withSp1,
    )
    expect(unplaced.newSet).toHaveLength(1)
    expect(unplaced.newNumber).toEqual([])
    expect(unplaced.otherNumber).toEqual([])
  })
})

describe('dotggUnits', () => {
  const current: StockQuantities = {
    'A1-1': { stockCardId: 'A1-1', amountOwned: 3, collected: true },
    'B1a-28': { stockCardId: 'B1a-28', amountOwned: 0, collected: true },
    'A1-3': { stockCardId: 'A1-3', amountOwned: 1, collected: false },
  }
  const incoming = normalizeImportRows(
    mapDotggRows(parseDotggCsv(exportFile([[2, 0, 'Ivysaur', 'A1', '2']])).rows, index).rows,
    index,
  ).units

  it('zeroes what the export does not list and keeps the carddex flag; a copy turns it on', () => {
    const units = dotggUnits(incoming, index, current)
    expect(Object.keys(units)).toHaveLength(index.catalog.stockUnits.length)
    expect(units['A1-1']).toEqual({ stockCardId: 'A1-1', amountOwned: 0, collected: true })
    expect(units['B1a-28']).toEqual({ stockCardId: 'B1a-28', amountOwned: 0, collected: true })
    expect(units['A1-3']).toEqual({ stockCardId: 'A1-3', amountOwned: 0, collected: false })
    expect(units['A1-2']).toEqual({ stockCardId: 'A1-2', amountOwned: 2, collected: true })
    expect(units['A2-1']).toEqual({ stockCardId: 'A2-1', amountOwned: 0, collected: false })
  })

  it('the diff shows the drops and the new unit, and never «ya no coleccionada»', () => {
    const diff = diffImport(index, current, dotggUnits(incoming, index, current))
    expect(diff.summary).toEqual({ unitsChanged: 3, copiesDelta: -2, newUnits: 1, zeroedUnits: 2, collectedChanged: 1 })
    expect(diff.changes.every((change) => !change.before?.collected || change.after.collected)).toBe(true)
  })
})

describe('dotggMissingExpansions', () => {
  it('names expansions with copies in the collection and no row in the export', () => {
    const current: StockQuantities = {
      'A1-1': { stockCardId: 'A1-1', amountOwned: 3, collected: true },
      'B4b-372': { stockCardId: 'B4b-372', amountOwned: 2, collected: true },
      'P-A-7': { stockCardId: 'P-A-7', amountOwned: 1, collected: true },
      'B1a-28': { stockCardId: 'B1a-28', amountOwned: 0, collected: true },
    }
    // A4b-1 is the twin of A1-1: it covers A1, the expansion of its stock unit.
    const file = normalizeImportRows(
      mapDotggRows(parseDotggCsv(exportFile([[1, 0, 'Bulbasaur', 'A4b', '1']])).rows, index).rows,
      index,
    ).units
    expect(dotggMissingExpansions(index, current, file)).toEqual([
      { expansionId: 'B4b', copies: 2, cards: 1 },
      { expansionId: 'P-A', copies: 1, cards: 1 },
    ])
    expect(dotggMissingExpansions(index, current, current)).toEqual([])
    // A card registered with no copy counts only when asked (the tracker file would clear its flag).
    expect(dotggMissingExpansions(index, current, file, { registered: true })).toEqual([
      { expansionId: 'B1a', copies: 0, cards: 1 },
      { expansionId: 'B4b', copies: 2, cards: 1 },
      { expansionId: 'P-A', copies: 1, cards: 1 },
    ])
  })
})

describe('dotggListedExpansions', () => {
  it('gives the expansion of each card, once: the code a row wrote, not where its stock unit is kept', () => {
    expect([...dotggListedExpansions(index, ['A1-1', 'A1-2', 'B4b-372', 'not-a-card'])]).toEqual(['A1', 'B4b'])
    // B4b-8 is a reprint kept under B1-2: the row still says ptcgpocket.gg writes B4b.
    expect(index.cardById('B4b-8')?.stockCardId).toBe('B1-2')
    expect([...dotggListedExpansions(index, ['B4b-8'])]).toEqual(['B4b'])
    expect(dotggListedExpansions(index, []).size).toBe(0)
  })
})

describe('dotggGapCoverage (S-B, S-E)', () => {
  const unit = (stockCardId: string, amountOwned: number, collected = amountOwned > 0) => ({
    stockCardId,
    amountOwned,
    collected,
  })
  const all = index.catalog.expansions.map((expansion) => expansion.id)
  const except = (...ids: string[]) => new Set(all.filter((id) => !ids.includes(id)))

  it('compares a whole expansion with no row only when ptcgpocket.gg knows it and the app has 0 there', () => {
    const tracker: StockQuantities = {
      'A1-1': unit('A1-1', 1),
      'B1a-28': unit('B1a-28', 0, true),
      'B4b-372': unit('B4b-372', 3),
      'P-A-7': unit('P-A-7', 1),
    }
    const coverage = dotggGapCoverage(index, {
      tracker,
      game: { 'A1-1': unit('A1-1', 2) },
      listed: new Set(['A1']),
      seen: except('B1a'),
      held: new Set(['P-A']),
      heldUnits: new Set(['P-A-7']),
    })
    expect(coverage.leftOut).toEqual([
      // Never written by ptcgpocket.gg: it may not know the set.
      { expansionId: 'B1a', cards: 1, reason: 'unseen' },
      // Known, but the app still has copies: the drop waits for Santi in the app.
      { expansionId: 'P-A', cards: 1, reason: 'held' },
    ])
    expect(coverage.empty).toEqual([{ expansionId: 'B4b', cards: 1 }])
    expect(coverage.reprints).toEqual({ cards: 0, expansionIds: [] })
    expect(['B1a-28', 'P-A-7'].every((id) => coverage.skipped.has(id))).toBe(true)
    expect(['A1-1', 'B4b-372'].some((id) => coverage.skipped.has(id))).toBe(false)
  })

  it('leaves everything with no row out when nothing is known (before the first applied sync)', () => {
    const coverage = dotggGapCoverage(index, {
      tracker: { 'A1-1': unit('A1-1', 1), 'B4b-372': unit('B4b-372', 3) },
      game: { 'A1-1': unit('A1-1', 1) },
      listed: new Set(['A1']),
      seen: new Set(),
      held: new Set(),
      heldUnits: new Set(),
    })
    expect(coverage.leftOut).toEqual([{ expansionId: 'B4b', cards: 1, reason: 'unseen' }])
    expect(coverage.empty).toEqual([])
  })

  it('leaves out a card whose copy may be a reprint in a set ptcgpocket.gg never wrote', () => {
    // A4b-44 is a reprint kept under A3a-6.
    expect(index.cardById('A4b-44')?.stockCardId).toBe('A3a-6')
    const tracker: StockQuantities = { 'A3a-6': unit('A3a-6', 1), 'A1-1': unit('A1-1', 1) }
    const game: StockQuantities = { 'A1-1': unit('A1-1', 1) }
    // The whole of A3a has no row, ptcgpocket.gg knows A3a and the app has 0 there, but not A4b.
    const empty = dotggGapCoverage(index, {
      tracker,
      game,
      listed: new Set(['A1']),
      seen: except('A4b'),
      held: new Set(),
      heldUnits: new Set(),
    })
    expect(empty.skipped.has('A3a-6')).toBe(true)
    expect(empty.reprints).toEqual({ cards: 1, expansionIds: ['A4b'] })
    expect(empty.empty).toEqual([])
    // Once A4b is known, the 0 is the game's.
    const known = dotggGapCoverage(index, {
      tracker,
      game,
      listed: new Set(['A1']),
      seen: new Set(all),
      held: new Set(),
      heldUnits: new Set(),
    })
    expect(known.skipped.has('A3a-6')).toBe(false)
    expect(known.empty).toEqual([{ expansionId: 'A3a', cards: 1 }])
    // The same in an expansion the export covers.
    const covered = dotggGapCoverage(index, {
      tracker: { ...tracker, 'A3a-1': unit('A3a-1', 1) },
      game: { ...game, 'A3a-1': unit('A3a-1', 1) },
      listed: new Set(['A1', 'A3a']),
      seen: new Set(),
      held: new Set(),
      heldUnits: new Set(),
    })
    expect(covered.skipped.has('A3a-6')).toBe(true)
    expect(covered.reprints.expansionIds).toEqual(['A4b'])
    expect(covered.leftOut).toEqual([])
    // A row for A3a-6 with 0 copies is no proof either: the copy may still be the A4b reprint.
    const zeroRow = dotggGapCoverage(index, {
      tracker,
      game: { ...game, 'A3a-6': unit('A3a-6', 0) },
      listed: new Set(['A1', 'A3a']),
      seen: new Set(),
      held: new Set(),
      heldUnits: new Set(),
    })
    expect(zeroRow.skipped.has('A3a-6')).toBe(true)
    expect(zeroRow.reprints).toEqual({ cards: 1, expansionIds: ['A4b'] })
  })

  it('leaves out a card at 0 in the export that the app still has: a drop not applied yet (S-K)', () => {
    const tracker: StockQuantities = {
      'A1-1': unit('A1-1', 1),
      'A1-2': unit('A1-2', 1),
      'A1-3': unit('A1-3', 1),
      'A1-4': unit('A1-4', 0, true),
    }
    const coverage = dotggGapCoverage(index, {
      tracker,
      // A1-2 is listed with 0 copies; A1-3 and A1-4 are not listed.
      game: { 'A1-1': unit('A1-1', 1), 'A1-2': unit('A1-2', 0) },
      listed: new Set(all),
      seen: new Set(all),
      held: new Set(['A1']),
      heldUnits: new Set(['A1-1', 'A1-2', 'A1-3', 'A1-4']),
    })
    // A1-1 has its copy in the export; A1-2, A1-3 and A1-4 would go to 0 (or lose the mark) while the app has them.
    expect(coverage.pending).toBe(3)
    expect([...coverage.skipped].sort()).toEqual(['A1-2', 'A1-3', 'A1-4'])
    // Applied (the app at 0 there), they are compared.
    const applied = dotggGapCoverage(index, {
      tracker,
      game: { 'A1-1': unit('A1-1', 1), 'A1-2': unit('A1-2', 0) },
      listed: new Set(all),
      seen: new Set(all),
      held: new Set(['A1']),
      heldUnits: new Set(['A1-1']),
    })
    expect(applied.pending).toBe(0)
    expect(applied.skipped.size).toBe(0)
  })

  it('leaves out a card with no copy in the export named like a row the catalog cannot place (S-D)', () => {
    // Bulbasaur: A1-1 (with its A4b-1 twin), A1-227 and P-A-23, among others; A1-2 is Ivysaur.
    const tracker: StockQuantities = {
      'A1-1': unit('A1-1', 1),
      'A1-2': unit('A1-2', 1),
      'A1-227': unit('A1-227', 1),
      'P-A-23': unit('P-A-23', 0, true),
    }
    const input = {
      tracker,
      game: { 'A1-1': unit('A1-1', 2) },
      listed: new Set(all),
      seen: new Set(all),
      held: new Set<string>(),
      heldUnits: new Set<string>(),
    }
    const coverage = dotggGapCoverage(index, { ...input, unplacedNames: new Set(['bulbasaur']) })
    // A1-1 has its copies in the export, and Ivysaur is another name: both compared.
    expect(coverage.sameName).toEqual(['A1-227', 'P-A-23'])
    expect([...coverage.skipped].sort()).toEqual(['A1-227', 'P-A-23'])
    // Without the name, they would be compared (as 0).
    expect(dotggGapCoverage(index, input)).toMatchObject({ sameName: [], skipped: new Set() })
    // A drop the app has not applied yet stays a pending drop.
    const held = dotggGapCoverage(index, {
      ...input,
      heldUnits: new Set(['A1-227']),
      unplacedNames: new Set(['bulbasaur']),
    })
    expect(held).toMatchObject({ pending: 1, sameName: ['P-A-23'] })
  })

  it('a known expansion written whole under another code is not zeroed (S-D on top of S-E)', () => {
    // ptcgpocket.gg knew P-A, the app has 0 there (a sync applied), and the export now writes P-A-7 as «PA-7».
    const tracker: StockQuantities = { 'A1-1': unit('A1-1', 1), 'P-A-7': unit('P-A-7', 1) }
    const input = {
      tracker,
      game: { 'A1-1': unit('A1-1', 1) },
      listed: new Set(['A1']),
      seen: new Set(all),
      held: new Set(['A1']),
      heldUnits: new Set(['A1-1']),
    }
    // Without the name, P-A is compared as 0: the file would take P-A-7 off the tracker.
    expect(dotggGapCoverage(index, input).empty).toEqual([{ expansionId: 'P-A', cards: 1 }])
    const coverage = dotggGapCoverage(index, {
      ...input,
      unplacedNames: new Set([dotggNameKey("Professor's Research")]),
    })
    expect(coverage.sameName).toEqual(['P-A-7'])
    expect(coverage.skipped.has('P-A-7')).toBe(true)
    expect(coverage.empty).toEqual([])
  })
})
