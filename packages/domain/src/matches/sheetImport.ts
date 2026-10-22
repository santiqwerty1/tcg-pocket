/**
 * «Importar desde la hoja» (T-022): the owner's match sheet (tab «Partidas» of his Google Sheet), exported as CSV or
 * copied and pasted, read into matches without duplicating any. The header row is found by its text («Código»,
 * «Resultado», «Fecha»…), wherever it is; every row after it with something written is a row of the sheet.
 *
 * Columns: Código (M01–M25, a deck of his list), Salida (Primero/Segundo, may be empty), Resultado, Mazo (automático:
 * a short name, only for the deck suggestion), Fecha (dd/mm/aaaa hh:mm in his time zone), Mazo rival, Notas, Rango
 * (the rank the match was played at, when he changed it; usually empty), Rango (efectivo) and Temporada (formulas, not
 * read) and «En la app (n.º)» (the match's number in the app once imported).
 *
 * Without duplicating: a row with its number in the app is skipped; any other row has a key (`sheet:` and a hash of
 * the date, the code, the result, who went first and the rival, normalized) stored as the match's `clientRef`, so
 * uploading the sheet again finds it; and a match of the app with the same deck and result 15 minutes around is a
 * «posible repetida», left out unless the owner picks it.
 */
import { hashText } from '../catalog/hash.js'
import { DELIMITERS, type Delimiter, parseDelimited } from './delimited.js'
import { cleanOpponent, opponentKey } from './opponents.js'
import { type Rank, type RankChange, type RankedSeason, rankAt, rankLabelEs, seasonOf } from './ranked.js'
import {
  MATCH_NOTE_MAX_LENGTH,
  MATCH_RESULT_LABEL_ES,
  type MatchMode,
  type MatchResult,
  OPPONENT_MAX_LENGTH,
} from './types.js'

/** Matches written by one import, at most (one transaction). */
export const SHEET_IMPORT_MAX_NEW = 500
/** Rows with data read from one text, at most (rows already in the app are cheap: they are skipped). */
export const SHEET_IMPORT_MAX_ROWS = 10_000
/** Characters of the text, at most. */
export const SHEET_IMPORT_MAX_CHARS = 4_000_000
/** A match of the app this close to a row, with its deck and result, may be the same match. */
export const SHEET_DUPLICATE_WINDOW_MS = 15 * 60 * 1000
/** A date further ahead than this is a typo, not a clock. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000
/** Longest code of a deck in the sheet («M01»; room for the owner's own names). */
export const SHEET_CODE_MAX_LENGTH = 20
/** Prefix of the key of a row in `clientRef` (the phone's keys are UUIDs). */
export const SHEET_KEY_PREFIX = 'sheet:'

export type SheetColumn = 'code' | 'wentFirst' | 'result' | 'deckName' | 'date' | 'opponent' | 'note' | 'rank' | 'appId'

export const SHEET_COLUMN_LABEL_ES: Readonly<Record<SheetColumn, string>> = {
  code: 'Código',
  wentFirst: 'Salida',
  result: 'Resultado',
  deckName: 'Mazo',
  date: 'Fecha',
  opponent: 'Mazo rival',
  note: 'Notas',
  rank: 'Rango',
  appId: 'En la app (n.º)',
}

/** Lower case, no diacritics, whitespace collapsed. */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The column a header names, or null («Rango (efectivo)», «Temporada» and the rest are not read). */
export function sheetColumnOf(header: string): SheetColumn | null {
  const text = fold(header)
  if (text === 'codigo') return 'code'
  if (text === 'salida') return 'wentFirst'
  if (text === 'resultado') return 'result'
  if (text.includes('rival')) return 'opponent'
  if (text.startsWith('mazo')) return 'deckName'
  if (text.startsWith('fecha')) return 'date'
  if (text === 'notas' || text === 'nota') return 'note'
  if (text === 'rango') return 'rank'
  if (text.startsWith('en la app')) return 'appId'
  return null
}

interface Header {
  /** 0-based record. */
  at: number
  columns: Map<SheetColumn, number>
}

