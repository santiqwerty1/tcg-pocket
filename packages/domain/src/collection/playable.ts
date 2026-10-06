/**
 * Playable copies per functional group (I4): the active adjustment of the group, or Σ `amountOwned` over its
 * stock units. Twins are counted once because they share a stock unit (A4b-1 never doubles A1-1).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, FunctionalGroup } from '../catalog/types.js'
import {
  type ActiveAdjustment,
  activeAdjustmentsByGroup,
  type CollectionAdjustment,
  toActiveAdjustment,
} from './adjustments.js'
import { type StockQuantities, stockValueOf } from './stock.js'

export interface PlayableEdition {
  cardId: CardId
  stockCardId: CardId
  /** Copies of the stock unit this edition belongs to (twins show the same number). */
  owned: number
  collected: boolean
}

export interface PlayableCopies {
  groupId: CardId
  nameEn: string
  nameEs: string
  /** Σ owned over the group's stock units. */
  fromStock: number
  adjustment: ActiveAdjustment | null
  /** `adjustment.playableCopies` when an adjustment is active, else `fromStock`. */
  playable: number
  editions: PlayableEdition[]
}

function playableOfGroup(
  index: CatalogIndex,
  stock: StockQuantities,
  active: Map<CardId, CollectionAdjustment>,
  group: FunctionalGroup,
): PlayableCopies {
  let fromStock = 0
  for (const stockCardId of group.stockCardIds) fromStock += stockValueOf(stock, stockCardId).amountOwned
  const editions = index.cardsOfGroup(group.id).map((card): PlayableEdition => {
    const value = stockValueOf(stock, card.stockCardId)
    return { cardId: card.id, stockCardId: card.stockCardId, owned: value.amountOwned, collected: value.collected }
  })
  const adjustment = active.get(group.id)
  return {
    groupId: group.id,
    nameEn: group.nameEn,
    nameEs: group.nameEs,
    fromStock,
    adjustment: adjustment ? toActiveAdjustment(adjustment) : null,
    playable: adjustment ? adjustment.playableCopies : fromStock,
    editions,
  }
}

/** Playable copies of every functional group, in catalog order. */
export function playableCopies(
  index: CatalogIndex,
  stock: StockQuantities,
  adjustments: readonly CollectionAdjustment[] = [],
): Map<CardId, PlayableCopies> {
  const active = activeAdjustmentsByGroup(adjustments)
  const result = new Map<CardId, PlayableCopies>()
  for (const group of index.catalog.groups) result.set(group.id, playableOfGroup(index, stock, active, group))
  return result
}

/** Playable copies of one group, addressed by its id or by any of its editions. */
export function playableOf(
  index: CatalogIndex,
  stock: StockQuantities,
  adjustments: readonly CollectionAdjustment[],
  groupIdOrCardId: CardId,
): PlayableCopies | undefined {
  const group = index.groupById(groupIdOrCardId) ?? index.groupOfCard(groupIdOrCardId)
  if (!group) return undefined
  return playableOfGroup(index, stock, activeAdjustmentsByGroup(adjustments), group)
}

export interface EditionStatus {
  cardId: CardId
  stockCardId: CardId
  functionalGroupId: CardId
  /** Other editions sharing the stock unit: editing this card changes them too. */
  twinCardIds: CardId[]
  owned: number
  collected: boolean
}

/** What the user owns of one edition, through its stock unit. */
export function editionStatus(index: CatalogIndex, stock: StockQuantities, cardId: CardId): EditionStatus | undefined {
  const card = index.cardById(cardId)
  const unit = index.stockOfCard(cardId)
  if (!card || !unit) return undefined
  const value = stockValueOf(stock, unit.id)
  return {
    cardId: card.id,
    stockCardId: unit.id,
    functionalGroupId: card.functionalGroupId,
    twinCardIds: unit.cardIds.filter((id) => id !== cardId),
    owned: value.amountOwned,
    collected: value.collected,
  }
}
