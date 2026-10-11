import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { importAppliedSchema, importPreviewSchema } from './schemas'

export const trackerStatusKey = ['tracker-sync'] as const
const statusSchema = z.object({
  friendId: z.string(),
  enabled: z.boolean(),
  lastAppliedAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  result: z.enum(['preview', 'applied', 'review', 'error']).nullable(),
  error: z.string().nullable(),
  previewId: z.string().nullable(),
})
export function useTrackerStatus() {
  return useQuery({
    queryKey: trackerStatusKey,
    queryFn: ({ signal }) => request('/api/collection/tracker-sync/status', { schema: statusSchema, signal }),
  })
}
export function useTrackerPreview() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => request('/api/collection/tracker-sync/preview', { method: 'POST', schema: importPreviewSchema }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: trackerStatusKey })
      void client.invalidateQueries({ queryKey: ['collection', 'imports'] })
    },
  })
}
export function useApplyTracker() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request('/api/collection/tracker-sync/apply', { method: 'POST', body: { id }, schema: importAppliedSchema }),
    onSuccess: () => client.invalidateQueries(),
  })
}