/** The first record (of the first 50) with «Código» and «Resultado», and where each column is. */
function findHeader(records: readonly string[][]): Header | null {
  for (let at = 0; at < Math.min(records.length, 50); at++) {
    const columns = new Map<SheetColumn, number>()
    for (const [index, cell] of (records[at] ?? []).entries()) {
      const column = sheetColumnOf(cell)
      if (column && !columns.has(column)) columns.set(column, index)
    }
    if (columns.has('code') && columns.has('result')) return { at, columns }
  }
  return null
}

/** The delimiter whose header has the most columns (on the start of the text: the header is in its first records). */
export function detectDelimiter(text: string): Delimiter | null {
  const head = text.slice(0, 65_536)
  let best: { delimiter: Delimiter; columns: number } | null = null
  for (const delimiter of DELIMITERS) {
    const header = findHeader(parseDelimited(head, delimiter))
    if (header && (!best || header.columns.size > best.columns)) best = { delimiter, columns: header.columns.size }
  }
  return best?.delimiter ?? null
}

// -------------------------------------------------------------------------------------------------------------------
// Cells
// -------------------------------------------------------------------------------------------------------------------

/** «m8», «M08 » → «M08»; anything else as written (upper case, no spaces); null when empty. */
export function normalizeSheetCode(text: string): string | null {
  const compact = text.replace(/\s+/gu, '').toUpperCase()
  if (compact === '') return null
  const numbered = /^M0*(\d{1,3})$/u.exec(compact)
  return numbered ? `M${(numbered[1] as string).padStart(2, '0')}` : compact
}

function parseResult(text: string): MatchResult | null | undefined {
  const value = fold(text)
  if (value === '') return null
  if (['victoria', 'ganada', 'gane', 'v', 'win'].includes(value)) return 'win'
  if (['derrota', 'perdida', 'perdi', 'd', 'loss'].includes(value)) return 'loss'
  if (['empate', 'e', 'tie'].includes(value)) return 'tie'
  return undefined
}

function parseWentFirst(text: string): boolean | null | undefined {
  const value = fold(text).replace(/[°º.]/gu, '')
  if (value === '') return null
  if (['primero', 'primera', '1', '1ro', '1ra', 'first'].includes(value)) return true
  if (['segundo', 'segunda', '2', '2do', '2da', 'second'].includes(value)) return false
  return undefined
}

const BALLS: Readonly<Record<string, string>> = {
  principiante: 'beginner',
  poke: 'poke',
  'poke ball': 'poke',
  super: 'great',
  'super ball': 'great',
  ultra: 'ultra',
  'ultra ball': 'ultra',
}

/** «Ultra Ball 3» → `ultra-3`, «Master Ball» → `master`; null when empty, undefined when not a rank. */
export function parseSheetRank(text: string): Rank | null | undefined {
  const value = fold(text).replace(/[-.]/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (value === '') return null
  if (value === 'master' || value === 'master ball') return 'master'
  const tiered = /^(.+?) ?([1-4])$/u.exec(value)
  const ball = tiered ? BALLS[tiered[1] as string] : undefined
  return ball ? (`${ball}-${tiered?.[2]}` as Rank) : undefined
}

/** A wall time read from the sheet: its parts and whether it had a time of day. */
interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  hasTime: boolean
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: +(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u
const YMD = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u

/** «17/10/2026 22:19» (also with seconds, without the time, or as 2026-10-17 22:19); null when not a date. */
export function parseSheetDate(text: string): WallTime | null {
  const value = text.trim().replace(/,\s*/gu, ' ').replace(/\s+/gu, ' ')
  const dmy = DMY.exec(value)
  const ymd = dmy ? null : YMD.exec(value)
  if (!dmy && !ymd) return null
  const parts = (dmy ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]] : ymd?.slice(1, 7)) as (string | undefined)[]
  const [year, month, day, hour, minute, second] = parts.map((part) => (part === undefined ? undefined : Number(part)))
  const wall: WallTime = {
    year: year as number,
    month: month as number,
    day: day as number,
    hour: hour ?? 0,
    minute: minute ?? 0,
    second: second ?? 0,
    hasTime: hour !== undefined,
  }
  const days = new Date(Date.UTC(wall.year, wall.month, 0)).getUTCDate()
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > days) return null
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return null
  return wall
}

