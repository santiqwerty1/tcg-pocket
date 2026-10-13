const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' })
const number = new Intl.NumberFormat('es-AR')
const oneDecimal = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateOnly.format(date)
}

export function formatNumber(value: number): string {
  return number.format(value)
}

/** The space before «%» does not break (phone review: «48⏎%»); the same as @tcg/domain `PERCENT_ES`. */
export const PERCENT = '\u00a0%'

export function formatPercent(value: number): string {
  return `${oneDecimal.format(value)}${PERCENT}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${oneDecimal.format(bytes / 1024)} KB`
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`
}

/** «falta 1» / «faltan 3»; with a noun, «falta 1 copia» / «faltan 3 copias» (phone review: «faltan 1»). */
export function missing(count: number, noun?: readonly [singular: string, plural: string]): string {
  const verb = count === 1 ? 'falta' : 'faltan'
  return noun ? `${verb} ${plural(count, noun[0], noun[1])}` : `${verb} ${formatNumber(count)}`
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—'
}
