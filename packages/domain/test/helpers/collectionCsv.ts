// Reads the real collection export once per worker (as text with its BOM and as bytes) and memoizes the parse.
import { readFileSync } from 'node:fs'
import {
  type NormalizedImport,
  normalizeImportRows,
  type ParsedCsv,
  parseTrackerCsv,
} from '../../src/collection/index.js'
import { COLLECTION_CSV_PATH, catalogIndex } from './loadFixtures.js'

let bytes: Uint8Array | undefined
/** The file exactly as stored (UTF-8 with BOM, LF, no trailing newline). */
export function realCsvBytes(): Uint8Array {
  bytes ??= new Uint8Array(readFileSync(COLLECTION_CSV_PATH))
  return bytes
}

let text: string | undefined
/** The file decoded as UTF-8, keeping the BOM character at position 0. */
export function realCsvText(): string {
  text ??= readFileSync(COLLECTION_CSV_PATH, 'utf8')
  return text
}

let parsed: ParsedCsv | undefined
export function realCsvParsed(): ParsedCsv {
  parsed ??= parseTrackerCsv(realCsvText())
  return parsed
}

let normalized: NormalizedImport | undefined
export function realCsvNormalized(): NormalizedImport {
  normalized ??= normalizeImportRows(realCsvParsed().rows, catalogIndex())
  return normalized
}
