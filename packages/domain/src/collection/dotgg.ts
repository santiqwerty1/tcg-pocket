/**
 * ptcgpocket.gg (DotGG) as a collection source (T-020). Its «Permanent export link» answers, without logging in, the
 * collection the site mirrors from the game every day, as CSV: header `Normal,Foil,Name,Set,Number`, one row per
 * distinct card owned (`2,0,"Bulbasaur","A1","1"`: normal copies, foil copies — always 0 in Pocket —, English name,
 * expansion code and number without leading zeros). It is a complete snapshot: a card it does not list is not owned.
 *
 * Cards map to the catalog by expansion and number, which is the tracker's card id (`A1-1`, `P-A-7`), so the stock
 * unit (and its twins) comes from the catalog and no internal id is involved. Rows the catalog does not know (a new
 * set, another code) are kept apart and listed, never dropped in silence; rows whose name is another card's (another
 * numbering) are flagged. On the real export of 22/10/2026 every row maps and every name matches.
 *
 * The link is a secret: anyone with it reads the collection. Nothing here returns it, except `parseDotggExportLink`
 * to the server that stores it; `maskDotggExportLink` is what the API and the web show.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, ExpansionId } from '../catalog/types.js'
import { type CsvLineEnding, type CsvRow, decodeCsv, detectCsvLineEnding, splitCsvFields } from './csv.js'
import type { StockQuantities } from './stock.js'

export const DOTGG_EXPORT_HOST = 'api.dotgg.gg'
export const DOTGG_EXPORT_PATH = '/cgfw/exportcollection'
export const DOTGG_EXPORT_PREFIX = `https://${DOTGG_EXPORT_HOST}${DOTGG_EXPORT_PATH}`
/** The game parameter of Pokémon TCG Pocket in DotGG's collection framework (it serves other games too). */
export const DOTGG_GAME = 'pokepocket'
/** What the source is called in the app. */
export const DOTGG_SOURCE_NAME = 'ptcgpocket.gg (juego)'
export const DOTGG_CSV_COLUMNS = ['Normal', 'Foil', 'Name', 'Set', 'Number'] as const
/** Columns without which the file cannot be read; `Foil` (0 when absent) and `Name` are optional. */
export const DOTGG_REQUIRED_COLUMNS = ['Normal', 'Set', 'Number'] as const

const MAX_LINK_LENGTH = 1000
const MIN_TOKEN_LENGTH = 8
const MAX_TOKEN_LENGTH = 256

export type DotggLinkErrorCode = 'empty' | 'too_long' | 'not_url' | 'wrong_place' | 'no_token' | 'wrong_game'

export type DotggLinkCheck =
  | { ok: true; url: string; token: string }
  | { ok: false; code: DotggLinkErrorCode; message: string }

const LINK_MESSAGES: Record<DotggLinkErrorCode, string> = {
  empty: 'Pegá el link de exportación de ptcgpocket.gg.',
  too_long: 'El link es demasiado largo para ser el de exportación de ptcgpocket.gg.',
  not_url: 'Eso no es un link: copiá el «Permanent export link» de ptcgpocket.gg.',
  wrong_place: `El link tiene que empezar con ${DOTGG_EXPORT_PREFIX}.`,
  no_token: 'Al link le falta el token (…&token=…): copialo entero desde ptcgpocket.gg.',
  wrong_game: `El link tiene que ser el de Pokémon TCG Pocket (game=${DOTGG_GAME}).`,
}

function linkError(code: DotggLinkErrorCode): DotggLinkCheck {
  return { ok: false, code, message: LINK_MESSAGES[code] }
}

/**
 * Checks a pasted link: `https://api.dotgg.gg/cgfw/exportcollection` with `game=pokepocket` and a `token`, nothing
 * else in front (no other host, port, user or path). Returns the normalized URL (fragment dropped). The messages never
 * repeat what was pasted, so they can be shown and logged.
 */
