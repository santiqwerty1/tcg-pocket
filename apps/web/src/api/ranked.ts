/** Ranked by season and rank (14/10): the season, the rank noted when it changes, and the summary. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { gameRecordSchema, winRateSchema } from './schemas'

const rateRow = {
  record: gameRecordSchema,
  games: z.number(),
  rate: winRateSchema.nullable(),
  text: z.string(),
}
const rankChangeSchema = z.object({
  id: z.string(),
  at: z.string(),
  rank: z.string(),
  points: z.number().nullable(),
  label: z.string(),
})
const seasonSchema = z.object({ code: z.string(), name: z.string(), startsOn: z.string(), endsOn: z.string() })

export const rankedSchema = z.object({
  timeZone: z.string(),
  today: z.string(),
  ranks: z.array(z.object({ code: z.string(), label: z.string() })),
  seasons: z.array(seasonSchema.extend({ ...rateRow, current: z.boolean(), rankLabel: z.string().nullable() })),
  current: z
    .object({ code: z.string(), name: z.string(), endsOn: z.string(), rank: rankChangeSchema.nullable() })
    .nullable(),
  summary: z
    .object({
      season: seasonSchema,
      ...rateRow,
      rank: rankChangeSchema.nullable(),
      steps: z.array(
        rankChangeSchema.extend({
          move: z.enum(['up', 'down', 'same']).nullable(),
          decks: z.array(z.object({ deckId: z.string(), deckName: z.string(), ...rateRow })),
        }),
      ),
      byRank: z.array(z.object({ rank: z.string().nullable(), label: z.string(), ...rateRow })),
      byDeck: z.array(z.object({ deckId: z.string(), deckName: z.string(), ...rateRow })),
    })
    .nullable(),
})
/** 18/10: the season and the rank a registered match was played at, and the next rank noted after it. */
const matchRankedSchema = z.object({
  matchId: z.string(),
  competitive: z.boolean(),
  season: z.object({ code: z.string(), name: z.string() }).nullable(),
  rank: rankChangeSchema.nullable(),
  next: rankChangeSchema.nullable(),
})

export type Ranked = z.infer<typeof rankedSchema>
export type RankChange = z.infer<typeof rankChangeSchema>

const rankedKeys = {
  all: ['ranked'] as const,
  view: (season?: string) => ['ranked', season ?? ''] as const,
  match: (id: string) => ['ranked', 'match', id] as const,
}

export function useRanked(season?: string) {
  return useQuery({
    queryKey: rankedKeys.view(season),
    queryFn: ({ signal }) => request('/api/ranked', { query: season ? { season } : {}, schema: rankedSchema, signal }),
    placeholderData: (previous) => previous,
  })
}

/** 18/10: the season and the rank a registered match was played at. */
export function useMatchRanked(matchId: string) {
  return useQuery({
    queryKey: rankedKeys.match(matchId),
    queryFn: ({ signal }) =>
      request(`/api/ranked/matches/${encodeURIComponent(matchId)}`, { schema: matchRankedSchema, signal }),
  })
}

export function useAddRank() {
  const queryClient = useQueryClient()
  return useMutation({
    /** `beforeMatch` (18/10): the rank a registered match was played at, noted just before it. */
    mutationFn: (body: { rank: string; points?: number | null; at?: string; beforeMatch?: string }) =>
      request('/api/ranked/ranks', { method: 'POST', body, schema: rankChangeSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rankedKeys.all }),
  })
}

export function useDeleteRank() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request(`/api/ranked/ranks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rankedKeys.all }),
  })
}

export function useSetSeason() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ code, ...body }: { code: string; name: string; startsOn: string; endsOn: string }) =>
      request(`/api/ranked/seasons/${encodeURIComponent(code)}`, { method: 'PUT', body, schema: seasonSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rankedKeys.all }),
  })
}

/** The rank after `code` and before it in the game's order (null at the ends). */
export function neighbourRanks(ranks: Ranked['ranks'], code: string | null) {
  const at = code ? ranks.findIndex((rank) => rank.code === code) : -1
  return { up: at >= 0 ? (ranks[at + 1] ?? null) : null, down: at > 0 ? (ranks[at - 1] ?? null) : null }
}
