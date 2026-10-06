/**
 * The app's own deck interchange format (PLAN §3.3 "JSON propio"), versioned by `schemaVersion`.
 */
import { z } from 'zod'
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { SELECTABLE_ENERGIES } from '../catalog/types.js'
import type { DeckDraft, ParseIssue, ParseResult } from './types.js'

export const DECK_JSON_SCHEMA_VERSION = 1

export const deckJsonV1Schema = z.object({
  schemaVersion: z.literal(DECK_JSON_SCHEMA_VERSION),
  name: z.string(),
  energies: z.array(z.enum(SELECTABLE_ENERGIES)),
  cards: z.array(z.object({ cardId: z.string().min(1), count: z.number().int().min(1) })),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** Id of the deck this one is a variant of. */
  variantOf: z.string().optional(),
  /** Tracker commit the card ids refer to. */
  catalogCommit: z.string().optional(),
})

export type DeckJsonV1 = z.infer<typeof deckJsonV1Schema>

export interface DeckJsonExtras {
  tags?: readonly string[] | undefined
  variantOf?: string | undefined
  catalogCommit?: string | undefined
}

/**
 * Parses a JSON string (or an already parsed value) into a `DeckJsonV1`. With an index, every card id must exist
 * in the catalog (`unknown_card`).
 */
export function parseDeckJson(input: unknown, index?: CatalogIndex): ParseResult<DeckJsonV1> {
  const errors: ParseIssue[] = []
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        value: null,
        errors: [{ code: 'invalid_json', message: `El JSON no es válido: ${detail}` }],
        warnings: [],
      }
    }
  }
  const parsed = deckJsonV1Schema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.')
      errors.push({ code: 'invalid_json', message: `${path === '' ? 'JSON' : path}: ${issue.message}` })
    }
    return { value: null, errors, warnings: [] }
  }
  if (index) {
    for (const entry of parsed.data.cards) {
      if (!index.cardById(entry.cardId)) {
        errors.push({ code: 'unknown_card', message: `No existe la carta ${entry.cardId} en el catálogo` })
      }
    }
  }
  return { value: errors.length > 0 ? null : parsed.data, errors, warnings: [] }
}

export function deckJsonToDraft(json: DeckJsonV1): DeckDraft {
  return {
    name: json.name,
    energies: [...json.energies],
    cards: json.cards.map((c) => ({ cardId: c.cardId, count: c.count })),
    ...(json.notes !== undefined ? { notes: json.notes } : {}),
    source: 'json',
  }
}

export function draftToDeckJson(draft: DeckDraft, extras: DeckJsonExtras = {}): DeckJsonV1 {
  return {
    schemaVersion: DECK_JSON_SCHEMA_VERSION,
    name: draft.name ?? '',
    energies: [...draft.energies],
    cards: draft.cards.map((c) => ({ cardId: c.cardId, count: c.count })),
    ...(extras.tags !== undefined ? { tags: [...extras.tags] } : {}),
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    ...(extras.variantOf !== undefined ? { variantOf: extras.variantOf } : {}),
    ...(extras.catalogCommit !== undefined ? { catalogCommit: extras.catalogCommit } : {}),
  }
}

/** Pretty-printed JSON (2 spaces, trailing newline). */
export function writeDeckJson(draft: DeckDraft, extras: DeckJsonExtras = {}): string {
  return `${JSON.stringify(draftToDeckJson(draft, extras), null, 2)}\n`
}
