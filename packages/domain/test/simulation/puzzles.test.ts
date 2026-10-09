import { describe, expect, it } from 'vitest'
import { gradeAnswer, puzzleRank, puzzleSpots } from '../../src/simulation/puzzles.js'

// Shapes of engine-cli play replays with the coach: the owner is seat 0; scores only on the owner's decisions.
const steps = [
  { turn: 0, actor: 0, options: ['a', 'b'], chosen: 0, scores: [27.1, -1448.9] },
  { turn: 0, actor: 1, options: ['x', 'y'], chosen: 1, scores: null },
  { turn: 1, actor: 0, options: ['EndTurn'], chosen: 0 },
  { turn: 1, actor: 0, options: ['EndTurn', 'Poké Ball', 'Place'], chosen: 0, scores: [-1300, 1900, 100] },
  { turn: 3, actor: 0, options: ['EndTurn', 'Attack'], chosen: 0, scores: [0, 12_000] },
  { turn: 5, actor: 0, options: ['EndTurn', 'Attack'], chosen: 1, scores: [-50, 0] },
  { turn: 7, actor: 0, options: ['EndTurn', 'Retreat'], chosen: 0, scores: [0, 400] },
  { turn: 9, actor: 0, options: ['a', 'b', 'c'], chosen: 0, scores: [1, 2] },
]

describe('situaciones para resolver (Fase 24)', () => {
  it('the owner decisions that cost a «Peor» or worse, with their decision number', () => {
    expect(puzzleSpots(steps)).toEqual([
      { step: 3, ply: 2, turn: 1, options: 3, chosen: 0, best: 1, gap: 3200, verdict: 'mistake' },
      { step: 4, ply: 3, turn: 3, options: 2, chosen: 0, best: 1, gap: 12000, verdict: 'blunder' },
    ])
    // A lower bar brings «Un poco peor» too; a step without scores never counts.
    expect(puzzleSpots(steps, 100).map((spot) => spot.step)).toEqual([3, 4, 6])
    expect(puzzleSpots([])).toEqual([])
  })

  it('an answer is graded like the game: the best or close solves it', () => {
    expect(gradeAnswer([-1300, 1900, 100], 1)).toEqual({ best: 1, gap: 0, rank: 1, verdict: 'best', solved: true })
    expect(gradeAnswer([-1300, 1900, 1850], 2)).toMatchObject({ verdict: 'close', solved: true, rank: 2 })
    expect(gradeAnswer([-1300, 1900, 100], 2)).toMatchObject({ verdict: 'mistake', gap: 1800, solved: false })
    expect(gradeAnswer([-1300, 1900, 100], 0)).toMatchObject({ verdict: 'mistake', rank: 3, solved: false })
  })

  it('practice order: never tried, failed, solved', () => {
    expect(puzzleRank(undefined)).toBe(0)
    expect(puzzleRank({ attempts: 0, solved: false, lastAt: null })).toBe(0)
    expect(puzzleRank({ attempts: 2, solved: false, lastAt: new Date() })).toBe(1)
    expect(puzzleRank({ attempts: 1, solved: true, lastAt: new Date() })).toBe(2)
  })
})
