import { describe, expect, it } from 'vitest'
import { averageRanks, type CalibrationPairing, calibrationReport, spearman } from '../../src/simulation/index.js'

describe('rank correlation', () => {
  it('ranks ties with the mean of the ranks they span', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
    expect(averageRanks([3, 1, 2])).toEqual([3, 1, 2])
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2])
  })

  it('Spearman: 1 for the same order, −1 for the reverse, and the textbook value with ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])?.rho).toBeCloseTo(1, 10)
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])?.rho).toBeCloseTo(-1, 10)
    // scipy.stats.spearmanr([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]) = 0.8207826816681233
    const tied = spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])
    expect(tied?.rho).toBeCloseTo(0.8207826816681233, 10)
    expect(tied?.n).toBe(5)
    const [lo, hi] = tied?.ci95 ?? [Number.NaN, Number.NaN]
    expect(lo).toBeLessThan(0.82)
    expect(hi).toBeGreaterThan(0.82)
    expect(hi).toBeLessThanOrEqual(1)
  })

  it('needs 3 pairs and some spread; the interval needs 5', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull()
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull()
    expect(spearman([1, 2, 3], [1, 3, 2])?.ci95).toBeNull()
    expect(() => spearman([1, 2, 3], [1, 2])).toThrow(RangeError)
  })
})

describe('calibration report', () => {
  const pairings: CalibrationPairing[] = [
    // Close to tournaments: 60 % against 55 % over 100 games, inside its interval.
    {
      a: 'gyarados',
      b: 'darkrai',
      labelA: 'Gyarados ex',
      labelB: 'Darkrai ex',
      simulated: { wins: 60, losses: 40, ties: 5 },
      tournament: { wins: 55, losses: 45 },
    },
    // Far: the bots win 80 % of a matchup people win 30 %.
    {
      a: 'gyarados',
      b: 'venusaur',
      labelA: 'Gyarados ex',
      labelB: 'Mega Venusaur ex',
      simulated: { wins: 80, losses: 20, ties: 0 },
      tournament: { wins: 30, losses: 70 },
    },
    // Too few tournament games to judge: shown, left out of the summary.
    {
      a: 'darkrai',
      b: 'venusaur',
      labelA: 'Darkrai ex',
      labelB: 'Mega Venusaur ex',
      simulated: { wins: 50, losses: 50, ties: 0 },
      tournament: { wins: 5.5, losses: 4.5 },
    },
    // Never met in tournaments.
    {
      a: 'darkrai',
      b: 'mew',
      labelA: 'Darkrai ex',
      labelB: 'Mew ex',
      simulated: { wins: 30, losses: 70, ties: 2 },
      tournament: null,
    },
  ]
  const report = calibrationReport(pairings, {
    shares: new Map([
      ['gyarados', 20],
      ['darkrai', 15],
      ['venusaur', 10],
      ['mew', 5],
    ]),
  })

  it('keeps each side apart, per game and without ties, with its own interval', () => {
    const [close, far, few, never] = report.rows
    expect(close?.simulated).toMatchObject({ source: 'simulation', value: 60, games: 100 })
    expect(close?.ties).toBe(5)
    expect(close?.tournament).toMatchObject({ source: 'tournament', games: 100 })
    expect(close?.tournament?.value).toBeCloseTo(55, 10)
    expect(close?.difference).toBeCloseTo(5, 10)
    expect(close?.inside).toBe(true)
    expect(far?.inside).toBe(false)
    expect(far?.difference).toBeCloseTo(50, 10)
    expect(few?.tournament?.games).toBe(10)
    expect(few?.inside).toBeNull()
    expect(never).toMatchObject({ tournament: null, difference: null, inside: null })
  })

  it('sums up only the pairings with enough tournament games', () => {
    expect(report.compared).toBe(2)
    expect(report.inside).toBe(1)
    expect(report.meanAbsDifference).toBeCloseTo(27.5, 10)
    // Two pairs are too few for a correlation.
    expect(report.rankCorrelation).toBeNull()
    expect(report.minTournamentGames).toBe(20)
  })

  it('contrasts each archetype against the rest of the bank, weighted by share, from both sides', () => {
    const gyarados = report.archetypes.find((row) => row.id === 'gyarados')
    // Simulated: 60 % against Darkrai (weight 15) and 80 % against Venusaur (weight 10).
    expect(gyarados?.simulated).toBeCloseTo((60 * 15 + 80 * 10) / 25, 10)
    expect(gyarados?.tournament).toBeCloseTo((55 * 15 + 30 * 10) / 25, 10)
    expect(gyarados?.rivalsWithData).toBe(2)
    const venusaur = report.archetypes.find((row) => row.id === 'venusaur')
    // B's side: 20 % against Gyarados and 50 % against Darkrai; tournaments only count Gyarados (Darkrai has 10 games).
    expect(venusaur?.simulated).toBeCloseTo((20 * 20 + 50 * 15) / 35, 10)
    expect(venusaur?.tournament).toBeCloseTo(70, 10)
    const mew = report.archetypes.find((row) => row.id === 'mew')
    expect(mew).toMatchObject({ tournament: null, rivalsWithData: 0 })
    expect(mew?.simulated).toBeCloseTo(70, 10)
  })
})
