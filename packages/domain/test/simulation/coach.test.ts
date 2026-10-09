import { describe, expect, it } from 'vitest'
import {
  COACH_THRESHOLDS,
  coachContext,
  coachSummary,
  coachVerdict,
  parseCoachScores,
  reviewChoice,
} from '../../src/simulation/coach.js'

// A real decision of engine-cli play with the coach (Mega Altaria ex vs Mega Blaziken ex, seed 12345, ply 1).
const REAL = { scores: [-1448.9, -1329.9, 27.1, -662.9, -616.5, -1328.9], best: 2 }
const TEXTS = ['Place(Swablu, 0)', 'Place(Chingling, 0)', 'Place(Jirachi, 0)', 'a', 'b', 'c']

describe('coach verdicts (Fase 20)', () => {
  it('the gap against the best option decides it', () => {
    expect(coachVerdict(0, true)).toBe('best')
    expect(coachVerdict(500, true)).toBe('best')
    expect(coachVerdict(0, false)).toBe('best') // a tie with the best
    expect(coachVerdict(COACH_THRESHOLDS.close - 1, false)).toBe('close')
    expect(coachVerdict(COACH_THRESHOLDS.close, false)).toBe('inaccuracy')
    expect(coachVerdict(COACH_THRESHOLDS.inaccuracy, false)).toBe('mistake')
    expect(coachVerdict(COACH_THRESHOLDS.mistake - 1, false)).toBe('mistake')
    expect(coachVerdict(COACH_THRESHOLDS.mistake, false)).toBe('blunder')
    expect(coachVerdict(20_000, false)).toBe('blunder')
  })

  it('a review: gap, rank among the options and both texts', () => {
    const chosen = reviewChoice({ ply: 1, turn: 0, coach: REAL, chosen: 0, texts: TEXTS })
    expect(chosen).toMatchObject({
      options: 6,
      chosen: 0,
      best: 2,
      chosenText: 'Place(Swablu, 0)',
      bestText: 'Place(Jirachi, 0)',
      gap: 1476,
      rank: 6,
      verdict: 'mistake',
      hinted: false,
    })
    expect(reviewChoice({ ply: 1, turn: 0, coach: REAL, chosen: 2, texts: TEXTS, hinted: true })).toMatchObject({
      gap: 0,
      rank: 1,
      verdict: 'best',
      hinted: true,
    })
    expect(reviewChoice({ ply: 1, turn: 0, coach: REAL, chosen: 4, texts: TEXTS })).toMatchObject({
      gap: 643.6,
      rank: 2,
      verdict: 'inaccuracy',
    })
  })

  it('the summary: agreement, hints and the three costliest choices', () => {
    const coach = { scores: [0, -50, -500, -2000, -9000, -30000], best: 0 }
    const reviews = [0, 1, 2, 3, 4, 5, 0].map((chosen, i) =>
      reviewChoice({ ply: i + 1, turn: i, coach, chosen, texts: TEXTS, hinted: i === 0 }),
    )
    const summary = coachSummary(reviews)
    expect(summary.decisions).toBe(7)
    expect(summary.counts).toEqual({ best: 2, close: 1, inaccuracy: 1, mistake: 1, blunder: 2 })
    expect(summary.agreement).toBeCloseTo((3 / 7) * 100, 10)
    expect(summary.hints).toBe(1)
    expect(summary.worst.map((review) => review.gap)).toEqual([30000, 9000, 2000])
    expect(coachSummary([])).toMatchObject({ decisions: 0, agreement: 0, worst: [] })
  })

  it('keeps the actions and the cards in play so the app can name them', () => {
    const state = {
      players: [{ in_play: [{ card: 'A1 033' }, null, null, null] }, { in_play: [{ card: 'B1 102' }] }],
      stadium: null,
    }
    const ctx = coachContext(state)
    expect(ctx).toEqual({ in_play: [['A1 033', null, null, null], ['B1 102']], stadium: null })
    const review = reviewChoice({
      ply: 3,
      turn: 4,
      coach: REAL,
      chosen: 0,
      texts: TEXTS,
      actions: ['EndTurn', 'x', { Attack: 1 }],
      ctx,
    })
    expect(review).toMatchObject({ chosenAction: 'EndTurn', bestAction: { Attack: 1 }, ctx })
    expect(coachContext(null)).toBeNull()
    expect(coachContext({ players: 'x' })).toBeNull()
  })

  it('parses what the engine sends, and nothing else', () => {
    expect(parseCoachScores(REAL)).toEqual(REAL)
    expect(parseCoachScores(null)).toBeNull()
    expect(parseCoachScores({ scores: [1, 2], best: 2 })).toBeNull()
    expect(parseCoachScores({ scores: [1, 'x'], best: 0 })).toBeNull()
    expect(parseCoachScores({ scores: [1, 2] })).toBeNull()
  })
})
