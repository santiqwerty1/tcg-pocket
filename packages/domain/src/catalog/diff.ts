/**
 * Differences between two catalog versions (PLAN §3.1: when the pinned commit changes, the sync shows new cards,
 * internal ids that changed, groups or stock units that split or merged, and names that fell back to English).
 * Identity is the card id; everything else is compared per card.
 */
import { typesOf } from './pokemonTypes.js'
import type { CardId, Catalog, ExpansionId } from './types.js'

export interface CardFieldChange<T> {
  cardId: CardId
  from: T
  to: T
}

export interface NameChange {
  cardId: CardId
  field: 'nameEn' | 'nameEs'
  from: string
  to: string
}

export interface CatalogDiff {
  added: CardId[]
  removed: CardId[]
  internalIdChanged: CardFieldChange<number>[]
  stockChanged: CardFieldChange<CardId>[]
  groupChanged: CardFieldChange<CardId>[]
  nameChanged: NameChange[]
  /** Printed types that changed, as «water» → «water/darkness» (C1: a card that gains or loses its second type). */
  typesChanged: CardFieldChange<string>[]
  expansionsAdded: ExpansionId[]
  expansionsRemoved: ExpansionId[]
}

export function isEmptyDiff(diff: CatalogDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.internalIdChanged.length === 0 &&
    diff.stockChanged.length === 0 &&
    diff.groupChanged.length === 0 &&
    diff.nameChanged.length === 0 &&
    diff.typesChanged.length === 0 &&
    diff.expansionsAdded.length === 0 &&
    diff.expansionsRemoved.length === 0
  )
}

export function diffCatalog(prev: Catalog, next: Catalog): CatalogDiff {
  const diff: CatalogDiff = {
    added: [],
    removed: [],
    internalIdChanged: [],
    stockChanged: [],
    groupChanged: [],
    nameChanged: [],
    typesChanged: [],
    expansionsAdded: [],
    expansionsRemoved: [],
  }
  const prevCards = new Map(prev.cards.map((card) => [card.id, card]))
  const nextCards = new Map(next.cards.map((card) => [card.id, card]))

  for (const card of next.cards) {
    const before = prevCards.get(card.id)
    if (!before) {
      diff.added.push(card.id)
      continue
    }
    if (before.internalId !== card.internalId) {
      diff.internalIdChanged.push({ cardId: card.id, from: before.internalId, to: card.internalId })
    }
    if (before.stockCardId !== card.stockCardId) {
      diff.stockChanged.push({ cardId: card.id, from: before.stockCardId, to: card.stockCardId })
    }
    if (before.functionalGroupId !== card.functionalGroupId) {
      diff.groupChanged.push({ cardId: card.id, from: before.functionalGroupId, to: card.functionalGroupId })
    }
    if (before.nameEn !== card.nameEn) {
      diff.nameChanged.push({ cardId: card.id, field: 'nameEn', from: before.nameEn, to: card.nameEn })
    }
    if (before.nameEs !== card.nameEs) {
      diff.nameChanged.push({ cardId: card.id, field: 'nameEs', from: before.nameEs, to: card.nameEs })
    }
    const [typesBefore, typesAfter] = [typesOf(before).join('/'), typesOf(card).join('/')]
    if (typesBefore !== typesAfter) diff.typesChanged.push({ cardId: card.id, from: typesBefore, to: typesAfter })
  }
  for (const card of prev.cards) {
    if (!nextCards.has(card.id)) diff.removed.push(card.id)
  }

  const prevExpansions = new Set(prev.expansions.map((expansion) => expansion.id))
  const nextExpansions = new Set(next.expansions.map((expansion) => expansion.id))
  for (const id of nextExpansions) if (!prevExpansions.has(id)) diff.expansionsAdded.push(id)
  for (const id of prevExpansions) if (!nextExpansions.has(id)) diff.expansionsRemoved.push(id)
  return diff
}
