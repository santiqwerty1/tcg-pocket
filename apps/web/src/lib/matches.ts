/**
 * Labels and formatting of own matches. The numbers come computed from the API (@tcg/domain); this module only
 * renders them, with the same conventions as the domain's `formatWinRateEs` (DECISIONES 0.10).
 */
import type { GameRecord, MatchMode, MatchResult, WinRate } from '@/api/schemas'

export const RESULT_LABEL: Record<MatchResult, string> = { win: 'Victoria', loss: 'Derrota', tie: 'Empate' }
export const RESULT_SHORT: Record<MatchResult, string> = { win: 'V', loss: 'D', tie: 'E' }
export const MODE_LABEL: Record<MatchMode, string> = {
  competitive: 'Competitiva',
  casual: 'Distendida',
  beginner: 'Principiante',
  event: 'Evento',
  friend: 'Amigo',
}
export const WENT_FIRST_LABEL = { first: 'Empecé yo', second: 'Empezó el rival', unknown: 'Sin dato' } as const

const valueFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const intervalFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('es-AR')

/** «70 %», «66,7 %». */
export function formatRateValue(value: number): string {
  return `${valueFormat.format(value)} %`
}

/** «39,7–89,2 %». */
export function formatInterval([lo, hi]: readonly [number, number]): string {
  return `${intervalFormat.format(lo)}–${intervalFormat.format(hi)} %`
}

/** «n = 10» (tournament: «n = 268 en 40 listas»). */
export function formatSample(rate: WinRate): string {
  const games = `n = ${countFormat.format(rate.games)}`
  return rate.sampleKind === 'lists' ? `${games} en ${countFormat.format(rate.samples)} listas` : games
}

/** Same text as @tcg/domain `formatWinRateEs`: «70 % (n = 10, IC 39,7–89,2 %, orientativo)». */
export function formatRate(rate: WinRate | null): string {
  if (!rate) return 'sin datos'
  const parts = [formatSample(rate), `IC ${formatInterval(rate.ci95)}`]
  if (rate.orientative) parts.push('orientativo')
  return `${formatRateValue(rate.value)} (${parts.join(', ')})`
}

/** «7 V · 3 D», with «· 1 E» only when there are ties. */
export function formatRecord(record: GameRecord): string {
  const parts = [`${record.wins} V`, `${record.losses} D`]
  if (record.ties > 0) parts.push(`${record.ties} E`)
  return parts.join(' · ')
}

/** Same grouping key as @tcg/domain `opponentKey`: case, accents and punctuation do not matter. */
export function opponentKeyOf(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Inverse of `toLocalInput`: the local wall time as an ISO instant; null when empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const PERIODS = [
  { key: 'all', label: 'Todo', days: null },
  { key: '7', label: '7 días', days: 7 },
  { key: '30', label: '30 días', days: 30 },
  { key: '90', label: '90 días', days: 90 },
] as const
export type PeriodKey = (typeof PERIODS)[number]['key']

/** Start of the period (ISO) counted back from `now`; undefined for «Todo». */
export function periodFrom(key: PeriodKey, now: Date = new Date()): string | undefined {
  const period = PERIODS.find((item) => item.key === key)
  if (!period?.days) return undefined
  return new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000).toISOString()
}

const timeFormat = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFormat = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' })

/** «hoy 14:32», «ayer 21:05», «3 oct 18:40». */
export function formatPlayedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000))
  const time = timeFormat.format(date)
  if (days === 0) return `hoy ${time}`
  if (days === 1) return `ayer ${time}`
  return `${dayFormat.format(date)} ${time}`
}
