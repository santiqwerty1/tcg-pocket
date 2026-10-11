import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/mutate.js'
import { coinAdjustedRate } from '../../src/matches/coinAdjusted.js'
import type { MatchResult } from '../../src/matches/types.js'

const games = (wentFirst: boolean | null, wins: number, losses: number, ties = 0) => [
  ...Array.from({ length: wins }, () => ({ result: 'win' as MatchResult, wentFirst })),
  ...Array.from({ length: losses }, () => ({ result: 'loss' as MatchResult, wentFirst })),
  ...Array.from({ length: ties }, () => ({ result: 'tie' as MatchResult, wentFirst })),
]

describe('win share adjusted by the coin (Fase 44)', () => {
  it('weighs each side by half, whatever the number of matches on each', () => {
    // 15 of 20 going first (75 %), 3 of 10 going second (30 %): plain 60 %, adjusted 52,5 %.
    const rate = coinAdjustedRate([...games(true, 15, 5), ...games(false, 3, 7), ...games(null, 4, 0)])
    expect(rate?.value).toBeCloseTo(52.5, 10)
    expect(rate?.plain).toBeCloseTo(60, 10)
    // 20 and 10 matches a side are worth 26,7 balanced ones (4 / (1/20 + 1/10)), and 10 is under 15: orientative.
    expect(rate).toMatchObject({ games: 30, unknown: 4, orientative: true, firstShare: 75, secondShare: 30 })
    expect(rate?.ci95[0]).toBeLessThan(52.5)
    expect(rate?.ci95[1]).toBeGreaterThan(52.5)
    expect(rate?.text).toBe(
      'Ajustado por la moneda: 52,5 % (n = 30, IC 36,8–69,3 %, orientativo): mitad empezando (75 % en 20) y mitad yendo segundo (30 % en 10). Sin ajustar: 60 %.',
    )
  })

  it('orientative by the sides, not their sum: the balanced size under 30 or a side under 15', () => {
    expect(coinAdjustedRate([...games(true, 20, 10), ...games(false, 12, 18)])?.orientative).toBe(false)
    // 54 matches, but 14 going second.
    expect(coinAdjustedRate([...games(true, 30, 10), ...games(false, 7, 7)])?.orientative).toBe(true)
  })

  it('a tie is a game not won; without a match on each side there is nothing to say', () => {
    expect(coinAdjustedRate([...games(true, 1, 0, 1), ...games(false, 1, 1)])?.value).toBeCloseTo(50, 10)
    expect(coinAdjustedRate(games(true, 5, 5))).toBeNull()
    expect(coinAdjustedRate([...games(null, 5, 5), ...games(false, 2, 2)])).toBeNull()
    expect(coinAdjustedRate([...games(true, 2, 1), ...games(false, 1, 1)])?.orientative).toBe(true)
  })

  it('stays inside 0–100 and keeps the value inside its interval at the edges', () => {
    const all = coinAdjustedRate([...games(true, 3, 0), ...games(false, 2, 0)])
    expect(all?.value).toBe(100)
    expect(all?.ci95[1]).toBe(100)
    expect(all?.ci95[0]).toBeGreaterThan(40)
    const none = coinAdjustedRate([...games(true, 0, 3), ...games(false, 0, 2)])
    expect(none?.ci95[0]).toBe(0)
  })

  it('covers the true adjusted share about 95 % of the time with few matches a side', () => {
    const random = seededRandom(44)
    const truth = { first: 0.6, second: 0.4 }
    let covered = 0
    const runs = 4000
    for (let run = 0; run < runs; run += 1) {
      const draw = (p: number, n: number) => {
        let wins = 0
        for (let i = 0; i < n; i += 1) if (random() < p) wins += 1
        return wins
      }
      const w1 = draw(truth.first, 8)
      const w2 = draw(truth.second, 12)
      const rate = coinAdjustedRate([...games(true, w1, 8 - w1), ...games(false, w2, 12 - w2)])
      const [low, high] = rate?.ci95 ?? [0, 0]
      if (low <= 50 && 50 <= high) covered += 1
    }
    expect(covered / runs).toBeGreaterThan(0.93)
    expect(covered / runs).toBeLessThan(0.99)
  })
})
