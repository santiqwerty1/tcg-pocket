import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  jobSummarySchema,
  type LabExploreInput,
  type LabTestInput,
  labBankSchema,
  labExplorePlanSchema,
  labJobSchema,
  labJobsSchema,
  simulationPreviewSchema,
} from './schemas'
import { simulationKeys } from './simulations'

export const labKeys = {
  all: ['lab'] as const,
  bank: (size: number, era: string | undefined) => ['lab', 'bank', size, era ?? ''] as const,
  jobs: ['lab', 'jobs'] as const,
  job: (id: string) => ['lab', 'job', id] as const,
}

const ACTIVE = new Set(['queued', 'running'])

/** The meta bank of the era: archetypes, their lists and weights (T-008). */
export function useLabBank(size: number, era?: string) {
  return useQuery({
    queryKey: labKeys.bank(size, era),
    queryFn: ({ signal }) =>
      request(`/api/lab/bank?size=${size}${era ? `&era=${encodeURIComponent(era)}` : ''}`, {
        schema: labBankSchema,
        signal,
      }),
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
