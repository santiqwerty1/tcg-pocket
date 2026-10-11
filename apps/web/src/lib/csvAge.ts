/**
 * How old the collection is (Fase 41). The brief starts from a CSV that goes stale: after a week the app says so in
 * «Hoy» and in Colección, with a link to import a new one.
 */
export const CSV_STALE_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days since the last import; null when there was never one. */
export function csvAgeDays(lastImportAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!lastImportAt) return null
  const at = new Date(lastImportAt).getTime()
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS))
}

/** The notice to show, or null while the CSV is fresh. */
export function csvAgeNotice(lastImportAt: string | null | undefined, now: Date = new Date()): string | null {
  const days = csvAgeDays(lastImportAt, now)
  if (days === null) return 'Todavía no sincronizaste tu colección'
  if (days < CSV_STALE_DAYS) return null
  return `Tu última sincronización es de hace ${days} días`
}
