/**
 * Manual adjustments (PLAN §3.2, I4): an absolute number of playable copies per functional group that overrides
 * the stock sum ("the CSV says 3 Latias and 1 Latios, I really have 2 and 2"). At most one active per group.
 * They are never exported; the four rules of §3.2 are implemented here as pure helpers:
 * (a) `adjustmentsMatchingStock`, (b) `adjustmentsHidingChange`, (c) `adjustmentForCard`,
 * (d) `planAdjustmentConversion`.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, FunctionalGroup } from '../catalog/types.js'
import { type StockQuantities, stockValueOf } from './stock.js'

export const ADJUSTMENT_RESOLUTIONS = ['user', 'csv_matches', 'manual_edit', 'converted', 'catalog_change'] as const
export type AdjustmentResolution = (typeof ADJUSTMENT_RESOLUTIONS)[number]

export interface CollectionAdjustment {
  id: string
  functionalGroupId: CardId
  /** Absolute playable copies of the group while active. */
  playableCopies: number
  reason: string
  active: boolean
  /** ISO 8601 timestamps (strings so the object is JSON-safe). */
  createdAt: string
  resolvedAt: string | null
  resolution: AdjustmentResolution | null
}

/** The part of an active adjustment shown next to a playable count. */
export type ActiveAdjustment = Pick<
  CollectionAdjustment,
  'id' | 'functionalGroupId' | 'playableCopies' | 'reason' | 'createdAt'
>

export function toActiveAdjustment(adjustment: CollectionAdjustment): ActiveAdjustment {
  return {
    id: adjustment.id,
    functionalGroupId: adjustment.functionalGroupId,
    playableCopies: adjustment.playableCopies,
    reason: adjustment.reason,
    createdAt: adjustment.createdAt,
  }
}

/** Active adjustments keyed by group. Throws when a group has two active ones (I4; the DB has a partial UNIQUE). */
export function activeAdjustmentsByGroup(
  adjustments: readonly CollectionAdjustment[],
): Map<CardId, CollectionAdjustment> {
  const byGroup = new Map<CardId, CollectionAdjustment>()
  for (const adjustment of adjustments) {
    if (!adjustment.active) continue
    const existing = byGroup.get(adjustment.functionalGroupId)
    if (existing) {
      throw new Error(
        `Two active adjustments for group ${adjustment.functionalGroupId}: ${existing.id} and ${adjustment.id}`,
      )
    }
    byGroup.set(adjustment.functionalGroupId, adjustment)
  }
  return byGroup
}

/** Σ `amountOwned` over the stock units of a group (0 for an unknown group). */
export function groupStockSum(index: CatalogIndex, stock: StockQuantities, groupId: CardId): number {
  const group = index.groupById(groupId)
  if (!group) return 0
  let sum = 0
  for (const stockCardId of group.stockCardIds) sum += stockValueOf(stock, stockCardId).amountOwned
  return sum
}

/** Rule (c): the active adjustment of the group an edition belongs to, if any (the UI asks before a manual edit). */
export function adjustmentForCard(
  index: CatalogIndex,
  adjustments: readonly CollectionAdjustment[],
  cardId: CardId,
): CollectionAdjustment | null {
  const card = index.cardById(cardId)
  if (!card) return null
  return activeAdjustmentsByGroup(adjustments).get(card.functionalGroupId) ?? null
}

export interface AdjustmentStockMatch {
  adjustmentId: string
  groupId: CardId
  nameEn: string
  nameEs: string
  playableCopies: number
  stockSum: number
}

function describe(group: FunctionalGroup, adjustment: CollectionAdjustment) {
  return {
    adjustmentId: adjustment.id,
    groupId: group.id,
    nameEn: group.nameEn,
    nameEs: group.nameEs,
    playableCopies: adjustment.playableCopies,
  }
}

/**
 * Rule (a): active adjustments whose group stock sum already equals the override, so the adjustment is redundant
 * ("el ajuste de X ya coincide con el CSV, ¿lo retirás?"). Adjustments of groups missing from the catalog are
 * skipped (they belong to the catalog-change flow, I12).
 */
export function adjustmentsMatchingStock(
  index: CatalogIndex,
  stock: StockQuantities,
  adjustments: readonly CollectionAdjustment[],
): AdjustmentStockMatch[] {
  const matches: AdjustmentStockMatch[] = []
  for (const adjustment of activeAdjustmentsByGroup(adjustments).values()) {
    const group = index.groupById(adjustment.functionalGroupId)
    if (!group) continue
    const stockSum = groupStockSum(index, stock, group.id)
    if (stockSum === adjustment.playableCopies) matches.push({ ...describe(group, adjustment), stockSum })
  }
  return matches
}

