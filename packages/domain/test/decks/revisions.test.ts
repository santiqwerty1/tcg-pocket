import { describe, expect, it } from 'vitest'
import { type DeckDraft, diffDeckDrafts } from '../../src/decks/index.js'
import { deckDraft } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('diffDeckDrafts', () => {
  it('reports nothing for identical drafts, even with a different entry order or split entries', () => {
    const a = deckDraft(2)
    const shuffled: DeckDraft = { ...a, cards: [...a.cards].reverse() }
    expect(diffDeckDrafts(a, shuffled, index).changed).toBe(false)
    const split: DeckDraft = {
      ...a,
      cards: [...a.cards.map((c) => (c.cardId === 'B1-33' ? { ...c, count: 1 } : c)), { cardId: 'B1-33', count: 1 }],
    }
    expect(diffDeckDrafts(a, split, index).changed).toBe(false)
    expect(diffDeckDrafts(a, { ...a, energies: ['fire'] }, index).energies).toBeNull()
  })

  it('B1-36 → B1-254 is an editionChanged inside the Mega-Blaziken ex group, not remove + add', () => {
    const a = deckDraft(2)
    const b: DeckDraft = { ...a, cards: a.cards.map((c) => (c.cardId === 'B1-36' ? { ...c, cardId: 'B1-254' } : c)) }
    const diff = diffDeckDrafts(a, b, index)
    expect(diff).toEqual({
      added: [],
      removed: [],
      countChanged: [],
      editionChanged: [{ groupId: 'B1-36', from: 'B1-36', to: 'B1-254', fromCount: 1, toCount: 1 }],
      energies: null,
      changed: true,
    })
  })

  it('reports added, removed, count and energy changes', () => {
    const a = deckDraft(2)
    const b: DeckDraft = {
      ...a,
      energies: ['fire', 'lightning'],
      cards: [
        ...a.cards.filter((c) => c.cardId !== 'B1-44').map((c) => (c.cardId === 'B1-225' ? { ...c, count: 1 } : c)),
        { cardId: 'A1-225', count: 1 },
        { cardId: 'B1-36', count: 1 },
      ],
    }
    const diff = diffDeckDrafts(a, b, index)
    expect(diff.added).toEqual([{ cardId: 'A1-225', count: 1 }])
    expect(diff.removed).toEqual([{ cardId: 'B1-44', count: 1 }])
    expect(diff.countChanged).toEqual([
      { cardId: 'B1-36', from: 1, to: 2 },
      { cardId: 'B1-225', from: 2, to: 1 },
    ])
    expect(diff.editionChanged).toEqual([])
    expect(diff.energies).toEqual({ from: ['fire'], to: ['fire', 'lightning'] })
    expect(diff.changed).toBe(true)
  })

  it('pairs one edition swap per group and keeps the rest as added/removed', () => {
    // Deck 8: Mega-Mawile ex B2-113 + B2-201 → B2-113 only (count 2): B2-201 removed, B2-113 count changed.
    const a = deckDraft(8)
    const b: DeckDraft = {
      ...a,
      cards: a.cards.filter((c) => c.cardId !== 'B2-201').map((c) => (c.cardId === 'B2-113' ? { ...c, count: 2 } : c)),
    }
    const diff = diffDeckDrafts(a, b, index)
    expect(diff.removed).toEqual([{ cardId: 'B2-201', count: 1 }])
    expect(diff.countChanged).toEqual([{ cardId: 'B2-113', from: 1, to: 2 }])
    expect(diff.editionChanged).toEqual([])
    // Unknown ids diff by themselves.
    const unknownDiff = diffDeckDrafts(
      { energies: [], cards: [{ cardId: 'Z9-1', count: 1 }] },
      { energies: [], cards: [{ cardId: 'Z9-2', count: 1 }] },
      index,
    )
    expect(unknownDiff.removed).toEqual([{ cardId: 'Z9-1', count: 1 }])
    expect(unknownDiff.added).toEqual([{ cardId: 'Z9-2', count: 1 }])
  })
})
