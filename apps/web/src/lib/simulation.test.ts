import { describe, expect, it } from 'vitest'
import { decodeSource, encodeSource, formatDuration, multisetCount, progressFraction, retryNote } from './simulation'

describe('simulation helpers', () => {
  it('round-trips sources through the URL of the form', () => {
    const deck = { deckId: '13', energies: ['fire' as const] }
    const list = {
      listKey: '00aabbccddeeff',
      era: 'B4a',
      format: 'NOEX' as const,
      kind: 'group' as const,
      energies: ['darkness' as const],
    }
    expect(encodeSource(deck)).toBe('d:13:fire')
    expect(decodeSource(encodeSource(deck))).toEqual(deck)
    expect(decodeSource(encodeSource(list))).toEqual(list)
    expect(decodeSource('d:7')).toEqual({ deckId: '7' })
    expect(decodeSource('l:not-a-key')).toBeNull()
    expect(decodeSource('x:1')).toBeNull()
    expect(decodeSource('d:7:dragon')).toEqual({ deckId: '7' })
  })

  it('counts optimize combinations like engine-cli (multisets)', () => {
    expect(multisetCount(3, 2)).toBe(6)
    expect(multisetCount(5, 3)).toBe(35)
    expect(multisetCount(0, 2)).toBe(0)
  })

  it('formats durations and progress', () => {
    expect(formatDuration(40)).toBe('40 s')
    expect(formatDuration(5460)).toBe('1 h 31 min')
    expect(formatDuration(3600)).toBe('1 h')
    expect(
      progressFraction({
        progress: {
          totalGames: 400,
          gamesDone: 100,
          chunks: { total: 2, done: 0, running: 1, failed: 0 },
          etaSeconds: null,
        },
      }),
    ).toBe(0.25)
  })
})

describe('retryNote («Reintentar lo que falló»)', () => {
  it('says when an error tied to a game will come back, and names a deckgym bug already reported', () => {
    expect(retryNote([null, 'timeout'])).toBeNull()
    expect(retryNote(['la partida con semilla 12 falló: index out of bounds'])).toMatch(/va a fallar igual/)
    expect(retryNote(['la partida con semilla 14450885746355706057 falló: Active Pokemon should be there'])).toMatch(
      /bcollazo\/deckgym-core#398/,
    )
  })
})
