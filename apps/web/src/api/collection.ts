import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { downloadFile, request } from './client'
import {
  adjustmentsResponseSchema,
  collectionAdjustmentSchema,
  collectionGroupsResponseSchema,
  collectionSummarySchema,
  importAppliedSchema,
  importPreviewSchema,
  importsResponseSchema,
  missionsSchema,
  packLuckViewSchema,
  stockPatchResultSchema,
  stockResponseSchema,
} from './schemas'

export const PAGE_SIZE = 50

export const collectionKeys = {
  all: ['collection'] as const,
  summary: ['collection', 'summary'] as const,
  groups: (params: GroupsParams) => ['collection', 'groups', params] as const,
  stock: (params: StockParams) => ['collection', 'stock', params] as const,
  imports: ['collection', 'imports'] as const,
  import: (id: string) => ['collection', 'imports', id] as const,
  adjustments: (active: boolean) => ['collection', 'adjustments', active] as const,
}

/** Everything that depends on owned copies: collection views, group pages and deck completeness. */
export async function invalidateCollection(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: collectionKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['groups'] }),
    queryClient.invalidateQueries({ queryKey: ['cards'] }),
    queryClient.invalidateQueries({ queryKey: ['decks'] }),
  ])
}

export function useCollectionSummary() {
  return useQuery({
    queryKey: collectionKeys.summary,
    queryFn: ({ signal }) => request('/api/collection/summary', { schema: collectionSummarySchema, signal }),
  })
}

export interface GroupsParams {
  q?: string
  expansion?: string
  missingOnly?: boolean
}

export function useCollectionGroups(params: GroupsParams) {
  return useInfiniteQuery({
    queryKey: collectionKeys.groups(params),
    queryFn: ({ pageParam, signal }) =>
      request('/api/collection/groups', {
        query: {
          q: params.q?.trim() || undefined,
          expansion: params.expansion || undefined,
          missingOnly: params.missingOnly ? true : undefined,
          limit: PAGE_SIZE,
          offset: pageParam,
        },
        schema: collectionGroupsResponseSchema,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0)
      return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
  })
}

export interface StockParams {
  q?: string
  expansion?: string
  onlyOwned?: boolean
}

export function useCollectionStock(params: StockParams) {
  return useInfiniteQuery({
    queryKey: collectionKeys.stock(params),
    queryFn: ({ pageParam, signal }) =>
      request('/api/collection/stock', {
        query: {
          q: params.q?.trim() || undefined,
          expansion: params.expansion || undefined,
          onlyOwned: params.onlyOwned ? true : undefined,
          limit: PAGE_SIZE,
          offset: pageParam,
        },
        schema: stockResponseSchema,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0)
      return lastPage.items.length > 0 && loaded < lastPage.total ? loaded : undefined
    },
  })
}

export interface StockPatch {
  cardId: string
  amountOwned?: number
  collected?: boolean
}

export function usePatchStock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ cardId, ...body }: StockPatch) =>
      request(`/api/collection/stock/${encodeURIComponent(cardId)}`, {
        method: 'PATCH',
        body,
        schema: stockPatchResultSchema,
      }),
    onSuccess: () => invalidateCollection(queryClient),
  })
}

export function useCreateImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file, file.name)
      return request('/api/collection/imports', { method: 'POST', body: form, schema: importPreviewSchema })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionKeys.imports }),
  })
}

export function useImports() {
  return useQuery({
    queryKey: collectionKeys.imports,
    queryFn: ({ signal }) => request('/api/collection/imports', { schema: importsResponseSchema, signal }),
    select: (data) => data.items,
  })
}

export function useImport(id: string | undefined) {
  return useQuery({
    queryKey: collectionKeys.import(id ?? ''),
    queryFn: ({ signal }) =>
      request(`/api/collection/imports/${encodeURIComponent(id ?? '')}`, { schema: importPreviewSchema, signal }),
    enabled: Boolean(id),
  })
}

export function useApplyImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request(`/api/collection/imports/${encodeURIComponent(id)}/apply`, {
        method: 'POST',
        schema: importAppliedSchema,
      }),
    onSuccess: () => invalidateCollection(queryClient),
  })
}

export function useDiscardImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request(`/api/collection/imports/${encodeURIComponent(id)}/discard`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionKeys.imports }),
  })
}

export function exportCollectionCsv(): Promise<string> {
  return downloadFile('/api/collection/export.csv', 'tcgcollectiontracterexport.csv')
}

export function useAdjustments(active = true) {
  return useQuery({
    queryKey: collectionKeys.adjustments(active),
    queryFn: ({ signal }) =>
      request('/api/collection/adjustments', {
        query: { active: active ? true : undefined },
        schema: adjustmentsResponseSchema,
        signal,
      }),
    select: (data) => data.items,
  })
}

export interface AdjustmentInput {
  functionalGroupId: string
  playableCopies: number
  reason: string
}

export function useCreateAdjustment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AdjustmentInput) =>
      request('/api/collection/adjustments', { method: 'POST', body, schema: collectionAdjustmentSchema.partial() }),
    onSuccess: () => invalidateCollection(queryClient),
  })
}

export type AdjustmentResolution = 'user' | 'csv_matches' | 'manual_edit'

export function useResolveAdjustment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: AdjustmentResolution }) =>
      request<unknown>(`/api/collection/adjustments/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: { resolution },
      }),
    onSuccess: () => invalidateCollection(queryClient),
  })
}

export function useConvertAdjustment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, targetCardId }: { id: string; targetCardId: string }) =>
      request<unknown>(`/api/collection/adjustments/${encodeURIComponent(id)}/convert`, {
        method: 'POST',
        body: { targetCardId },
      }),
    onSuccess: () => invalidateCollection(queryClient),
  })
}

/** Themed-collection missions against the collection (Fase 8). */
export function useMissions(params: { expansion?: string; incomplete?: boolean }) {
  const search = new URLSearchParams()
  if (params.expansion) search.set('expansion', params.expansion)
  if (params.incomplete) search.set('incomplete', 'true')
  return useQuery({
    queryKey: ['collection', 'missions', params.expansion ?? '', Boolean(params.incomplete)] as const,
    queryFn: ({ signal }) =>
      request(`/api/collection/missions?${search.toString()}`, { schema: missionsSchema, signal }),
    placeholderData: keepPreviousData,
  })
}

/** Fase 17: what came in between imports, by rarity, against the rates of packs. */
export function usePackLuck() {
  return useQuery({
    queryKey: ['collection', 'pack-luck'] as const,
    queryFn: ({ signal }) => request('/api/collection/pack-luck', { schema: packLuckViewSchema, signal }),
  })
}
