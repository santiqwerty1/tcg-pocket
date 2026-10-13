import { describe, expect, it } from 'vitest'
import type { WinRate } from '@/api/schemas'
import {
  formatInterval,
  formatPlayedAt,
  formatRate,
  formatRateValue,
  formatRecord,
  fromLocalInput,
  opponentKeyOf,
  periodFrom,
  toLocalInput,
} from './matches'

const seventyPercent: WinRate = {
  source: 'matches',
  value: 70,
  games: 10,
  samples: 10,
  sampleKind: 'matches',
  ci95: [39.677, 89.2211],
  orientative: true,
}

describe('formatRate', () => {
  it('renders the acceptance example exactly like the domain', () => {
    expect(formatRate(seventyPercent)).toBe('70\u00a0% (n = 10, IC\u00a039,7–89,2\u00a0%, orientativo)')
    expect(formatRate(null)).toBe('sin datos')
  })

  it('drops «orientativo» from 30 samples and names lists for tournament rates', () => {
    expect(formatRate({ ...seventyPercent, games: 30, samples: 30, orientative: false })).toBe(
      '70\u00a0% (n = 30, IC\u00a039,7–89,2\u00a0%)',
    )
    expect(
      formatRate({
        ...seventyPercent,
        source: 'tournament',
        value: 51.119,
        games: 268,
        samples: 40,
        sampleKind: 'lists',
        ci95: [45.16, 57.04],
        orientative: false,
      }),
    ).toBe('51,1\u00a0% (n = 268 en 40 listas, IC\u00a045,2–57,0\u00a0%)')
  })

  it('formats value, interval and record', () => {
    expect(formatRateValue(200 / 3)).toBe('66,7\u00a0%')
    expect(formatInterval([0, 27.75])).toBe('0,0–27,8\u00a0%')
    expect(formatRecord({ wins: 7, losses: 3, ties: 0 })).toBe('7 V · 3 D')
    expect(formatRecord({ wins: 2, losses: 1, ties: 1 })).toBe('2 V · 1 D · 1 E')
  })
})

describe('opponentKeyOf', () => {
  it('matches the domain grouping', () => {
    expect(opponentKeyOf('Mega-Blaziken ex')).toBe('mega blaziken ex')
    expect(opponentKeyOf(' MEGA blazíken  EX ')).toBe('mega blaziken ex')
    expect(opponentKeyOf('---')).toBe('')
  })
})

describe('dates', () => {
  it('round-trips datetime-local values in local time', () => {
    const iso = new Date(2026, 9, 7, 14, 32).toISOString()
    expect(toLocalInput(iso)).toBe('2026-10-07T14:32')
    expect(fromLocalInput('2026-10-07T14:32')).toBe(iso)
    expect(fromLocalInput('')).toBeNull()
    expect(toLocalInput('nope')).toBe('')
  })

  it('names today and yesterday', () => {
    const now = new Date(2026, 9, 7, 20, 0)
    expect(formatPlayedAt(new Date(2026, 9, 7, 14, 32).toISOString(), now)).toBe('hoy 14:32')
    expect(formatPlayedAt(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toBe('ayer 09:05')
    expect(formatPlayedAt(new Date(2026, 9, 3, 18, 40).toISOString(), now)).toMatch(/^3 oct\.? 18:40$/)
  })

  it('computes the start of a period', () => {
    const now = new Date('2026-10-07T12:00:00Z')
    expect(periodFrom('all', now)).toBeUndefined()
    expect(periodFrom('7', now)).toBe('2026-09-30T12:00:00.000Z')
  })
})
