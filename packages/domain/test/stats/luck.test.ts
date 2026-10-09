import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/index.js'
import {
  betaBinomialTails,
  binomialTails,
  holmVerdicts,
  losingStreak,
  luckCheck,
  oneIn,
  runProbability,
} from '../../src/stats/index.js'

describe('¿mala racha o mal matchup? (Fase 13)', () => {
  it('binomial tails: exact small cases', () => {
    // 10 games at 50 %: P(X ≤ 2) = (1 + 10 + 45) / 1024.
    const { lower, upper } = binomialTails(10, 2, 0.5)
    expect(lower).toBeCloseTo(56 / 1024, 12)
    expect(upper).toBeCloseTo(1 - 11 / 1024, 12)
    expect(binomialTails(3, 0, 0).lower).toBe(1)
    expect(binomialTails(3, 3, 1).upper).toBe(1)
    // A thousand games do not overflow.
    const big = binomialTails(1000, 470, 0.5)
    expect(big.lower).toBeGreaterThan(0.02)
    expect(big.lower).toBeLessThan(0.04)
  })

  it('verdicts: too few games, normal, unlucky, lucky', () => {
    expect(luckCheck({ wins: 0, losses: 3, ties: 0 }, 50).verdict).toBe('too_few')
    expect(luckCheck({ wins: 3, losses: 4, ties: 0 }, 50).verdict).toBe('normal')
    const bad = luckCheck({ wins: 2, losses: 10, ties: 0 }, 55)
    expect(bad.verdict).toBe('unlucky')
    expect(bad.actual).toBeCloseTo(16.67, 1)
    expect(bad.lowerTail).toBeLessThan(0.05)
    expect(luckCheck({ wins: 12, losses: 1, ties: 0 }, 50).verdict).toBe('lucky')
    // H-009: ties are out (W/(W+L)), on both sides.
    expect(luckCheck({ wins: 2, losses: 2, ties: 2 }, 50).games).toBe(4)
  })

  it('H-009: «raro» is two-sided (each tail under 2,5 %), not 5 % on either side', () => {
    // 2-8 at 50 %: P(X ≤ 2) = 56/1024 = 5,5 %; 1-9: 11/1024 = 1,07 % → raro.
    expect(luckCheck({ wins: 2, losses: 8, ties: 0 }, 50).verdict).toBe('normal')
    // 3-12 at 50 %: P(X ≤ 3) = 576/32768 = 1,76 % → raro now; 4-11: 5,9 % → normal.
    expect(luckCheck({ wins: 3, losses: 12, ties: 0 }, 50).verdict).toBe('unlucky')
    // A tail between 2,5 % and 5 % used to be «raro»: 3-11 at 50 % (P(X ≤ 3) = 2,87 %).
    const edge = luckCheck({ wins: 3, losses: 11, ties: 0 }, 50)
    expect(edge.lowerTail).toBeGreaterThan(0.025)
    expect(edge.lowerTail).toBeLessThan(0.05)
    expect(edge.verdict).toBe('normal')
  })

  it('H-009: the uncertainty of the expected rate (beta-binomial) — the example of the review', () => {
    // Tournament 3-7 against own 6-2: taken as exact (30 %), the upper tail is 1,13 % («raro»).
    const exact = luckCheck({ wins: 6, losses: 2, ties: 0 }, 30)
    expect(exact.upperTail).toBeCloseTo(0.01129, 4)
    // With the 3-7 behind it (Beta(3,5; 7,5)), it is about 5 %: within the normal.
    const honest = luckCheck({ wins: 6, losses: 2, ties: 0 }, 30, { expectedRecord: { wins: 3, losses: 7 } })
    expect(honest.upperTail).toBeGreaterThan(0.04)
    expect(honest.upperTail).toBeLessThan(0.07)
    expect(honest.verdict).toBe('normal')
    expect(honest.expected).toBeCloseTo(30, 10)
    // A huge tournament record behaves like the exact rate.
    const huge = luckCheck({ wins: 6, losses: 2, ties: 0 }, 30, { expectedRecord: { wins: 30_000, losses: 70_000 } })
    expect(huge.upperTail).toBeCloseTo(exact.upperTail, 4)
  })

  it('beta-binomial tails sum to one and match the uniform case', () => {
    // Beta(1, 1) is uniform: every k of n is equally likely, 1 / (n + 1).
    const { lower, upper } = betaBinomialTails(9, 0, 1, 1)
    expect(lower).toBeCloseTo(1 / 10, 10)
    expect(upper).toBeCloseTo(1, 10)
    const mid = betaBinomialTails(20, 7, 4.5, 6.5)
    const at = betaBinomialTails(20, 7, 4.5, 6.5)
    expect(mid.lower + betaBinomialTails(20, 8, 4.5, 6.5).upper).toBeCloseTo(1, 10)
    expect(at.lower).toBeGreaterThan(0)
  })

  it('H-009: Holm over several rivals keeps «raro» at one in twenty in all', () => {
    const rare = luckCheck({ wins: 1, losses: 14, ties: 0 }, 50) // p ≈ 0,001
    const borderline = luckCheck({ wins: 3, losses: 12, ties: 0 }, 50) // two-sided p ≈ 0,035
    const normal = luckCheck({ wins: 5, losses: 5, ties: 0 }, 50)
    const few = luckCheck({ wins: 0, losses: 2, ties: 0 }, 50)
    expect(borderline.verdict).toBe('unlucky')
    // Alone, the borderline one is raro; next to the rare one and two normal ones, its step is 0,05 / 3.
    expect(holmVerdicts([rare, borderline, normal, few])).toEqual(['unlucky', 'normal', 'normal', 'too_few'])
    expect(holmVerdicts([borderline])).toEqual(['unlucky'])
    const lucky = luckCheck({ wins: 15, losses: 0, ties: 0 }, 50)
    expect(holmVerdicts([lucky, normal])).toEqual(['lucky', 'normal'])
    expect(holmVerdicts([])).toEqual([])
  })

  it('losing runs: the latest run, its chance, and the chance of such a run somewhere', () => {
    expect(losingStreak(['loss', 'loss', 'win', 'loss', 'loss'], 50)).toBeNull()
    const run = losingStreak(['win', 'loss', 'loss', 'loss', 'loss'], 50)
    expect(run).toMatchObject({ losses: 4 })
    expect(run?.probability).toBeCloseTo(1 / 16, 12)
    expect(run?.somewhere).toBeGreaterThan(run?.probability ?? 1)
    expect(oneIn(1 / 16)).toBe(16)
  })

  it('a run somewhere matches a simulation', () => {
    const random = seededRandom(7)
    const games = 20
    const trials = 40_000
    let hits = 0
    for (let t = 0; t < trials; t++) {
      let streak = 0
      let found = false
      for (let g = 0; g < games; g++) {
        streak = random() < 0.55 ? streak + 1 : 0
        if (streak >= 4) found = true
      }
      if (found) hits += 1
    }
    expect(Math.abs(runProbability(games, 4, 0.55) - hits / trials)).toBeLessThan(0.01)
    expect(runProbability(3, 4, 0.5)).toBe(0)
  })
})
