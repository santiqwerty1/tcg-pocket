/**
 * Response shapes of the collection endpoints (docs/API.md «Colección»). Numeric ids travel as strings.
 */
import type {
  AdjustmentResolution,
  CsvErrorCode,
  DotggErrorCode,
  DotggRenamed,
  DotggUnmatched,
  ImportSummary,
  StockValue,
  TwinConflict,
} from '@tcg/domain'
import type { CardSummary, GroupSummary } from '../catalog/catalog-views.js'
import type { CollectionImportStatus } from '../generated/prisma/enums.js'

export interface CollectionSummaryView {
  /** Σ amountOwned over the stock units (twins counted once). */
  copies: number
  stockUnitsCollected: number
  groupsWithAtLeast: { one: number; two: number }
  groupsMissing: number
  lastImportAt: Date | null
  activeAdjustments: number
}

export interface CollectionGroupItem {
  group: GroupSummary
  playable: number
  fromStock: number
  hasAdjustment: boolean
}

export interface StockItem {
  card: CardSummary
  owned: number
  collected: boolean
  twinCardIds: string[]
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface ActiveAdjustmentView {
  id: string
  functionalGroupId: string
  nameEs: string
  playableCopies: number
  reason: string
  createdAt: Date
}

export interface StockPatchResult {
  stockCardId: string
  /** Every edition of the unit (the edited one included). */
  cardIds: string[]
  affectedTwinIds: string[]
  before: StockValue | null
  after: StockValue
  /** Rule (c) of PLAN §3.2: the UI asks whether to retire it. */
  activeAdjustment: ActiveAdjustmentView | null
}

export interface ImportErrorView {
  line: number | null
  code: CsvErrorCode | DotggErrorCode
  column: string | null
  message: string
}

/** T-020: what a ptcgpocket.gg snapshot changes and why it waits for a look (`requiresReview`). */
export interface DotggReviewView {
  /** The collection, adjustments and catalog it was diffed against: applying refuses anything else. */
  baseline: string
  increased: number
  decreased: number
  /** Copies lost in all (gross: gains do not hide them). */
  removedCopies: number
  currentCopies: number
  requiresReview: boolean
  reviewReasons: string[]
  /** Rows of the export the catalog does not have. */
  unmatched: DotggUnmatched[]
  /** Rows whose name is another card's (another numbering?): mapped, but they make it wait for a look. */
  renamed: DotggRenamed[]
  /** Expansions with copies in the collection and no row in the export. */
  missingExpansions: { expansionId: string; nameEs: string; copies: number }[]
}

export interface ImportChangeView {
  stockCardId: string
  cardIds: string[]
  nameEs: string
  before: StockValue | null
  after: StockValue
}

export interface AdjustmentMatchView {
  adjustmentId: string
  groupId: string
  nameEs: string
  playableCopies: number
  stockSum: number
}

export interface AdjustmentHiddenChangeView {
  adjustmentId: string
  groupId: string
  nameEs: string
  playableCopies: number
  sumBefore: number
  sumAfter: number
}

export interface ImportPreview {
  source: string
  tracker?: {
    friendId: string
    baseline: string
    increased: number
    decreased: number
    removedCopies: number
    currentCopies: number
    requiresReview: boolean
    reviewReasons?: string[]
    catalogCommit?: string | null
  }
  dotgg?: DotggReviewView
  id: string
  /** Null when the CSV was pasted as JSON `{ csv }`. */
  fileName: string | null
  status: CollectionImportStatus
  importedAt: Date
  appliedAt: Date | null
  sha256: string
  /** Rows that parsed (errors are listed apart). */
  rowCount: number
  naiveTotal: number
  dedupTotal: number
  bom: boolean
  lineEnding: string
  errors: ImportErrorView[]
  unknownIds: string[]
  /** Rows whose InternalId differs from the catalog's (the file comes from another tracker version). */
  internalIdMismatches: number
  twinConflicts: TwinConflict[]
  /** True while errors or twin conflicts block `apply`. */
  blocked: boolean
  summary: ImportSummary
  changes: ImportChangeView[]
  adjustmentsMatching: AdjustmentMatchView[]
  adjustmentsHidingChange: AdjustmentHiddenChangeView[]
}

export interface ImportListItem {
  source: string
  id: string
  fileName: string | null
  importedAt: Date
  appliedAt: Date | null
  status: CollectionImportStatus
  rowCount: number
  naiveTotal: number
  dedupTotal: number
  blocked: boolean
  summary: ImportSummary
}

export interface CollectionAdjustmentView {
  id: string
  functionalGroupId: string
  nameEs: string
  playableCopies: number
  /** Current stock sum of the group (what the adjustment overrides). */
  fromStock: number
  reason: string
  active: boolean
  createdAt: Date
  resolvedAt: Date | null
  resolution: AdjustmentResolution | null
}

export interface AdjustmentConversionResult {
  adjustment: CollectionAdjustmentView
  stockCardId: string
  affectedTwinIds: string[]
  before: StockValue | null
  after: StockValue
}

/** Themed-collection missions against the collection (Fase 8). Names and rewards in English, as the game data. */
export interface MissionsView {
  total: number
  complete: number
  expansions: { id: string; nameEs: string; missions: number }[]
  items: {
    expansionId: string
    expansionNameEs: string
    name: string
    reward: string | null
    secret: boolean
    complete: boolean
    missingCopies: number
    slots: { amount: number; have: number; nameEs: string; options: { cardId: string; rarity: string | null }[] }[]
  }[]
}
