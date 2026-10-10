/**
 * Calibration of the simulations against tournaments (R-012): the meta bank played against itself by a chosen bot
 * (`/api/calibration`), next to the archetypes' tournament matchups of the same era. Each side keeps its own rate.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  isoDate,
  jobProgressSchema,
  jobSummarySchema,
  nullableDate,
  SIMULATION_STATUSES,
  winRateSchema,
} from './schemas'
import { simulationKeys } from './simulations'

const rankCorrelationSchema = z.object({
  rho: z.number(),
  n: z.number(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
  method: z.enum(['fisher', 'bootstrap']),
})
export type RankCorrelation = z.infer<typeof rankCorrelationSchema>

const calibrationJobSchema = z.object({
  id: z.number(),
  status: z.enum(SIMULATION_STATUSES),
  label: z.string(),
  bot: z.string(),
  botEs: z.string(),
  era: z.string(),
  format: z.string(),
  engineRev: z.string(),
  gamesPerPair: z.number(),
  createdAt: isoDate,
  finishedAt: nullableDate,
  progress: jobProgressSchema,
  lists: z.number(),
})

export const calibrationRowSchema = z.object({
  a: z.string(),
  b: z.string(),
  labelA: z.string(),
  labelB: z.string(),
  simulated: winRateSchema.nullable(),
  ties: z.number(),
  tournament: winRateSchema.nullable(),
  difference: z.number().nullable(),
  differenceCi95: z.tuple([z.number(), z.number()]).nullable(),
  compatible: z.boolean().nullable(),
})
export type CalibrationRow = z.infer<typeof calibrationRowSchema>

const weightedRateSchema = z.object({
  value: z.number(),
  ci95: z.tuple([z.number(), z.number()]),
  games: z.number(),
  orientative: z.boolean(),
})
export type WeightedRate = z.infer<typeof weightedRateSchema>

const calibrationArchetypeSchema = z.object({
  id: z.string(),
  label: z.string(),
  simulated: weightedRateSchema.nullable(),
  tournament: weightedRateSchema.nullable(),
  rivals: z.number(),
})
export type CalibrationArchetype = z.infer<typeof calibrationArchetypeSchema>

export const calibrationViewSchema = z.object({
  job: calibrationJobSchema,
  report: z.object({
    rows: z.array(calibrationRowSchema),
    compared: z.number(),
    compatible: z.number(),
    meanAbsDifference: z.number().nullable(),
    rankCorrelation: rankCorrelationSchema.nullable(),
    archetypes: z.array(calibrationArchetypeSchema),
    archetypeCorrelation: rankCorrelationSchema.nullable(),
    minTournamentGames: z.number(),
  }),
  tournaments: z.object({
    era: z.string(),
    format: z.string(),
    matches: z.number(),
    tournamentsWithPairings: z.number(),
  }),
  pending: z.number(),
  failed: z.number(),
  /** Left unplayed by a cancelled job. */
  cancelled: z.number().default(0),
  /** Two lists of one archetype: not compared. */
  mirrors: z.number().default(0),
})
export type CalibrationView = z.infer<typeof calibrationViewSchema>

const calibrationSummarySchema = calibrationJobSchema.extend({
  summary: z
    .object({
      compared: z.number(),
      compatible: z.number(),
      meanAbsDifference: z.number().nullable(),
      rankCorrelation: rankCorrelationSchema.nullable(),
    })
    .nullable(),
  failed: z.number(),
  cancelled: z.number().default(0),
})
export type CalibrationSummary = z.infer<typeof calibrationSummarySchema>

export const calibrationKeys = {
  all: ['calibration'] as const,
  list: ['calibration', 'list'] as const,
  detail: (id: string) => ['calibration', 'detail', id] as const,
}

const ACTIVE = new Set(['queued', 'running'])

export function useCalibrations() {
  return useQuery({
    queryKey: calibrationKeys.list,
    queryFn: ({ signal }) => request('/api/calibration', { schema: z.array(calibrationSummarySchema), signal }),
    refetchInterval: (q) => (q.state.data?.some((job) => ACTIVE.has(job.status)) ? 10_000 : 60_000),
    placeholderData: keepPreviousData,
  })
}

export function useCalibration(id: string) {
  return useQuery({
    queryKey: calibrationKeys.detail(id),
    queryFn: ({ signal }) => request(`/api/calibration/${id}`, { schema: calibrationViewSchema, signal }),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.job.status) ? 10_000 : false),
  })
}

export function useStartCalibration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { bot: string; gamesPerPair?: number }) =>
      request('/api/calibration', { method: 'POST', body: input, schema: jobSummarySchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: calibrationKeys.all })
      void queryClient.invalidateQueries({ queryKey: simulationKeys.all })
    },
  })
}
