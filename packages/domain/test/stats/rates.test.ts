import { describe, expect, it } from 'vitest'
import {
  addRecords,
  formatIntervalEs,
  formatPercentEs,
  formatWinRateEs,
  matchWinRate,
  ORIENTATIVE_BELOW,
  wilsonInterval,
  winRate,
  Z_95,
} from '../../src/stats/index.js'

/** Closed form of the Wilson bounds, written independently of the implementation. */
function reference(successes: number, n: number, z = 1.96): [number, number] {
  const p = successes / n
  const root = z * Math.sqrt(z * z + 4 * n * p * (1 - p))
  const denominator = 2 * (n + z * z)
  return [(2 * n * p + z * z - root) / denominator, (2 * n * p + z * z + root) / denominator]
}

describe('wilsonInterval', () => {
  it('matches the closed form for several samples', () => {
    for (const [k, n] of [
      [7, 10],
      [0, 10],
      [10, 10],
      [1, 2],
      [137, 268],
      [15, 30],
      [500, 1000],
    ] as const) {
      const [lo, hi] = wilsonInterval(k, n)
      const [refLo, refHi] = reference(k, n, Z_95)
      expect(lo).toBeCloseTo(Math.max(0, refLo), 12)
      expect(hi).toBeCloseTo(Math.min(1, refHi), 12)
      expect(lo).toBeLessThanOrEqual(k / n)
      expect(hi).toBeGreaterThanOrEqual(k / n)
    }
  })

  it('stays inside [0, 1] at the edges and is not degenerate', () => {
    const [zeroLo, zeroHi] = wilsonInterval(0, 10)
    expect(zeroLo).toBe(0)
    expect(zeroHi * 100).toBeCloseTo(27.75, 2)
    const [allLo, allHi] = wilsonInterval(10, 10)
    expect(allHi).toBe(1)
    expect(allLo * 100).toBeCloseTo(72.25, 2)
  })

  it('narrows as the sample grows', () => {
    const width = (k: number, n: number) => {
      const [lo, hi] = wilsonInterval(k, n)
      return hi - lo
    }
    expect(width(5, 10)).toBeGreaterThan(width(50, 100))
    expect(width(50, 100)).toBeGreaterThan(width(500, 1000))
  })

  it('rejects impossible inputs', () => {
    expect(() => wilsonInterval(0, 0)).toThrow(RangeError)
    expect(() => wilsonInterval(11, 10)).toThrow(RangeError)
    expect(() => wilsonInterval(-1, 10)).toThrow(RangeError)
    expect(() => wilsonInterval(1.5, 10)).toThrow(RangeError)
  })
})

describe('matchWinRate', () => {
  it('PLAN §7 Fase 2: 7 wins in 10 → «70 % (n = 10, IC 39,7–89,2 %, orientativo)»', () => {
    const rate = matchWinRate({ wins: 7, losses: 3, ties: 0 })
    expect(rate).not.toBeNull()
    expect(rate).toMatchObject({ source: 'matches', value: 70, games: 10, samples: 10, sampleKind: 'matches' })
    expect(rate?.orientative).toBe(true)
    expect(rate?.ci95[0]).toBeCloseTo(39.68, 2)
    expect(rate?.ci95[1]).toBeCloseTo(89.22, 2)
    expect(formatWinRateEs(rate)).toBe('70 % (n = 10, IC 39,7–89,2 %, orientativo)')
  })

  it('counts ties as games that are not wins (WR = W / (W + L + T))', () => {
    const rate = matchWinRate({ wins: 7, losses: 2, ties: 1 })
    expect(rate?.value).toBe(70)
    expect(rate?.games).toBe(10)
    expect(matchWinRate({ wins: 0, losses: 0, ties: 4 })?.value).toBe(0)
  })

  it('is null without games: the UI says «sin datos», never «0 %»', () => {
    expect(matchWinRate({ wins: 0, losses: 0, ties: 0 })).toBeNull()
    expect(formatWinRateEs(null)).toBe('sin datos')
  })

  it('marks «orientativo» below 30 matches and not from 30 on', () => {
    expect(ORIENTATIVE_BELOW).toBe(30)
    expect(matchWinRate({ wins: 15, losses: 14, ties: 0 })?.orientative).toBe(true)
    const thirty = matchWinRate({ wins: 15, losses: 15, ties: 0 })
    expect(thirty?.orientative).toBe(false)
    expect(formatWinRateEs(thirty)).toBe('50 % (n = 30, IC 33,2–66,8 %)')
  })

  it('rejects negative or fractional records', () => {
    expect(() => matchWinRate({ wins: -1, losses: 3, ties: 0 })).toThrow(RangeError)
    expect(() => matchWinRate({ wins: 1.5, losses: 3, ties: 0 })).toThrow(RangeError)
  })
})

describe('winRate for other sources', () => {
  it('tournament rates decide «orientativo» on lists, not games, and say so', () => {
    // Plan §7 Fase 5 example: 268 games of an exact list; with 40 lists it is not orientative.
    const rate = winRate('tournament', { wins: 137, losses: 126, ties: 5 }, 40, 'lists')
    expect(rate).toMatchObject({ source: 'tournament', games: 268, samples: 40, orientative: false })
    expect(formatWinRateEs(rate)).toBe('51,1 % (n = 268 en 40 listas, IC 45,2–57,0 %)')
    expect(winRate('tournament', { wins: 137, losses: 126, ties: 5 }, 12, 'lists')?.orientative).toBe(true)
  })
})

describe('formatting', () => {
  it('uses Spanish decimals, one at most for the value and exactly one for the interval', () => {
    expect(formatPercentEs(70)).toBe('70 %')
    expect(formatPercentEs(200 / 3)).toBe('66,7 %')
    expect(formatPercentEs(69.96)).toBe('70 %')
    expect(formatIntervalEs([0, 27.75])).toBe('0,0–27,8 %')
    expect(formatWinRateEs(matchWinRate({ wins: 617, losses: 600, ties: 17 }))).toBe('50 % (n = 1.234, IC 47,2–52,8 %)')
  })

  it('adds records field by field', () => {
    expect(addRecords({ wins: 1, losses: 2, ties: 3 }, { wins: 4, losses: 5, ties: 6 })).toEqual({
      wins: 5,
      losses: 7,
      ties: 9,
    })
  })
})
