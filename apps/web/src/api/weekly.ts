/** Resumen semanal (Fase 32): a week from Monday to Sunday (Buenos Aires time), by default the last full one. */
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'

const recordSchema = z.object({ wins: z.number(), losses: z.number(), ties: z.number() })
const rowSchema = z.object({ record: recordSchema, games: z.number(), text: z.string() })
const moveSchema = z.object({ name: z.string(), delta: z.number() })

export const weekSummarySchema = z.object({
  week: z.object({
    start: z.string(),
    label: z.string(),
    previous: z.string(),
    next: z.string().nullable(),
    current: z.boolean(),
  }),
  matches: z.object({
    overall: rowSchema,
    previousWeek: rowSchema,
    byDeck: z.array(rowSchema.extend({ deck: z.string(), deckId: z.string() })),
    bestRival: rowSchema.extend({ label: z.string() }).nullable(),
    worstRival: rowSchema.extend({ label: z.string() }).nullable(),
  }),
  bot: z.object({
    games: z.number(),
    wins: z.number(),
    losses: z.number(),
    ties: z.number(),
    coachGames: z.number(),
    coachAgreement: z.number().nullable(),
  }),
  practice: z.object({
    situationsTried: z.number(),
    situationsSolved: z.number(),
    drillsAnswered: z.number(),
    drillsCorrect: z.number(),
  }),
  work: z.object({ simulations: z.number(), lab: z.number() }),
  imports: z.number(),
  meta: z.object({ rising: z.array(moveSchema), falling: z.array(moveSchema) }).nullable(),
  headline: z.string(),
  quiet: z.boolean(),
})
export type WeekSummary = z.infer<typeof weekSummarySchema>

export function useWeekSummary(week: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['weekly', week ?? ''] as const,
    queryFn: ({ signal }) =>
      request('/api/weekly', { query: { semana: week ?? undefined }, schema: weekSummarySchema, signal }),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60_000,
  })
}
