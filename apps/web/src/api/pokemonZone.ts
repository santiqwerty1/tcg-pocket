/**
 * pokemon-zone (2/11/2026): what the bookmarklet brings from pokemon-zone.com. `POST /api/pokemon-zone/preview` says
 * what saving would change, `POST /api/pokemon-zone/imports` saves it, `GET /api/pokemon-zone` is the latest import
 * with its comparisons (docs/API.md «pokemon-zone»). Schemas mirror apps/api's PokemonZoneService views.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from './client'
import { packKeys } from './packs'
import { pokemonZoneKey } from './pokemonZoneKey'
import { settingsKeys } from './settings'

export { pokemonZoneKey }

const counter = z.object({ battles: z.number(), wins: z.number() })
export const gameCounterSchema = counter.extend({
  rate: z.number().nullable(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
  orientative: z.boolean(),
})
export type GameCounter = z.infer<typeof gameCounterSchema>

const gameBattlesSchema = z.object({
  versus: gameCounterSchema.nullable(),
  ranked: gameCounterSchema.nullable(),
  solo: gameCounterSchema.nullable(),
  rental: gameCounterSchema.nullable(),
  rankedPoints: z.number().nullable(),
})

export const promoCouponSchema = z.object({
  key: z.string(),
  event: z.string(),
  count: z.number(),
  eventId: z.string().nullable(),
  nameEs: z.string().nullable(),
  active: z.boolean(),
})
export type PromoCoupon = z.infer<typeof promoCouponSchema>

const totalsSchema = z.object({
  packsOpened: z.number().nullable(),
  cardsObtained: z.number().nullable(),
  uniqueCards: z.number().nullable(),
  wonderPicks: z.number().nullable(),
  trades: z.number().nullable(),
})

const nullableCount = z.number().nullable()
const hourglassesSchema = z.object({
  pack: nullableCount,
  wonder: nullableCount,
  trade: nullableCount,
  event: nullableCount,
  rewind: nullableCount,
})

const importRefSchema = z.object({ id: z.string(), importedAt: z.string(), syncedAt: z.string() })
export type PokemonZoneImportRef = z.infer<typeof importRefSchema>

/** Review of pz/import: `kept` — changed by hand after the read, the value stays (`game` is what the game said). */
const hourglassesUpdateSchema = z.object({
  before: z.number(),
  after: z.number(),
  game: z.number(),
  kept: z.boolean(),
})

export const pokemonZonePreviewSchema = z.object({
  syncedAt: z.string(),
  level: z.number().nullable(),
  account: z.enum(['first', 'same', 'other']),
  duplicate: z.boolean(),
  older: z.boolean(),
  packPoints: z.object({
    changes: z.array(
      z.object({ expansionId: z.string(), before: z.number(), after: z.number(), nameEs: z.string().nullable() }),
    ),
    unchanged: z.number(),
    kept: z.array(
      z.object({
        expansionId: z.string(),
        value: z.number(),
        game: z.number(),
        editedAt: z.string(),
        nameEs: z.string().nullable(),
      }),
    ),
  }),
  hourglasses: hourglassesUpdateSchema.extend({ editedAt: z.string().nullable() }).nullable(),
  coupons: z.array(promoCouponSchema),
  battles: gameBattlesSchema,
  totals: totalsSchema,
  since: z.object({ from: importRefSchema, packs: z.number(), cards: z.number() }).nullable(),
})
export type PokemonZonePreview = z.infer<typeof pokemonZonePreviewSchema>

export const pokemonZoneSavedSchema = z.object({
  import: importRefSchema,
  duplicate: z.boolean(),
  applied: z
    .object({ packPoints: z.number(), packPointsKept: z.number(), hourglasses: hourglassesUpdateSchema.nullable() })
    .nullable(),
})
export type PokemonZoneSaved = z.infer<typeof pokemonZoneSavedSchema>

