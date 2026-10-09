/**
 * Resumen semanal (Fase 32): weeks from Monday 00:00 to the next Monday in the owner's time zone (the server runs in
 * UTC). Built on Intl, so a zone with daylight saving time works too.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  }
}

/** How far the zone's wall clock is ahead of UTC at `date`, in ms. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** 00:00 of a calendar day in the zone, as a UTC instant (the day may overflow: day 0, day 32…). */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day)
  const first = offsetMs(new Date(guess), timeZone)
  const instant = guess - first
  const second = offsetMs(new Date(instant), timeZone)
  return new Date(second === first ? instant : guess - second)
}

/** Monday 00:00 of the week holding `date`, in the zone. */
export function weekStart(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone)
  return zonedMidnight(p.year, p.month, p.day - p.weekday, timeZone)
}

/** The Monday `weeks` weeks after (or before) a week start. */
export function shiftWeek(start: Date, weeks: number, timeZone: string): Date {
  const p = zonedParts(start, timeZone)
  return zonedMidnight(p.year, p.month, p.day + weeks * 7, timeZone)
}

/** «2026-10-05»: the local date of an instant. */
export function zonedDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** The week that holds a local date «YYYY-MM-DD» (null when it is not a date). */
export function weekOfDate(text: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const noon = zonedMidnight(Number(match[1]), Number(match[2]), Number(match[3]), timeZone)
  if (Number.isNaN(noon.getTime()) || zonedDate(noon, timeZone) !== text) return null
  return weekStart(new Date(noon.getTime() + 12 * 60 * 60 * 1000), timeZone)
}

/** «29/9 al 5/10»: Monday to Sunday. */
export function weekLabelEs(start: Date, timeZone: string): string {
  const monday = zonedParts(start, timeZone)
  const sunday = zonedParts(new Date(shiftWeek(start, 1, timeZone).getTime() - 1), timeZone)
  return `${monday.day}/${monday.month} al ${sunday.day}/${sunday.month}`
}
