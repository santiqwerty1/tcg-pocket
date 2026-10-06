/**
 * Stock quantities: what the user owns per stock unit (editions sharing a tracker internal id, PLAN §4.1 I3).
 * Keyed by `stockCardId`, so twins such as A1-1 / A4b-1 are one entry. Plain objects only: they travel as JSON
 * between the API and the UI and map 1:1 to the `CollectionStock` table.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { CsvRow } from './csv.js'

export interface StockQuantity {
  stockCardId: CardId
  /** Copies owned (integer ≥ 0). */
  amountOwned: number
  /** The tracker's "carddex" flag. Independent from the amount: B1a-28 is owned 0 and collected. */
  collected: boolean
}

/** Stock state keyed by `stockCardId`. A missing key means "never recorded" (0 copies, not collected). */
export type StockQuantities = Record<CardId, StockQuantity>

/** Amount and flag of one unit, without the key (used in diffs). */
export interface StockValue {
  amountOwned: number
  collected: boolean
}

export interface TwinConflictRow {
  cardId: CardId
  /** 1-based line in the CSV file. */
  line: number
  amountOwned: number
  collected: boolean
}

/** Rows of the same stock unit (twins) carrying different values: the file is inconsistent and must be fixed. */
export interface TwinConflict {
  stockCardId: CardId
  rows: TwinConflictRow[]
}

/** The row's `InternalId` differs from the catalog's: the file comes from another tracker version (I1). */
export interface InternalIdMismatch {
  cardId: CardId
  line: number
  csvInternalId: number
  catalogInternalId: number
}

export interface NormalizedImport {
  /** One entry per stock unit seen in the rows (first row wins when twins disagree; see `conflicts`). */
  units: StockQuantities
  conflicts: TwinConflict[]
  /** Card ids absent from the catalog, in order of first appearance. Their rows are not imported. */
  unknownIds: string[]
  internalIdMismatches: InternalIdMismatch[]
  /** Rows whose stock unit had already appeared in an earlier row (the tracker's linked reprints). */
  twinRows: number
  /** Σ `NumberOwned` over every row as written in the file (twins counted twice). */
  naiveTotal: number
  /** Σ `amountOwned` over `units` (twins counted once). */
  dedupTotal: number
}

function sameValues(a: TwinConflictRow, b: TwinConflictRow): boolean {
  return a.amountOwned === b.amountOwned && a.collected === b.collected
}

/**
 * Folds parsed CSV rows into stock units. Each `Id` is validated against the catalog (the tracker does not);
 * the stock unit comes from the catalog, which is the dedupe by `InternalId` that the tracker performs
 * (twins share the internal id). Twins with different values are reported, never silently merged.
 */
export function normalizeImportRows(rows: readonly CsvRow[], index: CatalogIndex): NormalizedImport {
  const units: StockQuantities = {}
  const seen = new Map<CardId, TwinConflictRow[]>()
  const unknown = new Set<string>()
  const internalIdMismatches: InternalIdMismatch[] = []
  let twinRows = 0
  let naiveTotal = 0
  for (const row of rows) {
    naiveTotal += row.numberOwned
    const card = index.cardById(row.id)
    if (!card) {
      unknown.add(row.id)
      continue
    }
    if (row.internalId !== card.internalId) {
      internalIdMismatches.push({
        cardId: row.id,
        line: row.line,
        csvInternalId: row.internalId,
        catalogInternalId: card.internalId,
      })
    }
    const entry: TwinConflictRow = {
      cardId: row.id,
      line: row.line,
      amountOwned: row.numberOwned,
      collected: row.collected,
    }
    const previous = seen.get(card.stockCardId)
    if (previous) {
      twinRows += 1
      previous.push(entry)
      continue
    }
    seen.set(card.stockCardId, [entry])
    units[card.stockCardId] = { stockCardId: card.stockCardId, amountOwned: row.numberOwned, collected: row.collected }
  }
  const conflicts: TwinConflict[] = []
  for (const [stockCardId, twins] of seen) {
    const first = twins[0]
    if (twins.length > 1 && first && twins.some((twin) => !sameValues(first, twin))) {
      conflicts.push({ stockCardId, rows: twins })
    }
  }
  return {
    units,
    conflicts,
    unknownIds: [...unknown],
    internalIdMismatches,
    twinRows,
    naiveTotal,
    dedupTotal: totalCopies(units),
  }
}

/** Amount and flag of a stock unit, treating a missing key as 0 / false. */
export function stockValueOf(stock: StockQuantities, stockCardId: CardId): StockValue {
  const unit = stock[stockCardId]
  return unit ? { amountOwned: unit.amountOwned, collected: unit.collected } : { amountOwned: 0, collected: false }
}

/** Σ `amountOwned` over the whole stock. */
export function totalCopies(stock: StockQuantities): number {
  let total = 0
  for (const unit of Object.values(stock)) total += unit.amountOwned
  return total
}
