import { describe, expect, it } from 'vitest'
import {
  checkPerGame,
  PER_GAME_CLI_VERSION,
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
    expect(PER_GAME_CLI_VERSION).toBe('0.2.0')
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

  it('checks the turns: their sum is the chunk’s, and «L» goes with more than 30 turns and only then', () => {
    const mixed: PerGameResults = {
      winners: 'ABTT',
      starters: 'ABAB',
      endings: 'PNLT',
      turns: [12, 9, 31, 20],
      stagesA: '0120',
      stagesB: '1002',
    }
    const tally = { games: 4, winsA: 1, winsB: 1, ties: 2 }
    expect(checkPerGame(mixed, { ...tally, turns: 72 })).toBeNull()
    expect(checkPerGame(mixed, tally)).toBeNull()
    expect(checkPerGame(mixed, { ...tally, turns: 71 })).toMatch(/no suma/)
    expect(checkPerGame({ ...mixed, turns: [12, 9, 30, 20] }, tally)).toMatch(/límite de 30 turnos/)
    // The engine says its limit (0.2.1 on): with 25, 26 turns is the limit and 26 in a tie by points is not.
    expect(checkPerGame({ ...mixed, turnLimit: 25, turns: [12, 9, 26, 20] }, tally)).toBeNull()
    expect(checkPerGame({ ...mixed, turnLimit: 25, turns: [12, 9, 26, 26] }, tally)).toMatch(/límite de 25 turnos/)
    expect(checkPerGame({ ...mixed, turns: [12, 9, 31, 31] }, tally)).toMatch(/partida 3.*límite/)
    expect(checkPerGame({ ...mixed, turns: [12, 9, 31, -1] }, tally)).toMatch(/turns/)
    expect(checkPerGame({ ...mixed, turns: '12,9,31,20' }, tally)).toMatch(/turns/)
    expect(checkPerGame({ ...mixed, endings: 'PNLX' }, tally)).toMatch(/endings/)
    expect(checkPerGame({ ...mixed, winners: 'ABTX' }, tally)).toMatch(/winners/)
    expect(checkPerGame({ ...mixed, stagesA: '01a0' }, tally)).toMatch(/stagesA/)
    expect(checkPerGame([], tally)).toMatch(/winners/)
    expect(perGameEntries(mixed)).toEqual([
      { index: 0, winner: 'a', starter: 'a', ending: 'points', turns: 12, stageA: 0, stageB: 1 },
      { index: 1, winner: 'b', starter: 'b', ending: 'no_pokemon', turns: 9, stageA: 1, stageB: 0 },
      { index: 2, winner: 'tie', starter: 'a', ending: 'turn_limit', turns: 31, stageA: 2, stageB: 0 },
      { index: 3, winner: 'tie', starter: 'b', ending: 'tie', turns: 20, stageA: 0, stageB: 2 },
    ])
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
