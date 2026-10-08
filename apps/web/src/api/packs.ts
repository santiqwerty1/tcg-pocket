import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import {
  packInfoSchema,
  packsResponseSchema,
  type RecommendBody,
  rarityRuleSchema,
  rarityRulesResponseSchema,
  recommendationSchema,
} from './schemas'

export const packKeys = {
  all: ['packs'] as const,
  list: ['packs', 'list'] as const,
  rarityRules: ['packs', 'rarity-rules'] as const,
  recommend: (body: RecommendBody) => ['packs', 'recommend', body] as const,
}

export function usePacks() {
  return useQuery({
    queryKey: packKeys.list,
    queryFn: ({ signal }) => request('/api/packs', { schema: packsResponseSchema, signal }),
    select: (data) => data.items,
  })
}

export interface PackPatch {
  available?: boolean
  limited?: boolean
  /** YYYY-MM-DD, the last day on sale; null = unknown. */
  limitedUntil?: string | null
}

export function useUpdatePack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PackPatch }) => {
      const [expansionId, name] = id.split('/')
      return request(`/api/packs/${encodeURIComponent(expansionId ?? '')}/${encodeURIComponent(name ?? '')}`, {
        method: 'PATCH',
        body: patch,
        schema: packInfoSchema,
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packKeys.all }),
  })
}

export function useRarityRules() {
  return useQuery({
    queryKey: packKeys.rarityRules,
    queryFn: ({ signal }) => request('/api/rarity-rules', { schema: rarityRulesResponseSchema, signal }),
    select: (data) => data.items,
  })
}

export function useSetRarityRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      rarity,
      patch,
    }: {
      rarity: string
      patch: { points?: number | null; verified?: boolean; tradeable?: boolean }
    }) =>
      request(`/api/rarity-rules/${encodeURIComponent(rarity)}`, {
        method: 'PATCH',
        body: patch,
        schema: rarityRuleSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packKeys.all }),
  })
}

/** Read-only POST: the goals travel in the body. Keeps the previous table while a new one loads. */
export function useRecommendation(body: RecommendBody | null) {
  return useQuery({
    queryKey: packKeys.recommend(
      body ?? {
        model: 'corrected',
        alpha: 0,
        collection: null,
        onlyAvailable: true,
        limitedBoost: 2,
        deckTarget: 'saved',
      },
    ),
    queryFn: ({ signal }) =>
      request('/api/packs/recommend', { method: 'POST', body, schema: recommendationSchema, signal }),
    enabled: body !== null,
    placeholderData: keepPreviousData,
  })
}
