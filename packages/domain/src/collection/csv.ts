/**
 * The tracker's collection CSV (docs/fase0/catalogo.md §3–4): UTF-8 with BOM, LF, no quotes, no trailing newline,
 * header `Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected`, one row per card in catalog order,
 * twins repeating the same values, booleans as TRUE/FALSE. The parser is lenient (CRLF, no BOM, extra columns,
 * quoted fields); the writer reproduces the tracker's bytes so the export can be fed back to the tracker.
 */
import { CatalogIndex } from '../catalog/catalogIndex.js'
import type { Catalog } from '../catalog/types.js'
import type { StockQuantities } from './stock.js'

export const TRACKER_CSV_COLUMNS = [
  'Id',
  'CardName',
  'InternalId',
  'NumberOwned',
  'Expansion',
  'Pack',
  'Rarity',
  'Collected',
] as const
export const TRACKER_CSV_HEADER: string = TRACKER_CSV_COLUMNS.join(',')
/** Columns the tracker's importer requires in the first row (ImportReader.tsx:60-69); the rest are ignored. */
export const REQUIRED_CSV_COLUMNS = ['Id', 'InternalId', 'NumberOwned', 'Collected'] as const

export type CsvLineEnding = 'LF' | 'CRLF' | 'mixed'

export type CsvErrorCode =
  | 'empty_file'
  | 'missing_column'
  | 'missing_field'
  | 'empty_id'
  | 'invalid_internal_id'
  | 'invalid_number_owned'
  | 'invalid_collected'

export interface CsvError {
  /** 1-based line in the file (the header is line 1). */
  line: number
  code: CsvErrorCode
  /** Column the error refers to, or null for file-level errors. */
  column: string | null
  message: string
}

export interface CsvRow {
  /** 1-based line in the file. */
  line: number
  id: string
  internalId: number
  numberOwned: number
  collected: boolean
  /** Optional tracker columns: null when the column is absent from the file. */
  cardName: string | null
  expansion: string | null
  pack: string | null
  rarity: string | null
}

export interface ParsedCsv {
  /** Rows that parsed without error, in file order. */
  rows: CsvRow[]
  errors: CsvError[]
  /** Header columns as found in the file. */
  columns: string[]
  bom: boolean
  lineEnding: CsvLineEnding
  trailingNewline: boolean
}

const BOM = '﻿'
const INTEGER = /^\d+$/

function decode(input: string | Uint8Array): string {
  if (typeof input === 'string') return input
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(input)
}

function detectLineEnding(text: string): CsvLineEnding {
  let crlf = 0
  let lone = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charAt(i - 1) === '\r') crlf += 1
    else lone += 1
  }
  if (crlf > 0 && lone > 0) return 'mixed'
  return crlf > 0 ? 'CRLF' : 'LF'
}

/** Splits one record into fields; RFC 4180 quotes are honoured only when a field starts with a quote. */
function splitFields(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const fields: string[] = []
  let i = 0
  for (;;) {
    let field = ''
    if (line.charAt(i) === '"') {
      i += 1
      while (i < line.length) {
        const ch = line.charAt(i)
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            field += '"'
            i += 2
            continue
          }
          i += 1
          break
        }
        field += ch
        i += 1
      }
    }
    const next = line.indexOf(',', i)
    if (next < 0) {
      fields.push(field + line.slice(i))
      return fields
    }
    fields.push(field + line.slice(i, next))
    i = next + 1
  }
}

