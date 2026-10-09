/** Ejercicios de cálculo (Fase 30): a question from your decks, graded at once. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'

export type DrillKind = 'draw' | 'ko'

export const drillQuestionSchema = z.object({
  kind: z.enum(['draw', 'ko']),
  seed: z.number(),
  prompt: z.string(),
  facts: z.array(z.string()),
  choices: z.array(z.string()),
  deckId: z.string(),
  deck: z.string(),
})
export type DrillQuestion = z.infer<typeof drillQuestionSchema>

const tallySchema = z.object({ answered: z.number(), correct: z.number() })
export const drillStatsSchema = z.object({
  today: tallySchema,
  streak: z.number(),
  byKind: z.object({ draw: tallySchema, ko: tallySchema }),
})
export type DrillStats = z.infer<typeof drillStatsSchema>

export const drillAnswerSchema = z.object({
  correct: z.boolean(),
  answer: z.number(),
  explanation: z.string(),
  stats: drillStatsSchema,
})
export type DrillAnswer = z.infer<typeof drillAnswerSchema>

export const drillKeys = {
  stats: ['drills', 'stats'] as const,
  question: (kind: DrillKind, deckId: string, seed: number) => ['drills', 'question', kind, deckId, seed] as const,
}

export function useDrillStats() {
  return useQuery({
    queryKey: drillKeys.stats,
    queryFn: ({ signal }) => request('/api/drills/stats', { schema: drillStatsSchema, signal }),
  })
}

export function useDrill(kind: DrillKind, deckId: string, seed: number) {
  return useQuery({
    queryKey: drillKeys.question(kind, deckId, seed),
    queryFn: ({ signal }) =>
      request('/api/drills', {
        query: { kind, deckId: deckId || undefined, seed },
        schema: drillQuestionSchema,
        signal,
      }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
}

export function useAnswerDrill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { kind: DrillKind; deckId: string; seed: number; choice: number }) =>
      request('/api/drills/answer', { method: 'POST', body, schema: drillAnswerSchema }),
    onSuccess: (answer) => queryClient.setQueryData(drillKeys.stats, answer.stats),
  })
}