export function parseDotggExportLink(text: string): DotggLinkCheck {
  const trimmed = text.trim()
  if (trimmed === '') return linkError('empty')
  if (trimmed.length > MAX_LINK_LENGTH) return linkError('too_long')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return linkError('not_url')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== DOTGG_EXPORT_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== DOTGG_EXPORT_PATH
  ) {
    return linkError('wrong_place')
  }
  const tokens = url.searchParams.getAll('token')
  const token = tokens[0] ?? ''
  if (tokens.length !== 1 || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return linkError('no_token')
  }
  const games = url.searchParams.getAll('game')
  if (games.length !== 1 || games[0] !== DOTGG_GAME) return linkError('wrong_game')
  url.hash = ''
  return { ok: true, url: url.toString(), token }
}

/** What the app shows of a stored link: `…/exportcollection?…token=••••abcd` (the last four characters of the token). */
export function maskDotggExportLink(url: string): string {
  let token = ''
  try {
    token = new URL(url).searchParams.get('token') ?? ''
  } catch {
    token = ''
  }
  const tail = token.length >= MIN_TOKEN_LENGTH ? token.slice(-4) : ''
  return `…/exportcollection?…token=••••${tail}`
}

/**
 * A text with the link taken out (the whole URL, the token as is and URL-encoded), for anything that may end up in a
 * response, a log, an alert or the database: a message built from a library error could quote the URL it was given.
 */
export function redactDotggLink(text: string, link: string | null | undefined): string {
  if (!link) return text
  const secrets = new Set<string>([link])
  try {
    const token = new URL(link).searchParams.get('token')
    if (token) {
      secrets.add(token)
      secrets.add(encodeURIComponent(token))
    }
  } catch {
    // Not a URL: only the text as given is taken out.
  }
  let result = text
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 4) result = result.split(secret).join('••••')
  }
  return result
}

export type DotggErrorCode =
  | 'empty_file'
  | 'missing_column'
  | 'missing_field'
  | 'invalid_count'
  | 'invalid_set'
  | 'invalid_number'
  | 'duplicate_card'

export interface DotggError {
  /** 1-based line in the file (the header is line 1). */
  line: number
  code: DotggErrorCode
  column: string | null
  /** In Spanish, without the row's values (the line is enough to find it). */
  message: string
}

export interface DotggRow {
  line: number
  /** Normal + foil copies (foil is always 0 in Pocket, but a copy is a copy). */
  copies: number
  /** English name as written by ptcgpocket.gg ('' when the column is absent). */
  name: string
  /** Expansion code as written («A1», «P-A»). */
  set: string
  /** Card number without leading zeros. */
  number: number
}

export interface ParsedDotgg {
  rows: DotggRow[]
  errors: DotggError[]
  columns: string[]
  /** The header is missing or lacks a required column: nothing in the file can be read. */
  fatal: boolean
  bom: boolean
  lineEnding: CsvLineEnding
}

const COUNT = /^\d{1,6}$/
const SET = /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8}){0,2}$/
const NUMBER = /^\d{1,4}$/

