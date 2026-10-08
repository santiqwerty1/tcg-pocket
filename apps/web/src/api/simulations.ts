import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  consistencySchema,
  engineInfoSchema,
  jobDetailSchema,
  jobSummarySchema,
  jobsResponseSchema,
  replayResponseSchema,
  type SimulationInput,
  simulationPreviewSchema,
} from './schemas'

export const simulationKeys = {
  all: ['simulations'] as const,
  list: ['simulations', 'list'] as const,
  engine: ['simulations', 'engine'] as const,
  detail: (id: string) => ['simulations', 'detail', id] as const,
  replay: (id: string) => ['simulations', 'replay', id] as const,
}

const ACTIVE = new Set(['queued', 'running'])

/** Refreshes every 5 s while a job is queued or running, every 30 s otherwise. */
export function useSimulations() {
  return useQuery({
    queryKey: simulationKeys.list,
    queryFn: ({ signal }) => request('/api/simulations', { schema: jobsResponseSchema, signal }),
    select: (data) => data.items,
    refetchInterval: (q) => (q.state.data?.items.some((job) => ACTIVE.has(job.status)) ? 5000 : 30_000),
  })
}

/** Engine revision, card status source, workers (online or not) and the bots. */
export function useEngineInfo() {
  return useQuery({
    queryKey: simulationKeys.engine,
    queryFn: ({ signal }) => request('/api/simulations/engine', { schema: engineInfoSchema, signal }),
    refetchInterval: 15_000,
  })
}

/** The job with its results; refetched every 10 s while it runs (SSE moves the progress bar in between). */
export function useSimulation(id: string) {
  return useQuery({
    queryKey: simulationKeys.detail(id),
    queryFn: ({ signal }) => request(`/api/simulations/${encodeURIComponent(id)}`, { schema: jobDetailSchema, signal }),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 10_000 : false),
    placeholderData: keepPreviousData,
  })
}

export function usePreviewSimulation() {
  return useMutation({
    mutationFn: (input: SimulationInput) =>
      request('/api/simulations/preview', { method: 'POST', body: input, schema: simulationPreviewSchema }),
  })
}

export function useCreateSimulation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SimulationInput) =>
      request('/api/simulations', { method: 'POST', body: input, schema: jobSummarySchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}

export function useCancelSimulation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => request(`/api/simulations/${id}/cancel`, { method: 'POST', schema: jobSummarySchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}

export function useDeleteSimulation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => request(`/api/simulations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}

/** A stored replay (deckgym's JSON) and the Spanish names of its cards, by engine id. */
export function useReplay(id: string) {
  return useQuery({
    queryKey: simulationKeys.replay(id),
    queryFn: ({ signal }) =>
      request(`/api/simulations/replays/${encodeURIComponent(id)}`, { schema: replayResponseSchema, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

const deckConsistencySchema = z.object({
  result: z.object({ job: jobSummarySchema, consistency: consistencySchema }).nullable(),
})

/** The latest finished consistency of a deck (Fase 8). */
export function useDeckConsistency(deckId: string) {
  return useQuery({
    queryKey: [...simulationKeys.all, 'consistency', deckId] as const,
    queryFn: ({ signal }) =>
      request(`/api/simulations/consistency/deck/${encodeURIComponent(deckId)}`, {
        schema: deckConsistencySchema,
        signal,
      }),
    select: (data) => data.result,
  })
}

export function useMeasureConsistency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { deckId: string; keyCards?: string[]; games?: number }) =>
      request('/api/simulations/consistency', { method: 'POST', body, schema: jobSummarySchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}
