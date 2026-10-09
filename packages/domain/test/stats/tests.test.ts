import { describe, expect, it } from 'vitest'
import {
  benjaminiHochberg,
  clusteredVariance,
  clusteredWinRate,
  designEffect,
  fisherExact,
  normalCdf,
  twoSidedP,
  wilsonFromRate,
  wilsonInterval,
  winRate,
} from '../../src/stats/index.js'

describe('honest numbers (H-011, Fase 37)', () => {
  it('normal distribution and two-sided p', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-1.959963984540054)).toBeCloseTo(0.025, 6)
    expect(twoSidedP(1.959963984540054)).toBeCloseTo(0.05, 6)
    expect(twoSidedP(-3)).toBeCloseTo(0.0027, 4)
  })

  it("Fisher's exact test: known tables", () => {
    // The lady tasting tea: [[3, 1], [1, 3]], two-sided p = 34/70.
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(34 / 70, 10)
    // [[4, 2], [0, 5]] (the review's example): p = 0,0606.
    expect(fisherExact(4, 2, 0, 5)).toBeCloseTo(0.0606, 4)
    expect(fisherExact(0, 0, 0, 0)).toBe(1)
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 10)
    expect(fisherExact(10, 0, 0, 10)).toBeLessThan(0.0001)
  })

  it('Benjamini–Hochberg: the step-up rule', () => {
    // m = 5 at q = 0,05: thresholds 0,01 0,02 0,03 0,04 0,05; the largest p under its threshold is the 3rd.
    expect(benjaminiHochberg([0.001, 0.5, 0.025, 0.019, 0.9])).toEqual([true, false, true, true, false])
    expect(benjaminiHochberg([0.04, 0.04])).toEqual([true, true])
    expect(benjaminiHochberg([0.03, 0.2, 0.2])).toEqual([false, false, false])
    expect(benjaminiHochberg([])).toEqual([])
  })

  it('design effect: alike clusters widen, independent-looking ones do not narrow', () => {
    // Two kinds of lists: 7-0 and 0-7. Within a list every game is the same: far from independent.
    const split = [
      { successes: 7, trials: 7 },
      { successes: 0, trials: 7 },
      { successes: 7, trials: 7 },
      { successes: 0, trials: 7 },
    ]
    expect(designEffect(split)).toBeGreaterThan(5)
    // Every list 4-3: less spread than independence would give; the effect stays at 1.
    expect(designEffect(Array.from({ length: 10 }, () => ({ successes: 4, trials: 7 })))).toBe(1)
    expect(designEffect([{ successes: 3, trials: 7 }])).toBe(1)
    expect(clusteredVariance([{ successes: 3, trials: 7 }])).toBeNull()
  })

  it('a clustered rate keeps the value and widens the interval by the design effect', () => {
    const lists = [
      { wins: 7, losses: 0, ties: 0 },
      { wins: 0, losses: 7, ties: 0 },
      { wins: 6, losses: 1, ties: 0 },
      { wins: 1, losses: 6, ties: 0 },
    ]
    const plain = winRate('tournament', { wins: 14, losses: 14, ties: 0 }, 4, 'lists')
    const clustered = clusteredWinRate('tournament', lists, 4, 'lists')
    expect(clustered?.value).toBe(plain?.value)
    expect(clustered?.games).toBe(28)
    expect((clustered?.ci95[1] ?? 0) - (clustered?.ci95[0] ?? 0)).toBeGreaterThan(
      (plain?.ci95[1] ?? 0) - (plain?.ci95[0] ?? 0),
    )
    expect(clustered?.designEffect).toBeGreaterThan(1)
    expect(clusteredWinRate('tournament', [], 0, 'lists')).toBeNull()
  })

  it('Wilson over a fractional sample agrees with the whole one', () => {
    const [lo, hi] = wilsonInterval(7, 10)
    const [flo, fhi] = wilsonFromRate(0.7, 10)
    expect(flo).toBeCloseTo(lo, 12)
    expect(fhi).toBeCloseTo(hi, 12)
    expect(wilsonFromRate(0.5, 0)).toEqual([0, 1])
  })
})