export interface AdjustmentHiddenChange {
  adjustmentId: string
  groupId: CardId
  nameEn: string
  nameEs: string
  playableCopies: number
  stockBefore: number
  stockAfter: number
}

/**
 * Rule (b): active adjustments whose group stock sum changed between two stock states without landing on the
 * override (those go to `adjustmentsMatchingStock`). The playable count stays frozen at the override, so the
 * change would otherwise be invisible: "antes A, ahora B, ajuste N".
 */
export function adjustmentsHidingChange(
  index: CatalogIndex,
  before: StockQuantities,
  after: StockQuantities,
  adjustments: readonly CollectionAdjustment[],
): AdjustmentHiddenChange[] {
  const hidden: AdjustmentHiddenChange[] = []
  for (const adjustment of activeAdjustmentsByGroup(adjustments).values()) {
    const group = index.groupById(adjustment.functionalGroupId)
    if (!group) continue
    const stockBefore = groupStockSum(index, before, group.id)
    const stockAfter = groupStockSum(index, after, group.id)
    if (stockBefore === stockAfter || stockAfter === adjustment.playableCopies) continue
    hidden.push({ ...describe(group, adjustment), stockBefore, stockAfter })
  }
  return hidden
}

export type ConversionErrorCode = 'inactive' | 'unknown_card' | 'target_not_in_group' | 'negative_amount'

export type ConversionPlan =
  | {
      ok: true
      adjustmentId: string
      groupId: CardId
      targetCardId: CardId
      /** Stock unit that receives the edit; its other editions move with it. */
      stockCardId: CardId
      twinCardIds: CardId[]
      stockSum: number
      playableCopies: number
      /** Copies to add (positive) or remove (negative) from the target unit so the stock sum equals the override. */
      delta: number
      amountBefore: number
      amountAfter: number
    }
  | { ok: false; code: ConversionErrorCode; message: string }

/**
 * Rule (d): turns an adjustment into a manual edit of one edition so the tracker can be corrected too. Applying
 * the plan is `manualEdit(index, stock, targetCardId, { amountOwned: amountAfter })` followed by resolving the
 * adjustment as 'converted'.
 */
export function planAdjustmentConversion(
  index: CatalogIndex,
  stock: StockQuantities,
  adjustment: CollectionAdjustment,
  targetCardId: CardId,
): ConversionPlan {
  if (!adjustment.active) {
    return { ok: false, code: 'inactive', message: `Adjustment ${adjustment.id} is not active` }
  }
  const card = index.cardById(targetCardId)
  const unit = index.stockOfCard(targetCardId)
  if (!card || !unit) return { ok: false, code: 'unknown_card', message: `Unknown card id: ${targetCardId}` }
  if (card.functionalGroupId !== adjustment.functionalGroupId) {
    return {
      ok: false,
      code: 'target_not_in_group',
      message: `${targetCardId} belongs to group ${card.functionalGroupId}, not ${adjustment.functionalGroupId}`,
    }
  }
  const stockSum = groupStockSum(index, stock, adjustment.functionalGroupId)
  const delta = adjustment.playableCopies - stockSum
  const amountBefore = stockValueOf(stock, unit.id).amountOwned
  const amountAfter = amountBefore + delta
  if (amountAfter < 0) {
    return {
      ok: false,
      code: 'negative_amount',
      message: `${targetCardId} has ${amountBefore} copies; removing ${-delta} would leave ${amountAfter}`,
    }
  }
  return {
    ok: true,
    adjustmentId: adjustment.id,
    groupId: adjustment.functionalGroupId,
    targetCardId,
    stockCardId: unit.id,
    twinCardIds: unit.cardIds.filter((id) => id !== targetCardId),
    stockSum,
    playableCopies: adjustment.playableCopies,
    delta,
    amountBefore,
    amountAfter,
  }
}

/** A resolved copy of the adjustment (inactive, with the resolution and its timestamp). */
export function resolveAdjustment(
  adjustment: CollectionAdjustment,
  resolution: AdjustmentResolution,
  resolvedAt: string,
): CollectionAdjustment {
  return { ...adjustment, active: false, resolvedAt, resolution }
}
