import { describe, expect, it } from 'vitest'
import { deckListSearch, deckNeighbors, deckPath, filterDecks, readDeckListFilters } from './deckList'

const decks = [
  { id: '1', builtInGame: true, tags: ['uno-por-tipo'] },
  { id: '2', builtInGame: false, tags: [] },
  { id: '9', builtInGame: true, tags: [] },
  { id: '10', builtInGame: true, tags: ['uno-por-tipo'] },
]

describe('deck list filters in the URL', () => {
  it('reads and writes the same query string', () => {
    const filters = { tag: 'uno por tipo', onlyBuilt: true, archived: true }
    const search = deckListSearch(filters)
    expect(search).toBe('etiqueta=uno+por+tipo&armados=1&archivados=1')
    expect(readDeckListFilters(new URLSearchParams(search))).toEqual(filters)
  })

  it('leaves the URL clean when nothing is filtered', () => {
    expect(deckListSearch({ tag: null, onlyBuilt: false, archived: false })).toBe('')
    expect(readDeckListFilters(new URLSearchParams(''))).toEqual({ tag: null, onlyBuilt: false, archived: false })
    expect(deckPath('13', '')).toBe('/mazos/13')
    expect(deckPath('13', 'armados=1')).toBe('/mazos/13?armados=1')
  })

  it('filters by built and tag', () => {
    expect(filterDecks(decks, { tag: null, onlyBuilt: true, archived: false }).map((d) => d.id)).toEqual([
      '1',
      '9',
      '10',
    ])
    expect(filterDecks(decks, { tag: 'uno-por-tipo', onlyBuilt: false, archived: false }).map((d) => d.id)).toEqual([
      '1',
      '10',
    ])
  })
})

describe('deckNeighbors', () => {
  it('gives the decks around one in the list', () => {
    expect(deckNeighbors(decks, '9')).toEqual({ prev: decks[1], next: decks[3], position: 3, total: 4 })
  })

  it('has no previous deck at the start and no next one at the end', () => {
    expect(deckNeighbors(decks, '1')).toMatchObject({ prev: null, next: decks[1], position: 1 })
    expect(deckNeighbors(decks, '10')).toMatchObject({ prev: decks[2], next: null, position: 4 })
  })

  it('keeps the place by number of a deck that left the list (numeric order: 9 before 10)', () => {
    const built = filterDecks(decks, { tag: null, onlyBuilt: true, archived: false })
    expect(deckNeighbors(built, '2')).toEqual({ prev: decks[0], next: decks[2], position: null, total: 3 })
    expect(deckNeighbors(built, '11')).toMatchObject({ prev: decks[3], next: null, position: null })
    expect(deckNeighbors([], '5')).toEqual({ prev: null, next: null, position: null, total: 0 })
  })
})
