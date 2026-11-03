/**
 * pokemon-zone (2/11/2026): pokemon-zone.com syncs the owner's game data once a day, and its JSON answers only a real
 * browser (Cloudflare), so the app's server cannot read it. A bookmarklet run on pokemon-zone.com reads two of its
 * endpoints with the owner's cookies — `GET /api/players/mine/` (`player`, `resourceData`, `config`) and
 * `GET /api/players/<friendId>/stats/` — and hands them to the app in the URL fragment.
 *
 * This module checks that shape (anything else is refused) and keeps only what phase 1 uses, normalized: pack points
 * and hourglasses, promo coupons, the game's battle counters, packs opened and cards obtained by rarity. Nothing else
 * of the payload is kept: not the name, not the cards or the decks. The friend id does not even come: the bookmarklet
 * sends its SHA-256, and the API keeps a keyed fingerprint of that, to tell an import of another account.
 */
import { z } from 'zod'

export const POKEMON_ZONE_PAYLOAD_VERSION = 1

/** Keys and ids as pokemon-zone writes them («TICKET_2610000_EV_03», «AN001_0010_00_000», «pvp_wins»). */
const key = z.string().regex(/^[\w.-]{1,80}$/, 'clave inválida')
/**
 * An expansion id («A1», «B4b», «C1», «SP1», «P-A»). It becomes a key of the `packPoints` setting, so it starts with a
 * capital letter: «constructor» or «__proto__» are not ids.
 */
const expansionKey = z.string().regex(/^[A-Z][A-Za-z0-9-]{0,11}$/, 'expansión inválida')
/** A rarity code («C», «RR», «SAR»): capitals only, so no key of `Object.prototype` passes. */
const rarityKey = z.string().regex(/^[A-Z]{1,5}$/, 'rareza inválida')
const label = z.string().max(300)
const count = z.number().int().min(0).max(1_000_000_000)
/** An ISO 8601 date-time with its offset, as pokemon-zone writes them («2026-11-02T02:43:29.379814Z»). */
const instant = z.iso.datetime({ offset: true })

/** An item of `resourceData` (a currency, a ticket, pack points, hourglasses). */
const resourceItem = z.object({ key, value: count.nullable(), name: label.nullish() })
/** At most 100 of each list, and their sums fit a count: what the snapshot keeps passes its own schema. */
const resourceList = z.array(resourceItem).max(100)

/** Pack points as the settings take them (`packPoints`, at most 1 000 000 each). */
const pointsItem = resourceItem.extend({ key: expansionKey, value: z.number().int().min(0).max(1_000_000).nullable() })

const statItem = z.object({ id: key, value: count.nullable() })

/** pokemon-zone's privacy switches: a few flags, nothing big (phase 1 does not use them). */
const configSchema = z
  .record(z.string().max(60), z.union([z.boolean(), z.number(), z.string().max(60), z.null()]))
  .refine((config) => Object.keys(config).length <= 30, 'demasiadas claves')

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
        currencies: resourceList.default([]),
        tickets: resourceList.default([]),
        packCeilPoints: z.array(pointsItem).max(100),
        packPowerChargers: resourceList.default([]),
        challengePowerChargers: resourceList.default([]),
        tradePowerChargers: resourceList.default([]),
        eventPowerChargers: resourceList.default([]),
        revivalClocks: resourceList.default([]),
      }),
      /** Sent by the bookmarklet (pokemon-zone's privacy switches); phase 1 does not use it. */
      config: configSchema.optional(),
    }),
    stats: z.object({
      syncedAt: instant.nullish(),
      headline: z.array(statItem).max(100).default([]),
      battles: z.array(statItem).max(100),
      packsByExpansion: z
        .array(z.object({ expansionId: expansionKey, name: label, packsOpened: count, cardsObtained: count }))
        .max(200),
      packs: z
        .array(z.object({ packId: key, name: label, expansionId: expansionKey.nullable(), opened: count }))
        .max(500),
      cardsByRarity: z.array(z.object({ rarity: rarityKey, obtained: count })).max(50),
    }),
  })
  .refine((payload) => payload.stats.syncedAt || payload.mine.player.lastUpdatedAt, {
    message: 'Falta la fecha de la última sincronización de pokemon-zone con el juego.',
    path: ['stats', 'syncedAt'],
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
  packPoints: z.record(expansionKey, z.number().int().min(0).max(1_000_000)),
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
  coupons: z.array(z.object({ key, event: label, count })).max(100),
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
    .max(200),
  /** Packs opened per pack, lifetime (`packId` is pokemon-zone's). */
  packs: z
    .array(z.object({ packId: key, expansionId: expansionKey.nullable(), nameEn: label, opened: count }))
    .max(500),
  /** Cards obtained per pokemon-zone rarity code, lifetime (every source: packs, Wonder Pick, trades, gifts). */
  rarities: z.array(z.object({ code: rarityKey, obtained: count })).max(50),
})

