/**
 * Import diff and application (PLAN §3.2): the diff is shown before applying; applying is a pure merge where
 * units absent from the file keep their current values (the tracker upserts only the rows it receives).
 * Manual edits act on the stock unit, so twins move together.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import {
  type AdjustmentHiddenChange,
  type AdjustmentStockMatch,
  adjustmentsHidingChange,
  adjustmentsMatchingStock,
  type CollectionAdjustment,
} from './adjustments.js'
import { type StockQuantities, type StockQuantity, type StockValue, stockValueOf } from './stock.js'

export interface StockChange {
  stockCardId: CardId
  /** Every edition of the unit (twins included), so the UI can show what the row affects. */
  cardIds: CardId[]
  /** Current values, or null when the unit had never been recorded. */
  before: StockValue | null
  after: StockValue
}

export interface ImportSummary {
  /** Units whose amount or flag differs after the import. */
  unitsChanged: number
  /** Σ (after − before) over the changed units. */
  copiesDelta: number
  /** Changed units that had never been recorded. */
  newUnits: number
  /** Units whose amount drops from > 0 to 0. */
  zeroedUnits: number
  /** Units whose `collected` flag flips. */
  collectedChanged: number
}

export interface ImportDiff {
  changes: StockChange[]
  summary: ImportSummary
  /** Rule (a): active adjustments the imported stock already satisfies. */
  adjustmentsMatching: AdjustmentStockMatch[]
  /** Rule (b): active adjustments hiding a stock change brought by the import. */
  adjustmentsHidingChange: AdjustmentHiddenChange[]
}

function sameValue(a: StockValue, b: StockValue): boolean {
  return a.amountOwned === b.amountOwned && a.collected === b.collected
}

/** Keys of `stock` in catalog stock-unit order; keys unknown to the catalog go last, in key order. */
function orderedKeys(index: CatalogIndex, stock: StockQuantities): CardId[] {
  const order = new Map<CardId, number>()
  for (const [at, unit] of index.catalog.stockUnits.entries()) order.set(unit.id, at)
  const unknownAfter = order.size
  return Object.keys(stock).sort((a, b) => {
    const byOrder = (order.get(a) ?? unknownAfter) - (order.get(b) ?? unknownAfter)
    return byOrder !== 0 ? byOrder : a < b ? -1 : a > b ? 1 : 0
  })
}

/** What applying `incoming` over `current` would change, plus the adjustment warnings of §3.2 (a) and (b). */
export function diffImport(
  index: CatalogIndex,
  current: StockQuantities,
  incoming: StockQuantities,
  adjustments: readonly CollectionAdjustment[] = [],
): ImportDiff {
  const changes: StockChange[] = []
  const summary: ImportSummary = { unitsChanged: 0, copiesDelta: 0, newUnits: 0, zeroedUnits: 0, collectedChanged: 0 }
  for (const stockCardId of orderedKeys(index, incoming)) {
    const after = stockValueOf(incoming, stockCardId)
    const recorded = current[stockCardId]
    const before = stockValueOf(current, stockCardId)
    if (sameValue(before, after)) continue
    changes.push({
      stockCardId,
      cardIds: index.stockById(stockCardId)?.cardIds ?? [stockCardId],
      before: recorded ? before : null,
      after,
    })
    summary.unitsChanged += 1
    summary.copiesDelta += after.amountOwned - before.amountOwned
    if (!recorded) summary.newUnits += 1
    if (before.amountOwned > 0 && after.amountOwned === 0) summary.zeroedUnits += 1
    if (before.collected !== after.collected) summary.collectedChanged += 1
  }
  const merged = applyImport(current, incoming)
  return {
    changes,
    summary,
    adjustmentsMatching: adjustmentsMatchingStock(index, merged, adjustments),
    adjustmentsHidingChange: adjustmentsHidingChange(index, current, merged, adjustments),
  }
}

/** New stock with every imported unit upserted; units absent from the import keep their current values. */
export function applyImport(current: StockQuantities, incoming: StockQuantities): StockQuantities {
  const merged: StockQuantities = { ...current }
  for (const unit of Object.values(incoming)) merged[unit.stockCardId] = { ...unit }
  return merged
}

export interface ManualEditPatch {
  amountOwned?: number | undefined
  collected?: boolean | undefined
}

export interface ManualEditResult {
  stock: StockQuantities
  stockCardId: CardId
  /** Every edition of the unit, the edited one included. */
  cardIds: CardId[]
  /** Twins that change along with the edited card (empty when the unit has one edition). */
  affectedTwinIds: CardId[]
  before: StockQuantity | null
  after: StockQuantity
}

/**
 * Edits one edition through its stock unit. `collected` turns on when the amount goes from 0 to > 0 and is left
 * alone when it drops to 0, unless the patch sets it explicitly. Throws on unknown ids or invalid amounts.
 */
export function manualEdit(
  index: CatalogIndex,
  stock: StockQuantities,
  cardId: CardId,
  patch: ManualEditPatch,
): ManualEditResult {
  const unit = index.stockOfCard(cardId)
  if (!unit) throw new Error(`Unknown card id: ${cardId}`)
  const before = stock[unit.id] ?? null
  const previous = stockValueOf(stock, unit.id)
  const amountOwned = patch.amountOwned ?? previous.amountOwned
  if (!Number.isInteger(amountOwned) || amountOwned < 0) {
    throw new RangeError(`amountOwned must be an integer ≥ 0, got ${amountOwned}`)
  }
  let collected = patch.collected ?? previous.collected
  if (patch.collected === undefined && previous.amountOwned === 0 && amountOwned > 0) collected = true
  const after: StockQuantity = { stockCardId: unit.id, amountOwned, collected }
  return {
    stock: { ...stock, [unit.id]: after },
    stockCardId: unit.id,
    cardIds: [...unit.cardIds],
    affectedTwinIds: unit.cardIds.filter((id) => id !== cardId),
    before,
    after,
  }
}