const OFFSET_FORMATS = new Map<string, Intl.DateTimeFormat>()

/** How far the zone's wall clock is ahead of UTC at an instant (whole seconds). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  let format = OFFSET_FORMATS.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    OFFSET_FORMATS.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return wall - Math.floor(instant / 1000) * 1000
}

/** The instant a wall time of the zone names (the earlier one when a clock change repeats it). */
export function wallTimeToInstant(wall: Omit<WallTime, 'hasTime'>, timeZone: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  const first = guess - zoneOffsetMs(guess, timeZone)
  const second = guess - zoneOffsetMs(first, timeZone)
  return new Date(Math.min(first, second))
}

function wallText(wall: WallTime): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const date = `${wall.year}-${two(wall.month)}-${two(wall.day)}`
  if (!wall.hasTime) return date
  return `${date} ${two(wall.hour)}:${two(wall.minute)}${wall.second ? `:${two(wall.second)}` : ''}`
}

// -------------------------------------------------------------------------------------------------------------------
// Rows
// -------------------------------------------------------------------------------------------------------------------

export interface SheetRow {
  /** 1-based record of the text: the sheet's row when the export (or the copy) starts at row 1. */
  row: number
  code: string | null
  /** Column D as written (trimmed), only for the deck suggestion. */
  deckName: string | null
  result: MatchResult | null
  wentFirst: boolean | null
  /**
   * The instant of the date in the owner's time zone. Rows of the same instant are spread a second each, in the
   * sheet's order (so they keep it, and a rank noted for each has its own moment).
   */
  playedAt: Date | null
  /** The date as written. */
  dateText: string
  opponent: string | null
  note: string
  rank: Rank | null
  /** Column K: the number of the match in the app, and the cell as written. */
  appId: string | null
  appIdText: string
  /** `clientRef` of the match: `sheet:` and the hash of the row (null when the row cannot be imported). */
  key: string | null
  errors: string[]
  warnings: string[]
}

export interface ParsedSheet {
  delimiter: Delimiter | null
  /** 1-based record of the header row. */
  headerRow: number | null
  /** The rows with something written after the header, in order. */
  rows: SheetRow[]
  /** The first and the last of them: the block for column K covers every row in between. */
  firstRow: number | null
  lastRow: number | null
  /** Why nothing can be read (no header, too long): no rows then. */
  error: string | null
}

const READ_COLUMNS: readonly SheetColumn[] = [
  'code',
  'wentFirst',
  'result',
  'date',
  'opponent',
  'note',
  'rank',
  'appId',
]

function emptySheet(error: string, delimiter: Delimiter | null = null, headerRow: number | null = null): ParsedSheet {
  return { delimiter, headerRow, rows: [], firstRow: null, lastRow: null, error }
}

