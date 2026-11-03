/**
 * pokemon-zone (2/11/2026): pokemon-zone.com syncs the owner's game data once a day, and its JSON answers only a real
 * browser (Cloudflare), so the app's server cannot read it. A bookmarklet run on pokemon-zone.com reads two of its
 * endpoints with the owner's cookies — `GET /api/players/mine/` and `GET /api/players/<friendId>/stats/` — picks the
 * fields phase 1 uses and hands them to the app in the URL fragment.
 *
 * This module checks that shape and keeps only what phase 1 uses, normalized: pack points and hourglasses, promo
 * coupons, the game's battle counters, packs opened and cards obtained by rarity. The fields it uses are checked
 * strictly; anything else in the lists (another stat, another ticket, a key with «:», a decimal) is ignored, so a
 * change on pokemon-zone's side in what the app does not read does not stop the import (review of pz/import). Nothing
 * else is kept: the friend id does not even come (the bookmarklet sends its SHA-256, and the API keeps a keyed
 * fingerprint of that, to tell an import of another account).
 */
import { z } from 'zod'

export const POKEMON_ZONE_PAYLOAD_VERSION = 1

/** Keys and ids the app keeps («TICKET_2610000_EV_03», «AN001_0010_00_000»). */
const key = z.string().regex(/^[\w.:-]{1,80}$/, 'clave inválida')
/**
 * An expansion id («A1», «B4b», «C1», «SP1», «P-A»). It becomes a key of the `packPoints` setting, so it starts with a
 * capital letter: «constructor» or «__proto__» are not ids.
 */
const expansionKey = z.string().regex(/^[A-Z][A-Za-z0-9-]{0,11}$/, 'expansión inválida')
/** A rarity code («C», «RR», «SAR», «SR2»): it starts with a capital, so no key of `Object.prototype` passes. */
const rarityKey = z.string().regex(/^[A-Z][A-Z0-9_]{0,9}$/, 'rareza inválida')
const label = z.string().max(300)
const count = z.number().int().min(0).max(1_000_000_000)
const points = z.number().int().min(0).max(1_000_000)
/** An ISO 8601 date-time with its offset, as pokemon-zone writes them («2026-11-02T02:43:29.379814Z»). */
const instant = z.iso.datetime({ offset: true })

/** Lists are generous: pokemon-zone may add items the app does not read. */
const LIST_MAX = 1000

/** An item of a `resourceData` list, unchecked until the app picks it. */
const resourceItem = z.object({ key: z.unknown(), value: z.unknown(), name: z.unknown() }).partial()
const resourceList = z.array(resourceItem).max(LIST_MAX).default([])
/** An item of `headline` or `battles`, unchecked until the app picks it. */
const statItem = z.object({ id: z.unknown(), value: z.unknown() }).partial()

/** The headline counters and the battle counters the app reads. */
const HEADLINE_IDS = ['packs_opened', 'cards_obtained', 'unique_cards', 'wonder_picks', 'trades'] as const
const BATTLE_IDS = [
  'pvp_battles',
  'pvp_wins',
  'ranked_battles',
  'ranked_wins',
  'ranked_points',
  'solo_battles',
  'solo_wins',
  'rental_deck_battles',
  'rental_deck_wins',
] as const
/** The keys of the resources the app reads one by one. */
const HOURGLASS_KEY = 'REGULAR_CHARGER_LARGE'
const CURRENCY_KEYS = ['SHOP_TICKET', 'BRIGHT_SAND', 'SUBSCRIPTION_TICKET'] as const

/** A ticket that is a promo card exchange coupon: «Promo Card Exchange Ticket(s) (<event>)». */
const COUPON_NAME = /^\s*promo card exchange tickets?\b/i

type Issue = { path: (string | number)[]; message: string }

/** Checks `value` against `schema` and turns a failure into an issue at `path`. */
function check(issues: Issue[], schema: z.ZodType, value: unknown, path: (string | number)[]): void {
  const result = schema.safeParse(value)
  if (!result.success) issues.push({ path, message: result.error.issues[0]?.message ?? 'inválido' })
}

