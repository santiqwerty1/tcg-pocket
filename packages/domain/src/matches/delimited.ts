/**
 * Delimited text as a spreadsheet exports or copies it (T-022, «Importar desde la hoja»): RFC 4180 — a field in double
 * quotes may hold the delimiter, line breaks and doubled quotes — with a comma (Sheets' CSV), a semicolon (other
 * exports in Spanish) or a tab (cells copied from the sheet and pasted). CRLF, LF or a lone CR end a record, and a BOM
 * at the start is dropped. Lenient like a spreadsheet: a quote inside an unquoted field is a plain character, text after
 * a closing quote is kept, and an unclosed quote runs to the end of the text.
 */

export type Delimiter = ',' | ';' | '\t'

/** The delimiters tried, in the order a tie is broken. */
export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t']

/** Every record of the text, each one its fields (an empty line is one empty field). */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  return readDelimited(text, delimiter).records
}

/**
 * The records, and the 0-based record where a quote opened and never closed (null when every quote closed): that quote
 * took the rest of the text into one field, which a reader should refuse rather than take as one long cell.
 */
export function readDelimited(text: string, delimiter: Delimiter): { records: string[][]; unclosedAt: number | null } {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let quotedAt = 0
  let fieldStart = true
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  while (i < text.length) {
    const ch = text.charAt(i)
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      // Self-review: a quoted field is copied up to its next quote at once (a long note is one slice, not a char loop).
      const next = text.indexOf('"', i)
      const end = next < 0 ? text.length : next
      field += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '"' && fieldStart) {
      quoted = true
      quotedAt = records.length
      fieldStart = false
      i += 1
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
  return { records, unclosedAt: quoted ? quotedAt : null }
}
