import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import {
  type DeckTarget,
  packInfoSchema,
  packsResponseSchema,
  type RecommendBody,
  rarityRuleSchema,
  rarityRulesResponseSchema,
  recommendationSchema,
} from './schemas'

export interface StarCouponParams {
  deckTarget: DeckTarget
  copies: number
}

export const packKeys = {
  all: ['packs'] as const,
  list: ['packs', 'list'] as const,
  rarityRules: ['packs', 'rarity-rules'] as const,
  recommend: (body: RecommendBody) => ['packs', 'recommend', body] as const,
  starCoupon: (params: StarCouponParams) => ['packs', 'star-coupon', params] as const,
}

const starCouponCardSchema = z.object({
  cardId: z.string(),
  groupId: z.string(),
  nameEs: z.string(),
  owned: z.number(),
  decks: z.array(z.string()),
  newEdition: z.boolean(),
  belowGoal: z.boolean(),
})

const starCouponPackSchema = z.object({
  packId: z.string(),
  nameEs: z.string(),
  expansionId: z.string(),
  expansionNameEs: z.string(),
  size: z.number(),
  forDecks: z.number(),
  newEditions: z.number(),
  belowGoal: z.number(),
  /** Percent (0–100). */
  chanceDecks: z.number(),
  chanceNew: z.number(),
  chanceBelowGoal: z.number(),
  cards: z.array(starCouponCardSchema),
  limited: z.object({ until: z.string().nullable(), daysLeft: z.number().nullable() }).nullable(),
})

const starCouponStatusSchema = z.object({
  key: z.string(),
  name: z.string(),
  count: z.number(),
  nameEs: z.string().nullable(),
  until: z.string().nullable(),
  expired: z.boolean(),
})

/** Cupón ★★ (3/11/2026): `GET /api/packs/star-coupon`. */
export const starCouponSchema = z.object({
  rarity: z.string(),
  today: z.string(),
  deckTarget: z.enum(['saved', 'tournament']),
  goalCopies: z.number(),
  goals: z.array(
    z.object({ id: z.string(), name: z.string(), priority: z.number(), target: z.enum(['saved', 'tournament']) }),
  ),
  lastImportAt: z.string().nullable(),
  packs: z.array(starCouponPackSchema),
  best: z.array(z.string()),
  coupons: z
    .object({ importedAt: z.string(), syncedAt: z.string(), items: z.array(starCouponStatusSchema).nullable() })
    .nullable(),
  known: z.array(z.object({ key: z.string(), nameEs: z.string(), until: z.string().nullable() })),
})
export type StarCoupon = z.infer<typeof starCouponSchema>
export type StarCouponPack = z.infer<typeof starCouponPackSchema>

/** With the page's knobs, so the section follows them before they are saved. */
export function useStarCoupon(params: StarCouponParams) {
  return useQuery({
    queryKey: packKeys.starCoupon(params),
    queryFn: ({ signal }) =>
      request('/api/packs/star-coupon', {
        query: { deckTarget: params.deckTarget, copies: params.copies },
        schema: starCouponSchema,
        signal,
      }),
    placeholderData: keepPreviousData,
  })
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
        limitedBoost: 3,
        deckTarget: 'saved',
        missions: false,
      },
    ),
    queryFn: ({ signal }) =>
      request('/api/packs/recommend', { method: 'POST', body, schema: recommendationSchema, signal }),
    enabled: body !== null,
    placeholderData: keepPreviousData,
  })
}
