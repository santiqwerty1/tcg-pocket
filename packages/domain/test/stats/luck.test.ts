import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/index.js'
import { binomialTails, losingStreak, luckCheck, oneIn, runProbability } from '../../src/stats/index.js'

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
    // Ties count as non-wins, like every rate of the app.
    expect(luckCheck({ wins: 2, losses: 2, ties: 2 }, 50).games).toBe(6)
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
