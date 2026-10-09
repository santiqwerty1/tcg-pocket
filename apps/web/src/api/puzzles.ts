/** Situaciones para resolver (Fase 24): moments of your games with the coach where it saw a much better move. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { puzzleAnswerSchema, puzzleListSchema, puzzleSchema } from './schemas'

export const puzzleKeys = {
  all: ['puzzles'] as const,
  one: (id: string) => ['puzzles', id] as const,
}

export function usePuzzles() {
  return useQuery({
    queryKey: puzzleKeys.all,
    queryFn: ({ signal }) => request('/api/puzzles', { schema: puzzleListSchema, signal }),
  })
}

export function usePuzzle(id: string) {
  return useQuery({
    queryKey: puzzleKeys.one(id),
    queryFn: ({ signal }) => request(`/api/puzzles/${encodeURIComponent(id)}`, { schema: puzzleSchema, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useAnswerPuzzle(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { i: number }) =>
      request(`/api/puzzles/${encodeURIComponent(id)}/answer`, { method: 'POST', body, schema: puzzleAnswerSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: puzzleKeys.all, exact: true }),
  })
}
