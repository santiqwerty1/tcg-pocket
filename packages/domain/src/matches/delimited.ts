/**
 * Delimited text as a spreadsheet exports or copies it (T-022, «Importar desde la hoja»): RFC 4180 — a field in double
 * quotes may hold the delimiter, line breaks and doubled quotes — with a comma (Sheets' CSV), a semicolon (other
 * exports in Spanish) or a tab (cells copied from the sheet and pasted). CRLF, LF or a lone CR end a record, and a BOM
 * at the start is dropped.
 *
 * A quote opens a quoted field only when the field is a well-formed one: it starts with the quote and its closing quote
 * is followed by the delimiter, a line break or the end. Otherwise the quote is a plain character of the cell (review
 * of #143): `"Hoopa" me ganó` stays as written. When cells are copied from Sheets (tabs), only a cell with a line break
 * comes in quotes, and a cell never holds a tab: a quote whose field would take a tab is a plain character too, so a
 * note that starts with a quote and one that has a quote rows below are two cells, not one that swallows the rows in
 * between. In a CSV, an unclosed quote runs to the end of the text and is reported (`unclosedAt`).
 */

export type Delimiter = ',' | ';' | '\t'

/** The delimiters tried, in the order a tie is broken. */
export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t']

/** Every record of the text, each one its fields (an empty line is one empty field). */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  return readDelimited(text, delimiter).records
}

/**
 * A quoted field from its opening quote at `start`: its value and the index right after its closing quote; `literal`
 * when it is not a well-formed quoted field (the quote is then a plain character); `unclosed` when no quote closes it.
 */
function quotedField(
  text: string,
  start: number,
  delimiter: Delimiter,
): { value: string; end: number } | 'literal' | 'unclosed' {
  let value = ''
  let at = start + 1
  for (;;) {
    const next = text.indexOf('"', at)
    if (delimiter === '\t') {
      // Cells copied from Sheets never hold a tab: a quoted field that would take one is no quoted field.
      const tab = text.indexOf('\t', at)
      if (tab >= 0 && (next < 0 || tab < next)) return 'literal'
      if (next < 0) return 'literal'
    }
    if (next < 0) return 'unclosed'
    value += text.slice(at, next)
    if (text.charAt(next + 1) === '"') {
      value += '"'
      at = next + 2
      continue
    }
    const after = text.charAt(next + 1)
    if (after === '' || after === delimiter || after === '\r' || after === '\n') return { value, end: next + 1 }
    return 'literal'
  }
}

/**
 * The records, and the 0-based record where a quote opened and never closed (null when every quote closed): that quote
 * took the rest of the text into one field, which a reader should refuse rather than take as one long cell.
 */
export function readDelimited(text: string, delimiter: Delimiter): { records: string[][]; unclosedAt: number | null } {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let unclosedAt: number | null = null
  let fieldStart = true
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (i < text.length) {
    const ch = text.charAt(i)
    if (ch === '"' && fieldStart) {
      const quoted = quotedField(text, i, delimiter)
      fieldStart = false
      if (quoted === 'unclosed') {
        unclosedAt = records.length
        field += text.slice(i + 1)
        i = text.length
      } else if (quoted === 'literal') {
        field += ch
        i += 1
      } else {
        field += quoted.value
        i = quoted.end
      }
      continue
    }
    if (ch === delimiter) {
      record.push(field)
      field = ''
      fieldStart = true
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      fieldStart = true
      i += ch === '\r' && text.charAt(i + 1) === '\n' ? 2 : 1
      continue
    }
    field += ch
    fieldStart = false
    i += 1
  }
  // The last record, when the text does not end with a line break.
  if (!fieldStart || field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return { records, unclosedAt }
}
