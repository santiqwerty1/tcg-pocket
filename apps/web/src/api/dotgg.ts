/**
 * T-020: the collection from the game through ptcgpocket.gg, and «Tracker al día». The link goes up once
 * (`PUT /api/collection/dotgg/link`) and never comes back: the status shows it masked.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { importAppliedSchema, importPreviewSchema } from './schemas'
import { trackerStatusKey } from './trackerSync'

export const dotggStatusKey = ['dotgg-sync'] as const
export const trackerGapKey = ['tracker-gap'] as const

export const dotggStatusSchema = z.object({
  configured: z.boolean(),
  link: z.string().nullable(),
  unreadable: z.boolean().default(false),
  enabled: z.boolean(),
  lastAppliedAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  result: z.enum(['preview', 'applied', 'unchanged', 'review', 'error']).nullable(),
  error: z.string().nullable(),
  previewId: z.string().nullable(),
})
export type DotggStatus = z.infer<typeof dotggStatusSchema>

export function useDotggStatus() {
  return useQuery({
    queryKey: dotggStatusKey,
    queryFn: ({ signal }) => request('/api/collection/dotgg/status', { schema: dotggStatusSchema, signal }),
  })
}

function useStatusMutation<T>(fn: (input: T) => Promise<DotggStatus>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => {
      client.setQueryData(dotggStatusKey, status)
      void client.invalidateQueries({ queryKey: trackerStatusKey })
      void client.invalidateQueries({ queryKey: ['collection', 'imports'] })
      void client.invalidateQueries({ queryKey: trackerGapKey })
    },
  })
}

export function useSetDotggLink() {
  return useStatusMutation((url: string) =>
    request('/api/collection/dotgg/link', { method: 'PUT', body: { url }, schema: dotggStatusSchema }),
  )
}

export function useClearDotggLink() {
  return useStatusMutation(() => request('/api/collection/dotgg/link', { method: 'DELETE', schema: dotggStatusSchema }))
}

export function useDotggPreview() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request('/api/collection/dotgg/preview', { method: 'POST', schema: importPreviewSchema }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: dotggStatusKey })
      void client.invalidateQueries({ queryKey: ['collection', 'imports'] })
    },
  })
}

export function useApplyDotgg() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request('/api/collection/dotgg/apply', { method: 'POST', body: { id }, schema: importAppliedSchema }),
    onSuccess: () => client.invalidateQueries(),
  })
}

const trackerGapRowSchema = z.object({
  stockCardId: z.string(),
  cardIds: z.array(z.string()),
  nameEs: z.string(),
  expansionId: z.string(),
  rarity: z.string(),
  tracker: z.number(),
  game: z.number(),
  delta: z.number(),
  /** The tracker's carddex flag now, and what the file writes (TRUE with a copy in the game, FALSE without). */
  trackerCollected: z.boolean(),
  collected: z.boolean(),
})
export type TrackerGapRow = z.infer<typeof trackerGapRowSchema>

export const trackerGapSchema = z.object({
  checkedAt: z.string(),
  summary: z.object({
    cards: z.number(),
    cardsMissing: z.number(),
    copiesMissing: z.number(),
    cardsExtra: z.number(),
    copiesExtra: z.number(),
    cardsCollected: z.number().default(0),
    trackerCopies: z.number(),
    gameCopies: z.number(),
  }),
  rows: z.array(trackerGapRowSchema),
  unmatchedGame: z.array(
    z.object({ line: z.number(), set: z.string(), number: z.number(), name: z.string(), copies: z.number() }),
  ),
  unknownTracker: z.array(z.number()),
  warnings: z.array(z.string()),
  /** Expansions with no row in the export compared as 0 (a sync listed them before and the app has none there). */
  emptyExpansions: z.array(z.object({ expansionId: z.string(), nameEs: z.string(), cards: z.number() })).default([]),
  /** Cards at 0 in the export that the app still has: a drop to apply first (they are not compared). */
  pendingDrops: z.number().default(0),
  /** Cards left out of the comparison; `complete`: nothing left out and the internal ids are the tracker's. */
  notCompared: z.number().default(0),
  complete: z.boolean().default(true),
  trackerFile: z.object({ fileName: z.string(), rows: z.number(), content: z.string() }).nullable(),
  catalogCommit: z.string().nullable(),
})
export type TrackerGap = z.infer<typeof trackerGapSchema>

/**
 * Reads both collections every time the screen opens and when the app gets the focus back: after importing the file
 * in the tracker, coming back shows the new comparison (each read takes a few seconds).
 */
export function useTrackerGap() {
  return useQuery({
    queryKey: trackerGapKey,
    queryFn: ({ signal }) => request('/api/collection/tracker-gap', { schema: trackerGapSchema, signal }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  })
}
