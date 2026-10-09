import { describe, expect, it } from 'vitest'
import {
  OPTIMIZE_CONFIRM_GAMES,
  OPTIMIZE_CONFIRM_MAX,
  optimizeConfirmationGames,
  optimizeConfirmGamesPerRival,
  optimizeFinalists,
  optimizeRanking,
} from '../../src/simulation/index.js'

/** An engine-cli combination with `wins` of `games` (no ties). */
const combination = (card: string, wins: number, games = 100) => ({
  cards: [card],
  winsA: wins,
  winsB: games - wins,
  ties: 0,
  perEnemy: [{ winsA: wins, winsB: games - wins, ties: 0 }],
})

describe('optimize confirmation (H-011.5)', () => {
  it('takes the best three', () => {
    const ranking = optimizeRanking([60, 70, 50, 65, 40].map((wins, at) => combination(`c${at}`, wins)))
    expect(optimizeFinalists(ranking).map((row) => row.cards[0])).toEqual(['c1', 'c3', 'c0'])
  })

  it('keeps the ones tied with the third, up to five', () => {
    const tied = optimizeRanking([70, 65, 60, 60, 60, 60, 60, 50].map((wins, at) => combination(`c${at}`, wins)))
    const finalists = optimizeFinalists(tied)
    expect(finalists).toHaveLength(OPTIMIZE_CONFIRM_MAX)
    expect(finalists.slice(2).every((row) => row.record.wins === 60)).toBe(true)
    // A tie above the third adds nothing: the third is already in.
    const above = optimizeRanking([70, 70, 60, 50].map((wins, at) => combination(`c${at}`, wins)))
    expect(optimizeFinalists(above)).toHaveLength(3)
  })

  it('compares shares, not wins, when the games differ', () => {
    const ranking = optimizeRanking([combination('a', 80), combination('b', 70), combination('c', 30, 50)])
    const extra = { cards: ['d'], record: { wins: 60, losses: 40, ties: 0 }, perEnemy: [] }
    expect(optimizeFinalists([...ranking, extra]).map((row) => row.cards[0])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('confirms fewer when there are fewer combinations', () => {
    expect(optimizeFinalists(optimizeRanking([combination('a', 50)]))).toHaveLength(1)
    expect(optimizeFinalists([])).toEqual([])
  })

  it('estimates its games: three combinations × rivals × at least 200', () => {
    expect(optimizeConfirmGamesPerRival(50)).toBe(OPTIMIZE_CONFIRM_GAMES)
    expect(optimizeConfirmGamesPerRival(500)).toBe(500)
    expect(optimizeConfirmationGames(10, 4, 50)).toBe(3 * 4 * 200)
    expect(optimizeConfirmationGames(2, 4, 300)).toBe(2 * 4 * 300)
    expect(optimizeConfirmationGames(0, 4, 300)).toBe(0)
  })
})
