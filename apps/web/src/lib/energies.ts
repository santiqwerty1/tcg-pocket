import { SELECTABLE_ENERGIES, type SelectableEnergy } from '@/api/schemas'

export { SELECTABLE_ENERGIES }

/** Spanish energy names as the game prints them (same table as @tcg/domain ENERGY_NAME_ES). */
export const ENERGY_NAME_ES: Record<SelectableEnergy, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquico',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
}

export const ENERGY_SHORT_ES: Record<SelectableEnergy, string> = {
  grass: 'Pla',
  fire: 'Fue',
  water: 'Agu',
  lightning: 'Ray',
  psychic: 'Psí',
  fighting: 'Luc',
  darkness: 'Osc',
  metal: 'Met',
}

/** Chip colors: readable on light and dark backgrounds. */
export const ENERGY_COLORS: Record<SelectableEnergy, { bg: string; fg: string }> = {
  grass: { bg: '#16a34a', fg: '#ffffff' },
  fire: { bg: '#ea580c', fg: '#ffffff' },
  water: { bg: '#2563eb', fg: '#ffffff' },
  lightning: { bg: '#facc15', fg: '#1f2937' },
  psychic: { bg: '#9333ea', fg: '#ffffff' },
  fighting: { bg: '#b45309', fg: '#ffffff' },
  darkness: { bg: '#4b5563', fg: '#ffffff' },
  metal: { bg: '#94a3b8', fg: '#0f172a' },
}

export function isSelectableEnergy(value: string): value is SelectableEnergy {
  return (SELECTABLE_ENERGIES as readonly string[]).includes(value)
}

/** Spanish name of any energy type: the selectable ones, plus Dragon and Colorless (Pokémon types the zone never gives). */
export function energyLabel(energy: string): string {
  if (isSelectableEnergy(energy)) return ENERGY_NAME_ES[energy]
  if (energy === 'dragon') return 'Dragón'
  if (energy === 'colorless') return 'Incoloro'
  return energy
}

/** The fields of an edition that say its type (`CardEdition` of the API). */
interface TypedEdition {
  energy?: string | undefined
  types?: readonly string[] | undefined
  ability?: { effect: string } | null | undefined
}

/**
 * The printed types of an edition: two for C1's dual-type Pokémon (29/10/2026), one before; none for trainers. Same
 * rule as `typesOf` in @tcg/domain: the list when it starts with `energy`, else `[energy]`.
 */
export function editionTypes(edition: TypedEdition): string[] {
  const { energy, types } = edition
  if (!energy || energy === 'trainer') return []
  return types && types.length > 0 && types[0] === energy ? [...types] : [energy]
}

const ENERGY_SYMBOLS: Record<string, string> = {
  G: 'grass',
  R: 'fire',
  W: 'water',
  L: 'lightning',
  P: 'psychic',
  F: 'fighting',
  D: 'darkness',
  M: 'metal',
  N: 'dragon',
  C: 'colorless',
}
const GRANTED_TYPES = /as long as this pok[ée]mon is in play, it is \[([A-Z])\] and \[([A-Z])\] type/iu

/** The types it counts as in play, for a Weakness: the printed ones plus Urshifu's «Double Type» (`typesInPlay`). */
export function editionTypesInPlay(edition: TypedEdition): string[] {
  const types = editionTypes(edition)
  const granted = edition.ability ? GRANTED_TYPES.exec(edition.ability.effect) : null
  if (!granted || types.length === 0) return types
  for (const symbol of [granted[1], granted[2]]) {
    const type = symbol ? ENERGY_SYMBOLS[symbol.toUpperCase()] : undefined
    if (type && !types.includes(type)) types.push(type)
  }
  return types
}

/**
 * The «+20 por debilidad de X» hint of the game against the bot. The printed types always hit the Weakness (C1's dual
 * types too). A type that only an Ability grants (Urshifu's «Double Type») hits it while the Ability works: an effect
 * can strip it (Budew's Prickly Powder, deckgym `CardEffect::AbilitiesDisabled`), and the engine's board does not say
 * so. `abilitiesDisabled`: true leaves the granted type out, false counts it as printed; unknown (the board as it is
 * today), the hint says it depends on the Ability. Null without a match or without both editions.
 */
export function weaknessHint(
  attacker: TypedEdition | null | undefined,
  defender: { weakness?: string | null | undefined } | null | undefined,
  defenderName: string,
  options: { abilitiesDisabled?: boolean | undefined } = {},
): string | null {
  if (!attacker || !defender?.weakness) return null
  if (editionTypes(attacker).includes(defender.weakness)) return `+20 por debilidad de ${defenderName}`
  if (options.abilitiesDisabled === true || !editionTypesInPlay(attacker).includes(defender.weakness)) return null
  return options.abilitiesDisabled === false
    ? `+20 por debilidad de ${defenderName}`
    : `+20 por debilidad de ${defenderName}, si su habilidad no está anulada`
}
