import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CsvRow } from './csv.js'
import type { ImportDiff } from './import.js'
import type { StockQuantities } from './stock.js'

/** The public API stores one row per internal id, including wanted-only and carddex-only rows. */
export interface TrackerCollectionRow {
  internal_id: number
  amount_owned: number | null
  collected: boolean | null
}

/** Sparse snapshot in the CSV importer's format; absent stock units are filled at diff time. */
export function trackerImportRows(rows: readonly TrackerCollectionRow[], index: CatalogIndex): CsvRow[] {
  const saved = new Map<number, TrackerCollectionRow>()
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.internal_id) ||
      row.internal_id < 0 ||
      row.internal_id > 2147483647 ||
      (row.amount_owned !== null &&
        (!Number.isSafeInteger(row.amount_owned) || row.amount_owned < 0 || row.amount_owned > 2147483647)) ||
      (row.collected !== null && typeof row.collected !== 'boolean')
    ) {
      throw new Error('Fila inválida en la colección del tracker.')
    }
    if (saved.has(row.internal_id)) throw new Error(`internal_id duplicado: ${row.internal_id}`)
    saved.set(row.internal_id, row)
  }
  const result: CsvRow[] = []
  for (const unit of index.catalog.stockUnits) {
    const card = index.cardById(unit.id)
    if (!card) throw new Error(`Unidad sin edición: ${unit.id}`)
    const row = saved.get(card.internalId)
    saved.delete(card.internalId)
    if (!row || (!(row.amount_owned ?? 0) && !row.collected)) continue
    result.push({
      line: result.length + 2,
      id: card.id,
      internalId: card.internalId,
      numberOwned: row?.amount_owned ?? 0,
      collected: row?.collected ?? false,
      cardName: null,
      expansion: null,
      pack: null,
      rarity: null,
    })
  }
  for (const row of saved.values())
    result.push({
      line: result.length + 2,
      id: `internal_id:${row.internal_id}`,
      internalId: row.internal_id,
      numberOwned: row.amount_owned ?? 0,
      collected: row.collected ?? false,
      cardName: null,
      expansion: null,
      pack: null,
      rarity: null,
    })
  return result
}

/** The tracker is a complete snapshot, unlike a CSV merge. Expand only in memory. */
export function trackerUnits(units: StockQuantities, index: CatalogIndex): StockQuantities {
  const result = { ...units }
  for (const unit of index.catalog.stockUnits)
    result[unit.id] ??= { stockCardId: unit.id, amountOwned: 0, collected: false }
  return result
}

/** Gross losses, not the net change: gains cannot hide copies removed by the remote snapshot. */
export function trackerDiffStats(diff: ImportDiff, currentCopies: number) {
  const removedCopies = diff.changes.reduce(
    (sum, c) => sum + Math.max(0, (c.before?.amountOwned ?? 0) - c.after.amountOwned),
    0,
  )
  return {
    increased: diff.changes.filter((c) => c.after.amountOwned > (c.before?.amountOwned ?? 0)).length,
    decreased: diff.changes.filter((c) => c.after.amountOwned < (c.before?.amountOwned ?? 0)).length,
    removedCopies,
    currentCopies,
    requiresReview: removedCopies > currentCopies * 0.1,
  }
}
