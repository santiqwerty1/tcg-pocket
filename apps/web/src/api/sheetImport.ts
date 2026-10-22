/** T-022, «Importar desde la hoja»: the preview of the owner's match sheet and applying it (docs/API.md «Partidas»). */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { matchKeys } from './matches'
import { type MatchMode, matchModeSchema, matchResultSchema } from './schemas'

export const SHEET_ROW_STATUSES = ['in_app', 'duplicate', 'possible_duplicate', 'unmapped', 'error', 'new'] as const
export type SheetRowStatus = (typeof SHEET_ROW_STATUSES)[number]

const countsSchema = z.object({
  rows: z.number(),
  new: z.number(),
  inApp: z.number(),
  duplicate: z.number(),
  possibleDuplicate: z.number(),
  picked: z.number(),
  unmapped: z.number(),
  errors: z.number(),
  warnings: z.number(),
  write: z.number(),
  ranks: z.number(),
})
const columnKSchema = z.object({ firstRow: z.number(), text: z.string() }).nullable()

export const sheetImportRowSchema = z.object({
  row: z.number(),
  status: z.enum(SHEET_ROW_STATUSES),
  code: z.string().nullable(),
  deckName: z.string().nullable(),
  deck: z.object({ id: z.string(), name: z.string() }).nullable(),
  result: matchResultSchema.nullable(),
  wentFirst: z.boolean().nullable(),
  playedAt: z.string().nullable(),
  dateText: z.string(),
  opponent: z.string().nullable(),
  note: z.string(),
  rank: z
    .object({
      label: z.string(),
      action: z.enum(['note', 'same', 'skip']).nullable(),
      text: z.string().nullable(),
    })
    .nullable(),
  matchId: z.string().nullable(),
  duplicateOf: z.object({ id: z.string(), text: z.string() }).nullable(),
  write: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
})

export const sheetImportPreviewSchema = z.object({
  delimiter: z.enum(['comma', 'semicolon', 'tab']).nullable(),
  headerRow: z.number().nullable(),
  firstRow: z.number().nullable(),
  error: z.string().nullable(),
  mode: matchModeSchema,
  maxNew: z.number(),
  tooMany: z.boolean(),
  counts: countsSchema,
  codes: z.array(
    z.object({
      code: z.string(),
      names: z.array(z.string()),
      rows: z.number(),
      deckId: z.string().nullable(),
      source: z.enum(['chosen', 'saved']).nullable(),
      suggestion: z.object({ deckId: z.string(), reason: z.string() }).nullable(),
    }),
  ),
  decks: z.array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() })),
  rows: z.array(sheetImportRowSchema),
  columnK: columnKSchema,
  fingerprint: z.string(),
  /** Matches imported from the sheet around its dates that no row is any more (a row corrected without K). */
  orphans: z.array(z.object({ id: z.string(), text: z.string() })),
})

export const sheetImportAppliedSchema = z.object({
  imported: z.array(z.object({ row: z.number(), matchId: z.string() })),
  ranks: z.number(),
  counts: countsSchema,
  columnK: columnKSchema,
})

export type SheetImportPreview = z.infer<typeof sheetImportPreviewSchema>
export type SheetImportRow = z.infer<typeof sheetImportRowSchema>
export type SheetImportApplied = z.infer<typeof sheetImportAppliedSchema>

export interface SheetImportRequest {
  text: string
  /** The deck chosen for each code (null: none). */
  deckMap: Record<string, string | null>
  mode: MatchMode
  /** Rows of possible repeats to import anyway. */
  include: number[]
}

/** What importing would do (nothing is written). */
export function useSheetImportPreview() {
  return useMutation({
    mutationFn: (body: SheetImportRequest) =>
      request('/api/matches/import/preview', { method: 'POST', body, schema: sheetImportPreviewSchema }),
  })
}

/** Imports as previewed (its fingerprint); a 409 means something changed since. */
export function useSheetImportApply() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SheetImportRequest & { fingerprint: string }) =>
      request('/api/matches/import', { method: 'POST', body, schema: sheetImportAppliedSchema }),
    // Every list, statistic and season reads the matches (and the ranks noted with them).
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: matchKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['ranked'] }),
      ]),
  })
}