export const pokemonZonePayloadSchema = z
  .object({
    v: z.literal(POKEMON_ZONE_PAYLOAD_VERSION),
    mine: z.object({
      player: z.object({
        /**
         * SHA-256 (hex) of the game account's friend id, computed by the bookmarklet: the id itself never leaves
         * pokemon-zone.com. Only for the API's keyed fingerprint (another account's import); never answered.
         */
        accountHash: z.string().regex(/^[0-9a-f]{64}$/, 'huella de la cuenta inválida'),
        lastUpdatedAt: instant.nullish(),
        level: count.nullish(),
      }),
      resourceData: z.object({
        currencies: resourceList,
        tickets: resourceList,
        packCeilPoints: z.array(resourceItem).max(LIST_MAX),
        packPowerChargers: resourceList,
        challengePowerChargers: resourceList,
        tradePowerChargers: resourceList,
        eventPowerChargers: resourceList,
        revivalClocks: resourceList,
      }),
    }),
    stats: z.object({
      syncedAt: instant.nullish(),
      headline: z.array(statItem).max(LIST_MAX).default([]),
      battles: z.array(statItem).max(LIST_MAX),
      packsByExpansion: z
        .array(z.object({ expansionId: expansionKey, name: label, packsOpened: count, cardsObtained: count }))
        .max(500),
      packs: z
        .array(z.object({ packId: key, name: label, expansionId: expansionKey.nullable(), opened: count }))
        .max(LIST_MAX),
      cardsByRarity: z.array(z.object({ rarity: rarityKey, obtained: count })).max(100),
    }),
  })
  .superRefine((payload, ctx) => {
    const issues: Issue[] = []
    if (!payload.stats.syncedAt && !payload.mine.player.lastUpdatedAt) {
      issues.push({
        path: ['stats', 'syncedAt'],
        message: 'Falta la fecha de la última sincronización de pokemon-zone con el juego.',
      })
    }
    // What the app reads, strictly; the rest of each list is ignored.
    const resources = payload.mine.resourceData
    const base = ['mine', 'resourceData']
    resources.packCeilPoints.forEach((item, i) => {
      check(issues, expansionKey, item.key, [...base, 'packCeilPoints', i, 'key'])
      check(issues, points.nullable(), item.value, [...base, 'packCeilPoints', i, 'value'])
    })
    for (const list of ['packPowerChargers', 'challengePowerChargers'] as const) {
      resources[list].forEach((item, i) => {
        if (item.key === HOURGLASS_KEY) check(issues, count.nullable(), item.value, [...base, list, i, 'value'])
      })
    }
    resources.currencies.forEach((item, i) => {
      if ((CURRENCY_KEYS as readonly unknown[]).includes(item.key))
        check(issues, count.nullable(), item.value, [...base, 'currencies', i, 'value'])
    })
    resources.tickets.forEach((item, i) => {
      if (typeof item.name !== 'string' || !COUPON_NAME.test(item.name)) return
      check(issues, label, item.name, [...base, 'tickets', i, 'name'])
      check(issues, key, item.key, [...base, 'tickets', i, 'key'])
      check(issues, count.nullable(), item.value, [...base, 'tickets', i, 'value'])
    })
    for (const [list, ids] of [
      ['headline', HEADLINE_IDS],
      ['battles', BATTLE_IDS],
    ] as const) {
      payload.stats[list].forEach((item, i) => {
        if ((ids as readonly unknown[]).includes(item.id))
          check(issues, count.nullable(), item.value, ['stats', list, i, 'value'])
      })
    }
    for (const issue of issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  })

export type PokemonZonePayload = z.infer<typeof pokemonZonePayloadSchema>

/** Battles and wins of one of the game's counters (lifetime). */
export interface GameCounter {
  battles: number
  wins: number
}

const counterSchema = z
  .object({ battles: count, wins: count })
  .refine((counter) => counter.wins <= counter.battles, 'más victorias que partidas')
const nullableCount = count.nullable()

/** What an import keeps (stored as JSON; the backup carries it). */
export const pokemonZoneSnapshotSchema = z.object({
  /** When pokemon-zone last read the game (ISO): the numbers are the game's at that moment. */
  syncedAt: instant,
  level: nullableCount,
  /** Pack points per expansion id («B4b»), as the game keeps them. */
  packPoints: z.record(expansionKey, points),
  /** Hourglasses in stock: pack (1 hour of a pack each), Wonder Pick, trade, event; and rewind watches. */
  hourglasses: z.object({
    pack: nullableCount,
    wonder: nullableCount,
    trade: nullableCount,
    event: nullableCount,
    rewind: nullableCount,
  }),
  currencies: z.object({ shopTickets: nullableCount, shinedust: nullableCount, premiumTickets: nullableCount }),
  /** Promo card exchange coupons, one entry per event (`event` as the game names it, in English). */
  coupons: z.array(z.object({ key, event: label, count })).max(LIST_MAX),
  battles: z.object({
    versus: counterSchema.nullable(),
    ranked: counterSchema.nullable(),
    rankedPoints: nullableCount,
    solo: counterSchema.nullable(),
    rental: counterSchema.nullable(),
  }),
  totals: z.object({
    packsOpened: nullableCount,
    cardsObtained: nullableCount,
    uniqueCards: nullableCount,
    wonderPicks: nullableCount,
    trades: nullableCount,
  }),
  /** Packs opened and cards obtained (from every source) per expansion, lifetime. */
  expansions: z
    .array(z.object({ expansionId: expansionKey, nameEn: label, packsOpened: count, cardsObtained: count }))
    .max(500),
  /** Packs opened per pack, lifetime (`packId` is pokemon-zone's). */
  packs: z
    .array(z.object({ packId: key, expansionId: expansionKey.nullable(), nameEn: label, opened: count }))
    .max(LIST_MAX),
  /** Cards obtained per pokemon-zone rarity code, lifetime (every source: packs, Wonder Pick, trades, gifts). */
  rarities: z.array(z.object({ code: rarityKey, obtained: count })).max(100),
})

export type PokemonZoneSnapshot = z.infer<typeof pokemonZoneSnapshotSchema>

/**
 * The payload as an import keeps it, checked against the stored form too: what is saved always reads back (the
 * summary and the backup parse it with `pokemonZoneSnapshotSchema`). Throws a ZodError when it does not.
 */
export function parsePokemonZone(payload: PokemonZonePayload): PokemonZoneSnapshot {
  return pokemonZoneSnapshotSchema.parse(normalizePokemonZone(payload))
}

/** The event of a coupon: the text in its last parentheses, or the whole name. */
function couponEvent(name: string): string {
  const match = /\(([^()]+)\)\s*$/.exec(name)
  return (match?.[1] ?? name).trim()
}

type ResourceItem = z.infer<typeof resourceItem>
type StatItem = z.infer<typeof statItem>

/** A value the schema already checked (null and absent are null). */
const checked = (value: unknown): number | null => (typeof value === 'number' ? value : null)

/** The value of one key of a resource list; null when the list does not have it (checked by the schema). */
function itemValue(items: readonly ResourceItem[], wanted: string): number | null {
  const item = items.find((entry) => entry.key === wanted)
  return item ? (checked(item.value) ?? 0) : null
}

/** The sum of a resource list's counts (at most a count's top); null when none. Other values are ignored. */
function sumOf(items: readonly ResourceItem[]): number | null {
  const values = items.map((item) => item.value).filter((value) => count.safeParse(value).success) as number[]
  if (values.length === 0) return null
  return Math.min(
    1_000_000_000,
    values.reduce((sum, value) => sum + value, 0),
  )
}

function stat(items: readonly StatItem[], id: string): number | null {
  const item = items.find((entry) => entry.id === id)
  return item ? checked(item.value) : null
}

/** A counter from its battles and wins; null when the game did not give both or they do not add up. */
function counter(battles: number | null, wins: number | null): GameCounter | null {
  if (battles === null || wins === null || wins > battles) return null
  return { battles, wins }
}

/** The payload, already checked, as an import keeps it. */
export function normalizePokemonZone(payload: PokemonZonePayload): PokemonZoneSnapshot {
  const { player, resourceData } = payload.mine
  const { stats } = payload
  const syncedAt = new Date(Date.parse((stats.syncedAt || player.lastUpdatedAt) as string)).toISOString()
  const packPoints: Record<string, number> = {}
  for (const item of resourceData.packCeilPoints) packPoints[item.key as string] = checked(item.value) ?? 0
  return {
    syncedAt,
    level: player.level ?? null,
    packPoints,
    hourglasses: {
      pack: itemValue(resourceData.packPowerChargers, HOURGLASS_KEY),
      wonder: itemValue(resourceData.challengePowerChargers, HOURGLASS_KEY),
      trade: sumOf(resourceData.tradePowerChargers),
      event: sumOf(resourceData.eventPowerChargers),
      rewind: sumOf(resourceData.revivalClocks),
    },
    currencies: {
      shopTickets: itemValue(resourceData.currencies, 'SHOP_TICKET'),
      shinedust: itemValue(resourceData.currencies, 'BRIGHT_SAND'),
      premiumTickets: itemValue(resourceData.currencies, 'SUBSCRIPTION_TICKET'),
    },
    coupons: resourceData.tickets.flatMap((ticket) =>
      typeof ticket.name === 'string' && COUPON_NAME.test(ticket.name)
        ? [{ key: ticket.key as string, event: couponEvent(ticket.name), count: checked(ticket.value) ?? 0 }]
        : [],
    ),
    battles: {
      versus: counter(stat(stats.battles, 'pvp_battles'), stat(stats.battles, 'pvp_wins')),
      ranked: counter(stat(stats.battles, 'ranked_battles'), stat(stats.battles, 'ranked_wins')),
      rankedPoints: stat(stats.battles, 'ranked_points'),
      solo: counter(stat(stats.battles, 'solo_battles'), stat(stats.battles, 'solo_wins')),
      rental: counter(stat(stats.battles, 'rental_deck_battles'), stat(stats.battles, 'rental_deck_wins')),
    },
    totals: {
      packsOpened: stat(stats.headline, 'packs_opened'),
      cardsObtained: stat(stats.headline, 'cards_obtained'),
      uniqueCards: stat(stats.headline, 'unique_cards'),
      wonderPicks: stat(stats.headline, 'wonder_picks'),
      trades: stat(stats.headline, 'trades'),
    },
    expansions: stats.packsByExpansion.map((row) => ({
      expansionId: row.expansionId,
      nameEn: row.name,
      packsOpened: row.packsOpened,
      cardsObtained: row.cardsObtained,
    })),
    packs: stats.packs.map((row) => ({
      packId: row.packId,
      expansionId: row.expansionId,
      nameEn: row.name,
      opened: row.opened,
    })),
    rarities: stats.cardsByRarity.map((row) => ({ code: row.rarity, obtained: row.obtained })),
  }
}
