/** Notas por rival (Fase 12): few notes, so the list is fetched once and matched by opponent key on the client. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { opponentKeyOf } from '@/lib/matches'
import { request } from './client'
import { type RivalNote, rivalNoteResponseSchema, rivalNotesSchema } from './schemas'

export const rivalKeys = { all: ['rival-notes'] as const }

export function useRivalNotes() {
  return useQuery({
    queryKey: rivalKeys.all,
    queryFn: ({ signal }) => request('/api/rival-notes', { schema: rivalNotesSchema, signal }),
    select: (data) => data.items,
    staleTime: 60_000,
  })
}

/** The note of an opponent as typed (any spelling), from the cached list. */
export function useRivalNote(opponent: string | null | undefined): RivalNote | null {
  const notes = useRivalNotes()
  const key = opponent ? opponentKeyOf(opponent) : ''
  if (!key) return null
  return notes.data?.find((note) => note.key === key) ?? null
}

export function useSaveRivalNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { opponent: string; text: string; archetypeId?: string | null }) =>
      request('/api/rival-notes', { method: 'PUT', body, schema: rivalNoteResponseSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rivalKeys.all }),
  })
}

export function useDeleteRivalNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => request(`/api/rival-notes/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rivalKeys.all }),
  })
}
