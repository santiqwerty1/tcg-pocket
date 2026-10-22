/**
 * The printed type of a Pokémon as a list (C1 «Dual Fusion», 29/10/2026: the first dual-type cards, such as Mega Mewtwo
 * X ex, Psychic and Fighting). Until then every Pokémon had one type, and `CardEdition.energy` stays the first one, so
 * the code that reads it keeps working; the code that asks «is this a [X] Pokémon» reads `typesOf`/`isOfType`.
 *
 * How the tracker will write two types is not known yet (its scraper takes the type from the Limitless title and fails
 * on anything else): `parseTrackerEnergy` reads one type, a list, or a string with a separator, and refuses the rest.
 */
import { ENERGY_TYPES, type EnergyType } from './types.js'

const ENERGY_SET: ReadonlySet<string> = new Set(ENERGY_TYPES)

/** At most two printed types (dual-type Pokémon). */
export const MAX_POKEMON_TYPES = 2

/**
 * Separators a two-type string may use: «psychic/fighting», «psychic, fighting», «psychic & fighting», «a + b»,
 * «psychic-fighting», «a | b», «a; b» or a space. No type name has any of them.
 */
const TYPE_SEPARATOR = /\s*[/,&+|;-]\s*|\s+/u

export interface TrackerEnergy {
  /** The first printed type, or 'trainer'. */
  energy: EnergyType | 'trainer'
  /** Every printed type, in printed order; [] for trainers. */
  types: EnergyType[]
}

/**
 * The tracker's `energy` field as one or two types: `'psychic'`, `['psychic', 'fighting']` or `'psychic/fighting'`
 * (case and the spaces around ignored); `'trainer'` alone for trainers. Throws, naming the value, on anything else: an
 * unknown type, a repeated one, more than two, an empty one («psychic,»), 'trainer' mixed with types, or a value that
 * is neither a string nor a list of strings.
 */
export function parseTrackerEnergy(value: unknown): TrackerEnergy {
  const shown = JSON.stringify(value)
  let raw: unknown[]
  if (typeof value === 'string') raw = value.trim() === '' ? [] : value.trim().split(TYPE_SEPARATOR)
  else if (Array.isArray(value)) raw = value
  else throw new Error(`Energy is neither a string nor a list: ${shown}`)
  if (raw.some((part) => typeof part !== 'string'))
    throw new Error(`Energy list with an item that is not a string: ${shown}`)
  const parts = (raw as string[]).map((part) => part.trim().toLowerCase())
  if (parts.length === 1 && parts[0] === 'trainer') return { energy: 'trainer', types: [] }
  if (parts.length === 0) throw new Error(`Empty energy: ${shown}`)
  if (parts.includes('')) throw new Error(`Empty energy type in ${shown}`)
  if (parts.length > MAX_POKEMON_TYPES) throw new Error(`More than ${MAX_POKEMON_TYPES} types: ${shown}`)
  for (const part of parts) {
    if (!ENERGY_SET.has(part)) throw new Error(`Unknown energy type '${part}' in ${shown}`)
  }
  if (new Set(parts).size !== parts.length) throw new Error(`Repeated energy type in ${shown}`)
  const types = parts as EnergyType[]
  return { energy: types[0] as EnergyType, types }
}

/**
 * The printed types of a card: `types` when it agrees with `energy` (its first type); otherwise `[energy]`, for a card
 * stored before the list existed or rewritten by an older version that kept only `energy`. [] for trainers.
 */
export function typesOf(card: {
  energy: EnergyType | 'trainer'
  types?: readonly EnergyType[] | undefined
}): EnergyType[] {
  if (card.energy === 'trainer') return []
  if (card.types && card.types.length > 0 && card.types[0] === card.energy) return [...card.types]
  return [card.energy]
}

/** Is the card a Pokémon of this type (any of its printed types)? */
export function isOfType(
  card: { energy: EnergyType | 'trainer'; types?: readonly EnergyType[] | undefined },
  type: EnergyType,
): boolean {
  return typesOf(card).includes(type)
}
