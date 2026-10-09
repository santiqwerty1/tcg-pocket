import { describe, expect, it } from 'vitest'
import {
  checkPerGame,
  PER_GAME_WORKER_VERSION,
  type PerGameResults,
  perGameEntries,
  readPerGame,
  wantsPerGame,
} from '../../src/simulation/index.js'

/** The first 10 games of a real engine-cli run (e2 vs e2, deckgym's Blastoise ex against its fire deck). */
const SAMPLE: PerGameResults = {
  winners: 'AAABBAABAA',
  starters: 'BAAAABBABA',
  endings: 'PPPPPPPPPP',
  turns: [12, 13, 11, 12, 16, 12, 10, 12, 12, 13],
  stagesA: '2221122022',
  stagesB: '1001111111',
}
const TALLY = { games: 10, winsA: 7, winsB: 3, ties: 0 }

describe('per-game results of a chunk', () => {
  it('a job asks for them with params.perGame, and only workers from 0.2.5 on play it', () => {
    expect(wantsPerGame({ sideA: [1], perGame: true })).toBe(true)
    expect(wantsPerGame({ sideA: [1] })).toBe(false)
    expect(wantsPerGame({ perGame: 'yes' })).toBe(false)
    expect(wantsPerGame(null)).toBe(false)
    expect(PER_GAME_WORKER_VERSION).toBe('0.2.5')
  })

  it('accepts what the engine wrote when it matches the tallies', () => {
    expect(checkPerGame(SAMPLE, TALLY)).toBeNull()
  })

  it('refuses a wrong length, a stray letter, tallies that do not add up and a tie that ends on points', () => {
    expect(checkPerGame(undefined, TALLY)).toMatch(/falta perGame/)
    expect(checkPerGame({ ...SAMPLE, winners: 'AAAB' }, TALLY)).toMatch(/winners/)
    expect(checkPerGame({ ...SAMPLE, starters: 'BAAAABBABX' }, TALLY)).toMatch(/starters/)
    expect(checkPerGame({ ...SAMPLE, turns: [1, 2] }, TALLY)).toMatch(/turns/)
    expect(checkPerGame(SAMPLE, { ...TALLY, winsA: 6, winsB: 4 })).toMatch(/no coincide/)
    const tie = { ...SAMPLE, winners: 'TAABBAABAA', endings: 'PPPPPPPPPP' }
    expect(checkPerGame(tie, { games: 10, winsA: 6, winsB: 3, ties: 1 })).toMatch(/partida 0/)
    const limit = { ...tie, endings: 'LPPPPPPPPP', turns: [31, ...SAMPLE.turns.slice(1)] }
    expect(checkPerGame(limit, { games: 10, winsA: 6, winsB: 3, ties: 1 })).toBeNull()
    const win = { ...SAMPLE, endings: 'LPPPPPPPPP' }
    expect(checkPerGame(win, TALLY)).toMatch(/partida 0/)
  })

  it('reads them back from a chunk’s extra, and decodes each game', () => {
    expect(readPerGame({ perGame: SAMPLE })).toEqual(SAMPLE)
    expect(readPerGame({ combinations: [] })).toBeNull()
    expect(readPerGame(null)).toBeNull()
    expect(readPerGame({ perGame: { ...SAMPLE, stagesB: '1' } })).toBeNull()
    const games = perGameEntries(SAMPLE)
    expect(games).toHaveLength(10)
    expect(games[0]).toEqual({
      index: 0,
      winner: 'a',
      starter: 'b',
      ending: 'points',
      turns: 12,
      stageA: 2,
      stageB: 1,
    })
    expect(games[4]).toMatchObject({ winner: 'b', starter: 'a', turns: 16, stageA: 1 })
    expect(games.filter((game) => game.winner === 'a')).toHaveLength(7)
  })
})
