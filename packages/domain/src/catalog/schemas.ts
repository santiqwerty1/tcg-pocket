/**
 * Zod schemas for the raw inputs of the catalog build: the tracker's `cards.json` rows, its translation tables
 * and the reduced deckgym entries (`scripts/extract-fixtures.mjs` shape). Validation is strict on the fields that
 * drive our typing (rarity, energy, card/evolution type) and lenient (plain strings) elsewhere, so a scraper
 * change fails loudly where it matters and is reported, not silently coerced, where it does not.
 */
import { z } from 'zod'
import { MAX_POKEMON_TYPES, parseTrackerEnergy } from './pokemonTypes.js'
import { RARITIES } from './types.js'

const TRACKER_EVOLUTION_TYPES = ['basic', 'stage1', 'stage2', 'supporter', 'item', 'tool', 'stadium'] as const

export const trackerAttackSchema = z.object({
  cost: z.array(z.string()),
  name: z.string(),
  damage: z.string(),
  effect: z.string(),
})

/**
 * The tracker's `energy`: one type (as until B4b), or two for the dual-type Pokémon of C1 — as a list or as one string
 * with a separator, since how the tracker will write them is not known yet (`parseTrackerEnergy`). Anything else fails.
 */
const trackerEnergySchema = z
  .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(MAX_POKEMON_TYPES)])
  .transform((value, ctx) => {
    try {
      return parseTrackerEnergy(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message })
      return z.NEVER
    }
  })

/** The fields of a `cards.json` row the catalog reads; the build warns about any other (`TRACKER_IGNORED_FIELDS` aside). */
export const TRACKER_CARD_FIELDS = [
  'internal_id',
  'card_id',
  'expansion',
  'name',
  'hp',
  'energy',
  'card_type',
  'evolution_type',
  'image',
  'attacks',
  'ability',
  'weakness',
  'retreat',
  'rarity',
  'ex',
  'baby',
  'pack',
  'alternate_versions',
  'artist',
] as const

/** Fields of a `cards.json` row known and left out on purpose: `foil` (aac8d456, the ◊ foils of A4b/B4b). */
export const TRACKER_IGNORED_FIELDS = ['foil'] as const

export const trackerCardSchema = z
  .object({
    internal_id: z.number().int(),
    card_id: z.string().min(3),
    expansion: z.string().min(1),
    name: z.string().min(1),
    hp: z.number().int().optional(),
    energy: trackerEnergySchema,
    card_type: z.enum(['pokémon', 'trainer']),
    evolution_type: z.enum(TRACKER_EVOLUTION_TYPES),
    image: z.string(),
    attacks: z.array(trackerAttackSchema),
    ability: z.object({ name: z.string(), effect: z.string() }).optional(),
    weakness: z.string(),
    retreat: z.number().int().optional(),
    rarity: z.enum(RARITIES),
    ex: z.boolean(),
    baby: z.boolean(),
    pack: z.string().min(1),
    alternate_versions: z.array(z.number().int()).min(1),
    artist: z.string(),
  })
  .transform(({ energy, ...card }) => ({ ...card, energy: energy.energy, types: energy.types }))

export const trackerCardsSchema = z.array(trackerCardSchema)

/** One row of the tracker's `frontend/assets/cards.json` (@ the pinned commit). */
export type TrackerCard = z.infer<typeof trackerCardSchema>
export type TrackerAttack = z.infer<typeof trackerAttackSchema>

/** `{ "bulbasaur": { "en-US": "Bulbasaur", "es-ES": "Bulbasaur", "pt-BR": null, … } }` */
export const translationTableSchema = z.record(z.string(), z.record(z.string(), z.string().nullable()))
export type TranslationTable = z.infer<typeof translationTableSchema>

/** `frontend/public/locales/<lang>/common/{sets,packs}.json`: slug → display name. */
export const localeTableSchema = z.record(z.string(), z.string())

const engineBaseSchema = z.object({
  /** deckgym id, e.g. "A1 001" or "P-A 022". */
  id: z.string().min(5),
  name: z.string().min(1),
  /** deckgym rarity as written in database.json ('*', '**', '♛' are not the tracker's symbols). */
  rarity: z.string(),
})

export const enginePokemonSchema = engineBaseSchema.extend({
  kind: z.literal('pokemon'),
  /** 0 basic, 1 stage 1, 2 stage 2. */
  stage: z.number().int().min(0).max(2),
  evolvesFrom: z.string().nullable().optional(),
  hp: z.number().int(),
  /** The (first) printed type, as deckgym writes it («Psychic»). */
  energyType: z.string(),
  /** Every printed type, when the engine gives two (C1); absent for one. */
  energyTypes: z.array(z.string()).min(1).max(MAX_POKEMON_TYPES).optional(),
})

export const engineTrainerSchema = engineBaseSchema.extend({
  kind: z.literal('trainer'),
  /** deckgym `trainer_card_type`: Supporter, Item, Tool, Stadium or Fossil. */
  trainerType: z.string(),
})

export const engineCardSchema = z.discriminatedUnion('kind', [enginePokemonSchema, engineTrainerSchema])
export const engineCardsSchema = z.array(engineCardSchema)

/** Reduced deckgym `database.json` entry (see `engineCardsFromDatabaseJson` for the raw shape). */
export type EngineCard = z.infer<typeof engineCardSchema>
export type EnginePokemon = z.infer<typeof enginePokemonSchema>
export type EngineTrainer = z.infer<typeof engineTrainerSchema>

export function parseTrackerCards(json: unknown): TrackerCard[] {
  return trackerCardsSchema.parse(json)
}

export function parseEngineCards(json: unknown): EngineCard[] {
  return engineCardsSchema.parse(json)
}

export function parseTranslationTable(json: unknown): TranslationTable {
  return translationTableSchema.parse(json)
}

export function parseLocaleTable(json: unknown): Record<string, string> {
  return localeTableSchema.parse(json)
}
