/** Formatting of the packs page. Probabilities arrive in percent (0–100). */
import type { PackModel } from '@/api/schemas'

const significant = new Intl.NumberFormat('es-AR', { maximumSignificantDigits: 3 })
const twoDecimals = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/** «1,43 %», «96,5 %», «0,099 %»: three significant digits. */
export function formatChance(percent: number): string {
  if (percent === 0) return '0 %'
  return `${significant.format(percent)} %`
}

export function formatAmount(value: number): string {
  return twoDecimals.format(value)
}

/** Expected packs: one decimal under 10, whole packs above. */
export function formatExpectedPacks(value: number): string {
  return value < 10 ? twoDecimals.format(Math.round(value * 10) / 10) : integer.format(value)
}

export function formatPacks(value: number | null): string {
  if (value === null) return 'nunca'
  return value === 1 ? '1 sobre' : `${integer.format(value)} sobres`
}

export const MODEL_LABEL: Record<PackModel, string> = { corrected: 'corregido', tracker: 'tracker' }

export const REASON_LABEL: Record<'babies' | 'reprints', string> = {
  reprints: 'no cuenta reimpresiones de otra expansión',
  babies: 'cuenta de más las cartas bebé de ese set',
}

/** Rarities that come out of packs, in game order (promos never do). */
export const PACK_RARITIES = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare'] as const

export function rarityLabel(rarity: string): string {
  if (rarity === 'Crown Rare') return 'Corona'
  if (rarity === 'P') return 'promo'
  return rarity
}