/** Parses the export. Rows with errors are left out of `rows` and described in `errors` (they block applying). */
export function parseDotggCsv(input: string | Uint8Array): ParsedDotgg {
  let text = decodeCsv(input)
  const bom = text.startsWith('﻿')
  if (bom) text = text.slice(1)
  const lineEnding = detectCsvLineEnding(text)
  const lines = text.split(/\r\n|\n/)
  const rows: DotggRow[] = []
  const errors: DotggError[] = []
  const headerLine = lines[0] ?? ''
  if (headerLine.trim() === '') {
    errors.push({ line: 1, code: 'empty_file', column: null, message: 'La respuesta está vacía.' })
    return { rows, errors, columns: [], fatal: true, bom, lineEnding }
  }
  const columns = splitCsvFields(headerLine).map((name) => name.trim())
  const position = new Map<string, number>()
  columns.forEach((name, at) => {
    if (!position.has(name)) position.set(name, at)
  })
  const missing = DOTGG_REQUIRED_COLUMNS.filter((name) => !position.has(name))
  if (missing.length > 0) {
    errors.push({
      line: 1,
      code: 'missing_column',
      column: null,
      message: `Faltan las columnas ${missing.join(', ')}: no es la exportación de la colección de ptcgpocket.gg.`,
    })
    return { rows, errors, columns: [], fatal: true, bom, lineEnding }
  }
  const at = (name: string): number => position.get(name) ?? -1
  const normalAt = at('Normal')
  const setAt = at('Set')
  const numberAt = at('Number')
  const foilAt = at('Foil')
  const nameAt = at('Name')
  const seen = new Map<string, number>()
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    if (raw.trim() === '') continue
    const line = i + 1
    const fields = splitCsvFields(raw)
    const short = (
      [
        ['Normal', normalAt],
        ['Set', setAt],
        ['Number', numberAt],
      ] as const
    ).find(([, column]) => fields[column] === undefined)
    if (short) {
      errors.push({
        line,
        code: 'missing_field',
        column: short[0],
        message: `Línea ${line}: falta la columna ${short[0]}.`,
      })
      continue
    }
    const normalText = (fields[normalAt] ?? '').trim()
    const foilText = foilAt < 0 ? '0' : (fields[foilAt] ?? '').trim() || '0'
    const set = (fields[setAt] ?? '').trim()
    const numberText = (fields[numberAt] ?? '').trim()
    if (!COUNT.test(normalText) || !COUNT.test(foilText)) {
      errors.push({
        line,
        code: 'invalid_count',
        column: COUNT.test(normalText) ? 'Foil' : 'Normal',
        message: `Línea ${line}: la cantidad de copias no es un número entero ≥ 0.`,
      })
      continue
    }
    if (!SET.test(set)) {
      errors.push({
        line,
        code: 'invalid_set',
        column: 'Set',
        message: `Línea ${line}: el código de expansión no es válido.`,
      })
      continue
    }
    const number = Number(numberText)
    if (!NUMBER.test(numberText) || number < 1) {
      errors.push({
        line,
        code: 'invalid_number',
        column: 'Number',
        message: `Línea ${line}: el número de carta no es un entero de 1 a 9999.`,
      })
      continue
    }
    const key = `${set.toUpperCase()}-${number}`
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({
        line,
        code: 'duplicate_card',
        column: null,
        message: `Línea ${line}: repite la carta ${set}-${number} de la línea ${first}.`,
      })
      continue
    }
    seen.set(key, line)
    rows.push({
      line,
      copies: Number(normalText) + Number(foilText),
      name: nameAt < 0 ? '' : (fields[nameAt] ?? '').trim(),
      set,
      number,
    })
  }
  return { rows, errors, columns, fatal: false, bom, lineEnding }
}

/** A row whose expansion and number the catalog does not have. */
export interface DotggUnmatched {
  line: number
  set: string
  number: number
  name: string
  copies: number
}

/**
 * A row whose expansion and number exist but name another card (letters and digits compared, without case or
 * accents): ptcgpocket.gg may number that set differently, and the copies would go to the wrong card.
 */
export interface DotggRenamed {
  line: number
  cardId: CardId
  /** As written by ptcgpocket.gg. */
  name: string
  /** The catalog's English name of `cardId`. */
  catalogName: string
  copies: number
}

export interface MappedDotgg {
  /** Every row in the importer's format, in file order: matched ones with the catalog card, unmatched ones with the
   * id as written (`B9-1`) and internal id 0, so the importer lists them as unknown and stores what the file said. */
  rows: CsvRow[]
  unmatched: DotggUnmatched[]
  /** Matched rows whose name is another card's (they are still mapped, and they make the import wait for a look). */
  renamed: DotggRenamed[]
}

/** A name reduced to its letters and digits, without case or accents (`Professor’s Research` = `Professor's Research`). */
export function dotggNameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** The catalog expansion of a set code: exact, or ignoring case. */
export function dotggExpansion(set: string, index: CatalogIndex): ExpansionId | null {
  if (index.expansionById(set)) return set
  const lower = set.toLowerCase()
  return index.catalog.expansions.find((expansion) => expansion.id.toLowerCase() === lower)?.id ?? null
}

/** The catalog card of an export row (`A1` + 1 → `A1-1`), or null. */
export function dotggCardId(set: string, number: number, index: CatalogIndex): CardId | null {
  const expansion = dotggExpansion(set, index)
  if (!expansion) return null
  const id = `${expansion}-${number}`
  return index.cardById(id) ? id : null
}

