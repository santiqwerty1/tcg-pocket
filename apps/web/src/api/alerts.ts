import { useQuery } from '@tanstack/react-query'
import { request } from './client'
import { alertsSchema } from './schemas'

/** What the owner should know (new set, new era, limited pack ending…): checked every 30 minutes. */
export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: ({ signal }) => request('/api/alerts', { schema: alertsSchema, signal }),
    select: (data) => data.items,
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
  })
}