const luckCheckSchema = z.object({
  games: z.number(),
  wins: z.number(),
  verdict: z.enum(['too_few', 'normal', 'unlucky', 'lucky']),
  lowerTail: z.number(),
  upperTail: z.number(),
})
/** Review of pz/import: the check at both ends of what the cards from elsewhere could hold; «unknown» if they differ. */
const luckTierSchema = z.object({
  observed: z.number(),
  expectedShare: z.number(),
  games: z.number(),
  expected: z.number(),
  fromPacks: z.object({ min: z.number(), max: z.number() }),
  low: luckCheckSchema,
  high: luckCheckSchema,
  verdict: z.enum(['unknown', 'too_few', 'normal', 'unlucky', 'lucky']),
  tail: z.number().nullable(),
})
export type GameLuckTier = z.infer<typeof luckTierSchema>

export const gameLuckSchema = z.object({
  packs: z.number(),
  cards: z.number(),
  packCards: z.number(),
  otherCards: z.number(),
  wonderPicks: z.number().nullable(),
  trades: z.number().nullable(),
  byRarity: z.record(z.string(), z.number()),
  unknownRarity: z.number(),
  expansions: z.array(
    z.object({
      expansionId: z.string(),
      nameEs: z.string().nullable(),
      nameEn: z.string(),
      packs: z.number(),
      cards: z.number(),
      packCards: z.number().nullable(),
    }),
  ),
  byPack: z.array(
    z.object({
      packId: z.string(),
      nameEn: z.string(),
      expansionId: z.string().nullable(),
      appPackId: z.string().nullable(),
      nameEs: z.string().nullable(),
      opened: z.number(),
    }),
  ),
  unknownPacks: z.number(),
  rare: luckTierSchema.nullable(),
  ex: luckTierSchema.nullable(),
})
export type GameLuck = z.infer<typeof gameLuckSchema>

const loggedComparisonSchema = z.object({
  kind: z.enum(['ranked', 'versus']),
  game: z.number(),
  logged: z.number(),
  notLogged: z.number(),
})
export type LoggedComparison = z.infer<typeof loggedComparisonSchema>

const loggedSchema = z.object({ all: z.number(), competitive: z.number() })

export const pokemonZoneSummarySchema = z.object({
  imports: z.number(),
  latest: importRefSchema
    .extend({
      level: z.number().nullable(),
      packPoints: z.record(z.string(), z.number()),
      hourglasses: hourglassesSchema,
      currencies: z.object({ shopTickets: nullableCount, shinedust: nullableCount, premiumTickets: nullableCount }),
      coupons: z.array(promoCouponSchema),
      totals: totalsSchema,
    })
    .nullable(),
  previous: importRefSchema.nullable(),
  settings: z.object({
    packPoints: z.enum(['imported', 'edited']).nullable(),
    hourglasses: z.enum(['imported', 'edited']).nullable(),
  }),
  battles: z
    .object({
      game: gameBattlesSchema,
      logged: loggedSchema.extend({ firstAt: z.string().nullable() }),
      lifetime: z.array(loggedComparisonSchema),
      window: z
        .object({
          from: z.string(),
          to: z.string(),
          game: z.object({
            versus: counter.nullable(),
            ranked: counter.nullable(),
            solo: counter.nullable(),
            rental: counter.nullable(),
            rankedPoints: z.number().nullable(),
          }),
          logged: loggedSchema,
          comparison: z.array(loggedComparisonSchema),
        })
        .nullable(),
    })
    .nullable(),
  luck: z.object({ lifetime: gameLuckSchema.nullable(), since: gameLuckSchema.nullable() }).nullable(),
})
export type PokemonZoneSummary = z.infer<typeof pokemonZoneSummarySchema>

export function usePokemonZone() {
  return useQuery({
    queryKey: pokemonZoneKey,
    queryFn: ({ signal }) => request('/api/pokemon-zone', { schema: pokemonZoneSummarySchema, signal }),
  })
}

export function usePokemonZonePreview() {
  return useMutation({
    mutationFn: (payload: unknown) =>
      request('/api/pokemon-zone/preview', { method: 'POST', body: payload, schema: pokemonZonePreviewSchema }),
  })
}

export function useSavePokemonZone() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: unknown) =>
      request('/api/pokemon-zone/imports', { method: 'POST', body: payload, schema: pokemonZoneSavedSchema }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: pokemonZoneKey })
      void client.invalidateQueries({ queryKey: settingsKeys.all })
      void client.invalidateQueries({ queryKey: packKeys.all })
      void client.invalidateQueries({ queryKey: ['promo-packs'] })
    },
  })
}