/** Reads the sheet: header, rows and, for each row, what it says and what is wrong with it. */
export function parseSheet(text: string, options: { timeZone: string; now: Date }): ParsedSheet {
  if (text.length > SHEET_IMPORT_MAX_CHARS) {
    return emptySheet('El texto es demasiado largo: exportá solo la pestaña «Partidas».')
  }
  const delimiter = detectDelimiter(text)
  if (!delimiter) {
    return emptySheet(
      'No encontré la fila de encabezados («Código», «Resultado», «Fecha»…). Exportá la pestaña «Partidas» entera, o copiala desde la fila 1.',
    )
  }
  const records = parseDelimited(text, delimiter)
  const header = findHeader(records) as Header
  const headerRow = header.at + 1
  if (!header.columns.has('date')) {
    return emptySheet('Falta la columna «Fecha»: sin ella las partidas no tienen cuándo.', delimiter, headerRow)
  }
  const cell = (record: readonly string[], column: SheetColumn): string => {
    const index = header.columns.get(column)
    return index === undefined ? '' : (record[index] ?? '').trim()
  }
  const rows: SheetRow[] = []
  const walls = new Map<number, WallTime>()
  for (let at = header.at + 1; at < records.length; at++) {
    const record = records[at] as string[]
    // A row counts when something is written in a column that is read (D, I and J are formulas).
    if (READ_COLUMNS.every((column) => cell(record, column) === '')) continue
    if (rows.length >= SHEET_IMPORT_MAX_ROWS) {
      return emptySheet(
        `La hoja tiene más de ${new Intl.NumberFormat('es-AR').format(SHEET_IMPORT_MAX_ROWS)} filas con datos: importá una parte.`,
        delimiter,
        headerRow,
      )
    }
    const row: SheetRow = {
      row: at + 1,
      code: normalizeSheetCode(cell(record, 'code')),
      deckName: cell(record, 'deckName') || null,
      result: null,
      wentFirst: null,
      playedAt: null,
      dateText: cell(record, 'date'),
      opponent: cleanOpponent(cell(record, 'opponent')),
      note: cell(record, 'note'),
      rank: null,
      appId: null,
      appIdText: cell(record, 'appId'),
      key: null,
      errors: [],
      warnings: [],
    }
    if (row.appIdText !== '') {
      const number = row.appIdText.replace(/^(?:n\.?\s*[º°o]?\s*|#)/iu, '').trim()
      if (/^\d{1,9}$/u.test(number) && Number(number) > 0) row.appId = String(Number(number))
      else row.errors.push(`«En la app» dice «${row.appIdText}»: tiene que ser el número de la partida.`)
    }
    if (row.code === null) row.errors.push('Falta el código del mazo.')
    // Self-review: a code is a short name (M01–M25); a long text there is something else, and would be saved as a key.
    else if (row.code.length > SHEET_CODE_MAX_LENGTH) row.errors.push(`Código «${row.code}»: no es un código de mazo.`)
    const result = parseResult(cell(record, 'result'))
    if (result === null) row.errors.push('Falta el resultado.')
    else if (result === undefined)
      row.errors.push(`Resultado «${cell(record, 'result')}»: tiene que ser Victoria o Derrota.`)
    else row.result = result
    const wentFirst = parseWentFirst(cell(record, 'wentFirst'))
    if (wentFirst === undefined) {
      row.errors.push(`Salida «${cell(record, 'wentFirst')}»: tiene que ser Primero, Segundo o vacía.`)
    } else {
      row.wentFirst = wentFirst
      if (wentFirst === null) row.warnings.push('Sin «Salida»: el orden de turno queda sin anotar.')
    }
    if (row.dateText === '') {
      row.errors.push('Falta la fecha.')
    } else {
      const wall = parseSheetDate(row.dateText)
      if (!wall) {
        row.errors.push(`Fecha «${row.dateText}»: tiene que ser dd/mm/aaaa hh:mm.`)
      } else {
        if (!wall.hasTime) {
          wall.hour = 12
          row.warnings.push('La fecha no tiene hora: va a las 12:00.')
        }
        const playedAt = wallTimeToInstant(wall, options.timeZone)
        if (playedAt.getTime() > options.now.getTime() + FUTURE_TOLERANCE_MS) {
          row.errors.push(`La fecha ${row.dateText} todavía no llegó.`)
        } else {
          row.playedAt = playedAt
          walls.set(row.row, { ...wall, hasTime: wall.hasTime })
        }
      }
    }
    if (row.opponent !== null && row.opponent.length > OPPONENT_MAX_LENGTH) {
      row.errors.push(`El rival tiene ${row.opponent.length} caracteres: la app guarda hasta ${OPPONENT_MAX_LENGTH}.`)
    }
    if (row.note.length > MATCH_NOTE_MAX_LENGTH) {
      row.errors.push(`La nota tiene ${row.note.length} caracteres: la app guarda hasta ${MATCH_NOTE_MAX_LENGTH}.`)
    }
    const rank = parseSheetRank(cell(record, 'rank'))
    if (rank === undefined) row.warnings.push(`Rango «${cell(record, 'rank')}» desconocido: no lo anoto.`)
    else row.rank = rank
    rows.push(row)
  }
  spreadInstants(rows)
  assignKeys(rows, walls)
  return {
    delimiter,
    headerRow,
    rows,
    firstRow: rows[0]?.row ?? null,
    lastRow: rows.at(-1)?.row ?? null,
    error: null,
  }
}

/** Rows of the same instant: a second apart each, in the sheet's order (the first keeps it). */
function spreadInstants(rows: SheetRow[]): void {
  const used = new Set<number>()
  for (const row of rows) {
    if (!row.playedAt) continue
    let time = row.playedAt.getTime()
    while (used.has(time)) time += 1000
    used.add(time)
    if (time !== row.playedAt.getTime()) row.playedAt = new Date(time)
  }
}

/**
 * The key of each row that can be imported: date (as a wall time), code, result, who went first and the rival's key
 * (case, accents, punctuation and spaces do not matter), so retouching how a rival is written does not make a row new.
 * Two rows that say exactly the same get «#2», «#3»… in the sheet's order.
 */
function assignKeys(rows: SheetRow[], walls: ReadonlyMap<number, WallTime>): void {
  const seen = new Map<string, number>()
  for (const row of rows) {
    const wall = walls.get(row.row)
    if (!wall || row.code === null || row.result === null || row.errors.length > 0) continue
    const base = [
      'v1',
      wallText(wall),
      row.code,
      row.result,
      row.wentFirst === null ? '' : row.wentFirst ? 'first' : 'second',
      opponentKey(row.opponent) ?? '',
    ].join('|')
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    row.key = `${SHEET_KEY_PREFIX}${hashText(count === 1 ? base : `${base}#${count}`)}`
  }
}

// -------------------------------------------------------------------------------------------------------------------
// The plan: what each row does
// -------------------------------------------------------------------------------------------------------------------

export interface SheetExistingMatch {
  id: string
  deckId: string
  result: MatchResult
  playedAt: Date
  clientRef: string | null
}

export interface SheetDeck {
  id: string
  name: string
  archived: boolean
}

/**
 * - `in_app`: column K has its number: skipped.
 * - `duplicate`: a match of the app has its key (imported before): skipped.
 * - `possible_duplicate`: a match of the app with the deck and the result, 15 minutes around: skipped unless picked.
 * - `unmapped`: its code has no deck yet.
 * - `error`: something in it cannot be read (it does not go in).
 * - `new`: goes in.
 */
export type SheetRowStatus = 'in_app' | 'duplicate' | 'possible_duplicate' | 'unmapped' | 'error' | 'new'

export interface SheetRankPlan {
  rank: Rank
  label: string
  /** `note`: noted just before the match; `same`: already the rank then; `skip`: not noted (see `text`). */
  action: 'note' | 'same' | 'skip'
  text: string
  /** When it is noted (a millisecond before the match: the rank it was played at). */
  at: Date | null
}

export interface PlannedSheetRow extends SheetRow {
  status: SheetRowStatus
  deckId: string | null
  /** The app's match of the row: its number in column K, or the match with its key. */
  matchId: string | null
  /** The match it may repeat. */
  duplicateOf: SheetExistingMatch | null
  /** Written by the import: a new row, or a possible duplicate the owner picked. */
  write: boolean
  /** Its rank (column H), for a row written. */
  rankPlan: SheetRankPlan | null
}

export interface SheetCodeMapping {
  code: string
  /** The names of column D seen with it. */
  names: string[]
  /** Rows that need its deck (new, possible duplicates and unmapped). */
  rows: number
  /** The deck it goes to now: chosen in this preview, or saved from an import before. */
  deckId: string | null
  source: 'chosen' | 'saved' | null
  /** A deck to propose: the deck of its rows already in the app, else by the name of column D. */
  suggestion: { deckId: string; reason: string } | null
}

export interface SheetPlanCounts {
  rows: number
  new: number
  inApp: number
  duplicate: number
  possibleDuplicate: number
  /** Possible duplicates picked to go in. */
  picked: number
  unmapped: number
  errors: number
  warnings: number
  /** Matches written, and ranks noted. */
  write: number
  ranks: number
}

export interface SheetPlan {
  rows: PlannedSheetRow[]
  codes: SheetCodeMapping[]
  counts: SheetPlanCounts
  /** More than SHEET_IMPORT_MAX_NEW to write: nothing is applied. */
  tooMany: boolean
  /** Fingerprint of what would be written: applying checks it is still the same as the preview shown. */
  fingerprint: string
}

export interface SheetPlanContext {
  decks: readonly SheetDeck[]
  /** The mapping saved by an import before (code → deck id). */
  saved: Readonly<Record<string, string>>
  /** The mapping chosen in the preview (null: no deck). It wins over the saved one. */
  chosen: Readonly<Record<string, string | null>>
  /** The app's matches the rows may be: those of column K, those with their keys and those around their dates. */
  existing: readonly SheetExistingMatch[]
  /** Rows of possible duplicates to import anyway. */
  include: readonly number[]
  mode: MatchMode
  seasons: readonly RankedSeason[]
  changes: readonly RankChange[]
  timeZone: string
}

function nameTokens(text: string): string[] {
  return fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length >= 3)
}

/** The deck whose name has most of the words of column D («mawile» → «Mega-Mawile ex»), or null. */
export function suggestDeckByName(names: readonly string[], decks: readonly SheetDeck[]): SheetDeck | null {
  const tokens = [...new Set(names.flatMap(nameTokens))]
  if (tokens.length === 0) return null
  let best: { deck: SheetDeck; score: number } | null = null
  for (const deck of decks) {
    const target = ` ${nameTokens(deck.name).join(' ')} `
    let score = 0
    for (const token of tokens) score += target.includes(` ${token} `) ? 2 : target.includes(token) ? 1 : 0
    if (score === 0) continue
    if (!deck.archived) score += 0.5
    if (!best || score > best.score || (score === best.score && deck.name.length < best.deck.name.length)) {
      best = { deck, score }
    }
  }
  return best?.deck ?? null
}

function formatShort(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/** What each row does, the decks of the codes and the counts. Pure: the caller loads what it needs. */
export function planSheetImport(sheet: ParsedSheet, context: SheetPlanContext): SheetPlan {
  const decks = new Map(context.decks.map((deck) => [deck.id, deck]))
  const byId = new Map(context.existing.map((match) => [match.id, match]))
  const byRef = new Map(
    context.existing.flatMap((match) => (match.clientRef ? [[match.clientRef, match] as const] : [])),
  )
  // A match of the app that another row already is (by column K or by its key) is that row's, not a possible repeat.
  const claimed = new Set<string>()
  for (const row of sheet.rows) {
    if (row.appId) claimed.add(row.appId)
    const keyed = row.key ? byRef.get(row.key) : undefined
    if (keyed) claimed.add(keyed.id)
  }
  const deckOf = (code: string): { deckId: string | null; source: SheetCodeMapping['source'] } => {
    if (Object.hasOwn(context.chosen, code)) {
      const chosen = context.chosen[code]
      return chosen && decks.has(chosen) ? { deckId: chosen, source: 'chosen' } : { deckId: null, source: null }
    }
    const saved = context.saved[code]
    return saved && decks.has(saved) ? { deckId: saved, source: 'saved' } : { deckId: null, source: null }
  }
  const include = new Set(context.include)
  const rows: PlannedSheetRow[] = sheet.rows.map((row) => {
    const planned: PlannedSheetRow = {
      ...row,
      errors: [...row.errors],
      warnings: [...row.warnings],
      status: 'new',
      deckId: null,
      matchId: null,
      duplicateOf: null,
      write: false,
      rankPlan: null,
    }
    if (row.appId) {
      // Column K rules: whatever else the row says, it is in the app already.
      planned.status = 'in_app'
      planned.matchId = row.appId
      planned.errors = []
      planned.warnings = byId.has(row.appId)
        ? []
        : [`La partida n.º ${row.appId} no está en la app (¿la borraste?): la fila se saltea igual.`]
      return planned
    }
    if (planned.errors.length > 0) {
      planned.status = 'error'
      return planned
    }
    const keyed = row.key ? byRef.get(row.key) : undefined
    if (keyed) {
      planned.status = 'duplicate'
      planned.matchId = keyed.id
      planned.warnings = []
      return planned
    }
    const { deckId } = deckOf(row.code as string)
    if (!deckId) {
      planned.status = 'unmapped'
      planned.errors.push(`Elegí el mazo de ${row.code}.`)
      return planned
    }
    planned.deckId = deckId
    const at = (row.playedAt as Date).getTime()
    const near = context.existing
      .filter(
        (match) =>
          !claimed.has(match.id) &&
          match.deckId === deckId &&
          match.result === row.result &&
          Math.abs(match.playedAt.getTime() - at) <= SHEET_DUPLICATE_WINDOW_MS,
      )
      .sort((a, b) => Math.abs(a.playedAt.getTime() - at) - Math.abs(b.playedAt.getTime() - at))[0]
    if (near) {
      planned.status = 'possible_duplicate'
      planned.duplicateOf = near
      planned.write = include.has(row.row)
      return planned
    }
    planned.write = true
    return planned
  })
  planRanks(rows, context)
  const codes = mappings(rows, context, deckOf, byId, decks)
  const count = (status: SheetRowStatus) => rows.filter((row) => row.status === status).length
  const written = rows.filter((row) => row.write)
  const counts: SheetPlanCounts = {
    rows: rows.length,
    new: count('new'),
    inApp: count('in_app'),
    duplicate: count('duplicate'),
    possibleDuplicate: count('possible_duplicate'),
    picked: rows.filter((row) => row.status === 'possible_duplicate' && row.write).length,
    unmapped: count('unmapped'),
    errors: count('error'),
    warnings: rows.filter((row) => row.warnings.length > 0).length,
    write: written.length,
    ranks: written.filter((row) => row.rankPlan?.action === 'note').length,
  }
  return {
    rows,
    codes,
    counts,
    tooMany: written.length > SHEET_IMPORT_MAX_NEW,
    fingerprint: hashText(
      JSON.stringify({
        mode: context.mode,
        rows: written.map((row) => [
          row.row,
          row.key,
          row.deckId,
          row.playedAt?.toISOString(),
          row.result,
          row.wentFirst,
          row.opponent,
          row.note,
          row.rankPlan?.action === 'note' ? row.rank : null,
        ]),
      }),
    ),
  }
}

/**
 * The rank of each row written (column H: the rank it was played at), noted a millisecond before the match, as the app
 * does for a registered match. Never twice the same: when it was already the rank at that moment (noted before, or by
 * an earlier row of the sheet) nothing is noted. Nothing in a mass import replaces a rank already noted, and a match
 * that is not competitive or falls outside every season goes in without its rank.
 */
function planRanks(rows: PlannedSheetRow[], context: SheetPlanContext): void {
  const planned: RankChange[] = []
  const written = rows
    .filter((row) => row.write && row.rank !== null)
    .sort((a, b) => (a.playedAt as Date).getTime() - (b.playedAt as Date).getTime() || a.row - b.row)
  for (const row of written) {
    const rank = row.rank as Rank
    const label = rankLabelEs(rank)
    const playedAt = row.playedAt as Date
    const skip = (text: string): void => {
      row.rankPlan = { rank, label, action: 'skip', text, at: null }
      row.warnings.push(text)
    }
    if (context.mode !== 'competitive') {
      skip(`El rango (${label}) va solo con partidas competitivas: no lo anoto.`)
      continue
    }
    const season = seasonOf(playedAt, context.seasons, context.timeZone)
    if (!season) {
      skip(`La partida no cae en ninguna temporada de ranked: entra sin el rango (${label}).`)
      continue
    }
    const at = new Date(playedAt.getTime() - 1)
    const there = context.changes
      .filter((change) => change.at.getTime() === at.getTime())
      .sort((a, b) => Number(b.id) - Number(a.id))[0]
    if (there && there.rank !== rank) {
      skip(`Ya hay otro rango anotado en ese momento (${rankLabelEs(there.rank, there.points)}): no lo cambio.`)
      continue
    }
    // The sheet has no Master Ball points: Master Ball with points noted is the same rank.
    const current = there ?? rankAt(playedAt, [...context.changes, ...planned], season, context.timeZone)
    if (current && current.rank === rank) {
      row.rankPlan = { rank, label, action: 'same', text: `Ya estaba en ${label}: no hace falta anotarlo.`, at: null }
      continue
    }
    planned.push({ id: `sheet-${row.row}`, at, rank, points: null })
    row.rankPlan = { rank, label, action: 'note', text: `Se anota ${label} para esta partida y las siguientes.`, at }
  }
}

function mappings(
  rows: readonly PlannedSheetRow[],
  context: SheetPlanContext,
  deckOf: (code: string) => { deckId: string | null; source: SheetCodeMapping['source'] },
  byId: ReadonlyMap<string, SheetExistingMatch>,
  decks: ReadonlyMap<string, SheetDeck>,
): SheetCodeMapping[] {
  const needing = new Map<string, number>()
  for (const row of rows) {
    if (row.code === null) continue
    if (row.status === 'new' || row.status === 'possible_duplicate' || row.status === 'unmapped') {
      needing.set(row.code, (needing.get(row.code) ?? 0) + 1)
    }
  }
  return [...needing]
    .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
    .map(([code, count]) => {
      const ofCode = rows.filter((row) => row.code === code)
      const names = [...new Set(ofCode.flatMap((row) => (row.deckName ? [row.deckName] : [])))]
      // The rows of the code already in the app say its deck: the most common one (the latest match on a tie).
      const votes = new Map<string, { count: number; matchId: string }>()
      for (const row of ofCode) {
        const match = row.matchId ? byId.get(row.matchId) : undefined
        if (!match || !decks.has(match.deckId)) continue
        const vote = votes.get(match.deckId) ?? { count: 0, matchId: match.id }
        vote.count += 1
        if (Number(match.id) > Number(vote.matchId)) vote.matchId = match.id
        votes.set(match.deckId, vote)
      }
      const voted = [...votes].sort(([, a], [, b]) => b.count - a.count || Number(b.matchId) - Number(a.matchId))[0]
      const byName = voted ? null : suggestDeckByName(names, context.decks)
      const suggestion = voted
        ? { deckId: voted[0], reason: `por la partida n.º ${voted[1].matchId}` }
        : byName
          ? { deckId: byName.id, reason: `por el nombre «${names.join('», «')}»` }
          : null
      return { code, names, rows: count, ...deckOf(code), suggestion }
    })
}

/** One-line description of a possible duplicate («n.º 30, Victoria del 19/10 21:35»). */
export function duplicateTextEs(match: SheetExistingMatch, timeZone: string): string {
  return `n.º ${match.id}, ${MATCH_RESULT_LABEL_ES[match.result]} del ${formatShort(match.playedAt, timeZone)}`
}

/**
 * The text for column K: one line per row of the sheet from the first row with data to the last one, with the number
 * of its match in the app — the one in column K, the one found by its key, or the one just imported — and empty for
 * the rows that did not go in (and the empty rows in between), so it is pasted from the first row down.
 */
export function sheetColumnK(
  sheet: Pick<ParsedSheet, 'firstRow' | 'lastRow'>,
  rows: readonly Pick<PlannedSheetRow, 'row' | 'status' | 'appIdText' | 'matchId'>[],
  imported: ReadonlyMap<number, string> = new Map(),
): { firstRow: number; text: string } | null {
  if (sheet.firstRow === null || sheet.lastRow === null) return null
  const byRow = new Map(rows.map((row) => [row.row, row]))
  const lines: string[] = []
  for (let at = sheet.firstRow; at <= sheet.lastRow; at++) {
    const row = byRow.get(at)
    const written = imported.get(at)
    lines.push(
      written ??
        (row?.status === 'duplicate'
          ? (row.matchId ?? '')
          : // Whatever column K says stays (a number, or a typo the row was refused for).
            (row?.appIdText ?? '')),
    )
  }
  return { firstRow: sheet.firstRow, text: lines.join('\n') }
}
