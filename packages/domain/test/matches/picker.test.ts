import { describe, expect, it } from 'vitest'
import { orderDecksForPicker, revisionAt } from '../../src/matches/index.js'

describe('orderDecksForPicker', () => {
  it('puts recently played decks first, then built-in-game ones, then the rest by name; archived are left out', () => {
    const decks = [
      { id: '1', name: 'Zoroark', builtInGame: false, archived: false, lastPlayedAt: null },
      { id: '2', name: 'Mega-Blaziken', builtInGame: true, archived: false, lastPlayedAt: null },
      { id: '3', name: 'Ancient', builtInGame: false, archived: false, lastPlayedAt: new Date('2026-10-05') },
      { id: '4', name: 'Beedrill', builtInGame: false, archived: false, lastPlayedAt: new Date('2026-10-06') },
      { id: '5', name: 'Archivado', builtInGame: true, archived: true, lastPlayedAt: new Date('2026-10-07') },
      { id: '6', name: 'Abomasnow', builtInGame: false, archived: false, lastPlayedAt: null },
      { id: '7', name: 'Ábsol', builtInGame: true, archived: false, lastPlayedAt: null },
    ]
    expect(orderDecksForPicker(decks).map((d) => d.id)).toEqual(['4', '3', '7', '2', '6', '1'])
  })

  it('orders numbered deck names naturally (2 before 10)', () => {
    const numbered = ['10. Mega-Kangaskhan ex', '2. Mega-Blaziken ex', '1. Butterfree'].map((name, i) => ({
      id: String(i),
      name,
      builtInGame: false,
      archived: false,
      lastPlayedAt: null,
    }))
    expect(orderDecksForPicker(numbered).map((d) => d.name)).toEqual([
      '1. Butterfree',
      '2. Mega-Blaziken ex',
      '10. Mega-Kangaskhan ex',
    ])
  })
})

describe('revisionAt', () => {
  const revisions = [
    { number: 2, createdAt: new Date('2026-10-05T12:00:00Z') },
    { number: 1, createdAt: new Date('2026-10-01T12:00:00Z') },
    { number: 3, createdAt: new Date('2026-10-06T12:00:00Z') },
  ]

  it('returns the revision current at the time of the match', () => {
    expect(revisionAt(revisions, new Date('2026-10-07T00:00:00Z')).number).toBe(3)
    expect(revisionAt(revisions, new Date('2026-10-06T12:00:00Z')).number).toBe(3)
    expect(revisionAt(revisions, new Date('2026-10-06T11:59:59Z')).number).toBe(2)
    expect(revisionAt(revisions, new Date('2026-10-02T00:00:00Z')).number).toBe(1)
  })

  it('a match dated before the deck existed belongs to revision 1', () => {
    expect(revisionAt(revisions, new Date('2026-09-01T00:00:00Z')).number).toBe(1)
  })

  it('needs at least one revision', () => {
    expect(() => revisionAt([], new Date())).toThrow(RangeError)
  })
})
