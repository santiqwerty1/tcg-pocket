import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import {
  deckComparisonSchema,
  type MatchInput,
  type MatchMode,
  type MatchResult,
  matchesResponseSchema,
  matchSchema,
  matchStatsSchema,
  matchSuggestionsSchema,
} from './schemas'

export const matchKeys = {
  all: ['matches'] as const,
  list: (params: MatchListParams) => ['matches', 'list', params] as const,
  detail: (id: string) => ['matches', 'detail', id] as const,
  suggestions: ['matches', 'suggestions'] as const,
  stats: (params: MatchStatsParams) => ['matches', 'stats', params] as const,
  comparison: (deckId: string, mode?: MatchMode) => ['matches', 'comparison', deckId, mode ?? null] as const,
}

export interface MatchListParams {
  deckId?: string
  mode?: MatchMode
  result?: MatchResult
  opponent?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface MatchStatsParams {
  deckId?: string
  mode?: MatchMode
  from?: string
  to?: string
}

/** Every matches query (lists, stats, suggestions, comparisons) depends on every match. */
function invalidateMatches(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: matchKeys.all })
}

export function useMatchSuggestions() {
  return useQuery({
    queryKey: matchKeys.suggestions,
    queryFn: ({ signal }) => request('/api/matches/suggestions', { schema: matchSuggestionsSchema, signal }),
  })
}

export function useMatches(params: MatchListParams = {}) {
  return useQuery({
    queryKey: matchKeys.list(params),
    queryFn: ({ signal }) => request('/api/matches', { query: { ...params }, schema: matchesResponseSchema, signal }),
  })
}

export function useMatch(id: string | undefined) {
  return useQuery({
    queryKey: matchKeys.detail(id ?? ''),
    queryFn: ({ signal }) => request(`/api/matches/${encodeURIComponent(id ?? '')}`, { schema: matchSchema, signal }),
    enabled: Boolean(id),
  })
}

export function useMatchStats(params: MatchStatsParams = {}) {
  return useQuery({
    queryKey: matchKeys.stats(params),
    queryFn: ({ signal }) => request('/api/matches/stats', { query: { ...params }, schema: matchStatsSchema, signal }),
  })
}

export function useDeckComparison(deckId: string | undefined, mode?: MatchMode) {
  return useQuery({
    queryKey: matchKeys.comparison(deckId ?? '', mode),
    queryFn: ({ signal }) =>
      request(`/api/decks/${encodeURIComponent(deckId ?? '')}/comparison`, {
        query: { mode },
        schema: deckComparisonSchema,
        signal,
      }),
    enabled: Boolean(deckId),
  })
}

export function useCreateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MatchInput) => request('/api/matches', { method: 'POST', body, schema: matchSchema }),
    onSuccess: () => invalidateMatches(queryClient),
  })
}

export function useUpdateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<MatchInput> }) =>
      request(`/api/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, schema: matchSchema }),
    onSuccess: (match) => {
      queryClient.setQueryData(matchKeys.detail(match.id), match)
      return invalidateMatches(queryClient)
    },
  })
}

export function useDeleteMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request(`/api/matches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: matchKeys.detail(id) })
      return invalidateMatches(queryClient)
    },
  })
}
