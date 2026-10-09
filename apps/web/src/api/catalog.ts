import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  type CatalogStatus,
  cardEditionSchema,
  cardResponseSchema,
  cardSearchResponseSchema,
  catalogStatusSchema,
  expansionsResponseSchema,
  groupResponseSchema,
} from './schemas'

export const catalogKeys = {
  all: ['catalog'] as const,
  status: ['catalog', 'status'] as const,
  expansions: ['expansions'] as const,
  search: (q: string, lang: string, limit: number) => ['cards', 'search', q, lang, limit] as const,
  card: (cardId: string) => ['cards', cardId] as const,
  group: (groupId: string) => ['groups', groupId] as const,
}

const RUNNING_STATES = new Set(['running', 'pending', 'queued', 'started', 'in_progress'])

export function isSyncRunning(status: CatalogStatus | undefined): boolean {
  if (status?.syncRunning) return true
  const state = status?.lastSync?.status
  return state !== undefined && RUNNING_STATES.has(state)
}

export function useCatalogStatus() {
  return useQuery({
    queryKey: catalogKeys.status,
    queryFn: ({ signal }) => request('/api/catalog/status', { schema: catalogStatusSchema, signal }),
    // While a sync runs the page polls the status (docs/API.md: the sync runs in the background).
    refetchInterval: (query) => (isSyncRunning(query.state.data) ? 3000 : false),
  })
}

export function useSyncCatalog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { commit?: string; engineRev?: string }) =>
      request<unknown>('/api/catalog/sync', { method: 'POST', body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: catalogKeys.all }),
  })
}

export function useExpansions() {
  return useQuery({
    queryKey: catalogKeys.expansions,
    queryFn: ({ signal }) => request('/api/expansions', { schema: expansionsResponseSchema, signal }),
    staleTime: 10 * 60_000,
    select: (data) => data.items,
  })
}

export interface CardSearchOptions {
  lang?: 'es' | 'en' | 'any'
  limit?: number
  enabled?: boolean
}

export function useCardSearch(q: string, options: CardSearchOptions = {}) {
  const { lang = 'any', limit = 20, enabled = true } = options
  const trimmed = q.trim()
  return useQuery({
    queryKey: catalogKeys.search(trimmed, lang, limit),
    queryFn: ({ signal }) =>
      request('/api/cards', { query: { q: trimmed, lang, limit }, schema: cardSearchResponseSchema, signal }),
    enabled: enabled && trimmed.length > 0,
    placeholderData: keepPreviousData,
    select: (data) => data.items,
  })
}

export function useCard(cardId: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.card(cardId ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/cards/${encodeURIComponent(cardId ?? '')}`, { schema: cardResponseSchema, signal }),
    enabled: Boolean(cardId),
  })
}

const batchSchema = z.object({ items: z.array(cardEditionSchema) })

/** Fase 22: the editions of a game or a replay, once (they never change while the catalog is the same). */
export function useCardsBatch(cardIds: readonly string[]) {
  const ids = [...new Set(cardIds)].sort()
  return useQuery({
    queryKey: ['cards-batch', ids.join(',')] as const,
    queryFn: ({ signal }) =>
      request(`/api/cards/batch?ids=${encodeURIComponent(ids.join(','))}`, { schema: batchSchema, signal }),
    enabled: ids.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    select: (data) => new Map(data.items.map((card) => [card.id, card])),
  })
}

export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.group(groupId ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/groups/${encodeURIComponent(groupId ?? '')}`, { schema: groupResponseSchema, signal }),
    enabled: Boolean(groupId),
    select: (data) => data.group,
  })
}
