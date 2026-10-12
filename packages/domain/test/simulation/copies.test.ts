import { describe, expect, it } from 'vitest'
import { holderLeftMs, paceMsPerGame, pickCopy } from '../../src/simulation/index.js'

describe('repetir los últimos (phase 42)', () => {
  it('what a holder has left: by its pace from finished chunks, by its progress past two rounds, the smaller', () => {
    const unit = { games: 1000, gamesDone: 100, elapsedMs: 600_000, holderCores: 8, holderMsPerGame: null }
    // 100 of 1.000 in 10 minutes: 90 minutes left.
    expect(holderLeftMs(unit)).toBe(5_400_000)
    // Its finished chunks say 1 s a game: 15 minutes left, the smaller.
    expect(holderLeftMs({ ...unit, holderMsPerGame: 1000 })).toBe(900_000)
    // 10 games played with 8 cores: not past two rounds, its progress says nothing; neither does it have a pace.
    expect(holderLeftMs({ ...unit, gamesDone: 10 })).toBeNull()
    expect(holderLeftMs({ ...unit, gamesDone: 0, holderMsPerGame: 2000 })).toBe(2_000_000)
  })

  it('the pace from finished chunks; a duration of 0 says nothing', () => {
    expect(paceMsPerGame([])).toBeNull()
    expect(
      paceMsPerGame([
        { games: 100, durationMs: 50_000 },
        { games: 300, durationMs: 150_000 },
      ]),
    ).toBe(500)
    expect(paceMsPerGame([{ games: 100, durationMs: null }])).toBeNull()
    expect(paceMsPerGame([{ games: 100, durationMs: 0 }])).toBeNull()
  })

  it('the PC copies what the phone plays, never the other way round', () => {
    // The phone: 100 of 1.000 games in 10 minutes with 2 cores (90 minutes left); the PC plays a game in 0.5 s.
    const phone = {
      id: 'phone',
      games: 1000,
      gamesDone: 100,
      elapsedMs: 600_000,
      holderCores: 2,
      holderMsPerGame: null,
    }
    expect(pickCopy([phone], 500)).toBe(phone)
    // The PC, 64 games on 8 cores, 4,5 minutes without saying anything, 0.9 s a game by its finished chunks (about a
    // minute left): the phone, at 150 s a game, never copies it (review of #73).
    const pc = { id: 'pc', games: 64, gamesDone: 0, elapsedMs: 270_000, holderCores: 8, holderMsPerGame: 900 }
    expect(pickCopy([pc], 150_000)).toBeNull()
    // Nor without a pace of the PC: nothing said yet, no copy.
    expect(pickCopy([{ ...pc, holderMsPerGame: null }], 150_000)).toBeNull()
  })

  it('never one about to end; without a pace of the one asking, only one with over 10 minutes; the one with most left', () => {
    const base = { holderCores: 1, holderMsPerGame: null }
    const ending = { ...base, id: 'ending', games: 100, gamesDone: 99, elapsedMs: 990_000 }
    expect(pickCopy([ending], 1)).toBeNull()
    const five = { ...base, id: 'five', games: 100, gamesDone: 50, elapsedMs: 300_000 }
    const twenty = { ...base, id: 'twenty', games: 100, gamesDone: 50, elapsedMs: 1_200_000 }
    expect(pickCopy([five], null)).toBeNull()
    expect(pickCopy([five, twenty], null)).toBe(twenty)
    expect(pickCopy([five, twenty], 100)).toBe(twenty)
  })
})
