/**
 * «Tracker al día» (T-020): the tracker's collection against the game's (ptcgpocket.gg), card by card, and the file
 * that brings the tracker up to date. Both sides are compared by stock unit (twins share the tracker's internal id and
 * the in-game count), so a reprint is never counted twice.
 *
 * The file is for the tracker's importer (ImportReader: SheetJS reads the CSV, needs `Id`, `InternalId`, `NumberOwned`
 * and `Collected`, upserts by internal id only the rows it gets). It carries only the units it changes, with the game's
 * count and `Collected` TRUE with a copy and FALSE without (Santi, 22/10/2026): importing it touches nothing else, and
 * the trades the tracker offers come from the right numbers.
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
  /** The tracker's carddex («collected») flag now. */
  trackerCollected: boolean
  /** What the file writes in `Collected`: TRUE with a copy in the game, FALSE without (Santi, 22/10/2026). */
  collected: boolean
}

export interface TrackerGapSummary {
  /** Units the file changes: their count differs, or only their carddex flag. */
  cards: number
  /** Units the tracker has fewer copies of, and how many copies it is missing in all. */
  cardsMissing: number
  copiesMissing: number
  /** Units the tracker has more copies of, and how many copies of more in all. */
  cardsExtra: number
  copiesExtra: number
  /** Units with the right count whose carddex flag the file changes (registered with 0 copies, or the reverse). */
  cardsCollected: number
  trackerCopies: number
  gameCopies: number
}

export interface TrackerGap {
  /** In catalog order (expansion, number). */
  rows: TrackerGapRow[]
  summary: TrackerGapSummary
}

/**
 * Card by card, what the file would change in the tracker: the count, or only the carddex flag (TRUE with a copy in the
 * game, FALSE without). A missing unit counts as 0 and not registered on either side; units in `skip` (the game's count
 * is not trustworthy, e.g. another numbering) are left out of the rows and the totals.
 */
export function trackerGap(
  index: CatalogIndex,
  tracker: StockQuantities,
  game: StockQuantities,
  skip: ReadonlySet<CardId> = new Set(),
): TrackerGap {
  const rows: TrackerGapRow[] = []
  const summary: TrackerGapSummary = {
    cards: 0,
    cardsMissing: 0,
    copiesMissing: 0,
    cardsExtra: 0,
    copiesExtra: 0,
    cardsCollected: 0,
    trackerCopies: 0,
    gameCopies: 0,
  }
  for (const unit of index.catalog.stockUnits) {
    if (skip.has(unit.id)) continue
    const inTracker = tracker[unit.id]?.amountOwned ?? 0
    const inGame = game[unit.id]?.amountOwned ?? 0
    const trackerCollected = tracker[unit.id]?.collected ?? false
    const collected = inGame > 0
    summary.trackerCopies += inTracker
    summary.gameCopies += inGame
    if (inTracker === inGame && trackerCollected === collected) continue
    const delta = inGame - inTracker
    rows.push({
      stockCardId: unit.id,
      cardIds: [...unit.cardIds],
      internalId: unit.internalId,
      tracker: inTracker,
      game: inGame,
      delta,
      trackerCollected,
      collected,
    })
    summary.cards += 1
    if (delta > 0) {
      summary.cardsMissing += 1
      summary.copiesMissing += delta
    } else if (delta < 0) {
      summary.cardsExtra += 1
      summary.copiesExtra -= delta
    } else {
      summary.cardsCollected += 1
    }
  }
  return { rows, summary }
}

/**
 * The file for the tracker's importer: one row per unit it changes (its earliest edition; the tracker dedupes by
 * internal id anyway) with the game's count, and `Collected` TRUE with a copy and FALSE without — a card left with 0
 * copies stops counting in the tracker's carddex (Santi, 22/10/2026). Same bytes as the tracker's own export (BOM, LF).
 */
export function writeTrackerFixCsv(index: CatalogIndex, rows: readonly TrackerGapRow[]): string {
  const entries: TrackerCsvEntry[] = []
  for (const row of rows) {
    const card = index.cardById(row.stockCardId)
    if (!card) continue
    entries.push({ card, amountOwned: row.game, collected: row.game > 0 })
  }
  return writeTrackerCsvRows(entries)
}
