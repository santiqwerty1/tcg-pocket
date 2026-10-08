/**
 * Limitless API responses (docs/fase0/limitless.md §1–2, fixtures in docs/fase0/limitless/): parsing with zod and
 * normalization of standings into entries. Nullable on purpose: `placing` is null for drops in some tournaments,
 * `energy` is absent in NOEX, `decklist` and `deck` may be missing when the tournament has no lists.
 */
import { z } from 'zod'
import type { LimitlessDecklist } from '../decks/limitless.js'
import { type GameRecord, recordGames } from '../stats/rates.js'

const intLike = z.number().int().nonnegative()

/** One item of `GET /tournaments?game=POCKET`. */
export const limitlessTournamentSchema = z.object({
  id: z.string().min(1),
  game: z.string(),
  format: z.string().nullable().optional(),
  name: z.string(),
  date: z.string(),
  players: intLike,
  organizerId: z.number().int().nullable().optional(),
})
export type LimitlessTournament = z.infer<typeof limitlessTournamentSchema>

export const limitlessTournamentListSchema = z.array(limitlessTournamentSchema)

/** `GET /tournaments/{id}/details`: what lets a tournament be left out (no lists, bans, special rules). */
export const limitlessDetailsSchema = z.looseObject({
  id: z.string(),
  decklists: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  isOnline: z.boolean().optional(),
  organizer: z.object({ id: z.number().int(), name: z.string() }).partial().nullable().optional(),
  phases: z
    .array(z.object({ phase: z.number(), type: z.string(), rounds: z.number(), mode: z.string() }).partial())
    .optional(),
  bannedCards: z.array(z.unknown()).optional(),
  specialRules: z.array(z.unknown()).optional(),
})
export type LimitlessDetails = z.infer<typeof limitlessDetailsSchema>

const decklistCardSchema = z.object({
  count: z.number().int().positive(),
  set: z.string().min(1),
  number: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
})

const decklistSchema = z.object({
  pokemon: z.array(decklistCardSchema).default([]),
  trainer: z.array(decklistCardSchema).default([]),
  energy: z.array(z.string()).nullable().optional(),
})

export const limitlessStandingSchema = z.object({
  player: z.string().min(1),
  name: z.string(),
  country: z.string().nullable().optional(),
  placing: z.number().int().nullable().optional(),
  record: z.object({ wins: intLike, losses: intLike, ties: intLike }),
  decklist: decklistSchema.nullable().optional(),
  deck: z
    .object({ id: z.string(), name: z.string(), icons: z.array(z.string()).nullable().optional() })
    .nullable()
    .optional(),
  drop: z.number().int().nullable().optional(),
})
export type LimitlessStanding = z.infer<typeof limitlessStandingSchema>

export const limitlessStandingsSchema = z.array(limitlessStandingSchema)

/** Why a listed tournament does not count, before or after asking for its details. */
export type ExclusionReason =
  | 'custom_format'
  | 'unknown_format'
  | 'no_decklists'
  | 'banned_cards'
  | 'special_rules'
  | 'not_found'

export const EXCLUSION_REASON_ES: Record<ExclusionReason, string> = {
  custom_format: 'reglas caseras (CUSTOM)',
  unknown_format: 'formato desconocido',
  no_decklists: 'sin listas',
  banned_cards: 'cartas prohibidas',
  special_rules: 'reglas especiales',
  not_found: 'ya no está en Limitless',
}

/** From the details: a tournament without lists, or with bans or special rules, is not the format. */
export function exclusionFromDetails(details: LimitlessDetails): ExclusionReason | null {
  if (details.decklists === false) return 'no_decklists'
  if ((details.bannedCards?.length ?? 0) > 0) return 'banned_cards'
  if ((details.specialRules?.length ?? 0) > 0) return 'special_rules'
  return null
}

export interface ArchetypeRef {
  /** Limitless slug (`mega-lucario-ex-b3-lucario-a2`): not stable, kept as it came. */
  id: string
  name: string
  icons: string[]
}

/** A standings row as the app stores it. */
export interface NormalizedEntry {
  playerId: string
  playerName: string
  country: string | null
  placing: number | null
  drop: number | null
  record: GameRecord
  archetype: ArchetypeRef | null
  /** Pokémon and trainers as Limitless sent them; null when the tournament published no list for the player. */
  decklist: LimitlessDecklist | null
  /** Energy words in English («Fire»), empty when absent (NOEX). */
  energies: string[]
}

export function normalizeStanding(standing: LimitlessStanding): NormalizedEntry {
  const decklist = standing.decklist
  const hasCards = !!decklist && decklist.pokemon.length + decklist.trainer.length > 0
  return {
    playerId: standing.player,
    playerName: standing.name,
    country: standing.country ?? null,
    placing: standing.placing ?? null,
    drop: standing.drop ?? null,
    record: { ...standing.record },
    archetype: standing.deck
      ? { id: standing.deck.id, name: standing.deck.name, icons: standing.deck.icons ?? [] }
      : null,
    decklist: hasCards && decklist ? { pokemon: decklist.pokemon, trainer: decklist.trainer } : null,
    energies: decklist?.energy ?? [],
  }
}

/** Parses a standings response; throws a ZodError when the shape is not the expected one. */
export function parseStandings(raw: unknown): NormalizedEntry[] {
  return limitlessStandingsSchema.parse(raw).map(normalizeStanding)
}

/** A standings response with no players, or where nobody played a game, is not final yet: retry later. */
export function standingsIncomplete(entries: readonly NormalizedEntry[]): boolean {
  return entries.length === 0 || entries.every((entry) => recordGames(entry.record) === 0)
}

/** ΣW-ΣL-ΣT of a tournament (or any set of entries). */
export function totalRecord(entries: readonly { record: GameRecord }[]): GameRecord {
  const total = { wins: 0, losses: 0, ties: 0 }
  for (const { record } of entries) {
    total.wins += record.wins
    total.losses += record.losses
    total.ties += record.ties
  }
  return total
}
