/**
 * Text formats accepted by `POST /api/decks/import` and `POST /api/decks/validate` (docs/API.md, PLAN §3.3):
 * `spanish` (one deck in the Spanish list format), `spanish-file` (a whole file like `mazos_40_listas.md`, with its
 * summary table), `limitless` (the line format shared with deckgym) and `json` (the app's own format).
 * `auto` picks by inspection; the rules are small and unit-tested.
 */
import {
  type CatalogIndex,
  type DeckDraft,
  deckJsonToDraft,
  type ParseIssue,
  parseDeckJson,
  parseLineFormat,
  parseSpanishDeckFile,
  parseSpanishDeckText,
} from '@tcg/domain'

export const DECK_IMPORT_FORMATS = ['auto', 'spanish', 'spanish-file', 'limitless', 'json'] as const
export type DeckImportFormat = (typeof DECK_IMPORT_FORMATS)[number]
export type DetectedDeckFormat = Exclude<DeckImportFormat, 'auto'>

export interface ParsedDeckText {
  /** Deck number from a `### N.` heading (Spanish formats). */
  number: number | null
  title: string | null
  draft: DeckDraft | null
  errors: ParseIssue[]
  warnings: ParseIssue[]
}

const NUMBERED_HEADING = /^\s*#{1,6}\s+\d+\.\s/mu
const SUMMARY_TABLE_ROW = /^\s*\|\s*#\s*\|/mu
const SPANISH_BULLET = /^\s*(?:[-*]\s*)?(?:pok[ée]mon|entrenadores|energ[íi]a|nota)\s*:/imu

/** `auto` → the concrete format; an explicit format is returned as is. */
export function detectDeckFormat(text: string, format: DeckImportFormat = 'auto'): DetectedDeckFormat {
  if (format !== 'auto') return format
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return 'json'
  const headings = trimmed.match(new RegExp(NUMBERED_HEADING.source, 'gmu'))?.length ?? 0
  if (SUMMARY_TABLE_ROW.test(trimmed) || headings >= 2) return 'spanish-file'
  if (headings === 1 || SPANISH_BULLET.test(trimmed)) return 'spanish'
  return 'limitless'
}

/** Parses `text` into one or more drafts according to the (detected) format. */
export function parseDeckText(text: string, format: DeckImportFormat, index: CatalogIndex): ParsedDeckText[] {
  const detected = detectDeckFormat(text, format)
  switch (detected) {
    case 'spanish-file':
      return parseSpanishDeckFile(text, index).map((deck) => ({
        number: deck.number,
        title: deck.title,
        draft: deck.draft,
        errors: deck.errors,
        warnings: deck.warnings,
      }))
    case 'spanish': {
      const result = parseSpanishDeckText(text, index)
      return [
        {
          number: result.number,
          title: result.title,
          draft: result.value,
          errors: result.errors,
          warnings: result.warnings,
        },
      ]
    }
    case 'json': {
      const result = parseDeckJson(text, index)
      return [
        {
          number: null,
          title: result.value?.name ?? null,
          draft: result.value ? deckJsonToDraft(result.value) : null,
          errors: result.errors,
          warnings: result.warnings,
        },
      ]
    }
    case 'limitless': {
      const result = parseLineFormat(text, index)
      return [{ number: null, title: null, draft: result.value, errors: result.errors, warnings: result.warnings }]
    }
  }
}
