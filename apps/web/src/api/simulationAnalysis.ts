import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { gameRecordSchema, winRateSchema } from './schemas'
import { simulationKeys } from './simulations'

const interval = z.tuple([z.number(), z.number()])
const baseRow = z.object({
  key: z.string(),
  label: z.string(),
  record: gameRecordSchema,
  rate: winRateSchema.nullable(),
})
const matrixBase = z.object({
  id: z.number(),
  label: z.string(),
  bot: z.string(),
  engineRev: z.string(),
  era: z.string().nullable(),
  status: z.string().default('done'),
})
const edge = z.object({
  a: z.string(),
  b: z.string(),
  labelA: z.string(),
  labelB: z.string(),
  rate: winRateSchema,
  ties: z.number(),
})
const weighted = z.object({ value: z.number(), ci95: interval, games: z.number() })
export const simulationAnalysisSchema = z.object({
  source: z.literal('simulation'),
  options: z.object({ bots: z.array(z.string()), eras: z.array(z.string()), expansions: z.array(z.string()) }),
  summary: z.object({
    simulations: z.number(),
    activeJobs: z.number().default(0),
    games: z.number(),
    unknownEra: z.number(),
    failedChunks: z.number(),
    byBot: z.array(z.object({ bot: z.string(), botEs: z.string(), simulations: z.number(), games: z.number() })),
    byExpansion: z.array(z.object({ expansion: z.string(), simulations: z.number(), games: z.number() })),
  }),
  matrices: z.array(
    matrixBase.extend({
      status: z.string(),
      botEs: z.string(),
      symmetric: z.boolean(),
      games: z.number(),
      archived: z.boolean(),
      calibration: z.boolean(),
    }),
  ),
  matrix: matrixBase
    .extend({
      rows: z.array(
        baseRow.extend({
          cells: z.array(
            z.object({
              rival: z.string(),
              label: z.string(),
              record: gameRecordSchema.nullable(),
              rate: winRateSchema.nullable(),
            }),
          ),
        }),
      ),
    })
    .nullable(),
  rankings: z.array(matrixBase.extend({ rows: z.array(baseRow) })),
  comparison: z.object({ left: z.number().nullable(), right: z.number().nullable() }),
  agreement: z
    .object({
      left: z.number(),
      right: z.number(),
      orientative: z.boolean(),
      sameEngine: z.boolean(),
      leftBot: z.string(),
      rightBot: z.string(),
      leftEngine: z.string(),
      rightEngine: z.string(),
      leftStatus: z.string(),
      rightStatus: z.string(),
      correlation: z
        .object({ rho: z.number(), n: z.number(), ci95: interval.nullable(), method: z.literal('bootstrap') })
        .nullable(),
      changes: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          pValue: z.number(),
          significant: z.boolean(),
          before: weighted,
          after: weighted,
          difference: z.object({ value: z.number(), ci95: interval, se: z.number() }),
          rivals: z.number(),
          rankBefore: z.number(),
          rankAfter: z.number(),
          orientative: z.boolean(),
        }),
      ),
    })
    .nullable(),
  games: z.object({
    coverage: z.number(),
    first: winRateSchema.nullable(),
    second: winRateSchema.nullable(),
    ties: winRateSchema.nullable(),
    firstAdvantage: z.object({ value: z.number(), ci95: interval, n: z.number(), orientative: z.boolean() }).nullable(),
    duration: z
      .object({ mean: z.number(), ci95: interval.nullable(), n: z.number(), orientative: z.boolean() })
      .nullable(),
    histogram: z.array(z.object({ turns: z.number(), games: z.number() })),
  }),
  gameSample: z
    .object({ scope: z.enum(['matrix', 'laboratory']), jobIds: z.array(z.number()), games: z.number() })
    .optional(),
  patterns: z.object({
    dominant: z.array(edge),
    dominantTotal: z.number(),
    cycles: z.array(z.tuple([edge, edge, edge])),
    cyclesTotal: z.number(),
  }),
  findings: z.array(z.object({ kind: z.enum(['dominant', 'cycle', 'bot_change', 'first', 'ties']), text: z.string() })),
  calibrationJobId: z.number().nullable(),
})
export type SimulationAnalysis = z.infer<typeof simulationAnalysisSchema>
export function useSimulationAnalysis(params: URLSearchParams) {
  const query = params.toString()
  return useQuery({
    queryKey: [...simulationKeys.all, 'analysis', query],
    queryFn: ({ signal }) =>
      request(`/api/simulations/analysis${query ? `?${query}` : ''}`, { schema: simulationAnalysisSchema, signal }),
    refetchInterval: (q) => (q.state.data?.summary.activeJobs ? 30_000 : false),
  })
}
