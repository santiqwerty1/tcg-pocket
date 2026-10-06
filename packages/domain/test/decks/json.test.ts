import { describe, expect, it } from 'vitest'
import { deckJsonToDraft, parseDeckJson, writeDeckJson } from '../../src/decks/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex, TRACKER_COMMIT } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('deck JSON v1', () => {
  it('writes and reads back a deck with its extras', () => {
    const draft = deckDraft(2)
    const text = writeDeckJson(draft, { tags: ['torneo'], variantOf: 'deck-22', catalogCommit: TRACKER_COMMIT })
    expect(text.endsWith('\n')).toBe(true)
    const json = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(json)).toEqual([
      'schemaVersion',
      'name',
      'energies',
      'cards',
      'tags',
      'notes',
      'variantOf',
      'catalogCommit',
    ])
    const parsed = parseDeckJson(text, index)
    expect(parsed.errors).toEqual([])
    expect(parsed.value).toMatchObject({
      schemaVersion: 1,
      name: 'Mega-Blaziken ex',
      energies: ['fire'],
      tags: ['torneo'],
      variantOf: 'deck-22',
      catalogCommit: TRACKER_COMMIT,
    })
    expect(parsed.value?.cards).toEqual(draft.cards)
    const back = deckJsonToDraft(parsed.value as NonNullable<typeof parsed.value>)
    expect(back).toEqual({
      name: draft.name,
      energies: draft.energies,
      cards: draft.cards,
      notes: draft.notes,
      source: 'json',
    })
  })

  it('accepts an already parsed object and omits absent extras', () => {
    const text = writeDeckJson({ energies: ['water'], cards: [{ cardId: 'A1-1', count: 2 }] })
    expect(JSON.parse(text)).toEqual({
      schemaVersion: 1,
      name: '',
      energies: ['water'],
      cards: [{ cardId: 'A1-1', count: 2 }],
    })
    expect(parseDeckJson(JSON.parse(text)).value?.cards).toEqual([{ cardId: 'A1-1', count: 2 }])
  })

  it('rejects malformed JSON, other schema versions, bad fields, non-selectable energies and unknown cards', () => {
    expect(parseDeckJson('{', index).errors[0]).toMatchObject({ code: 'invalid_json' })
    expect(parseDeckJson({ schemaVersion: 2, name: 'x', energies: [], cards: [] }).errors[0]).toMatchObject({
      code: 'invalid_json',
    })
    const bad = parseDeckJson({
      schemaVersion: 1,
      name: 'x',
      energies: ['dragon'],
      cards: [{ cardId: 'A1-1', count: 0 }],
    })
    expect(bad.value).toBeNull()
    expect(bad.errors.map((e) => e.code)).toEqual(['invalid_json', 'invalid_json'])
    expect(bad.errors[0]?.message.startsWith('energies.0')).toBe(true)
    expect(bad.errors[1]?.message.startsWith('cards.0.count')).toBe(true)
    const unknown = parseDeckJson(
      { schemaVersion: 1, name: 'x', energies: ['fire'], cards: [{ cardId: 'Z9-1', count: 1 }] },
      index,
    )
    expect(unknown.value).toBeNull()
    expect(unknown.errors).toEqual([{ code: 'unknown_card', message: 'No existe la carta Z9-1 en el catálogo' }])
  })
})
