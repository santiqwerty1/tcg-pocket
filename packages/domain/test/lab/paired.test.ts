import { describe, expect, it } from 'vitest'
import {
  differenceVerdict,
  metaScore,
  pairedDifference,
  pairedWinner,
  perGameSummary,
  scoreDifference,
} from '../../src/lab/index.js'
import type { PerGameEntry } from '../../src/simulation/index.js'

const games = (wins: number, total: number) => Array.from({ length: total }, (_, i) => (i < wins ? 1 : 0))

describe('paired difference (H-010 with perGame)', () => {
  it('two lists that agree on most games: the difference is sharper than two independent scores', () => {
    // 200 games: the same 100 wins for both, plus 10 games only the variant wins.
    const base = games(100, 200)
    const variant = base.map((win, i) => (i >= 100 && i < 110 ? 1 : win))
    const paired = pairedDifference([{ weight: 1, a: variant, b: base }])
    if (!paired) throw new Error('no difference')
    expect(paired.value).toBeCloseTo(5, 8)
    const independent = scoreDifference(
      metaScore([{ weight: 1, record: { wins: 110, losses: 90, ties: 0 } }]) as never,
      metaScore([{ weight: 1, record: { wins: 100, losses: 100, ties: 0 } }]) as never,
    )
    expect(paired.se).toBeLessThan(independent.se / 2)
    expect(differenceVerdict(paired, 1.645)).toBe('better')
    expect(differenceVerdict(independent, 1.645)).toBe('unclear')
  })

  it('identical games keep some uncertainty; rivals weigh by their share; no games, no difference', () => {
    const same = pairedDifference([{ weight: 1, a: games(5, 10), b: games(5, 10) }])
    expect(same?.value).toBe(0)
    expect(same?.se).toBeGreaterThan(0)
    const weighted = pairedDifference([
      { weight: 3, a: games(10, 10), b: games(0, 10) },
      { weight: 1, a: games(0, 10), b: games(0, 10) },
    ])
    expect(weighted?.value).toBeCloseTo(75, 8)
    expect(pairedDifference([{ weight: 1, a: [], b: [] }])).toBeNull()
  })

  it('the screen keeps the best complete candidate past z', () => {
    const d = (value: number, se: number) => ({ value, se, ci95: [value - 2 * se, value + 2 * se] as [number, number] })
    expect(
      pairedWinner(
        [
          { id: 1, difference: d(4, 1), complete: true },
          { id: 2, difference: d(9, 1), complete: false },
          { id: 3, difference: d(6, 2), complete: true },
        ],
        1,
      ),
    ).toBe(3)
    expect(pairedWinner([{ id: 1, difference: d(1, 2), complete: true }], 1)).toBeNull()
  })
})

describe('what the games say (T-017 A2)', () => {
  it('first and second, how the losses ended, how far it evolved', () => {
    const entry = (over: Partial<PerGameEntry>): PerGameEntry => ({
      index: 0,
      winner: 'a',
      starter: 'a',
      ending: 'points',
      turns: 10,
      stageA: 2,
      stageB: 1,
      ...over,
    })
    const summary = perGameSummary([
      entry({}),
      entry({ starter: 'b', winner: 'b', ending: 'no_pokemon', stageA: 0 }),
      entry({ starter: 'b', winner: 'b', ending: 'points', stageA: 1 }),
      entry({ winner: 'tie', ending: 'turn_limit' }),
    ])
    expect(summary).toEqual({
      games: 4,
      first: { wins: 1, games: 2 },
      second: { wins: 0, games: 2 },
      losses: { points: 1, noPokemon: 1 },
      ties: { turnLimit: 1, other: 0 },
      stages: [1, 1, 2],
    })
  })
})
