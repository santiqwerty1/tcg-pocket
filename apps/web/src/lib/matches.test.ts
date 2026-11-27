import { describe, expect, it } from 'vitest'
import type { WinRate } from '@/api/schemas'
import {
  formatInterval,
  formatPlayedAt,
  formatRate,
  formatRateValue,
  formatRecord,
  formatSample,
  formatSampleOf,
  formatSampleShort,
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
    expect(formatRate(seventyPercent)).toBe('70\u00a0% (n = 10, IC\u00a039,7–\u206089,2\u00a0%, orientativo)')
    expect(formatRate(null)).toBe('sin datos')
  })

  it('drops «orientativo» from 30 samples and names lists for tournament rates', () => {
    expect(formatRate({ ...seventyPercent, games: 30, samples: 30, orientative: false })).toBe(
      '70\u00a0% (n = 30, IC\u00a039,7–\u206089,2\u00a0%)',
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
    ).toBe('51,1\u00a0% (n = 268 en 40 listas, IC\u00a045,2–\u206057,0\u00a0%)')
  })

  it('formats value, interval and record', () => {
    expect(formatRateValue(200 / 3)).toBe('66,7\u00a0%')
    expect(formatInterval([0, 27.75])).toBe('0,0–\u206027,8\u00a0%')
    expect(formatRecord({ wins: 7, losses: 3, ties: 0 })).toBe('7 V · 3 D')
    expect(formatRecord({ wins: 2, losses: 1, ties: 1 })).toBe('2 V · 1 D · 1 E')
  })
})

describe('the sample of a rate', () => {
  it('the long form: «n = 47», and the lists a tournament rate comes from', () => {
    expect(formatSample(seventyPercent)).toBe('n = 10')
    expect(formatSample({ ...seventyPercent, games: 14179, samples: 14179 })).toBe('n = 14.179')
    // The lists are said only when they are what the rate counted: a matchup of a tournament counts matches.
    expect(
      formatSample({ ...seventyPercent, source: 'tournament', games: 268, samples: 40, sampleKind: 'lists' }),
    ).toBe('n = 268 en 40 listas')
    expect(formatSample({ ...seventyPercent, source: 'tournament', games: 268, samples: 268 })).toBe('n = 268')
    expect(formatSampleOf(47)).toBe('n = 47')
    expect(formatSampleOf(47, null)).toBe('n = 47')
    expect(formatSampleOf(1268, 1040)).toBe('n = 1.268 en 1.040 listas')
    // Zero lists is a count, not «no lists given».
    expect(formatSampleOf(0, 0)).toBe('n = 0 en 0 listas')
  })

  it('the short form: «n 47» with a space that does not break, and the thousands as every count', () => {
    expect(formatSampleShort(47)).toBe('n\u00a047')
    expect(formatSampleShort(1)).toBe('n\u00a01')
    expect(formatSampleShort(1206)).toBe('n\u00a01.206')
    expect(formatSampleShort(14179)).toBe('n\u00a014.179')
    expect(formatSampleShort(0)).toBe('n\u00a00')
    for (const games of [0, 7, 47, 1206, 14179]) expect(formatSampleShort(games)).not.toMatch(/ /)
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
