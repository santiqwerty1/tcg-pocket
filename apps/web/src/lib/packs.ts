/** Formatting of the packs page. Probabilities arrive in percent (0–100). */
import type { PackModel } from '@/api/schemas'
import { PERCENT } from '@/lib/format'

const significant = new Intl.NumberFormat('es-AR', { maximumSignificantDigits: 3 })
const twoDecimals = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const integer = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

/** «1,43 %», «96,5 %», «0,099 %»: three significant digits. */
export function formatChance(percent: number): string {
  if (percent === 0) return `0${PERCENT}`
  return `${significant.format(percent)}${PERCENT}`
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

/** «28/10» from YYYY-MM-DD; the year only when it is not the current one. */
export function formatDay(iso: string, today: string): string {
  const [year, month, day] = iso.split('-')
  return year === today.slice(0, 4) ? `${day}/${month}` : `${day}/${month}/${year}`
}

/** «Hasta el 28/10 · quedan 21 días», «Último día», «Terminó el 28/10». */
export function limitedLabel(limited: { until: string | null; daysLeft: number | null }, today: string): string {
  if (limited.until === null) return 'Tiempo limitado, sin fecha de fin'
  const day = formatDay(limited.until, today)
  if (limited.daysLeft === null) return `Hasta el ${day}`
  if (limited.daysLeft < 0) return `Terminó el ${day}`
  if (limited.daysLeft === 0) return `Hasta hoy (${day}): último día`
  return `Hasta el ${day} · ${limited.daysLeft === 1 ? 'queda 1 día' : `quedan ${limited.daysLeft} días`}`
}

/** «×2», «×1,5». */
export function formatBoost(boost: number): string {
  return `×${twoDecimals.format(boost)}`
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