/** Parses a tracker export. Rows with errors are left out of `rows` and described in `errors`. */
export function parseTrackerCsv(input: string | Uint8Array): ParsedCsv {
  let text = decode(input)
  const bom = text.startsWith(BOM)
  if (bom) text = text.slice(BOM.length)
  const lineEnding = detectLineEnding(text)
  const trailingNewline = text.endsWith('\n')
  const lines = text.split(/\r\n|\n/)
  const errors: CsvError[] = []
  const rows: CsvRow[] = []
  const headerLine = lines[0] ?? ''
  if (headerLine.trim() === '') {
    errors.push({ line: 1, code: 'empty_file', column: null, message: 'The file has no header row' })
    return { rows, errors, columns: [], bom, lineEnding, trailingNewline }
  }
  const columns = splitFields(headerLine).map((name) => name.trim())
  const position = new Map<string, number>()
  columns.forEach((name, at) => {
    if (!position.has(name)) position.set(name, at)
  })
  const missing = REQUIRED_CSV_COLUMNS.filter((name) => !position.has(name))
  if (missing.length > 0) {
    errors.push({
      line: 1,
      code: 'missing_column',
      column: null,
      message: `Missing required columns: ${missing.join(', ')} (found: ${columns.join(', ') || 'none'})`,
    })
    return { rows, errors, columns, bom, lineEnding, trailingNewline }
  }
  const at = (name: string): number => position.get(name) ?? -1
  const required = [
    ['Id', at('Id')],
    ['InternalId', at('InternalId')],
    ['NumberOwned', at('NumberOwned')],
    ['Collected', at('Collected')],
  ] as const
  const [idAt, internalIdAt, numberOwnedAt, collectedAt] = required.map(([, column]) => column) as [
    number,
    number,
    number,
    number,
  ]
  const cardNameAt = at('CardName')
  const expansionAt = at('Expansion')
  const packAt = at('Pack')
  const rarityAt = at('Rarity')
  const optional = (fields: string[], column: number): string | null => (column < 0 ? null : (fields[column] ?? ''))

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    if (raw.trim() === '') continue
    const line = i + 1
    const fields = splitFields(raw)
    const short = required.find(([, column]) => fields[column] === undefined)
    if (short) {
      errors.push({
        line,
        code: 'missing_field',
        column: short[0],
        message: `Line ${line}: only ${fields.length} fields, column ${short[0]} is missing`,
      })
      continue
    }
    const id = (fields[idAt] ?? '').trim()
    const internalIdText = (fields[internalIdAt] ?? '').trim()
    const numberOwnedText = (fields[numberOwnedAt] ?? '').trim()
    const collectedRaw = (fields[collectedAt] ?? '').trim()
    const collectedText = collectedRaw.toUpperCase()
    if (id === '') {
      errors.push({ line, code: 'empty_id', column: 'Id', message: `Line ${line}: empty Id` })
      continue
    }
    if (!INTEGER.test(internalIdText)) {
      errors.push({
        line,
        code: 'invalid_internal_id',
        column: 'InternalId',
        message: `Line ${line} (${id}): InternalId must be a non-negative integer, got "${internalIdText}"`,
      })
      continue
    }
    if (!INTEGER.test(numberOwnedText)) {
      errors.push({
        line,
        code: 'invalid_number_owned',
        column: 'NumberOwned',
        message: `Line ${line} (${id}): NumberOwned must be an integer ≥ 0, got "${numberOwnedText}"`,
      })
      continue
    }
    if (collectedText !== 'TRUE' && collectedText !== 'FALSE') {
      errors.push({
        line,
        code: 'invalid_collected',
        column: 'Collected',
        message: `Line ${line} (${id}): Collected must be TRUE or FALSE, got "${collectedRaw}"`,
      })
      continue
    }
    rows.push({
      line,
      id,
      internalId: Number(internalIdText),
      numberOwned: Number(numberOwnedText),
      collected: collectedText === 'TRUE',
      cardName: optional(fields, cardNameAt),
      expansion: optional(fields, expansionAt),
      pack: optional(fields, packAt),
      rarity: optional(fields, rarityAt),
    })
  }
  return { rows, errors, columns, bom, lineEnding, trailingNewline }
}

export interface WriteTrackerCsvOptions {
  /** Prepend the UTF-8 BOM (default true, like SheetJS). */
  bom?: boolean | undefined
  /** Record separator (default 'LF', like SheetJS). */
  lineEnding?: 'LF' | 'CRLF' | undefined
  /** End the file with a newline (default false: the tracker does not). */
  trailingNewline?: boolean | undefined
  /** Language of `CardName` (default 'es'). */
  lang?: 'es' | 'en' | undefined
}

/** Quotes a field only when SheetJS would (separator, quote or line break inside); no catalog value needs it. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Writes the collection in the tracker's exact format: 8 columns in tracker order, one row per card in catalog
 * order, twins with identical values (they read the same stock unit), BOM + LF, no trailing newline.
 * Manual adjustments are never exported (they are per functional group, not per edition; PLAN §3.2 d).
 */
export function writeTrackerCsv(
  source: Catalog | CatalogIndex,
  stock: StockQuantities,
  options: WriteTrackerCsvOptions = {},
): string {
  const catalog = source instanceof CatalogIndex ? source.catalog : source
  const eol = options.lineEnding === 'CRLF' ? '\r\n' : '\n'
  const lang = options.lang ?? 'es'
  const lines: string[] = [TRACKER_CSV_HEADER]
  for (const card of catalog.cards) {
    const unit = stock[card.stockCardId]
    const amount = unit?.amountOwned ?? 0
    const collected = unit?.collected ?? false
    const name = lang === 'en' ? card.nameEn : card.nameEs
    lines.push(
      [
        csvField(card.id),
        csvField(name),
        String(card.internalId),
        String(amount),
        csvField(card.expansionId),
        csvField(card.pack),
        csvField(card.rarity),
        collected ? 'TRUE' : 'FALSE',
      ].join(','),
    )
  }
  const body = lines.join(eol) + (options.trailingNewline ? eol : '')
  return (options.bom ?? true) ? BOM + body : body
}
