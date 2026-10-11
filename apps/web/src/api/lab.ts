import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  jobSummarySchema,
  type LabCoreInput,
  type LabExploreInput,
  type LabObjectiveChoice,
  type LabTestInput,
  labBankSchema,
  labCoreSchema,
  labExplorePlanSchema,
  labJobSchema,
  labJobsSchema,
  simulationPreviewSchema,
} from './schemas'
import { simulationKeys } from './simulations'

export const labKeys = {
  all: ['lab'] as const,
  bank: (size: number, era: string | undefined, objective?: LabObjectiveChoice) =>
    ['lab', 'bank', size, era ?? '', objective?.objective ?? 'meta', objective?.archetypeId ?? ''] as const,
  jobs: ['lab', 'jobs'] as const,
  job: (id: string) => ['lab', 'job', id] as const,
}

const ACTIVE = new Set(['queued', 'running'])

/** The meta bank of the era: archetypes, their lists and weights (T-008). */
export function useLabBank(size: number, era?: string, objective?: LabObjectiveChoice) {
  const params = new URLSearchParams({ size: String(size) })
  if (era) params.set('era', era)
  // T-017 D4: «mi meta» or one rival instead of the era's most played.
  if (objective?.objective && objective.objective !== 'meta') params.set('objective', objective.objective)
  if (objective?.objective === 'rival' && objective.archetypeId) params.set('archetypeId', objective.archetypeId)
  const waiting = objective?.objective === 'rival' && !objective.archetypeId
  return useQuery({
    queryKey: labKeys.bank(size, era, objective),
    queryFn: ({ signal }) => request(`/api/lab/bank?${params.toString()}`, { schema: labBankSchema, signal }),
    enabled: !waiting,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

export function useLabJobs() {
  return useQuery({
    queryKey: labKeys.jobs,
    queryFn: ({ signal }) => request('/api/lab/jobs', { schema: labJobsSchema, signal }),
    select: (data) => data.items,
    refetchInterval: (q) => (q.state.data?.items.some((job) => ACTIVE.has(job.status)) ? 5000 : 30_000),
  })
}

/** A test or a search with its scores; refetched every 5 s while it runs. */
export function useLabJob(id: string) {
  return useQuery({
    queryKey: labKeys.job(id),
    queryFn: ({ signal }) => request(`/api/lab/jobs/${encodeURIComponent(id)}`, { schema: labJobSchema, signal }),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.job.status) ? 5000 : false),
    placeholderData: keepPreviousData,
  })
}

const testPreviewSchema = z.object({ preview: simulationPreviewSchema, bank: labBankSchema })

export function usePreviewLabTest() {
  return useMutation({
    mutationFn: (input: LabTestInput) =>
      request('/api/lab/test', { method: 'POST', body: { ...input, dryRun: true }, schema: testPreviewSchema }),
  })
}

export function useLabTest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LabTestInput) =>
      request('/api/lab/test', { method: 'POST', body: input, schema: jobSummarySchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: labKeys.all })
      void queryClient.invalidateQueries({ queryKey: simulationKeys.all })
    },
  })
}

export function usePlanLabExplore() {
  return useMutation({
    mutationFn: (input: LabExploreInput) =>
      request('/api/lab/explore', { method: 'POST', body: { ...input, dryRun: true }, schema: labExplorePlanSchema }),
  })
}

/** T-017 D2: «Frenar y confirmar» a search (the round in play ends with what it has, then the confirmation). */
export function useStopLabSearch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number | string) =>
      request(`/api/lab/jobs/${encodeURIComponent(String(id))}/stop`, { method: 'POST', schema: labJobSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: labKeys.all })
      void queryClient.invalidateQueries({ queryKey: simulationKeys.all })
    },
  })
}

export function useLabExplore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LabExploreInput) =>
      request('/api/lab/explore', { method: 'POST', body: input, schema: jobSummarySchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: labKeys.all })
      void queryClient.invalidateQueries({ queryKey: simulationKeys.all })
    },
  })
}

/** Fase 19: a first list around 1–4 cards (queues nothing). */
export function useLabCore() {
  return useMutation({
    mutationFn: (input: LabCoreInput) =>
      request('/api/lab/core', { method: 'POST', body: input, schema: labCoreSchema }),
  })
}