/** Maps every row onto the catalog by expansion and number, and checks the name it brings against the card's. */
export function mapDotggRows(rows: readonly DotggRow[], index: CatalogIndex): MappedDotgg {
  const mapped: CsvRow[] = []
  const unmatched: DotggUnmatched[] = []
  const renamed: DotggRenamed[] = []
  for (const row of rows) {
    const id = dotggCardId(row.set, row.number, index)
    const card = id ? index.cardById(id) : undefined
    if (!card) {
      unmatched.push({ line: row.line, set: row.set, number: row.number, name: row.name, copies: row.copies })
    } else if (row.name !== '' && dotggNameKey(row.name) !== dotggNameKey(card.nameEn)) {
      renamed.push({ line: row.line, cardId: card.id, name: row.name, catalogName: card.nameEn, copies: row.copies })
    }
    mapped.push({
      line: row.line,
      id: card?.id ?? `${row.set}-${row.number}`,
      internalId: card?.internalId ?? 0,
      numberOwned: row.copies,
      collected: row.copies > 0,
      cardName: row.name === '' ? null : row.name,
      expansion: row.set,
      pack: null,
      rarity: null,
    })
  }
  return { rows: mapped, unmatched, renamed }
}

/**
 * The export is the whole collection: every stock unit it does not list has 0 copies. The tracker's «collected»
 * (carddex) flag is never cleared — the game keeps a card in the dex after it is traded away — and turns on with a
 * copy; the export says nothing else about it.
 */
export function dotggUnits(units: StockQuantities, index: CatalogIndex, current: StockQuantities): StockQuantities {
  const result: StockQuantities = {}
  for (const unit of index.catalog.stockUnits) {
    const amountOwned = units[unit.id]?.amountOwned ?? 0
    result[unit.id] = {
      stockCardId: unit.id,
      amountOwned,
      collected: amountOwned > 0 || (current[unit.id]?.collected ?? false),
    }
  }
  return result
}

/**
 * Expansions with copies in the collection and not a single row in the export (by the expansion of each stock unit):
 * ptcgpocket.gg may not know a new set yet, and applying would zero it. In catalog order, with the copies and the units
 * there. With `registered`, a unit with no copy but the carddex flag counts too (the tracker file would clear it).
 */
export function dotggMissingExpansions(
  index: CatalogIndex,
  current: StockQuantities,
  units: StockQuantities,
  options: { registered?: boolean } = {},
): { expansionId: ExpansionId; copies: number; cards: number }[] {
  const covered = dotggListedExpansions(index, Object.keys(units))
  const found = new Map<ExpansionId, { copies: number; cards: number }>()
  for (const unit of Object.values(current)) {
    if (unit.amountOwned <= 0 && !(options.registered && unit.collected)) continue
    const expansion = index.cardById(unit.stockCardId)?.expansionId
    if (!expansion || covered.has(expansion)) continue
    const entry = found.get(expansion) ?? { copies: 0, cards: 0 }
    entry.copies += unit.amountOwned
    entry.cards += 1
    found.set(expansion, entry)
  }
  return index.catalog.expansions
    .filter((expansion) => found.has(expansion.id))
    .map((expansion) => ({ expansionId: expansion.id, ...(found.get(expansion.id) ?? { copies: 0, cards: 0 }) }))
}

/**
 * The expansion of each card, once: an export's rows by the card each one names give the set codes ptcgpocket.gg
 * wrote; stock unit ids give the expansions those units are kept under (as `dotggMissingExpansions` covers them).
 */
export function dotggListedExpansions(index: CatalogIndex, cardIds: Iterable<CardId>): Set<ExpansionId> {
  const listed = new Set<ExpansionId>()
  for (const cardId of cardIds) {
    const expansion = index.cardById(cardId)?.expansionId
    if (expansion) listed.add(expansion)
  }
  return listed
}

/** What «Tracker al día» compares when the export says nothing of a card (T-020, S-B and S-E). */
export interface DotggGapCoverage {
  /** Stock units not compared (their count would not be the game's). */
  skipped: Set<CardId>
  /** Expansions with no row in the export left out whole, with the tracker's cards there. */
  leftOut: { expansionId: ExpansionId; cards: number; reason: 'held' | 'unseen' }[]
  /** Expansions with no row in the export compared as 0 (the file puts the tracker's cards there at 0). */
  empty: { expansionId: ExpansionId; cards: number }[]
  /** Cards with no row that have a reprint in an expansion ptcgpocket.gg never wrote: left out, with those expansions. */
  reprints: { cards: number; expansionIds: ExpansionId[] }
  /** Cards at 0 in the export that the app still has copies of (a drop not applied yet): left out. */
  pending: number
}

