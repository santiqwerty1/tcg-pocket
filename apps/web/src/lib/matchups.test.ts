import { describe, expect, it } from 'vitest'
import { matchupTone, shortName } from './matchups'

const rate = (lo: number, hi: number) => ({
  source: 'tournament' as const,
  value: (lo + hi) / 2,
  games: 40,
  samples: 40,
  sampleKind: 'matches' as const,
  ci95: [lo, hi] as [number, number],
  orientative: false,
})

describe('matchups', () => {
  it('reads a matchup as favorable, unfavorable or even by its interval, not its value', () => {
    expect(matchupTone(rate(52, 70))).toBe('good')
    expect(matchupTone(rate(30, 49))).toBe('bad')
    expect(matchupTone(rate(45, 65))).toBe('even')
    expect(matchupTone(null)).toBe('none')
  })

  it('shortens long archetype names for the table header', () => {
    expect(shortName('Mega Blaziken ex')).toBe('Mega Blaziken…')
    expect(shortName('Hoopa ex')).toBe('Hoopa ex')
    expect(shortName('Mega Lucario ex Lucario')).toBe('Mega Lucario…')
  })
})
