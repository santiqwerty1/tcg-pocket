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

export function energyLabel(energy: string): string {
  return isSelectableEnergy(energy) ? ENERGY_NAME_ES[energy] : energy
}
