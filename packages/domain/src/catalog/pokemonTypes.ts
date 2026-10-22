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

/** Separators a two-type string may use: «psychic/fighting», «psychic, fighting», «psychic & fighting», «a + b». */
const TYPE_SEPARATOR = /\s*[/,&+]\s*|\s+/u

export interface TrackerEnergy {
  /** The first printed type, or 'trainer'. */
  energy: EnergyType | 'trainer'
  /** Every printed type, in printed order; [] for trainers. */
  types: EnergyType[]
}

/**
 * The tracker's `energy` field as one or two types: `'psychic'`, `['psychic', 'fighting']` or `'psychic/fighting'`
 * (case and spaces ignored); `'trainer'` alone for trainers. Throws on an unknown type, a repeated one, more than two,
 * or 'trainer' mixed with types.
 */
export function parseTrackerEnergy(value: string | readonly string[]): TrackerEnergy {
  const parts = (typeof value === 'string' ? value.trim().split(TYPE_SEPARATOR) : [...value])
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')
  if (parts.length === 1 && parts[0] === 'trainer') return { energy: 'trainer', types: [] }
  if (parts.length === 0) throw new Error(`Empty energy: ${JSON.stringify(value)}`)
  if (parts.length > MAX_POKEMON_TYPES)
    throw new Error(`More than ${MAX_POKEMON_TYPES} types: ${JSON.stringify(value)}`)
  for (const part of parts) {
    if (!ENERGY_SET.has(part)) throw new Error(`Unknown energy type '${part}' in ${JSON.stringify(value)}`)
  }
  if (new Set(parts).size !== parts.length) throw new Error(`Repeated energy type in ${JSON.stringify(value)}`)
  const types = parts as EnergyType[]
  return { energy: types[0] as EnergyType, types }
}

/** The printed types of a card: `types`, or `[energy]` for a card stored before the list existed; [] for trainers. */
export function typesOf(card: {
  energy: EnergyType | 'trainer'
  types?: readonly EnergyType[] | undefined
}): EnergyType[] {
  if (card.types && card.types.length > 0) return [...card.types]
  return card.energy === 'trainer' ? [] : [card.energy]
}

/** Is the card a Pokémon of this type (any of its printed types)? */
export function isOfType(
  card: { energy: EnergyType | 'trainer'; types?: readonly EnergyType[] | undefined },
  type: EnergyType,
): boolean {
  return typesOf(card).includes(type)
}
