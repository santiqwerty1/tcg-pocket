import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  deckComparisonSchema,
  deckMatchupsSchema,
  luckSchema,
  type Match,
  type MatchInput,
  type MatchMode,
  type MatchResult,
  type MatchSuggestions,
  matchesResponseSchema,
  matchSchema,
  matchStatsSchema,
  matchSuggestionsSchema,
  myMetaSchema,
  rivalSuggestionsSchema,
  unclassifiedSchema,
} from './schemas'

/** Fase 28: the last suggestions, so the quick-entry form opens without signal. */
export const SUGGESTIONS_STORAGE_KEY = 'tcg.match-suggestions'
/** Fase 28: a send that takes longer than this counts as «no signal» (the clientRef makes a retry safe). */
const SEND_TIMEOUT_MS = 15_000

export const matchKeys = {
  all: ['matches'] as const,
  list: (params: MatchListParams) => ['matches', 'list', params] as const,
  detail: (id: string) => ['matches', 'detail', id] as const,
  suggestions: ['matches', 'suggestions'] as const,
  stats: (params: MatchStatsParams) => ['matches', 'stats', params] as const,
  comparison: (deckId: string, mode?: MatchMode) => ['matches', 'comparison', deckId, mode ?? null] as const,
  deckMatchups: (deckId: string) => ['matches', 'deck-matchups', deckId] as const,
}

export interface MatchListParams {
  deckId?: string
  mode?: MatchMode
  result?: MatchResult
  opponent?: string
  /** Fase 41: «exact» for a drill-down from a stats row or an archetype (the default is a search). */
  opponentMatch?: 'contains' | 'exact'
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

function storedSuggestions(): MatchSuggestions | undefined {
  try {
    const raw = localStorage.getItem(SUGGESTIONS_STORAGE_KEY)
    const parsed = raw ? matchSuggestionsSchema.safeParse(JSON.parse(raw)) : null
    return parsed?.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function useMatchSuggestions() {
  return useQuery({
    queryKey: matchKeys.suggestions,
    queryFn: async ({ signal }) => {
      const data = await request('/api/matches/suggestions', { schema: matchSuggestionsSchema, signal })
      try {
        localStorage.setItem(SUGGESTIONS_STORAGE_KEY, JSON.stringify(data))
      } catch {
        // Storage full or blocked: the form just needs the signal to open.
      }
      return data
    },
    // Fase 28: the stored copy shows at once (and without signal); it is refetched right away.
    initialData: storedSuggestions,
    initialDataUpdatedAt: 0,
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

/** Fase 44: «mi meta», the rivals of my matches as shares of tournament archetypes. */
export function useMyMeta(params: { mode?: MatchMode; days?: number } = {}) {
  return useQuery({
    queryKey: ['matches', 'my-meta', params] as const,
    queryFn: ({ signal }) => request('/api/matches/my-meta', { query: { ...params }, schema: myMetaSchema, signal }),
  })
}

/** Fase 13: is the deck's record against a rival (or overall) unusual for what tournaments expect? */
export function useLuck(deckId: string | null, opponent: string | null) {
  return useQuery({
    queryKey: ['matches', 'luck', deckId ?? '', opponent ?? ''] as const,
    queryFn: ({ signal }) =>
      request('/api/matches/luck', {
        query: { deckId: deckId ?? '', opponent: opponent ?? undefined },
        schema: luckSchema,
        signal,
      }),
    enabled: Boolean(deckId),
  })
}

/** Fase 9: the deck against each rival — own matches and the tournament matchup of its archetype. */
export function useDeckMatchups(deckId: string | undefined) {
  return useQuery({
    queryKey: matchKeys.deckMatchups(deckId ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/decks/${encodeURIComponent(deckId ?? '')}/matchups`, { schema: deckMatchupsSchema, signal }),
    enabled: Boolean(deckId),
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

/** Saves a match; gives up after 15 s so a dead signal does not hang the form (the clientRef makes a retry safe). */
export function sendMatch(body: MatchInput): Promise<Match> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined
  return request('/api/matches', { method: 'POST', body, schema: matchSchema, ...(signal ? { signal } : {}) })
}

export function useCreateMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: sendMatch,
    // Without signal the form keeps the match on the phone, so the mutation must fail instead of pausing.
    networkMode: 'always',
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

/** 14/10: the era's archetypes for the rival's cards seen (none asked without cards). */
export function useRivalSuggestions(cards: readonly { cardId: string; count: number }[]) {
  const param = cards.map((card) => `${card.cardId}x${card.count}`).join(',')
  return useQuery({
    queryKey: ['matches', 'rival-suggestions', param] as const,
    queryFn: ({ signal }) =>
      request('/api/matches/rival-suggestions', { query: { cards: param }, schema: rivalSuggestionsSchema, signal }),
    enabled: cards.length > 0,
    placeholderData: (previous) => previous,
  })
}

/** 14/10: the matches without a rival and with cards seen, grouped; the rivals typed that are no archetype. */
export function useUnclassified() {
  return useQuery({
    queryKey: ['matches', 'unclassified'] as const,
    queryFn: ({ signal }) => request('/api/matches/unclassified', { schema: unclassifiedSchema, signal }),
  })
}

/** 14/10: how many matches wait for a rival (what «Hoy» shows, without the groups). */
export function useUnclassifiedCount() {
  return useQuery({
    queryKey: ['matches', 'unclassified', 'count'] as const,
    queryFn: ({ signal }) =>
      request('/api/matches/unclassified/count', { schema: z.object({ matches: z.number() }), signal }),
  })
}

const classifiedSchema = z.object({
  updated: z.number(),
  opponent: z.string().nullable(),
  previous: z.array(z.object({ id: z.string(), opponent: z.string().nullable() })).default([]),
})
export type Classified = z.infer<typeof classifiedSchema>

async function classify(body: { matchIds?: string[]; from?: string; opponent: string | null }) {
  return request('/api/matches/classify', { method: 'POST', body, schema: classifiedSchema })
}

/** 14/10: one rival for some matches, or for every match of a rival typed before (`from`); `null` unclassifies. */
export function useClassify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: classify,
    onSuccess: () => invalidateMatches(queryClient),
  })
}

/** «Deshacer» a classification: each match gets back the rival it had (or none). */
export async function undoClassify(done: Classified, queryClient: QueryClient): Promise<void> {
  const byOpponent = new Map<string | null, string[]>()
  for (const item of done.previous) {
    const ids = byOpponent.get(item.opponent) ?? []
    ids.push(item.id)
    byOpponent.set(item.opponent, ids)
  }
  for (const [opponent, matchIds] of byOpponent) await classify({ matchIds, opponent })
  await invalidateMatches(queryClient)
}
