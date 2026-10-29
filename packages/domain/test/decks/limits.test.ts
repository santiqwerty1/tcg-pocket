import { describe, expect, it } from 'vitest'
import { type BuiltInGameDeck, canMarkBuiltInGame, countBuiltInGame, MAX_BUILT_IN_GAME } from '../../src/decks/index.js'

function decks(built: number, extra: Partial<BuiltInGameDeck>[] = []): BuiltInGameDeck[] {
  const list: BuiltInGameDeck[] = Array.from({ length: built }, (_, i) => ({ id: `d${i + 1}`, builtInGame: true }))
  return [...list, ...extra.map((e, i) => ({ id: `x${i + 1}`, builtInGame: false, ...e }))]
}

describe('canMarkBuiltInGame', () => {
  it('allows up to 30 built decks and rejects the 31st with a Spanish reason', () => {
    expect(MAX_BUILT_IN_GAME).toBe(30)
    expect(canMarkBuiltInGame(decks(29, [{ id: 'new' }]), 'new')).toEqual({
      ok: true,
      built: 29,
      max: 30,
      message: null,
    })
    const full = canMarkBuiltInGame(decks(30, [{ id: 'new' }]), 'new')
    expect(full.ok).toBe(false)
    expect(full.built).toBe(30)
    expect(full.message).toBe('Ya hay 30 mazos armados en el juego (máximo 30); desarmá o archivá uno antes')
  })

  it('archiving a built deck frees a slot; an already built deck is not counted against itself', () => {
    const list = decks(30, [{ id: 'new' }])
    const archived = list.map((d) => (d.id === 'd1' ? { ...d, archivedAt: new Date('2026-10-06') } : d))
    expect(canMarkBuiltInGame(archived, 'new').ok).toBe(true)
    expect(countBuiltInGame(archived)).toBe(29)
    const unbuilt = list.map((d) => (d.id === 'd1' ? { ...d, builtInGame: false } : d))
    expect(canMarkBuiltInGame(unbuilt, 'new').ok).toBe(true)
    expect(canMarkBuiltInGame(list, 'd7')).toEqual({ ok: true, built: 29, max: 30, message: null })
    expect(canMarkBuiltInGame(decks(30), 'unknown').ok).toBe(false)
    expect(canMarkBuiltInGame([], 'solo').ok).toBe(true)
  })
})
