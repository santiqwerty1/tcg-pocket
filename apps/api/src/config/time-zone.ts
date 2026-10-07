/** The owner's time zone: the container runs in UTC, so dates the owner sees (backups, a pack's last day) name it. */
export const OWNER_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Today in the owner's time zone, as YYYY-MM-DD. */
export function todayInOwnerZone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OWNER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** A `@db.Date` column as YYYY-MM-DD (Prisma reads it as UTC midnight). */
export function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}
