import { describe, expect, it } from 'vitest'
import { type BuiltInGameDeck, canMarkBuiltInGame, countBuiltInGame, MAX_BUILT_IN_GAME } from '../../src/decks/index.js'

function decks(built: number, extra: Partial<BuiltInGameDeck>[] = []): BuiltInGameDeck[] {
  const list: BuiltInGameDeck[] = Array.from({ length: built }, (_, i) => ({ id: `d${i + 1}`, builtInGame: true }))
  return [...list, ...extra.map((e, i) => ({ id: `x${i + 1}`, builtInGame: false, ...e }))]
}

describe('canMarkBuiltInGame', () => {
  it('allows up to 25 built decks and rejects the 26th with a Spanish reason', () => {
    expect(MAX_BUILT_IN_GAME).toBe(25)
    expect(canMarkBuiltInGame(decks(24, [{ id: 'new' }]), 'new')).toEqual({
      ok: true,
      built: 24,
      max: 25,
      message: null,
    })
    const full = canMarkBuiltInGame(decks(25, [{ id: 'new' }]), 'new')
    expect(full.ok).toBe(false)
    expect(full.built).toBe(25)
    expect(full.message).toBe('Ya hay 25 mazos armados en el juego (máximo 25); desarmá o archivá uno antes')
  })

  it('archiving a built deck frees a slot; an already built deck is not counted against itself', () => {
    const list = decks(25, [{ id: 'new' }])
    const archived = list.map((d) => (d.id === 'd1' ? { ...d, archivedAt: new Date('2026-10-06') } : d))
    expect(canMarkBuiltInGame(archived, 'new').ok).toBe(true)
    expect(countBuiltInGame(archived)).toBe(24)
    const unbuilt = list.map((d) => (d.id === 'd1' ? { ...d, builtInGame: false } : d))
    expect(canMarkBuiltInGame(unbuilt, 'new').ok).toBe(true)
    expect(canMarkBuiltInGame(list, 'd7')).toEqual({ ok: true, built: 24, max: 25, message: null })
    expect(canMarkBuiltInGame(decks(25), 'unknown').ok).toBe(false)
    expect(canMarkBuiltInGame([], 'solo').ok).toBe(true)
  })
})