export type PokemonZoneSnapshot = z.infer<typeof pokemonZoneSnapshotSchema>

/**
 * The payload as an import keeps it, checked against the stored form too: what is saved always reads back (the
 * summary and the backup parse it with `pokemonZoneSnapshotSchema`). Throws a ZodError when it does not.
 */
export function parsePokemonZone(payload: PokemonZonePayload): PokemonZoneSnapshot {
  return pokemonZoneSnapshotSchema.parse(normalizePokemonZone(payload))
}

/** A ticket that is a promo card exchange coupon: «Promo Card Exchange Ticket(s) (<event>)». */
const COUPON_NAME = /^\s*promo card exchange tickets?\b/i

/** The event of a coupon: the text in its last parentheses, or the whole name. */
function couponEvent(name: string): string {
  const match = /\(([^()]+)\)\s*$/.exec(name)
  return (match?.[1] ?? name).trim()
}

type ResourceItem = z.infer<typeof resourceItem>

/** The value of one key of a resource list; null when the list does not have it. */
function itemValue(items: readonly ResourceItem[], wanted: string): number | null {
  const item = items.find((entry) => entry.key === wanted)
  return item ? (item.value ?? 0) : null
}

/** The sum of a resource list (at most a count's top); null when it is empty. */
function sumOf(items: readonly ResourceItem[]): number | null {
  if (items.length === 0) return null
  return Math.min(
    1_000_000_000,
    items.reduce((sum, item) => sum + (item.value ?? 0), 0),
  )
}

function stat(items: readonly { id: string; value: number | null }[], id: string): number | null {
  const item = items.find((entry) => entry.id === id)
  return item ? (item.value ?? null) : null
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
  for (const item of resourceData.packCeilPoints) packPoints[item.key] = item.value ?? 0
  return {
    syncedAt,
    level: player.level ?? null,
    packPoints,
    hourglasses: {
      pack: itemValue(resourceData.packPowerChargers, 'REGULAR_CHARGER_LARGE'),
      wonder: itemValue(resourceData.challengePowerChargers, 'REGULAR_CHARGER_LARGE'),
      trade: sumOf(resourceData.tradePowerChargers),
      event: sumOf(resourceData.eventPowerChargers),
      rewind: sumOf(resourceData.revivalClocks),
    },
    currencies: {
      shopTickets: itemValue(resourceData.currencies, 'SHOP_TICKET'),
      shinedust: itemValue(resourceData.currencies, 'BRIGHT_SAND'),
      premiumTickets: itemValue(resourceData.currencies, 'SUBSCRIPTION_TICKET'),
    },
    coupons: resourceData.tickets
      .filter((ticket) => COUPON_NAME.test(ticket.name ?? ''))
      .map((ticket) => ({ key: ticket.key, event: couponEvent(ticket.name ?? ''), count: ticket.value ?? 0 })),
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
