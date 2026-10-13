/** Formatting and URL state of the tournament screens (Fase 5). */

import type { TournamentFormat } from '@/api/schemas'
import type { TournamentScopeParams } from '@/api/tournaments'

const shareFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('es-AR')

/** «27/8/2026» from YYYY-MM-DD or an ISO instant (dates of tournaments are shown in UTC, as eras are). */
export function formatDayEs(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${Number(day)}/${Number(month)}/${year}`
}

/** Phone review: past this many days, a window counted up to the newest tournament loaded says it is old. */
export const STALE_TOURNAMENT_DAYS = 7

/**
 * «El último torneo cargado es del 5/9/2026, hace 38 días»: the windows («esta semana», «los últimos 14 días») end at
 * the newest tournament loaded, so data keeps showing when Limitless is late; past a week the screen says so.
 */
export function staleTournaments(newest: string | null, now: number = Date.now()): string | null {
  if (!newest) return null
  const days = Math.floor((now - new Date(newest).getTime()) / 86_400_000)
  if (days <= STALE_TOURNAMENT_DAYS) return null
  return `El último torneo cargado es del ${formatDayEs(newest)}, hace ${days} días: los números son de esos días.`
}

export function formatShare(value: number): string {
  return `${shareFormat.format(value)} %`
}

export function formatCount(value: number): string {
  return countFormat.format(value)
}

export const FORMAT_LABEL: Record<TournamentFormat, string> = { STANDARD: 'Estándar', NOEX: 'NOEX' }

/** Scope from the URL (`?era=B4a&formato=NOEX`); absent = current era, Standard. */
export function scopeFromSearch(search: URLSearchParams): TournamentScopeParams {
  const era = search.get('era') ?? undefined
  const format = search.get('formato') === 'NOEX' ? 'NOEX' : undefined
  return { era, format }
}

/** The same scope as a query string for links between tournament screens. */
export function scopeSearch(scope: TournamentScopeParams): string {
  const params = new URLSearchParams()
  if (scope.era) params.set('era', scope.era)
  if (scope.format === 'NOEX') params.set('formato', 'NOEX')
  const text = params.toString()
  return text ? `?${text}` : ''
}

/** «hace 2 h», «hace 3 días». */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 60) return minutes <= 1 ? 'recién' : `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}

/**
 * Labels for functional cards: the Spanish name, plus the card code when two different cards share it (Riolu A2-91 and
 * Riolu B3-79 are different cards with the same name).
 */
export function cardLabels(cards: readonly { groupId: string | null; nameEs: string }[]): Map<string, string> {
  const byName = new Map<string, Set<string>>()
  for (const card of cards) {
    if (card.groupId === null) continue
    const groups = byName.get(card.nameEs) ?? new Set<string>()
    groups.add(card.groupId)
    byName.set(card.nameEs, groups)
  }
  const labels = new Map<string, string>()
  for (const card of cards) {
    if (card.groupId === null) continue
    const shared = (byName.get(card.nameEs)?.size ?? 0) > 1
    labels.set(card.groupId, shared ? `${card.nameEs} (${card.groupId})` : card.nameEs)
  }
  return labels
}
