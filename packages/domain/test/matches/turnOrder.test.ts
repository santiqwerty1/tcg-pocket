import { describe, expect, it } from 'vitest'
import { opponentTurns, TURN_ORDER_MIN, turnOrderImpact } from '../../src/matches/turnOrder.js'
import type { MatchResult } from '../../src/matches/types.js'

const games = (wentFirst: boolean | null, wins: number, losses: number, ties = 0, opponent: string | null = null) => [
  ...Array.from({ length: wins }, () => ({ result: 'win' as MatchResult, wentFirst, opponent })),
  ...Array.from({ length: losses }, () => ({ result: 'loss' as MatchResult, wentFirst, opponent })),
  ...Array.from({ length: ties }, () => ({ result: 'tie' as MatchResult, wentFirst, opponent })),
]

describe('¿importa empezar? (Fase 25)', () => {
  it('too few matches on a side: says how many are missing', () => {
    const impact = turnOrderImpact([...games(true, 3, 1), ...games(false, 10, 10), ...games(null, 2, 2)])
    expect(impact).toMatchObject({
      first: { wins: 3, losses: 1, ties: 0 },
      second: { wins: 10, losses: 10, ties: 0 },
      unknown: 4,
      verdict: 'few',
      z: null,
      p: null,
    })
    expect(impact.coverage).toBeCloseTo((24 / 28) * 100, 10)
    expect(impact.text).toContain(`hacen falta ${TURN_ORDER_MIN} partidas`)
    expect(impact.text).toContain('(tenés 4 y 20)')
  })

  it('a clear gap: 18 of 25 going first against 8 of 25 going second', () => {
    const impact = turnOrderImpact([...games(true, 18, 7), ...games(false, 8, 17)])
    expect(impact.verdict).toBe('clear')
    expect(impact.gap).toBeCloseTo(40, 10)
    // Pooled p = 26/50: se = sqrt(.52·.48·(2/25)) ≈ .1413, z ≈ 2.83.
    expect(impact.z).toBeCloseTo(0.4 / Math.sqrt(0.52 * 0.48 * (2 / 25)), 10)
    // H-011: the verdict is Fisher's exact test.
    expect(impact.p).toBeGreaterThan(0)
    expect(impact.p).toBeLessThan(0.05)
    expect(impact.text).toBe(
      'Empezando ganás el 72\u00a0% (n = 25) y yendo segundo el 32\u00a0% (n = 25): 40 puntos más empezando, más de lo que explica el azar.',
    )
  })

  it('phone review: one decimal, as the rates next to it (16 of 33 is 48,5\u00a0%, not 48\u00a0%)', () => {
    const impact = turnOrderImpact([...games(true, 16, 14, 3), ...games(false, 12, 17, 1)])
    expect(impact.text).toBe(
      'Empezando ganás el 48,5\u00a0% (n = 33) y yendo segundo el 40\u00a0% (n = 30): 8,5 puntos más empezando, pero puede ser azar.',
    )
  })

  it('a small gap is maybe chance; ties count as games not won; better going second', () => {
    const impact = turnOrderImpact([...games(true, 5, 4, 1), ...games(false, 6, 4)])
    expect(impact).toMatchObject({ verdict: 'maybe', firstShare: 50, secondShare: 60 })
    expect(impact.text).toContain('10 puntos más yendo segundo, pero puede ser azar.')
    expect(turnOrderImpact([]).coverage).toBe(0)
  })

  it('H-011: 4 of 6 against 0 of 5 is z = 2,29 but Fisher p ≈ 0,06: maybe chance', () => {
    const impact = turnOrderImpact([...games(true, 4, 2), ...games(false, 0, 5)])
    expect(impact.z).toBeCloseTo(2.29, 2)
    expect(impact.p).toBeCloseTo(0.0606, 3)
    expect(impact.verdict).toBe('maybe')
    expect(impact.text).toContain('pero puede ser azar')
  })

  it('against each rival', () => {
    const turns = opponentTurns([
      ...games(true, 2, 1, 0, 'Mega Lucario ex'),
      ...games(false, 0, 2, 0, 'mega-lucario ex'),
      ...games(null, 1, 0, 0, 'Hoopa ex'),
    ])
    expect([...turns]).toEqual([
      ['mega lucario ex', { first: { wins: 2, losses: 1, ties: 0 }, second: { wins: 0, losses: 2, ties: 0 } }],
    ])
  })
})
