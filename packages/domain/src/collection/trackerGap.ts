/**
 * «Tracker al día» (T-020): the tracker's collection against the game's (ptcgpocket.gg), card by card, and the file
 * that brings the tracker up to date. Both sides are compared by stock unit (twins share the tracker's internal id and
 * the in-game count), so a reprint is never counted twice.
 *
 * The file is for the tracker's importer (ImportReader: SheetJS reads the CSV, needs `Id`, `InternalId`, `NumberOwned`
 * and `Collected`, upserts by internal id only the rows it gets). It carries only the units whose count differs, with
 * the game's count: importing it touches nothing else, and the trades the tracker offers come from the right numbers.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import { type TrackerCsvEntry, writeTrackerCsvRows } from './csv.js'
import type { StockQuantities } from './stock.js'

/** What the file is called when it is downloaded. */
export const TRACKER_FIX_FILE_NAME = 'tcg-pocket-para-el-tracker.csv'

export interface TrackerGapRow {
  stockCardId: CardId
  /** Every edition of the unit (twins included). */
  cardIds: CardId[]
  /** The catalog's internal id of the unit (what the tracker keys its counts by). */
  internalId: number
  tracker: number
  game: number
  /** game − tracker: above 0 the tracker is missing copies, below 0 it has copies of more. */
  delta: number
  /** The tracker's carddex flag, kept in the file when the game has no copy (the game keeps the card in the dex). */
  trackerCollected: boolean
}

export interface TrackerGapSummary {
  /** Units whose count differs. */
  cards: number
  /** Units the tracker has fewer copies of, and how many copies it is missing in all. */
  cardsMissing: number
  copiesMissing: number
  /** Units the tracker has more copies of, and how many copies of more in all. */
  cardsExtra: number
  copiesExtra: number
  trackerCopies: number
  gameCopies: number
}

export interface TrackerGap {
  /** In catalog order (expansion, number). */
  rows: TrackerGapRow[]
  summary: TrackerGapSummary
}

/** Card by card, where the tracker's count differs from the game's. A missing unit counts as 0 on either side. */
export function trackerGap(index: CatalogIndex, tracker: StockQuantities, game: StockQuantities): TrackerGap {
  const rows: TrackerGapRow[] = []
  const summary: TrackerGapSummary = {
    cards: 0,
    cardsMissing: 0,
    copiesMissing: 0,
    cardsExtra: 0,
    copiesExtra: 0,
    trackerCopies: 0,
    gameCopies: 0,
  }
  for (const unit of index.catalog.stockUnits) {
    const inTracker = tracker[unit.id]?.amountOwned ?? 0
    const inGame = game[unit.id]?.amountOwned ?? 0
    summary.trackerCopies += inTracker
    summary.gameCopies += inGame
    if (inTracker === inGame) continue
    const delta = inGame - inTracker
    rows.push({
      stockCardId: unit.id,
      cardIds: [...unit.cardIds],
      internalId: unit.internalId,
      tracker: inTracker,
      game: inGame,
      delta,
      trackerCollected: tracker[unit.id]?.collected ?? false,
    })
    summary.cards += 1
    if (delta > 0) {
      summary.cardsMissing += 1
      summary.copiesMissing += delta
    } else {
      summary.cardsExtra += 1
      summary.copiesExtra -= delta
    }
  }
  return { rows, summary }
}

/**
 * The file for the tracker's importer: one row per differing unit (its earliest edition; the tracker dedupes by
 * internal id anyway) with the game's count. `Collected` is TRUE with a copy and otherwise keeps the tracker's flag,
 * so a card traded away stays in the tracker's carddex. Same bytes as the tracker's own export (BOM, LF).
 */
export function writeTrackerFixCsv(index: CatalogIndex, rows: readonly TrackerGapRow[]): string {
  const entries: TrackerCsvEntry[] = []
  for (const row of rows) {
    const card = index.cardById(row.stockCardId)
    if (!card) continue
    entries.push({ card, amountOwned: row.game, collected: row.game > 0 || row.trackerCollected })
  }
  return writeTrackerCsvRows(entries)
}
