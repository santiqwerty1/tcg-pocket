import { describe, expect, it } from 'vitest'
import {
  detectDelimiter,
  duplicateTextEs,
  KNOWN_SEASONS,
  lineBreaks,
  normalizeSheetCode,
  type ParsedSheet,
  parseDelimited,
  parseSheet,
  parseSheetDate,
  parseSheetRank,
  planSheetImport,
  type RankChange,
  readDelimited,
  SHEET_IMPORT_MAX_NEW,
  type SheetDeck,
  type SheetExistingMatch,
  type SheetPlanContext,
  type SheetRow,
  sheetColumnK,
  suggestDeckByName,
  wallTimeToInstant,
} from '../../src/matches/index.js'

/**
 * T-022, «Importar desde la hoja»: synthetic sheets with the shape of the owner's (title and instructions in rows 1–3,
 * headers in row 4, data from row 5). Nothing here comes from the real sheet.
 */
const ZONE = 'America/Argentina/Buenos_Aires'
const NOW = new Date('2026-10-22T18:00:00Z')
const HEADER = [
  'Código',
  'Salida',
  'Resultado',
  'Mazo (automático)',
  'Fecha',
  'Mazo rival',
  'Notas',
  'Rango',
  'Rango (efectivo)',
  'Temporada',
  'En la app (n.º)',
]
type Cells = [string, string, string, string, string, string, string, string, string, string, string]

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** The sheet as Sheets exports it: comma-separated, quoted when needed, CRLF. */
function csv(rows: Cells[], delimiter = ','): string {
  const lines = [
    ['Registro de partidas', '', '', '', '', '', '', '', '', '', ''],
    ['Elegí el código del mazo en A', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    HEADER,
    ...rows,
  ]
  return `${lines.map((line) => line.map((cell) => (delimiter === ',' ? csvCell(cell) : cell)).join(delimiter)).join('\r\n')}\r\n`
}

/** The sheet as Sheets copies cells: tabs, and only a cell with a line break in quotes (its quotes doubled). */
function sheetsCopy(rows: Cells[]): string {
  const copied = (value: string) => (value.includes('\n') ? `"${value.replaceAll('"', '""')}"` : value)
  const lines = [
    ['Registro de partidas', '', '', '', '', '', '', '', '', '', ''],
    ['Elegí el código del mazo en A', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    HEADER,
    ...rows,
  ]
  return lines.map((line) => line.map(copied).join('\t')).join('\n')
}

const row = (
  overrides: Partial<
    Record<'code' | 'first' | 'result' | 'deck' | 'date' | 'rival' | 'note' | 'rank' | 'k', string>
  > = {},
): Cells => [
  overrides.code ?? 'M08',
  overrides.first ?? 'Primero',
  overrides.result ?? 'Victoria',
  overrides.deck ?? 'mawile',
  overrides.date ?? '19/10/2026 21:40',
  overrides.rival ?? 'Hoopa ex / Mega-Absol ex',
  overrides.note ?? '',
  overrides.rank ?? '',
  overrides.rank || 'Master Ball',
  'Temporada B4b SP',
  overrides.k ?? '',
]

const DECKS: SheetDeck[] = [
  { id: '3', name: 'Mega-Mawile ex', archived: false },
  { id: '7', name: 'Butterfree / Mega-Sceptile ex', archived: false },
  { id: '9', name: 'Mega-Latias ex', archived: false },
  { id: '12', name: 'Cachorros', archived: true },
]
const SEASON = KNOWN_SEASONS.filter((season) => season.code === 'B4bSP')

function context(overrides: Partial<SheetPlanContext> = {}): SheetPlanContext {
  return {
    decks: DECKS,
    saved: { M08: '3', M01: '7' },
    chosen: {},
    existing: [],
    include: [],
    mode: 'competitive',
    seasons: SEASON,
    changes: [],
    timeZone: ZONE,
    ...overrides,
  }
}

const parse = (text: string): ParsedSheet => parseSheet(text, { timeZone: ZONE, now: NOW })

describe('delimited text (RFC 4180)', () => {
  it('quotes keep delimiters, doubled quotes and line breaks; CRLF, LF and a BOM', () => {
    expect(parseDelimited('﻿a,"b, c","d ""e""",f\r\n"x\ny",z\n', ',')).toEqual([
      ['a', 'b, c', 'd "e"', 'f'],
      ['x\ny', 'z'],
    ])
    expect(parseDelimited('a;b\n;c', ';')).toEqual([
      ['a', 'b'],
      ['', 'c'],
    ])
    expect(parseDelimited('a\tb "c"\t"d\ne"\tf', '\t')).toEqual([['a', 'b "c"', 'd\ne', 'f']])
    expect(parseDelimited('a\n\nb', ',')).toEqual([['a'], [''], ['b']])
  })

  it('review of #143: a quote is a quoted field only when it is a well-formed one; with tabs, never across a tab', () => {
    // A cell that starts with a quote and goes on after its closing quote is text as written.
    expect(parseDelimited('"Hoopa" me ganó,x', ',')).toEqual([['"Hoopa" me ganó', 'x']])
    expect(parseDelimited('"Hoopa" me ganó\tx', '\t')).toEqual([['"Hoopa" me ganó', 'x']])
    // Copied from Sheets: a quote opened in one cell and one in a cell rows below are two cells.
    expect(parseDelimited('"Hoopa me ganó\tx\ny\tle dicen "el pibe"\tz', '\t')).toEqual([
      ['"Hoopa me ganó', 'x'],
      ['y', 'le dicen "el pibe"', 'z'],
    ])
    expect(readDelimited('a\t"b\nc\td', '\t')).toEqual({
      records: [
        ['a', '"b'],
        ['c', 'd'],
      ],
      unclosedAt: null,
    })
    // A cell with a line break (and quotes in it), as Sheets copies it: in quotes, the quotes doubled.
    expect(parseDelimited('a\t"dijo ""hola""\nchau"\tb', '\t')).toEqual([['a', 'dijo "hola"\nchau', 'b']])
    // In a CSV, an unclosed quote is reported.
    expect(readDelimited('a,"b\nc,d', ',').unclosedAt).toBe(0)
  })

  it('the delimiter is the one whose header row has the columns', () => {
    expect(detectDelimiter(csv([row()]))).toBe(',')
    expect(detectDelimiter(csv([row()], ';'))).toBe(';')
    expect(detectDelimiter(csv([row()], '\t'))).toBe('\t')
    expect(detectDelimiter('nada que ver\n1,2,3')).toBeNull()
  })
})

describe('cells of the sheet', () => {
  it('codes, ranks and dates', () => {
    expect(normalizeSheetCode(' m8 ')).toBe('M08')
    expect(normalizeSheetCode('M21')).toBe('M21')
    expect(normalizeSheetCode('')).toBeNull()
    expect(parseSheetRank('Master Ball')).toBe('master')
    expect(parseSheetRank('Poké Ball 2')).toBe('poke-2')
    expect(parseSheetRank('Super Ball 4')).toBe('great-4')
    expect(parseSheetRank('Principiante 1')).toBe('beginner-1')
    expect(parseSheetRank('ultra ball 3')).toBe('ultra-3')
    expect(parseSheetRank('')).toBeNull()
    expect(parseSheetRank('Ultra Ball 7')).toBeUndefined()
    expect(parseSheetDate('17/10/2026 22:19')).toMatchObject({
      day: 17,
      month: 10,
      hour: 22,
      minute: 19,
      hasTime: true,
    })
    expect(parseSheetDate('7/1/2026')).toMatchObject({ day: 7, month: 1, hasTime: false })
    expect(parseSheetDate('2026-10-17 22:19:30')).toMatchObject({ second: 30 })
    expect(parseSheetDate('31/02/2026 10:00')).toBeNull()
    expect(parseSheetDate('17/10/26 10:00')).toBeNull()
    expect(parseSheetDate('ayer')).toBeNull()
  })

  it("a wall time is the owner's (Buenos Aires, UTC−3)", () => {
    expect(
      wallTimeToInstant({ year: 2026, month: 10, day: 17, hour: 22, minute: 19, second: 0 }, ZONE).toISOString(),
    ).toBe('2026-10-18T01:19:00.000Z')
    expect(
      wallTimeToInstant({ year: 2026, month: 7, day: 1, hour: 0, minute: 0, second: 0 }, 'Europe/Madrid').toISOString(),
    ).toBe('2026-06-30T22:00:00.000Z')
  })
})

describe('reading the sheet', () => {
  it('headers in row 4, data from row 5, rows numbered as in the sheet; empty rows between and after are skipped', () => {
    const text = csv([
      row(),
      ['', '', '', '', '', '', '', '', '', 'sin temporada', ''],
      row({ code: 'M01', deck: 'butterfree', result: 'Derrota', date: '19/10/2026 22:05' }),
      ['', '', '', '', '', '', '', '', '', 'sin temporada', ''],
    ])
    const sheet = parse(text)
    expect(sheet).toMatchObject({ delimiter: ',', headerRow: 4, firstRow: 5, lastRow: 7, error: null })
    expect(sheet.rows.map((item) => item.row)).toEqual([5, 7])
    expect(sheet.rows[0]).toMatchObject({
      code: 'M08',
      deckName: 'mawile',
      result: 'win',
      wentFirst: true,
      opponent: 'Hoopa ex / Mega-Absol ex',
      rank: null,
      appId: null,
      errors: [],
      warnings: [],
    })
    expect(sheet.rows[0]?.playedAt?.toISOString()).toBe('2026-10-20T00:40:00.000Z')
    expect(sheet.rows[0]?.key).toMatch(/^sheet:[0-9a-f]{16}$/u)
    expect(sheet.rows[1]).toMatchObject({ code: 'M01', result: 'loss' })
  })

  it('notes with commas, quotes, accents and line breaks (CSV export), and the same sheet pasted with tabs', () => {
    const note = 'Me sacó "Hoopa" en el turno 2, después Absol.\nRevisar: ¿más Pokébolas?'
    const fromCsv = parse(csv([row({ note })]))
    expect(fromCsv.rows).toHaveLength(1)
    expect(fromCsv.rows[0]?.note).toBe(note)
    // Sheets puts a cell with a line break in quotes when copying it; the rest goes as is, tab-separated.
    const pasted = csv([row({ note: 'sin comillas, con coma' })], '\t')
    const fromTabs = parse(pasted)
    expect(fromTabs.delimiter).toBe('\t')
    expect(fromTabs.rows[0]).toMatchObject({ note: 'sin comillas, con coma', row: 5 })
    // The same row gives the same key whichever way it came.
    expect(fromTabs.rows[0]?.key).toBe(parse(csv([row({ note: 'otra nota' })])).rows[0]?.key)
  })

  it('a row without a date is an error; without the time it goes at 12:00, with a notice; a future date is an error', () => {
    const sheet = parse(
      csv([
        row({ date: '' }),
        row({ date: '18/10/2026' }),
        row({ date: '30/10/2026 10:00' }),
        row({ date: '18/10/26' }),
      ]),
    )
    expect(sheet.rows[0]?.errors).toEqual(['Falta la fecha.'])
    expect(sheet.rows[0]?.key).toBeNull()
    expect(sheet.rows[1]?.playedAt?.toISOString()).toBe('2026-10-18T15:00:00.000Z')
    expect(sheet.rows[1]?.warnings).toEqual(['La fecha no tiene hora: va a las 12:00.'])
    expect(sheet.rows[2]?.errors[0]).toMatch(/todavía no llegó/u)
    expect(sheet.rows[3]?.errors[0]).toMatch(/dd\/mm\/aaaa hh:mm/u)
  })

  it('without «Salida» the turn order stays unknown, with a notice; other values are errors', () => {
    const sheet = parse(csv([row({ first: '' }), row({ first: 'Segundo' }), row({ first: 'tercero' })]))
    expect(sheet.rows[0]).toMatchObject({
      wentFirst: null,
      warnings: ['Sin «Salida»: el orden de turno queda sin anotar.'],
    })
    expect(sheet.rows[0]?.errors).toEqual([])
    expect(sheet.rows[1]?.wentFirst).toBe(false)
    expect(sheet.rows[2]?.errors[0]).toMatch(/Salida «tercero»/u)
  })

  it('what cannot be read: code, result, column K, a rival too long, an unknown rank (a notice only)', () => {
    const sheet = parse(
      csv([
        row({ code: '' }),
        row({ result: 'Ganó' }),
        row({ k: 'sí' }),
        row({ rival: 'x'.repeat(81) }),
        row({ rank: 'Diamante' }),
        row({ k: 'n.º 14' }),
        row({ code: 'Una nota escrita en la columna A' }),
      ]),
    )
    expect(sheet.rows[6]?.errors[0]).toMatch(/no es un código de mazo/u)
    expect(sheet.rows[6]?.key).toBeNull()
    expect(sheet.rows[0]?.errors).toEqual(['Falta el código del mazo.'])
    expect(sheet.rows[1]?.errors[0]).toMatch(/Resultado «Ganó»/u)
    expect(sheet.rows[2]?.errors[0]).toMatch(/«En la app» dice «sí»/u)
    expect(sheet.rows[3]?.errors[0]).toMatch(/81 caracteres/u)
    expect(sheet.rows[4]).toMatchObject({ rank: null, errors: [] })
    expect(sheet.rows[4]?.warnings).toEqual(['Rango «Diamante» desconocido: no lo anoto.'])
    expect(sheet.rows[5]?.appId).toBe('14')
  })

  it('review: an unclosed quote (CSV) or millions of lines: nothing is read, it says why', () => {
    const exported = csv([row()]).replace('Hoopa ex / Mega-Absol ex', '"Hoopa ex')
    expect(parse(exported).error).toMatch(/La fila 5 tiene unas comillas que no se cierran/u)
    expect(parse(`${csv([row()])}${'\n'.repeat(60_000)}`).error).toMatch(/demasiado largo/u)
    // Codex on #143: a lone CR ends a record too (readDelimited takes it), and a CRLF is one break, not two.
    expect(lineBreaks('a\rb\r\nc\nd\r')).toBe(4)
    expect(parse(`${csv([row()])}${'\r'.repeat(60_000)}`).error).toMatch(/demasiado largo/u)
    expect(parse(`${csv([row()])}${'\r\n'.repeat(40_000)}`).error).toBeNull()
  })

  it('review of #143: pasted from Sheets, a note opening a quote and one closing it rows below swallow no row', () => {
    const rows = [
      row({ note: '"Hoopa me ganó' }),
      row({ date: '19/10/2026 21:50' }),
      row({ date: '19/10/2026 22:00', note: 'dos líneas\ny una con "comillas"' }),
      row({ date: '19/10/2026 22:10' }),
      row({ date: '19/10/2026 22:20', note: 'le dicen "el pibe"' }),
    ]
    const sheet = parse(sheetsCopy(rows))
    expect(sheet.error).toBeNull()
    expect(sheet.rows.map((item) => [item.row, item.note])).toEqual([
      [5, '"Hoopa me ganó'],
      [6, ''],
      [7, 'dos líneas\ny una con "comillas"'],
      [8, ''],
      [9, 'le dicen "el pibe"'],
    ])
    // A row with more cells than the headers is quotes read wrong: refused, naming the row.
    const extra = `${sheetsCopy([row()])}\n${sheetsCopy([row({ date: '19/10/2026 21:50' })])
      .split('\n')
      .at(-1)}\tsobra`
    expect(parse(extra).error).toMatch(/^La fila 6 tiene 12 celdas y los encabezados 11/u)
  })

  it('review of #143: a date before the game (30/10/2024) is an error, also a year of two digits', () => {
    const sheet = parse(
      csv([row({ date: '17/10/2006 21:00' }), row({ date: '17/10/0026 21:00' }), row({ date: '30/10/2024 00:00' })]),
    )
    expect(sheet.rows[0]?.errors[0]).toMatch(/es anterior al juego \(salió el 30\/10\/2024\)/u)
    expect(sheet.rows[1]?.errors[0]).toMatch(/es anterior al juego/u)
    expect(sheet.rows[2]?.errors).toEqual([])
  })

  it('review: «Rango (si cambió)» is the rank column too; «Rango (efectivo)» is not', () => {
    const text = csv([row({ rank: 'Ultra Ball 1' })]).replace(
      'Rango,Rango (efectivo)',
      'Rango (si cambió),Rango (efectivo)',
    )
    expect(text).toContain('Rango (si cambió)')
    expect(parse(text).rows[0]?.rank).toBe('ultra-1')
  })

  it('no header row, or no «Fecha» column: nothing is read', () => {
    expect(parse('a,b,c\n1,2,3').error).toMatch(/No encontré la fila de encabezados/u)
    expect(parse('Código,Resultado\nM01,Victoria').error).toMatch(/Falta la columna «Fecha»/u)
  })

  it('the key: retouching the rival or the note keeps it; another result or date changes it; twin rows differ', () => {
    const key = (cells: Cells) => parse(csv([cells])).rows[0]?.key
    const base = key(row())
    expect(key(row({ rival: '  hoopa EX/mega absol ex ' }))).toBe(base)
    expect(key(row({ note: 'una nota' }))).toBe(base)
    expect(key(row({ deck: 'otro nombre' }))).toBe(base)
    expect(key(row({ date: '19/10/2026 21:40:00' }))).toBe(base)
    expect(key(row({ result: 'Derrota' }))).not.toBe(base)
    expect(key(row({ date: '19/10/2026 21:41' }))).not.toBe(base)
    expect(key(row({ first: 'Segundo' }))).not.toBe(base)
    expect(key(row({ code: 'M01' }))).not.toBe(base)
    // Two rows that say the same (filled in the same minute): two keys, two instants a second apart, in order.
    const twins = parse(csv([row(), row()])).rows
    expect(twins[0]?.key).toBe(base)
    expect(twins[1]?.key).not.toBe(base)
    expect((twins[1]?.playedAt?.getTime() ?? 0) - (twins[0]?.playedAt?.getTime() ?? 0)).toBe(1000)
  })
})

describe('the plan of an import', () => {
  const existing = (id: string, iso: string, overrides: Partial<SheetExistingMatch> = {}): SheetExistingMatch => ({
    id,
    deckId: '3',
    result: 'win',
    playedAt: new Date(iso),
    clientRef: null,
    ...overrides,
  })

  it('column K skips the row; a key already in the app is a repeat; the rest is new', () => {
    const sheet = parse(
      csv([
        row({ k: '6', date: '17/10/2026 22:19' }),
        row({ date: '19/10/2026 21:40' }),
        row({ code: 'M01', deck: 'butterfree', date: '19/10/2026 23:00', first: '' }),
      ]),
    )
    const imported = sheet.rows[1]?.key as string
    const plan = planSheetImport(
      sheet,
      context({
        existing: [
          existing('6', '2026-10-18T01:19:00Z'),
          existing('40', '2026-10-20T00:40:00Z', { clientRef: imported }),
        ],
      }),
    )
    expect(plan.rows.map((item) => [item.row, item.status, item.matchId, item.write])).toEqual([
      [5, 'in_app', '6', false],
      [6, 'duplicate', '40', false],
      [7, 'new', null, true],
    ])
    expect(plan.rows[2]).toMatchObject({ deckId: '7', wentFirst: null })
    expect(plan.counts).toMatchObject({ rows: 3, new: 1, inApp: 1, duplicate: 1, write: 1, warnings: 1 })
  })

  it('uploading the same sheet again writes nothing', () => {
    const sheet = parse(csv([row(), row({ code: 'M01', date: '19/10/2026 23:00' }), row()]))
    const first = planSheetImport(sheet, context())
    expect(first.counts.write).toBe(3)
    // What the first import stored: each row's key as the match's clientRef.
    const stored = first.rows.map((item, at) =>
      existing(String(50 + at), (item.playedAt as Date).toISOString(), {
        deckId: item.deckId as string,
        clientRef: item.key,
      }),
    )
    const again = planSheetImport(
      parse(csv([row(), row({ code: 'M01', date: '19/10/2026 23:00' }), row()])),
      context({ existing: stored }),
    )
    expect(again.counts).toMatchObject({ new: 0, duplicate: 3, write: 0, possibleDuplicate: 0 })
  })

  it('a code without a deck waits for one; the chosen deck wins over the saved one; a deck that is gone does not count', () => {
    const sheet = parse(csv([row({ code: 'M22', deck: 'latias' }), row({ date: '19/10/2026 22:30' })]))
    const plan = planSheetImport(sheet, context())
    expect(plan.rows.map((item) => item.status)).toEqual(['unmapped', 'new'])
    expect(plan.rows[0]?.errors).toEqual(['Elegí el mazo de M22.'])
    expect(plan.codes).toEqual([
      {
        code: 'M08',
        names: ['mawile'],
        rows: 1,
        deckId: '3',
        source: 'saved',
        suggestion: { deckId: '3', reason: 'por el nombre «mawile»' },
      },
      {
        code: 'M22',
        names: ['latias'],
        rows: 1,
        deckId: null,
        source: null,
        suggestion: { deckId: '9', reason: 'por el nombre «latias»' },
      },
    ])
    const chosen = planSheetImport(sheet, context({ chosen: { M22: '9', M08: '7' } }))
    expect(chosen.rows.map((item) => [item.status, item.deckId])).toEqual([
      ['new', '9'],
      ['new', '7'],
    ])
    expect(chosen.codes.map((code) => [code.code, code.source])).toEqual([
      ['M08', 'chosen'],
      ['M22', 'chosen'],
    ])
    expect(planSheetImport(sheet, context({ saved: { M08: '99' } })).rows[1]?.status).toBe('unmapped')
    expect(planSheetImport(sheet, context({ chosen: { M08: null } })).rows[1]?.status).toBe('unmapped')
  })

  it('the deck of a code is suggested by its rows already in the app before its name', () => {
    const sheet = parse(
      csv([
        row({ code: 'M30', deck: 'mawile', k: '6' }),
        row({ code: 'M30', deck: 'mawile', date: '19/10/2026 22:00' }),
      ]),
    )
    const plan = planSheetImport(
      sheet,
      context({ existing: [existing('6', '2026-10-18T01:19:00Z', { deckId: '12' })] }),
    )
    expect(plan.codes[0]).toMatchObject({
      code: 'M30',
      deckId: null,
      suggestion: { deckId: '12', reason: 'por la partida n.º 6' },
    })
    expect(suggestDeckByName(['cachorros '], DECKS)?.id).toBe('12')
    expect(suggestDeckByName(['butterfree'], DECKS)?.id).toBe('7')
    expect(suggestDeckByName(['zzz'], DECKS)).toBeNull()
  })

  it('a match with the deck and the result 15 minutes around is a possible repeat, left out unless picked', () => {
    const sheet = parse(csv([row({ date: '19/10/2026 21:40' }), row({ date: '19/10/2026 23:40' })]))
    const near = existing('31', '2026-10-20T00:52:00Z')
    const plan = planSheetImport(sheet, context({ existing: [near] }))
    expect(plan.rows.map((item) => [item.status, item.write])).toEqual([
      ['possible_duplicate', false],
      ['new', true],
    ])
    expect(plan.rows[0]?.duplicateOf?.id).toBe('31')
    expect(plan.counts).toMatchObject({ possibleDuplicate: 1, picked: 0, write: 1 })
    const picked = planSheetImport(sheet, context({ existing: [near], include: [5] }))
    expect(picked.rows[0]?.write).toBe(true)
    expect(picked.counts).toMatchObject({ picked: 1, write: 2 })
    expect(picked.fingerprint).not.toBe(plan.fingerprint)
    // 16 minutes away, another result or another deck: not the same match.
    for (const other of [
      existing('31', '2026-10-20T00:56:01Z'),
      existing('31', '2026-10-20T00:52:00Z', { result: 'loss' }),
      existing('31', '2026-10-20T00:52:00Z', { deckId: '7' }),
    ]) {
      expect(planSheetImport(sheet, context({ existing: [other] })).rows[0]?.status).toBe('new')
    }
  })

  it('a match that another row already is (by column K or its key) is no possible repeat of a row near it', () => {
    const sheet = parse(csv([row({ date: '19/10/2026 21:30', k: '30' }), row({ date: '19/10/2026 21:40' })]))
    const plan = planSheetImport(sheet, context({ existing: [existing('30', '2026-10-20T00:30:00Z')] }))
    expect(plan.rows[1]?.status).toBe('new')
    // A row edited after its import (another rival): its old match is nobody's, so it is a possible repeat.
    const edited = parse(csv([row({ rival: 'Mega-Blaziken ex' })]))
    const before = parse(csv([row()])).rows[0]?.key as string
    const stored = existing('40', '2026-10-20T00:40:00Z', { clientRef: before })
    expect(planSheetImport(edited, context({ existing: [stored] })).rows[0]?.status).toBe('possible_duplicate')
  })

  it('more than the cap to write: too many, whatever is picked', () => {
    const rows: Cells[] = []
    for (let i = 0; i <= SHEET_IMPORT_MAX_NEW; i++) {
      const minute = String(i % 60).padStart(2, '0')
      const hour = String(Math.floor(i / 60) % 24).padStart(2, '0')
      rows.push(row({ date: `${String(1 + Math.floor(i / 1440)).padStart(2, '0')}/10/2026 ${hour}:${minute}` }))
    }
    rows[0] = row({ date: '01/10/2026 00:00', rank: 'Ultra Ball 2' })
    const plan = planSheetImport(parse(csv(rows)), context())
    expect(plan.counts.write).toBe(SHEET_IMPORT_MAX_NEW + 1)
    expect(plan.tooMany).toBe(true)
    // Review: nothing of it is applied, so its ranks are not planned (a cost per row).
    expect(plan.rows[0]?.rankPlan).toBeNull()
    const fits = planSheetImport(parse(csv(rows.slice(0, -1))), context())
    expect(fits.tooMany).toBe(false)
    expect(fits.rows[0]?.rankPlan?.action).toBe('skip')
  })

  it('review: two wins in a row with the deck, the first imported before: the second is new, not its repeat', () => {
    const sheet = parse(csv([row({ date: '19/10/2026 21:30' }), row({ date: '19/10/2026 21:40' })]))
    const first = sheet.rows[0]?.key as string
    const plan = planSheetImport(
      sheet,
      context({ existing: [existing('30', '2026-10-20T00:30:00Z', { clientRef: first })] }),
    )
    expect(plan.rows.map((item) => [item.status, item.matchId])).toEqual([
      ['duplicate', '30'],
      ['new', null],
    ])
    expect(plan.orphans).toEqual([])
  })

  it('review: exactly 15 minutes is a possible repeat, and the nearest match is the one named', () => {
    const sheet = parse(csv([row({ date: '19/10/2026 21:40' })]))
    const edge = planSheetImport(sheet, context({ existing: [existing('31', '2026-10-20T00:55:00Z')] }))
    expect(edge.rows[0]?.status).toBe('possible_duplicate')
    const two = planSheetImport(
      sheet,
      context({ existing: [existing('31', '2026-10-20T00:52:00Z'), existing('32', '2026-10-20T00:38:00Z')] }),
    )
    expect(two.rows[0]?.duplicateOf?.id).toBe('32')
  })

  it('review: a row corrected after its import, without K, finds the match of its old version the same day', () => {
    const before = parse(csv([row({ date: '19/10/2026 21:40' })])).rows[0]?.key as string
    const old = existing('40', '2026-10-20T00:40:00Z', { clientRef: before })
    for (const corrected of [
      row({ date: '19/10/2026 21:40', result: 'Derrota' }),
      row({ date: '19/10/2026 21:40', code: 'M01' }),
      row({ date: '19/10/2026 22:40' }),
    ]) {
      const plan = planSheetImport(parse(csv([corrected])), context({ existing: [old] }))
      expect(plan.rows[0]).toMatchObject({ status: 'possible_duplicate', duplicateKind: 'sheet', write: false })
      expect(plan.rows[0]?.duplicateOf?.id).toBe('40')
      expect(plan.orphans.map((match) => match.id)).toEqual(['40'])
    }
    // A date that had no time (the match went in at 12:00) and got one.
    const noon = parse(csv([row({ date: '19/10/2026' })])).rows[0] as SheetRow
    const atNoon = existing('41', (noon.playedAt as Date).toISOString(), { clientRef: noon.key })
    const timed = planSheetImport(parse(csv([row({ date: '19/10/2026 21:40' })])), context({ existing: [atNoon] }))
    expect(timed.rows[0]).toMatchObject({ status: 'possible_duplicate', duplicateKind: 'sheet' })
    // Another day, or a match typed in the app (no key of the sheet): new.
    const otherDay = parse(csv([row({ date: '20/10/2026 21:40', result: 'Derrota' })]))
    expect(planSheetImport(otherDay, context({ existing: [old] })).rows[0]?.status).toBe('new')
    const typed = existing('42', '2026-10-20T00:40:00Z', { result: 'loss' })
    const sheet = parse(csv([row({ date: '19/10/2026 21:40' })]))
    expect(planSheetImport(sheet, context({ existing: [typed] })).rows[0]?.status).toBe('new')
  })

  it('review: the fingerprint changes with what is written — the deck, the rank noted, the mode', () => {
    const sheet = parse(csv([row({ rank: 'Ultra Ball 2' })]))
    const base = planSheetImport(sheet, context())
    expect(base.rows[0]?.rankPlan?.action).toBe('note')
    expect(planSheetImport(sheet, context()).fingerprint).toBe(base.fingerprint)
    expect(planSheetImport(sheet, context({ chosen: { M08: '9' } })).fingerprint).not.toBe(base.fingerprint)
    const noted: RankChange = { id: '1', at: new Date('2026-10-19T10:00:00Z'), rank: 'ultra-2', points: null }
    const same = planSheetImport(sheet, context({ changes: [noted] }))
    expect(same.rows[0]?.rankPlan?.action).toBe('same')
    expect(same.fingerprint).not.toBe(base.fingerprint)
    // The mode alone (a row without a rank, so nothing else changes).
    const plain = parse(csv([row()]))
    expect(planSheetImport(plain, context({ mode: 'casual' })).fingerprint).not.toBe(
      planSheetImport(plain, context()).fingerprint,
    )
  })

  it('Codex on #143: 10.000 rows against 20.000 matches are planned at once (indexed, not every match per row)', () => {
    // Rows every 3 minutes from 01/10 (one per row, all M08 Victoria); against them, 10.000 matches of another
    // result (the old search looked at each one for each row) and 10.000 old sheet rows of September (one time-zone
    // format per orphan and row: a hundred million).
    const rows: Cells[] = []
    const start = Date.UTC(2026, 9, 1, 3, 0)
    const wall = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    for (let i = 0; i < 10_000; i++) {
      rows.push(row({ date: wall.format(new Date(start + i * 3 * 60_000)).replace(', ', ' ') }))
    }
    const sheet = parse(csv(rows))
    expect(sheet.rows).toHaveLength(10_000)
    const existing: SheetExistingMatch[] = []
    for (let i = 0; i < 10_000; i++) {
      existing.push({
        id: String(i + 1),
        deckId: '3',
        result: 'loss',
        playedAt: new Date(start + i * 3 * 60_000 + 60_000),
        clientRef: null,
      })
      existing.push({
        id: String(20_000 + i),
        deckId: '3',
        result: 'win',
        playedAt: new Date(Date.UTC(2026, 8, 1) + i * 60_000),
        clientRef: `sheet:${i}`,
      })
    }
    const began = performance.now()
    const plan = planSheetImport(sheet, context({ existing }))
    const ms = performance.now() - began
    expect(plan.counts).toMatchObject({ new: 10_000, possibleDuplicate: 0 })
    expect(plan.orphans).toHaveLength(10_000)
    expect(ms).toBeLessThan(3000)
    // And still the nearest within 15 minutes: one win a minute after the 5.000th row.
    const after = new Date(start + 4999 * 3 * 60_000 + 60_000)
    const one = planSheetImport(
      sheet,
      context({
        existing: [...existing, { ...existing[0], id: '99999', result: 'win', playedAt: after } as SheetExistingMatch],
      }),
    )
    expect(one.rows[4999]).toMatchObject({ status: 'possible_duplicate', duplicateKind: 'near' })
    expect(one.rows[4999]?.duplicateOf?.id).toBe('99999')
    // The rows 15 minutes around it (every 3 minutes: 10 of them) may be that match; the one 18 minutes away is not.
    expect(one.counts.possibleDuplicate).toBe(10)
    expect(one.rows.flatMap((item, at) => (item.status === 'possible_duplicate' ? [at] : []))).toEqual([
      4995, 4996, 4997, 4998, 4999, 5000, 5001, 5002, 5003, 5004,
    ])
  }, 30_000)

  it('review: a possible repeat is named «n.º X, Victoria del 19/10 21:35», and says when it is an old sheet row', () => {
    const match = existing('30', '2026-10-20T00:35:00Z')
    expect(duplicateTextEs(match, ZONE)).toBe('n.º 30, Victoria del 19/10 21:35')
    expect(duplicateTextEs(match, ZONE, 'sheet')).toBe(
      'n.º 30, Victoria del 19/10 21:35, importada de una fila que ya no está igual en la hoja',
    )
  })
})

describe('ranks from column H', () => {
  const change = (id: string, iso: string, rank: RankChange['rank'], points: number | null = null): RankChange => ({
    id,
    at: new Date(iso),
    rank,
    points,
  })

  it('noted a millisecond before the match (the rank it was played at), never twice the same in a row', () => {
    const sheet = parse(
      csv([
        row({ date: '19/10/2026 21:00', rank: 'Ultra Ball 4' }),
        row({ date: '19/10/2026 21:10', rank: 'Ultra Ball 4' }),
        row({ date: '19/10/2026 21:20' }),
        row({ date: '19/10/2026 21:30', rank: 'Master Ball' }),
      ]),
    )
    const plan = planSheetImport(sheet, context())
    expect(plan.rows.map((item) => item.rankPlan?.action ?? null)).toEqual(['note', 'same', null, 'note'])
    expect(plan.rows[0]?.rankPlan?.at?.toISOString()).toBe('2026-10-19T23:59:59.999Z')
    expect(plan.rows[1]?.warnings).toEqual([])
    expect(plan.counts.ranks).toBe(2)
  })

  it('the rank already noted at that moment or before is not noted again (Master Ball with points is Master Ball)', () => {
    const sheet = parse(csv([row({ date: '19/10/2026 21:00', rank: 'Master Ball' })]))
    const before = planSheetImport(sheet, context({ changes: [change('4', '2026-10-19T10:00:00Z', 'master', 1200)] }))
    expect(before.rows[0]?.rankPlan?.action).toBe('same')
    const other = planSheetImport(sheet, context({ changes: [change('5', '2026-10-19T23:59:59.999Z', 'ultra-4')] }))
    expect(other.rows[0]?.rankPlan).toMatchObject({ action: 'skip' })
    expect(other.rows[0]?.warnings[0]).toMatch(/Ya hay otro rango anotado en ese momento \(Ultra Ball 4\)/u)
    expect(other.counts.ranks).toBe(0)
  })

  it('outside every season, or not competitive: the match goes in, the rank does not', () => {
    const outside = parse(csv([row({ date: '05/10/2026 21:00', rank: 'Ultra Ball 2' })]))
    const plan = planSheetImport(outside, context())
    expect(plan.rows[0]).toMatchObject({ status: 'new', write: true, rankPlan: { action: 'skip' } })
    expect(plan.rows[0]?.warnings[0]).toMatch(/no cae en ninguna temporada/u)
    const casual = planSheetImport(parse(csv([row({ rank: 'Ultra Ball 2' })])), context({ mode: 'casual' }))
    expect(casual.rows[0]?.rankPlan?.action).toBe('skip')
    expect(casual.rows[0]?.warnings[0]).toMatch(/solo con partidas competitivas/u)
  })

  it('a row that is not written notes nothing', () => {
    const sheet = parse(csv([row({ rank: 'Master Ball', k: '6' })]))
    expect(planSheetImport(sheet, context()).rows[0]?.rankPlan).toBeNull()
  })
})

describe('the text for column K', () => {
  it('one line per row from the first with data, with the number in the app, empty for the rest', () => {
    const sheet = parse(
      csv([
        row({ k: '6', date: '17/10/2026 22:19' }),
        row({ date: '19/10/2026 21:40' }),
        ['', '', '', '', '', '', '', '', '', '', ''],
        row({ date: '' }),
        row({ date: '19/10/2026 23:00' }),
      ]),
    )
    const dup = sheet.rows[1]?.key as string
    const plan = planSheetImport(
      sheet,
      context({
        existing: [
          { id: '40', deckId: '3', result: 'win', playedAt: new Date('2026-10-20T00:40:00Z'), clientRef: dup },
        ],
      }),
    )
    expect(sheetColumnK(sheet, plan.rows, new Map([[9, '41']]))).toEqual({ firstRow: 5, text: '6\n40\n\n\n41' })
    expect(sheetColumnK(sheet, plan.rows)).toEqual({ firstRow: 5, text: '6\n40\n\n\n' })
    expect(sheetColumnK({ firstRow: null, lastRow: null }, [])).toBeNull()
  })

  it('review of #143: only numbers or nothing — a K with a line break or a typo is no line of its own', () => {
    const sheet = parse(
      csv([
        row({ k: '32\nrevisar', date: '17/10/2026 22:19' }),
        row({ k: 'n.º 14', date: '17/10/2026 22:29' }),
        row({ k: 'sí', date: '17/10/2026 22:39' }),
        row({ date: '17/10/2026 22:49' }),
      ]),
    )
    const plan = planSheetImport(sheet, context())
    const block = sheetColumnK(sheet, plan.rows, new Map([[8, '50']]))
    expect(block).toEqual({ firstRow: 5, text: '\n14\n\n50' })
    expect(block?.text.split('\n')).toHaveLength(4)
  })
})

describe('review of #143: the match of column K, and a row whose day was corrected', () => {
  const match = (id: string, iso: string, overrides: Partial<SheetExistingMatch> = {}): SheetExistingMatch => ({
    id,
    deckId: '3',
    result: 'win',
    playedAt: new Date(iso),
    clientRef: null,
    ...overrides,
  })

  it('a K number whose match has another deck, result or date (pasted shifted) is said; the row is skipped anyway', () => {
    const sheet = parse(csv([row({ k: '30', date: '19/10/2026 21:40' })]))
    const fine = planSheetImport(sheet, context({ existing: [match('30', '2026-10-20T00:40:00Z')] }))
    expect(fine.rows[0]).toMatchObject({ status: 'in_app', warnings: [] })
    const shifted = planSheetImport(
      sheet,
      context({ existing: [match('30', '2026-10-22T00:40:00Z', { deckId: '7', result: 'loss' })] }),
    )
    expect(shifted.rows[0]).toMatchObject({ status: 'in_app', write: false })
    expect(shifted.rows[0]?.warnings).toEqual([
      'La partida n.º 30 de la columna K tiene otro mazo, otro resultado y otra fecha: ¿pegaste los números corridos?',
    ])
    const late = planSheetImport(sheet, context({ existing: [match('30', '2026-10-21T00:41:00Z')] }))
    expect(late.rows[0]?.warnings[0]).toMatch(/tiene otra fecha:/u)
  })

  it('a row whose day was corrected finds its old match (same deck, result, who went first and rival) on another day', () => {
    const before = parse(csv([row({ date: '19/10/2026 21:40' })])).rows[0] as SheetRow
    const old = match('40', '2026-10-20T00:40:00Z', {
      clientRef: before.key,
      wentFirst: true,
      opponent: 'Hoopa ex / Mega-Absol ex',
    })
    const corrected = parse(csv([row({ date: '20/10/2026 21:40' })]))
    const plan = planSheetImport(corrected, context({ existing: [old] }))
    expect(plan.rows[0]).toMatchObject({ status: 'possible_duplicate', duplicateKind: 'sheet', write: false })
    expect(plan.rows[0]?.duplicateOf?.id).toBe('40')
    // Another rival (or result, or who went first) on another day: a new match.
    const other = parse(csv([row({ date: '20/10/2026 21:40', rival: 'Mega-Blaziken ex' })]))
    expect(planSheetImport(other, context({ existing: [old] })).rows[0]?.status).toBe('new')
    const second = parse(csv([row({ date: '20/10/2026 21:40', first: 'Segundo' })]))
    expect(planSheetImport(second, context({ existing: [old] })).rows[0]?.status).toBe('new')
    // Three days away is another match that says the same, not a day corrected.
    const far = parse(csv([row({ date: '16/10/2026 21:40' })]))
    expect(planSheetImport(far, context({ existing: [old] })).rows[0]?.status).toBe('new')
  })
})
