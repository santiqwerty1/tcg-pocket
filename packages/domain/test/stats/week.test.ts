import { describe, expect, it } from 'vitest'
import { shiftWeek, weekLabelEs, weekOfDate, weekStart, zonedDate, zonedMidnight } from '../../src/stats/week.js'

const BA = 'America/Argentina/Buenos_Aires'
const MADRID = 'Europe/Madrid'

describe('resumen semanal (Fase 32): weeks in the owner’s time zone', () => {
  it('a week runs from Monday 00:00 in Buenos Aires (UTC−3) to the next Monday', () => {
    // Friday 9/10/2026 01:00 UTC is still Thursday 8/10 22:00 in Buenos Aires.
    const start = weekStart(new Date('2026-10-09T01:00:00Z'), BA)
    expect(start.toISOString()).toBe('2026-10-05T03:00:00.000Z')
    expect(zonedDate(start, BA)).toBe('2026-10-05')
    // Monday 00:30 local belongs to the new week; Sunday 23:30 to the old one.
    expect(weekStart(new Date('2026-10-12T03:30:00Z'), BA).toISOString()).toBe('2026-10-12T03:00:00.000Z')
    expect(weekStart(new Date('2026-10-12T02:30:00Z'), BA).toISOString()).toBe('2026-10-05T03:00:00.000Z')
    expect(shiftWeek(start, -1, BA).toISOString()).toBe('2026-09-28T03:00:00.000Z')
    expect(shiftWeek(start, 1, BA).toISOString()).toBe('2026-10-12T03:00:00.000Z')
    expect(weekLabelEs(start, BA)).toBe('5/10 al 11/10')
    expect(weekLabelEs(shiftWeek(start, -1, BA), BA)).toBe('28/9 al 4/10')
  })

  it('reads a local date into its week and refuses what is not a date', () => {
    expect(weekOfDate('2026-10-08', BA)?.toISOString()).toBe('2026-10-05T03:00:00.000Z')
    expect(weekOfDate('2026-10-05', BA)?.toISOString()).toBe('2026-10-05T03:00:00.000Z')
    expect(weekOfDate('2026-10-11', BA)?.toISOString()).toBe('2026-10-05T03:00:00.000Z')
    expect(weekOfDate('2026-02-30', BA)).toBeNull()
    expect(weekOfDate('ayer', BA)).toBeNull()
  })

  it('survives daylight saving time (Madrid moves its clocks on 25/10/2026)', () => {
    expect(zonedMidnight(2026, 10, 26, MADRID).toISOString()).toBe('2026-10-25T23:00:00.000Z')
    const before = weekStart(new Date('2026-10-22T12:00:00Z'), MADRID)
    expect(before.toISOString()).toBe('2026-10-18T22:00:00.000Z')
    expect(shiftWeek(before, 1, MADRID).toISOString()).toBe('2026-10-25T23:00:00.000Z')
  })
})
