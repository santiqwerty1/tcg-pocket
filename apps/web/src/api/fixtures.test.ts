import { describe, expect, it } from 'vitest'
import cardsSearch from './__fixtures__/cards-search.json'
import catalogStatus from './__fixtures__/catalog-status.json'
import collectionSummary from './__fixtures__/collection-summary.json'
import deckDetail from './__fixtures__/deck-detail.json'
import deckImport from './__fixtures__/deck-import.json'
import decksList from './__fixtures__/decks-list.json'
import groupDetail from './__fixtures__/group-detail.json'
import importPreview from './__fixtures__/import-preview.json'
import tokens from './__fixtures__/tokens.json'
import {
  cardSearchResponseSchema,
  catalogStatusSchema,
  collectionSummarySchema,
  deckDetailSchema,
  decksResponseSchema,
  groupResponseSchema,
  importDecksResponseSchema,
  importPreviewSchema,
  tokensResponseSchema,
} from './schemas'

/** The fixtures are the contract as the UI understands it (docs/API.md); they must always parse. */
describe('fixtures match the response schemas', () => {
  it('catalog', () => {
    expect(cardSearchResponseSchema.parse(cardsSearch).items).toHaveLength(3)
    expect(groupResponseSchema.parse(groupDetail).group.playable).toBe(3)
    expect(catalogStatusSchema.parse(catalogStatus).counts?.cards).toBe(4317)
  })

  it('collection', () => {
    expect(collectionSummarySchema.parse(collectionSummary).groupsWithAtLeast.two).toBe(1255)
    expect(importPreviewSchema.parse(importPreview).changes).toHaveLength(4)
  })

  it('decks', () => {
    const deck = deckDetailSchema.parse(deckDetail)
    expect(deck.cards.reduce((n, c) => n + c.count, 0)).toBe(20)
    expect(decksResponseSchema.parse(decksList).items.map((d) => d.id)).toEqual(['dk_08', 'dk_09', 'dk_39'])
    const drafts = importDecksResponseSchema.parse(deckImport).drafts
    expect(drafts[1]?.errors[0]?.code).toBe('energy_choice_required')
    expect(drafts[2]?.draft).toBeNull()
  })

  it('tokens', () => {
    expect(tokensResponseSchema.parse(tokens).items[0]?.id).toBe('1')
  })
})
