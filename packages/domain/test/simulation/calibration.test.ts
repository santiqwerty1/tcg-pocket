import { describe, expect, it } from 'vitest'
import {
  averageRanks,
  type CalibrationPairing,
  calibrationReport,
  mixListRecords,
  spearman,
} from '../../src/simulation/index.js'
import type { GameRecord } from '../../src/stats/rates.js'

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
    expect(tied).toMatchObject({ n: 5, method: 'fisher' })
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

/** Every pairing of the archetypes with 200 simulated games and `tour` tournament games, A's chance by strength. */
function bank(rates: Record<string, number>, tour: number): CalibrationPairing[] {
  const ids = Object.keys(rates)
  const out: CalibrationPairing[] = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i] as string, ids[j] as string]
      const p = Math.min(0.95, Math.max(0.05, 0.5 + ((rates[a] as number) - (rates[b] as number)) / 100))
      const wins = Math.round(200 * p)
      out.push({
        a,
        b,
        labelA: a,
        labelB: b,
        simulated: { wins, losses: 200 - wins, ties: 3 },
        tournament: { wins: tour * p, losses: tour * (1 - p) },
      })
    }
  }
  return out
}

describe('calibration report', () => {
  const pairings: CalibrationPairing[] = [
    // Close to tournaments: 60 % against 55 % over 100 games, compatible.
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
    // Too few tournament games to judge: shown, left out of the summary and of the archetype means.
    {
      a: 'darkrai',
      b: 'venusaur',
      labelA: 'Darkrai ex',
      labelB: 'Mega Venusaur ex',
      simulated: { wins: 50, losses: 50, ties: 0 },
      tournament: { wins: 5.5, losses: 4.5 },
    },
    // Never met in tournaments: an archetype of the bank without tournament data.
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

  it('keeps each side apart, per game and without ties; the difference has an interval with both errors', () => {
    const [close, far, few, never] = report.rows
    expect(close?.simulated).toMatchObject({ source: 'simulation', value: 60, games: 100 })
    expect(close?.ties).toBe(5)
    expect(close?.tournament).toMatchObject({ source: 'tournament', games: 100 })
    expect(close?.difference).toBeCloseTo(5, 10)
    const [lo, hi] = close?.differenceCi95 ?? [Number.NaN, Number.NaN]
    // Both sides have ~5 points of error: the interval of the difference is about ±14 points.
    expect(hi - lo).toBeGreaterThan(25)
    expect(hi - lo).toBeLessThan(30)
    expect(close?.compatible).toBe(true)
    expect(far?.compatible).toBe(false)
    expect(far?.difference).toBeCloseTo(50, 10)
    // The interval of a difference stays within ±100 points, however few the games.
    const tiny = calibrationReport([
      {
        a: 'x',
        b: 'y',
        labelA: 'X',
        labelB: 'Y',
        simulated: { wins: 0, losses: 3, ties: 0 },
        tournament: { wins: 2, losses: 0 },
      },
    ]).rows[0]
    expect(tiny?.differenceCi95?.[0]).toBeGreaterThanOrEqual(-100)
    expect(tiny?.differenceCi95?.[1]).toBeLessThanOrEqual(100)
    expect(few?.tournament?.games).toBe(10)
    expect(few?.compatible).toBeNull()
    expect(few?.differenceCi95).not.toBeNull()
    expect(never).toMatchObject({ tournament: null, difference: null, differenceCi95: null, compatible: null })
  })

  it('counts compatibility with the simulation’s error too: more tournament games do not make a good bot fail', () => {
    // The simulated rate exactly at the tournament's: compatible with 20 tournament games and with 2.000.
    const exact = (tour: number): CalibrationPairing => ({
      a: 'x',
      b: 'y',
      labelA: 'X',
      labelB: 'Y',
      simulated: { wins: 110, losses: 90, ties: 0 },
      tournament: { wins: tour * 0.55, losses: tour * 0.45 },
    })
    expect(calibrationReport([exact(20)]).rows[0]?.compatible).toBe(true)
    expect(calibrationReport([exact(2000)]).rows[0]?.compatible).toBe(true)
    // 5 points off with 200 simulated games is within the simulation's own error even against 2.000 tournament games.
    const off = { ...exact(2000), tournament: { wins: 2000 * 0.5, losses: 2000 * 0.5 } }
    expect(calibrationReport([off]).rows[0]?.compatible).toBe(true)
  })

  it('sums up only the pairings with enough tournament games', () => {
    expect(report.compared).toBe(2)
    expect(report.compatible).toBe(1)
    expect(report.meanAbsDifference).toBeCloseTo(27.5, 10)
    expect(report.minTournamentGames).toBe(20)
  })

  it('averages each archetype over the same rivals on both sides, with n and an interval', () => {
    const gyarados = report.archetypes.find((row) => row.id === 'gyarados')
    // Both rivals have 100 tournament games: Darkrai (weight 15) and Venusaur (weight 10).
    expect(gyarados?.rivals).toBe(2)
    expect(gyarados?.simulated?.value).toBeCloseTo((60 * 15 + 80 * 10) / 25, 10)
    expect(gyarados?.tournament?.value).toBeCloseTo((55 * 15 + 30 * 10) / 25, 10)
    expect(gyarados?.simulated?.games).toBe(200)
    expect(gyarados?.tournament?.games).toBe(200)
    const [lo, hi] = gyarados?.simulated?.ci95 ?? [Number.NaN, Number.NaN]
    expect(lo).toBeLessThan(gyarados?.simulated?.value as number)
    expect(hi).toBeGreaterThan(gyarados?.simulated?.value as number)
    // Venusaur's only rival with enough tournament games is Gyarados: Darkrai (10 games) is out of both columns.
    const venusaur = report.archetypes.find((row) => row.id === 'venusaur')
    expect(venusaur?.rivals).toBe(1)
    expect(venusaur?.simulated?.value).toBeCloseTo(20, 10)
    expect(venusaur?.tournament?.value).toBeCloseTo(70, 10)
    // Mew never met anyone in tournaments: nothing on either side.
    expect(report.archetypes.find((row) => row.id === 'mew')).toMatchObject({
      simulated: null,
      tournament: null,
      rivals: 0,
    })
  })

  it('correlates the pairings both ways, so it does not depend on which side each was played from', () => {
    const rates = { a: 70, b: 55, c: 50, d: 40, e: 30, f: 20 }
    const straight = calibrationReport(bank(rates, 100))
    const turned = calibrationReport(
      bank(rates, 100).map((pairing) => ({
        ...pairing,
        a: pairing.b,
        b: pairing.a,
        labelA: pairing.labelB,
        labelB: pairing.labelA,
        simulated: { wins: pairing.simulated.losses, losses: pairing.simulated.wins, ties: pairing.simulated.ties },
        tournament: pairing.tournament && { wins: pairing.tournament.losses, losses: pairing.tournament.wins },
      })),
    )
    expect(straight.rankCorrelation?.rho).toBeCloseTo(turned.rankCorrelation?.rho as number, 10)
    expect(straight.rankCorrelation).toMatchObject({ n: 30, method: 'bootstrap' })
    expect(straight.rankCorrelation?.rho).toBeGreaterThan(0.95)
    const [lo, hi] = straight.rankCorrelation?.ci95 ?? [Number.NaN, Number.NaN]
    expect(lo).toBeLessThanOrEqual(straight.rankCorrelation?.rho as number)
    expect(hi).toBeLessThanOrEqual(1)
    // The bootstrap is seeded: the same report, the same interval.
    expect(calibrationReport(bank(rates, 100)).rankCorrelation?.ci95).toEqual(straight.rankCorrelation?.ci95)
    // A bot that gets the order wrong shows it.
    const wrong = bank(rates, 100).map((pairing) => ({
      ...pairing,
      simulated: { wins: pairing.simulated.losses, losses: pairing.simulated.wins, ties: 0 },
    }))
    expect(calibrationReport(wrong).rankCorrelation?.rho).toBeLessThan(-0.95)
    expect(straight.archetypeCorrelation?.rho).toBeCloseTo(1, 10)
    // The archetypes' correlation too: its points share pairings, so the same bootstrap over archetypes.
    expect(straight.archetypeCorrelation).toMatchObject({ n: 6, method: 'bootstrap' })
    const [aLo, aHi] = straight.archetypeCorrelation?.ci95 ?? [Number.NaN, Number.NaN]
    expect(aLo).toBeLessThanOrEqual(1)
    expect(aHi).toBeLessThanOrEqual(1)
    expect(aLo).toBeLessThanOrEqual(aHi)
    expect(calibrationReport(bank(rates, 100)).archetypeCorrelation?.ci95).toEqual(straight.archetypeCorrelation?.ci95)
    // Below 5 archetypes there is no interval.
    const four = calibrationReport(bank({ a: 70, b: 50, c: 40, d: 20 }, 100)).archetypeCorrelation
    expect(four).toMatchObject({ n: 4, ci95: null, method: 'bootstrap' })
  })
})

describe('calibrationReport with the games played (review of #44)', () => {
  it('shows the games the lists played, and keeps the interval of the scaled record', () => {
    // Two lists, 200 games each, at 10 % and 90 %: the mixture's record is worth about 1.073 games.
    const mixed = mixListRecords([
      { record: { wins: 20, losses: 180, ties: 0 }, weight: 0.5 },
      { record: { wins: 180, losses: 20, ties: 0 }, weight: 0.5 },
    ]) as GameRecord
    expect(mixed.wins + mixed.losses).toBeGreaterThan(400)
    const pairing = { a: 'x', b: 'y', labelA: 'X', labelB: 'Y', simulated: mixed, tournament: null }
    const [scaled] = calibrationReport([pairing]).rows
    const [played] = calibrationReport([{ ...pairing, simulatedGames: 400 }]).rows
    expect(played?.simulated).toMatchObject({ games: 400, samples: 400, orientative: false })
    expect(played?.simulated?.value).toBe(scaled?.simulated?.value)
    expect(played?.simulated?.ci95).toEqual(scaled?.simulated?.ci95)
    expect(scaled?.simulated?.games).toBeGreaterThan(400)
    // The per-archetype table says the same games for that pair (review of #67).
    const compared = calibrationReport([{ ...pairing, simulatedGames: 400, tournament: { wins: 30, losses: 20 } }])
    expect(compared.archetypes.map((row) => [row.id, row.simulated?.games, row.tournament?.games])).toEqual([
      ['x', 400, 50],
      ['y', 400, 50],
    ])
  })

  it('a lopsided mixture stays «orientativo» by its effective games, however many were played', () => {
    // 10 games of a list that weighs 95 % and 100 of one that weighs 5 %: 110 played, worth far fewer.
    const lopsided = mixListRecords([
      { record: { wins: 5, losses: 5, ties: 0 }, weight: 0.95 },
      { record: { wins: 50, losses: 50, ties: 0 }, weight: 0.05 },
    ]) as GameRecord
    expect(lopsided.wins + lopsided.losses).toBeLessThan(30)
    const pairing = {
      a: 'x',
      b: 'y',
      labelA: 'X',
      labelB: 'Y',
      simulated: lopsided,
      simulatedGames: 110,
      tournament: { wins: 30, losses: 20 },
    }
    const report = calibrationReport([pairing])
    expect(report.rows[0]?.simulated).toMatchObject({ games: 110, orientative: true })
    expect(report.archetypes[0]?.simulated).toMatchObject({ games: 110, orientative: true })
  })
})

describe('mixListRecords', () => {
  it('one list: its record as it is', () => {
    expect(mixListRecords([{ record: { wins: 30, losses: 20, ties: 2 }, weight: 0.4 }])).toEqual({
      wins: 30,
      losses: 20,
      ties: 2,
    })
    expect(mixListRecords([])).toBeNull()
  })

  it('two lists: the rate weighted by their parts, and about twice the games when they agree', () => {
    const same = mixListRecords([
      { record: { wins: 60, losses: 40, ties: 0 }, weight: 0.5 },
      { record: { wins: 60, losses: 40, ties: 1 }, weight: 0.5 },
    ]) as { wins: number; losses: number; ties: number }
    expect(same.wins / (same.wins + same.losses)).toBeCloseTo(0.6, 10)
    expect(same.wins + same.losses).toBeCloseTo(200, 0)
    expect(same.ties).toBe(1)
    const split = mixListRecords([
      { record: { wins: 80, losses: 20, ties: 0 }, weight: 0.75 },
      { record: { wins: 40, losses: 60, ties: 0 }, weight: 0.25 },
    ]) as { wins: number; losses: number }
    expect(split.wins / (split.wins + split.losses)).toBeCloseTo(0.75 * 0.8 + 0.25 * 0.4, 10)
    // A lopsided mixture is worth fewer games than the two lists together.
    expect(split.wins + split.losses).toBeLessThan(200)
  })
})
