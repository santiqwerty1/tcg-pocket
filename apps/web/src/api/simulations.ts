import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  consistencySchema,
  engineInfoSchema,
  type JobDetail,
  jobDetailSchema,
  jobSummarySchema,
  jobsResponseSchema,
  replayResponseSchema,
  type SimulationInput,
  simulationPreviewSchema,
} from './schemas'

export const simulationKeys = {
  all: ['simulations'] as const,
  list: (archived: boolean) => ['simulations', 'list', archived] as const,
  engine: ['simulations', 'engine'] as const,
  detail: (id: string) => ['simulations', 'detail', id] as const,
  replay: (id: string) => ['simulations', 'replay', id] as const,
}

const ACTIVE = new Set(['queued', 'running'])

/** The list (or the archived jobs), with the counts for the bulk buttons. Refreshes every 5 s while a job is queued
 * or running, every 30 s otherwise. */
export function useSimulations(archived = false) {
  return useQuery({
    queryKey: simulationKeys.list(archived),
    queryFn: ({ signal }) =>
      request(`/api/simulations${archived ? '?archived=true' : ''}`, { schema: jobsResponseSchema, signal }),
    refetchInterval: (q) => (q.state.data?.items.some((job) => ACTIVE.has(job.status)) ? 5000 : 30_000),
    placeholderData: keepPreviousData,
  })
}

/** Archive a finished job (hidden from the list; its results still count) or bring it back. */
export function useArchiveSimulation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      request(`/api/simulations/${id}/${archived ? 'archive' : 'unarchive'}`, {
        method: 'POST',
        schema: jobSummarySchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}

/** Delete every cancelled job, or archive every finished one. */
export function useCleanupSimulations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: 'delete_cancelled' | 'archive_done') =>
      request('/api/simulations/cleanup', {
        method: 'POST',
        body: { action },
        schema: z.object({ count: z.number() }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
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

/**
 * How often a job's page is read again: every 10 s while it runs (SSE moves the progress bar in between), and while
 * the confirmation of a finished optimize waits to be queued or plays (H-011.5); never once all of it ended.
 */
export function detailRefetchMs(job: Pick<JobDetail, 'status' | 'optimizeConfirmation'> | undefined): number | false {
  if (!job) return false
  const confirmation = job.optimizeConfirmation?.status
  return ACTIVE.has(job.status) ||
    confirmation === 'pending' ||
    (confirmation !== undefined && ACTIVE.has(confirmation))
    ? 10_000
    : false
}

/** The job with its results (refetched as `detailRefetchMs` says). */
export function useSimulation(id: string) {
  return useQuery({
    queryKey: simulationKeys.detail(id),
    queryFn: ({ signal }) => request(`/api/simulations/${encodeURIComponent(id)}`, { schema: jobDetailSchema, signal }),
    refetchInterval: (q) => detailRefetchMs(q.state.data),
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

const measuredSchema = z.object({ job: jobSummarySchema, consistency: consistencySchema }).nullable()
const deckConsistencySchema = z.object({ result: measuredSchema, meta: measuredSchema.default(null) })

/** The latest finished consistency of a deck: against a passive rival (Fase 8) and against the meta (D-019). */
export function useDeckConsistency(deckId: string) {
  return useQuery({
    queryKey: [...simulationKeys.all, 'consistency', deckId] as const,
    queryFn: ({ signal }) =>
      request(`/api/simulations/consistency/deck/${encodeURIComponent(deckId)}`, {
        schema: deckConsistencySchema,
        signal,
      }),
    select: (data) => ({ goldfish: data.result, meta: data.meta }),
  })
}

/** Queues a consistency measure: `goldfish` against a passive rival, `meta` against the Laboratorio's meta bank. */
export function useMeasureConsistency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ mode, ...body }: { mode: 'goldfish' | 'meta'; deckId: string; keyCards?: string[] }) =>
      request(mode === 'meta' ? '/api/lab/consistency' : '/api/simulations/consistency', {
        method: 'POST',
        body,
        schema: jobSummarySchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: simulationKeys.all }),
  })
}