/**
 * The export lists only what is owned, so «no row» can mean 0 copies or a set ptcgpocket.gg does not know (or writes
 * with another code). `known`: the set codes the export writes now plus those an applied sync wrote before (`seen`).
 * - An expansion the tracker has cards of and with no row (by the expansion each unit is kept under) is compared as 0
 *   only when it is known and the app's collection has no copy there (Santi applied the drop); otherwise it is left
 *   out: `held`, a drop the app has not applied yet, or `unseen`, a set ptcgpocket.gg may not know.
 * - A card the tracker has and the export gives no copy of (no row, or a row with 0), with a reprint in an expansion
 *   that is not known, is left out too: its copy may be that reprint, and the file would take it off the tracker.
 * - A card at 0 in the export that the app still has copies of (`heldUnits`) is left out as well, in any expansion:
 *   that drop waits for Santi in the app (a sync to review), and the file follows only what he applied.
 */
export function dotggGapCoverage(
  index: CatalogIndex,
  input: {
    tracker: StockQuantities
    game: StockQuantities
    listed: ReadonlySet<ExpansionId>
    seen: ReadonlySet<ExpansionId>
    /** Expansions where the app has copies (by the expansion each unit is kept under). */
    held: ReadonlySet<ExpansionId>
    /** Stock units the app has copies of. */
    heldUnits: ReadonlySet<CardId>
  },
): DotggGapCoverage {
  const known = new Set([...input.listed, ...input.seen])
  const skipped = new Set<CardId>()
  const leftOut: DotggGapCoverage['leftOut'] = []
  const emptyIds = new Set<ExpansionId>()
  for (const item of dotggMissingExpansions(index, input.tracker, input.game, { registered: true })) {
    if (input.held.has(item.expansionId)) leftOut.push({ ...pick(item), reason: 'held' })
    else if (!known.has(item.expansionId)) leftOut.push({ ...pick(item), reason: 'unseen' })
    else emptyIds.add(item.expansionId)
  }
  const out = new Set(leftOut.map((item) => item.expansionId))
  const reprintSets = new Set<ExpansionId>()
  let reprintCards = 0
  let pending = 0
  const emptyCards = new Map<ExpansionId, number>()
  for (const unit of index.catalog.stockUnits) {
    const expansion = index.cardById(unit.id)?.expansionId ?? ''
    if (out.has(expansion)) {
      skipped.add(unit.id)
      continue
    }
    const inTracker = input.tracker[unit.id]
    if (!inTracker || (inTracker.amountOwned <= 0 && !inTracker.collected)) continue
    if ((input.game[unit.id]?.amountOwned ?? 0) === 0 && input.heldUnits.has(unit.id)) {
      skipped.add(unit.id)
      pending += 1
      continue
    }
    // A copy in the export is the game's count. A row with 0 copies is not proof: the copy may be a reprint in a set
    // ptcgpocket.gg does not write.
    if ((input.game[unit.id]?.amountOwned ?? 0) > 0) continue
    const unknown = unit.cardIds
      .map((id) => index.cardById(id)?.expansionId)
      .filter((id): id is ExpansionId => !!id && !known.has(id))
    if (unknown.length > 0) {
      skipped.add(unit.id)
      reprintCards += 1
      for (const id of unknown) reprintSets.add(id)
    } else if (emptyIds.has(expansion)) emptyCards.set(expansion, (emptyCards.get(expansion) ?? 0) + 1)
  }
  return {
    skipped,
    leftOut,
    empty: [...emptyIds]
      .filter((id) => emptyCards.has(id))
      .map((expansionId) => ({ expansionId, cards: emptyCards.get(expansionId) ?? 0 })),
    reprints: {
      cards: reprintCards,
      expansionIds: index.catalog.expansions.map((item) => item.id).filter((id) => reprintSets.has(id)),
    },
    pending,
  }

  function pick(item: { expansionId: ExpansionId; cards: number }) {
    return { expansionId: item.expansionId, cards: item.cards }
  }
}
