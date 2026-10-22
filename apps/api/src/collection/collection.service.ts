/**
 * Collection (PLAN §3.2, invariants I3–I4): views by functional group and by edition, manual edits through the
 * stock unit, CSV imports with preview/apply/discard, the tracker-format export and the manual adjustments with
 * their four rules. All domain logic comes from @tcg/domain; this service only loads state, persists and shapes.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type AdjustmentResolution,
  adjustmentForCard,
  type CatalogIndex,
  type CollectionAdjustment,
  type ConversionPlan,
  type CsvLineEnding,
  type CsvRow,
  DOTGG_SOURCE_NAME,
  type DotggRenamed,
  type DotggUnmatched,
  diffImport,
  dotggMissingExpansions,
  dotggUnits,
  type ImportDiff,
  manualEdit,
  mapDotggRows,
  missionProgress,
  type NormalizedImport,
  normalizeImportRows,
  type PackLuck,
  type ParsedDotgg,
  packLuck,
  parseTrackerCsv,
  planAdjustmentConversion,
  playableCopies,
  rewardEs,
  type StockQuantities,
  stockValueOf,
  type TrackerCollectionRow,
  type TwinConflict,
  totalCopies,
  trackerDiffStats,
  trackerImportRows,
  trackerUnits,
  writeTrackerCsv,
} from '@tcg/domain'
import type { PoolClient } from 'pg'
import { CatalogService } from '../catalog/catalog.service.js'
import { toCardSummary, toGroupSummary } from '../catalog/catalog-views.js'
import type { CollectionAdjustment as AdjustmentRow, CollectionImport, Prisma } from '../generated/prisma/client.js'
import { idToString, parseNumericId } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { upsertMany } from '../prisma/sql.js'
import { CollectionRepository, stockFromRows, toDomainAdjustment } from './collection.repository.js'
import type {
  ActiveAdjustmentView,
  AdjustmentConversionResult,
  CollectionAdjustmentView,
  CollectionGroupItem,
  CollectionSummaryView,
  DotggReviewView,
  ImportChangeView,
  ImportErrorView,
  ImportListItem,
  ImportPreview,
  MissionsView,
  Page,
  StockItem,
  StockPatchResult,
} from './collection-views.js'
import { DOTGG_LINK_KEY, DotggLinkStore } from './dotgg-link.store.js'

export interface GroupsQuery {
  q?: string | undefined
  expansion?: string | undefined
  missingOnly?: boolean | undefined
  limit: number
  offset: number
}

export interface StockQuery {
  q?: string | undefined
  expansion?: string | undefined
  onlyOwned?: boolean | undefined
  limit: number
  offset: number
}

export interface StockPatch {
  amountOwned?: number | undefined
  collected?: boolean | undefined
}

export interface ImportSource {
  bytes: Buffer
  /** Null for a pasted CSV. */
  fileName: string | null
}

/** An import row as the service reads it: everything but the gzipped CSV (`raw_file_gz` is only written, never served). */
type ImportRecord = Omit<CollectionImport, 'rawFileGz'>
/** An automatic remote check that found nothing to change (no import is stored). */
export type UnchangedRemoteImport = { unchanged: true; reviewReasons: string[] }

/** Sources that answer the whole collection (a missing unit has 0 copies) and sync by themselves. */
export type RemoteSource = 'tracker' | 'dotgg'

/** The `app_settings` keys each remote source keeps. */
export const REMOTE_KEYS = {
  tracker: {
    auto: 'trackerAutoSync',
    state: 'trackerSyncState',
    warning: 'trackerSyncWarning',
    lastApplied: 'trackerLastAppliedAt',
    lastChecked: 'trackerLastCheckedAt',
  },
  dotgg: {
    auto: 'dotggAutoSync',
    state: 'dotggSyncState',
    warning: 'dotggSyncWarning',
    lastApplied: 'dotggLastAppliedAt',
    lastChecked: 'dotggLastCheckedAt',
  },
} as const satisfies Record<RemoteSource, Record<string, string>>

/** What a remote snapshot carries into the importer besides its rows. */
interface RemoteImport {
  source: RemoteSource
  automatic: boolean
  checkedAt: Date
  /** tracker: the friend id it was read for. */
  friendId?: string
  /** tracker: the published commit differs from the catalog (automatic runs). */
  upstreamReview?: string
  /** dotgg: sha-256 of the link it was read from (an automatic run stops if the link changed). */
  linkFingerprint?: string
  /** dotgg: rows the catalog does not have. */
  unmatched?: DotggUnmatched[]
  /** dotgg: rows whose name is another card's. */
  renamed?: DotggRenamed[]
}

/** The parse result the importer needs, from a tracker CSV or an export mapped onto the catalog. */
interface ImportInput {
  rows: CsvRow[]
  errors: ImportErrorView[]
  bom: boolean
  lineEnding: CsvLineEnding | string
}

/** The source is ptcgpocket.gg now: the tracker is only compared (T-020). */
const TRACKER_NOT_MASTER =
  'La colección viene de ptcgpocket.gg: el tracker queda para comparar en Colección → Tracker al día. Para que vuelva a mandar el tracker, quitá el link de ptcgpocket.gg en Ajustes.'

/** What `collection_imports.diff_summary` holds: parse metadata (fixed) plus the diff (refreshed while pending). */
interface StoredImport {
  tracker?: NonNullable<ImportPreview['tracker']>
  dotgg?: DotggReviewView
  meta: {
    bom: boolean
    lineEnding: string
    errors: ImportErrorView[]
    conflicts: TwinConflict[]
    internalIdMismatches: number
    twinRows: number
  }
  diff: ImportDiff
}

type InputJsonObject = Prisma.InputJsonObject

interface ImportRowLike {
  cardId: string
  internalId: number
  numberOwned: number
  collected: boolean
}

const EMPTY_DIFF: ImportDiff = {
  changes: [],
  summary: { unitsChanged: 0, copiesDelta: 0, newUnits: 0, zeroedUnits: 0, collectedChanged: 0 },
  adjustmentsMatching: [],
  adjustmentsHidingChange: [],
}

type ConversionErrorCode = Exclude<ConversionPlan, { ok: true }>['code']

const CONVERSION_MESSAGES: Record<ConversionErrorCode, string> = {
  inactive: 'El ajuste ya no está activo.',
  unknown_card: 'La carta elegida no existe en el catálogo.',
  target_not_in_group: 'La carta elegida no pertenece a la carta funcional del ajuste.',
  negative_amount: 'No se pueden quitar tantas copias de esa edición: quedaría en negativo.',
}

/** Import intervals «suerte de los sobres» reports (the newest). */
const PACK_LUCK_INTERVALS = 6

export interface PackLuckView {
  imports: number
  /** Newest first. */
  intervals: { from: ImportRef; to: ImportRef; luck: PackLuck }[]
  /** From the first applied import to the last. */
  overall: { from: ImportRef; to: ImportRef; luck: PackLuck } | null
}

interface ImportRef {
  id: string
  fileName: string
  appliedAt: string
}

@Injectable()
export class CollectionService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
    private readonly repository: CollectionRepository,
    private readonly links: DotggLinkStore,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------------------------

  async summary(): Promise<CollectionSummaryView> {
    const index = this.catalog.requireIndex()
    const [{ stock, adjustments }, lastImport, collectedCount, checks] = await Promise.all([
      this.repository.loadState(),
      this.prisma.collectionImport.findFirst({ where: { status: 'applied' }, orderBy: { appliedAt: 'desc' } }),
      this.prisma.collectionStock.count({ where: { collected: true } }),
      this.prisma.appSetting.findMany({
        where: { key: { in: [REMOTE_KEYS.tracker.lastChecked, REMOTE_KEYS.dotgg.lastChecked] } },
      }),
    ])
    // An automatic check that found nothing to change also says the collection is up to date (tracker or game).
    const checked = checks
      .map((row) => row.value)
      .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    let one = 0
    let two = 0
    let missing = 0
    for (const group of playableCopies(index, stock, adjustments).values()) {
      if (group.playable >= 2) two += 1
      if (group.playable >= 1) one += 1
      else missing += 1
    }
    return {
      copies: totalCopies(stock),
      stockUnitsCollected: collectedCount,
      groupsWithAtLeast: { one, two },
      groupsMissing: missing,
      lastImportAt:
        checked && Date.parse(checked) > (lastImport?.appliedAt?.getTime() ?? 0)
          ? new Date(checked)
          : (lastImport?.appliedAt ?? null),
      activeAdjustments: adjustments.length,
    }
  }

  /**
   * Fase 17: what came in between consecutive applied imports (and since the first one), by rarity, against the
   * rates of packs. Approximate: trades and rewards count too.
   */
  async packLuck(): Promise<PackLuckView> {
    const index = this.catalog.requireIndex()
    const imports = await this.prisma.collectionImport.findMany({
      where: { status: 'applied', appliedAt: { not: null } },
      orderBy: { appliedAt: 'asc' },
      select: { id: true, fileName: true, appliedAt: true },
    })
    const recent = imports.slice(-(PACK_LUCK_INTERVALS + 1))
    const snapshots = new Map<number, Map<number, number>>()
    for (const item of recent.length > 1 ? [imports[0], ...recent] : []) {
      if (!item || snapshots.has(item.id)) continue
      const rows = await this.prisma.collectionImportRow.findMany({
        where: { importId: item.id },
        select: { internalId: true, numberOwned: true },
      })
      const owned = new Map<number, number>()
      for (const row of rows) owned.set(row.internalId, Math.max(owned.get(row.internalId) ?? 0, row.numberOwned))
      snapshots.set(item.id, owned)
    }
    const ref = (item: { id: number; fileName: string; appliedAt: Date | null }) => ({
      id: idToString(item.id),
      fileName: item.fileName,
      appliedAt: item.appliedAt?.toISOString() ?? '',
    })
    const intervals: PackLuckView['intervals'] = []
    for (let at = 1; at < recent.length; at++) {
      const from = recent[at - 1]
      const to = recent[at]
      if (!from || !to) continue
      intervals.push({
        from: ref(from),
        to: ref(to),
        luck: packLuck(snapshots.get(from.id) ?? new Map(), snapshots.get(to.id) ?? new Map(), index),
      })
    }
    const first = imports[0]
    const last = imports[imports.length - 1]
    const overall =
      first && last && first.id !== last.id
        ? {
            from: ref(first),
            to: ref(last),
            luck: packLuck(snapshots.get(first.id) ?? new Map(), snapshots.get(last.id) ?? new Map(), index),
          }
        : null
    return { imports: imports.length, intervals: intervals.reverse(), overall }
  }

  /**
   * Themed-collection missions (Fase 8) against the collection: each slot with the copies owned among its options and
   * the cards that count; by expansion (newest first), incomplete first within each.
   */
  async missions(query: { expansion?: string | undefined; incomplete?: boolean | undefined }): Promise<MissionsView> {
    const index = this.catalog.requireIndex()
    const { stock } = await this.repository.loadState()
    const all = index.catalog.missions ?? []
    const progress = missionProgress(
      all.filter((mission) => !query.expansion || mission.expansionId === query.expansion),
      index,
      (stockCardId) => stock[stockCardId]?.amountOwned ?? 0,
    ).filter((item) => !query.incomplete || !item.complete)
    const order = new Map(index.catalog.expansions.map((expansion, at) => [expansion.id, at]))
    // Review of #87: the cards and expansions a reward names, in Spanish when the catalog knows them.
    const cardsEs = new Map<string, string>()
    for (const card of index.catalog.cards) if (!cardsEs.has(card.nameEn)) cardsEs.set(card.nameEn, card.nameEs)
    const expansionsEs = new Map(index.catalog.expansions.map((expansion) => [expansion.nameEn, expansion.nameEs]))
    const rewardNames = {
      card: (nameEn: string) => cardsEs.get(nameEn) ?? null,
      expansion: (nameEn: string) => expansionsEs.get(nameEn) ?? null,
    }
    const items = progress
      .sort(
        (a, b) =>
          (order.get(b.mission.expansionId) ?? 0) - (order.get(a.mission.expansionId) ?? 0) ||
          Number(a.complete) - Number(b.complete) ||
          a.missingCopies - b.missingCopies,
      )
      .map((item) => ({
        expansionId: item.mission.expansionId,
        expansionNameEs: index.expansionById(item.mission.expansionId)?.nameEs ?? item.mission.expansionId,
        name: item.mission.name,
        // Phone review: in Spanish (the app's names, to be confirmed by Santi).
        reward: item.mission.reward === null ? null : rewardEs(item.mission.reward, rewardNames),
        secret: item.mission.secret,
        complete: item.complete,
        missingCopies: item.missingCopies,
        slots: item.slots.map((slot) => {
          const first = index.cardById(slot.options[0] ?? '')
          return {
            amount: slot.amount,
            have: slot.have,
            nameEs: first?.nameEs ?? slot.options[0] ?? '?',
            options: slot.options.map((cardId) => ({ cardId, rarity: index.cardById(cardId)?.rarity ?? null })),
          }
        }),
      }))
    const expansions = [...new Set(all.map((mission) => mission.expansionId))]
      .sort((a, b) => (order.get(b) ?? 0) - (order.get(a) ?? 0))
      .map((id) => {
        return {
          id,
          nameEs: index.expansionById(id)?.nameEs ?? id,
          missions: all.filter((mission) => mission.expansionId === id).length,
        }
      })
    return {
      total: all.length,
      complete: missionProgress(all, index, (unit) => stock[unit]?.amountOwned ?? 0).filter((item) => item.complete)
        .length,
      expansions,
      items,
    }
  }

  /** One row per functional group, in catalog order or by search relevance when `q` is given. */
  async groups(query: GroupsQuery): Promise<Page<CollectionGroupItem>> {
    const index = this.catalog.requireIndex()
    const { stock, adjustments } = await this.repository.loadState()
    const playable = playableCopies(index, stock, adjustments)
    const candidates = query.q
      ? index
          .searchGroups(query.q, { lang: 'any', limit: Number.MAX_SAFE_INTEGER })
          .filter((hit) => hit.matchedOn !== 'text')
          .map((hit) => hit.group)
      : index.catalog.groups
    const items: CollectionGroupItem[] = []
    for (const group of candidates) {
      if (query.expansion && !group.cardIds.some((id) => index.cardById(id)?.expansionId === query.expansion)) continue
      const copies = playable.get(group.id)
      if (!copies) continue
      if (query.missingOnly && copies.playable > 0) continue
      items.push({
        group: toGroupSummary(group),
        playable: copies.playable,
        fromStock: copies.fromStock,
        hasAdjustment: copies.adjustment !== null,
      })
    }
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length }
  }

  /** One row per edition (twins show the same stock unit), in catalog order or by search relevance. */
  async stock(query: StockQuery): Promise<Page<StockItem>> {
    const index = this.catalog.requireIndex()
    const stock = await this.repository.loadStock()
    const candidates = query.q
      ? index
          .search(query.q, { lang: 'any', limit: Number.MAX_SAFE_INTEGER })
          .filter((hit) => hit.matchedOn !== 'text')
          .map((hit) => hit.card)
      : index.catalog.cards
    const items: StockItem[] = []
    for (const card of candidates) {
      if (query.expansion && card.expansionId !== query.expansion) continue
      const value = stockValueOf(stock, card.stockCardId)
      if (query.onlyOwned && value.amountOwned === 0) continue
      items.push({
        card: toCardSummary(card),
        owned: value.amountOwned,
        collected: value.collected,
        twinCardIds: (index.stockById(card.stockCardId)?.cardIds ?? []).filter((id) => id !== card.id),
      })
    }
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length }
  }

  /** Manual edit through the stock unit (twins move together); reports the active adjustment of the group (rule c). */
  async patchStock(cardId: string, patch: StockPatch): Promise<StockPatchResult> {
    const index = this.catalog.requireIndex()
    if (!index.cardById(cardId)) throw new NotFoundException(`Carta ${cardId} no encontrada.`)
    const { stock, adjustments } = await this.repository.loadState()
    const result = manualEdit(index, stock, cardId, patch)
    await this.repository.writeManualStock(result.stockCardId, result.after)
    const adjustment = adjustmentForCard(index, adjustments, cardId)
    return {
      stockCardId: result.stockCardId,
      cardIds: result.cardIds,
      affectedTwinIds: result.affectedTwinIds,
      before: result.before ? { amountOwned: result.before.amountOwned, collected: result.before.collected } : null,
      after: { amountOwned: result.after.amountOwned, collected: result.after.collected },
      activeAdjustment: adjustment ? this.activeView(index, adjustment) : null,
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Imports
  // ---------------------------------------------------------------------------------------------------------------

  /** Parses, normalizes and diffs the CSV, stores the snapshot as `pending` and returns the preview. */
  async createImport(source: ImportSource): Promise<ImportPreview> {
    const index = this.catalog.requireIndex()
    const parsed = parseTrackerCsv(source.bytes)
    if (parsed.rows.length === 0 && parsed.errors.length > 0) {
      throw new BadRequestException({
        code: 'invalid_csv',
        message: 'El archivo no tiene el formato de exportación del tracker.',
        details: parsed.errors,
      })
    }
    const preview = await this.createRows(index, parsed, source)
    if ('unchanged' in preview) throw new Error('CSV preview missing')
    return preview
  }

  async createTrackerImport(
    rows: readonly TrackerCollectionRow[],
    friendId: string,
    automatic = false,
    checkedAt = new Date(),
    upstreamReview?: string,
  ): Promise<ImportPreview | UnchangedRemoteImport> {
    const index = this.catalog.requireIndex()
    const csvRows = trackerImportRows(rows, index)
    return this.createRows(
      index,
      { rows: csvRows, errors: [], bom: false, lineEnding: 'LF' },
      { bytes: Buffer.from(JSON.stringify(rows)), fileName: `Tracker ${friendId}` },
      {
        source: 'tracker',
        friendId,
        automatic,
        checkedAt,
        ...(upstreamReview ? { upstreamReview } : {}),
      },
    )
  }

  /**
   * T-020: the export of ptcgpocket.gg (the game's collection), already parsed and mapped onto the catalog, through
   * the same importer: a complete snapshot like the tracker's, with its own review (first sync, drops, manual edits,
   * cards the catalog does not have, expansions it does not list).
   */
  async createDotggImport(
    parsed: ParsedDotgg,
    bytes: Buffer,
    options: { automatic: boolean; checkedAt: Date; linkFingerprint: string },
  ): Promise<ImportPreview | UnchangedRemoteImport> {
    const index = this.catalog.requireIndex()
    const mapped = mapDotggRows(parsed.rows, index)
    return this.createRows(
      index,
      { rows: mapped.rows, errors: parsed.errors, bom: parsed.bom, lineEnding: parsed.lineEnding },
      { bytes, fileName: DOTGG_SOURCE_NAME },
      { source: 'dotgg', unmatched: mapped.unmatched, renamed: mapped.renamed, ...options },
    )
  }

  private async createRows(
    index: CatalogIndex,
    parsed: ImportInput,
    source: ImportSource,
    remote?: RemoteImport,
  ): Promise<ImportPreview | UnchangedRemoteImport> {
    const normalized = normalizeImportRows(parsed.rows, index)
    const client = await this.prisma.pool.connect()
    try {
      await client.query('BEGIN')
      // Same lock order as apply; also excludes catalogue remaps and manual/MCP collection writes.
      await client.query('LOCK TABLE cards, collection_stock, collection_adjustments IN SHARE ROW EXCLUSIVE MODE')
      await client.query('SELECT pg_advisory_xact_lock(994202)')
      if (remote) await this.requireRemoteConfig(client, remote, true)
      const { stock, adjustments, baseline } = await this.importBaseline(client, index)
      const incoming = this.remoteUnits(index, remote?.source, normalized.units, stock)
      const diff = diffImport(index, stock, incoming, adjustments)
      const tracker =
        remote?.source === 'tracker'
          ? await this.trackerReview(client, diff, stock, remote.friendId ?? '', baseline, normalized.unknownIds)
          : undefined
      if (tracker && remote?.upstreamReview) {
        tracker.reviewReasons?.push(remote.upstreamReview)
        tracker.requiresReview = true
      }
      const dotgg =
        remote?.source === 'dotgg'
          ? await this.dotggReview(client, index, diff, stock, baseline, normalized, remote, parsed)
          : undefined
      if (remote) {
        const keys = REMOTE_KEYS[remote.source]
        await client.query(
          "UPDATE collection_imports SET status = 'discarded' WHERE source = $1 AND status = 'pending'",
          [remote.source],
        )
        await client.query('DELETE FROM app_settings WHERE key = $1', [keys.warning])
        await this.pruneRemoteImports(client, remote.source)
      }
      if (remote?.automatic && diff.changes.length === 0) {
        await client.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [REMOTE_KEYS[remote.source].lastChecked, JSON.stringify(remote.checkedAt.toISOString())],
        )
        await client.query('COMMIT')
        return { unchanged: true, reviewReasons: tracker?.reviewReasons ?? dotgg?.reviewReasons ?? [] }
      }
      const stored: StoredImport = {
        ...(tracker ? { tracker } : {}),
        ...(dotgg ? { dotgg } : {}),
        meta: {
          bom: parsed.bom,
          lineEnding: parsed.lineEnding,
          errors: parsed.errors,
          conflicts: normalized.conflicts,
          internalIdMismatches: normalized.internalIdMismatches.length,
          twinRows: normalized.twinRows,
        },
        diff,
      }
      const created = await client.query<{ id: number }>(
        `INSERT INTO collection_imports (source, file_name, sha256, row_count, naive_total, dedup_total, unknown_ids, diff_summary, raw_file_gz)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
        [
          remote?.source ?? 'csv',
          source.fileName ?? '',
          createHash('sha256').update(source.bytes).digest('hex'),
          parsed.rows.length,
          normalized.naiveTotal,
          normalized.dedupTotal,
          normalized.unknownIds,
          JSON.stringify(toJson(stored)),
          gzipSync(source.bytes),
        ],
      )
      const id = created.rows[0]?.id
      if (!id) throw new Error('Import insert returned no id')
      const uniqueRows = new Map<string, CsvRow>()
      for (const csvRow of parsed.rows) if (!uniqueRows.has(csvRow.id)) uniqueRows.set(csvRow.id, csvRow)
      await upsertMany(
        client,
        'collection_import_rows',
        ['import_id', 'card_id', 'internal_id', 'number_owned', 'collected'],
        [...uniqueRows.values()].map((r) => [id, r.id, r.internalId, r.numberOwned, r.collected]),
        ['import_id', 'card_id'],
      )
      await client.query('COMMIT')
      const row = await this.requireImport(String(id))
      return this.toPreview(index, row, stored)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async listImports(): Promise<ImportListItem[]> {
    const rows = await this.prisma.collectionImport.findMany({ orderBy: { id: 'desc' }, omit: { rawFileGz: true } })
    return rows.map((row) => {
      const stored = readStored(row)
      return {
        source: row.source,
        id: idToString(row.id),
        fileName: row.fileName === '' ? null : row.fileName,
        importedAt: row.importedAt,
        appliedAt: row.appliedAt,
        status: row.status,
        rowCount: row.rowCount,
        naiveTotal: row.naiveTotal,
        dedupTotal: row.dedupTotal,
        blocked: isBlocked(stored),
        summary: stored.diff.summary,
      }
    })
  }

  /**
   * The preview; a pending CSV import is diffed again against the current stock (it may have moved since). A remote
   * snapshot (tracker, ptcgpocket.gg) keeps the diff it was reviewed with: applying it refuses a moved collection.
   */
  async importPreview(rawId: string): Promise<ImportPreview> {
    const index = this.catalog.requireIndex()
    const row = await this.requireImport(rawId)
    const stored = readStored(row)
    if (row.status === 'pending' && row.source === 'csv') {
      const { stock, adjustments } = await this.repository.loadState()
      stored.diff = diffImport(index, stock, this.unitsOf(index, row.rows), adjustments)
    }
    return this.toPreview(index, row, stored)
  }

  /**
   * Applies a pending import in one SQL transaction: every changed stock unit is upserted (source `import`, `tracker`
   * or `dotgg`), the row is marked `applied` with the diff that was actually applied. 409 when not pending or blocked,
   * and for a tracker snapshot while ptcgpocket.gg is the source (T-020).
   */
  async applyImport(
    rawId: string,
    automatic = false,
    linkFingerprint?: string,
  ): Promise<{ applied: true; summary: ImportDiff['summary'] }> {
    const index = this.catalog.requireIndex()
    const row = await this.requireImport(rawId)
    if (row.status !== 'pending') throw notPending(row)
    const stored = readStored(row)
    if (isBlocked(stored)) {
      throw new ConflictException({
        code: 'import_blocked',
        message: 'El archivo tiene errores o gemelas con valores distintos; corregilo y volvé a importarlo.',
      })
    }
    const source = remoteSourceOf(row.source)
    const units = this.unitsOf(index, row.rows)
    const client = await this.prisma.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE cards, collection_stock, collection_adjustments IN SHARE ROW EXCLUSIVE MODE')
      await client.query('SELECT pg_advisory_xact_lock(994202)')
      if (source)
        await this.requireRemoteConfig(client, {
          source,
          automatic,
          checkedAt: new Date(),
          friendId: stored.tracker?.friendId ?? '',
          ...(linkFingerprint ? { linkFingerprint } : {}),
        })
      const locked = await client.query<{ status: string }>(
        'SELECT status FROM collection_imports WHERE id = $1 FOR UPDATE',
        [row.id],
      )
      if (locked.rows[0]?.status !== 'pending') throw notPending(row)
      const { stock: current, adjustments, baseline } = await this.importBaseline(client, index)
      if (source === 'tracker' && (!stored.tracker || stored.tracker.baseline !== baseline)) {
        throw new ConflictException({
          code: 'tracker_stale_preview',
          message: 'La colección, sus ajustes o el catálogo cambiaron. Obtené otra vista previa antes de aplicar.',
        })
      }
      if (source === 'dotgg' && (!stored.dotgg || stored.dotgg.baseline !== baseline)) {
        throw new ConflictException({
          code: 'dotgg_stale_preview',
          message:
            'La colección, sus ajustes o el catálogo cambiaron. Sincronizá otra vez con ptcgpocket.gg antes de aplicar.',
        })
      }
      const diff = diffImport(index, current, this.remoteUnits(index, source, units, current), adjustments)
      if (automatic && source === 'tracker') {
        const review = await this.trackerReview(
          client,
          diff,
          current,
          stored.tracker?.friendId ?? '',
          baseline,
          row.unknownIds,
        )
        if (review.requiresReview || stored.tracker?.requiresReview)
          throw new ConflictException({ code: 'tracker_review', message: review.reviewReasons?.join(' ') })
      }
      if (automatic && source === 'dotgg' && (!stored.dotgg || stored.dotgg.requiresReview)) {
        throw new ConflictException({ code: 'dotgg_review', message: stored.dotgg?.reviewReasons.join(' ') ?? '' })
      }
      const appliedAt = new Date()
      await upsertMany(
        client,
        'collection_stock',
        ['card_id', 'amount_owned', 'collected', 'source', 'import_id', 'updated_at'],
        diff.changes.map((change) => [
          change.stockCardId,
          change.after.amountOwned,
          change.after.collected,
          source ?? 'import',
          row.id,
          appliedAt,
        ]),
        ['card_id'],
        { casts: { source: '$n::collection_stock_source' } },
      )
      stored.diff = diff
      await client.query(
        'UPDATE collection_imports SET status = $2::collection_import_status, applied_at = $3, diff_summary = $4 WHERE id = $1',
        [row.id, 'applied', appliedAt, JSON.stringify(toJson(stored))],
      )
      if (source) {
        const keys = REMOTE_KEYS[source]
        await client.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, $3)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [keys.lastApplied, JSON.stringify(appliedAt.toISOString()), appliedAt],
        )
        await client.query(
          `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [keys.lastChecked, JSON.stringify(appliedAt.toISOString())],
        )
        if (source === 'tracker') {
          await client.query(
            `INSERT INTO app_settings (key, value) VALUES ('trackerLastAppliedCommit', $1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [JSON.stringify(this.catalog.trackerCommit)],
          )
        }
        await client.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (key) DO UPDATE SET value = app_settings.value || EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [
            keys.state,
            JSON.stringify({ result: 'applied', error: null, previewId: String(row.id), automatic }),
            appliedAt,
          ],
        )
        await this.pruneRemoteImports(client, source)
        await client.query('DELETE FROM app_settings WHERE key = $1', [keys.warning])
      }
      // Any successful import (including CSV) resolves the previous automatic warning of the tracker.
      await client.query("DELETE FROM app_settings WHERE key = 'trackerSyncWarning'")
      await client.query('COMMIT')
      return { applied: true, summary: diff.summary }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async discardImport(rawId: string): Promise<void> {
    const row = await this.requireImport(rawId)
    if (row.status !== 'pending') throw notPending(row)
    const source = remoteSourceOf(row.source)
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(994202)`
      const discarded = await tx.collectionImport.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'discarded' },
      })
      if (!discarded.count) throw notPending(row)
      if (source) {
        // An older preview must not clear a warning for a newer one.
        await tx.$executeRaw`DELETE FROM app_settings WHERE key = ${REMOTE_KEYS[source].warning} AND value->>'previewId' = ${String(row.id)}`
      }
    })
  }

  /** The collection in the tracker's exact format (BOM + LF, Spanish names, twins identical, no trailing newline). */
  async exportCsv(): Promise<Buffer> {
    const index = this.catalog.requireIndex()
    const stock = await this.repository.loadStock()
    return Buffer.from(writeTrackerCsv(index, stock), 'utf8')
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Adjustments (PLAN §3.2 rules a–d)
  // ---------------------------------------------------------------------------------------------------------------

  async listAdjustments(active: boolean | undefined): Promise<CollectionAdjustmentView[]> {
    const index = this.catalog.requireIndex()
    const [rows, stock] = await Promise.all([
      this.prisma.collectionAdjustment.findMany({
        where: active === undefined ? {} : { active },
        orderBy: [{ active: 'desc' }, { id: 'desc' }],
      }),
      this.repository.loadStock(),
    ])
    return rows.map((row) => this.adjustmentView(index, stock, row))
  }

  async createAdjustment(input: {
    functionalGroupId: string
    playableCopies: number
    reason: string
  }): Promise<CollectionAdjustmentView> {
    const index = this.catalog.requireIndex()
    if (!index.groupById(input.functionalGroupId)) {
      throw new NotFoundException(`Carta funcional ${input.functionalGroupId} no encontrada.`)
    }
    const existing = await this.prisma.collectionAdjustment.findFirst({
      where: { functionalGroupId: input.functionalGroupId, active: true },
    })
    if (existing) throw activeExists(input.functionalGroupId)
    let row: AdjustmentRow
    try {
      row = await this.prisma.collectionAdjustment.create({ data: input })
    } catch (error) {
      if (isUniqueViolation(error)) throw activeExists(input.functionalGroupId)
      throw error
    }
    return this.adjustmentView(index, await this.repository.loadStock(), row)
  }

  async resolveAdjustment(rawId: string, resolution: AdjustmentResolution): Promise<CollectionAdjustmentView> {
    const index = this.catalog.requireIndex()
    const row = await this.requireAdjustment(rawId)
    if (!row.active) throw inactive()
    const updated = await this.prisma.collectionAdjustment.update({
      where: { id: row.id },
      data: { active: false, resolvedAt: new Date(), resolution },
    })
    return this.adjustmentView(index, await this.repository.loadStock(), updated)
  }

  /** Rule (d): the adjustment becomes a manual edit of `targetCardId` and is resolved as `converted`. */
  async convertAdjustment(rawId: string, targetCardId: string): Promise<AdjustmentConversionResult> {
    const index = this.catalog.requireIndex()
    const row = await this.requireAdjustment(rawId)
    const stock = await this.repository.loadStock()
    const plan = planAdjustmentConversion(index, stock, toDomainAdjustment(row), targetCardId)
    if (!plan.ok) {
      const message = CONVERSION_MESSAGES[plan.code]
      if (plan.code === 'inactive') throw inactive()
      if (plan.code === 'unknown_card') throw new NotFoundException(`Carta ${targetCardId} no encontrada.`)
      throw new BadRequestException({ code: `conversion_${plan.code}`, message, details: plan })
    }
    const edit = manualEdit(index, stock, targetCardId, { amountOwned: plan.amountAfter })
    const [, updated] = await this.prisma.$transaction([
      this.prisma.collectionStock.upsert({
        where: { cardId: edit.stockCardId },
        create: {
          cardId: edit.stockCardId,
          amountOwned: edit.after.amountOwned,
          collected: edit.after.collected,
          source: 'manual',
        },
        update: {
          amountOwned: edit.after.amountOwned,
          collected: edit.after.collected,
          source: 'manual',
          importId: null,
        },
      }),
      this.prisma.collectionAdjustment.update({
        where: { id: row.id },
        data: { active: false, resolvedAt: new Date(), resolution: 'converted' },
      }),
    ])
    return {
      adjustment: this.adjustmentView(index, edit.stock, updated),
      stockCardId: edit.stockCardId,
      affectedTwinIds: edit.affectedTwinIds,
      before: edit.before ? { amountOwned: edit.before.amountOwned, collected: edit.before.collected } : null,
      after: { amountOwned: edit.after.amountOwned, collected: edit.after.collected },
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------------------------

  /** The import with its rows; the raw CSV blob stays in the database (nothing here needs it). */
  private async requireImport(rawId: string): Promise<ImportRecord & { rows: ImportRowLike[] }> {
    const id = parseNumericId(rawId, 'Importación')
    const row = await this.prisma.collectionImport.findUnique({
      where: { id },
      include: { rows: true },
      omit: { rawFileGz: true },
    })
    if (!row) throw new NotFoundException(`Importación ${rawId} no encontrada.`)
    return row
  }

  private async importBaseline(client: PoolClient, index: CatalogIndex) {
    const catalog = await client.query<{ id: number }>(
      "SELECT id FROM catalog_syncs WHERE status IN ('applied', 'needs_review') ORDER BY id DESC LIMIT 1",
    )
    if (catalog.rows[0]?.id !== this.catalog.loadedSyncId || index !== this.catalog.requireIndex()) {
      throw new ConflictException({
        code: 'catalog_changed',
        message: 'El catálogo cambió. Volvé a obtener una vista previa.',
      })
    }
    const stockRows = await client.query<{ cardId: string; amountOwned: number; collected: boolean }>(
      'SELECT card_id AS "cardId", amount_owned AS "amountOwned", collected, source, updated_at FROM collection_stock ORDER BY card_id',
    )
    const adjustmentRows =
      await client.query<AdjustmentRow>(`SELECT id, functional_group_id AS "functionalGroupId", playable_copies AS "playableCopies", reason, active,
      created_at AS "createdAt", resolved_at AS "resolvedAt", resolution FROM collection_adjustments WHERE active ORDER BY id`)
    const stock = stockFromRows(stockRows.rows)
    const adjustments = adjustmentRows.rows.map(toDomainAdjustment)
    const baseline = createHash('sha256')
      .update(JSON.stringify([catalog.rows[0]?.id, stockRows.rows, adjustments]))
      .digest('hex')
    return { stock, adjustments, baseline }
  }

  private async requireAdjustment(rawId: string): Promise<AdjustmentRow> {
    const id = parseNumericId(rawId, 'Ajuste')
    const row = await this.prisma.collectionAdjustment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Ajuste ${rawId} no encontrado.`)
    return row
  }

  /** Stored rows → stock units (same fold as the original normalization; line numbers are not needed here). */
  private unitsOf(index: CatalogIndex, rows: readonly ImportRowLike[]): StockQuantities {
    const csvRows: CsvRow[] = rows.map((row, at) => ({
      line: at + 2,
      id: row.cardId,
      internalId: row.internalId,
      numberOwned: row.numberOwned,
      collected: row.collected,
      cardName: null,
      expansion: null,
      pack: null,
      rarity: null,
    }))
    return normalizeImportRows(csvRows, index).units
  }

  /** What a source's units mean: a CSV merges, the tracker and ptcgpocket.gg are the whole collection. */
  private remoteUnits(
    index: CatalogIndex,
    source: RemoteSource | null | undefined,
    units: StockQuantities,
    current: StockQuantities,
  ): StockQuantities {
    if (source === 'tracker') return trackerUnits(units, index)
    if (source === 'dotgg') return dotggUnits(units, index, current)
    return units
  }

  private async trackerReview(
    client: PoolClient,
    diff: ImportDiff,
    stock: StockQuantities,
    friendId: string,
    baseline: string,
    unknownIds: readonly string[],
  ): Promise<NonNullable<ImportPreview['tracker']>> {
    const stats = trackerDiffStats(diff, totalCopies(stock))
    const reviewReasons: string[] = []
    if (stats.requiresReview)
      reviewReasons.push(`Bajan ${stats.removedCopies} de ${stats.currentCopies} copias (más del 10 %).`)
    const settings = await client.query<{ key: string; value: unknown }>(
      "SELECT key, value FROM app_settings WHERE key IN ('trackerLastAppliedAt', 'trackerLastAppliedCommit')",
    )
    const values = Object.fromEntries(settings.rows.map((r) => [r.key, r.value]))
    const manual = await client.query<{ card_id: string }>(
      `SELECT card_id FROM collection_stock WHERE source = 'manual' AND card_id = ANY($1::text[])
       AND updated_at > $2::timestamptz`,
      [diff.changes.map((c) => c.stockCardId), values.trackerLastAppliedAt ?? new Date(0).toISOString()],
    )
    if (manual.rowCount)
      reviewReasons.push(
        `${manual.rowCount} unidades tienen cambios manuales posteriores a la última sincronización aplicada.`,
      )
    // T-020: back to the tracker after ptcgpocket.gg (link removed), its first sync never overwrites the game's numbers
    // by itself: the tracker is usually behind the game.
    const fromGame = await client.query<{ card_id: string }>(
      `SELECT card_id FROM collection_stock WHERE source = 'dotgg' AND card_id = ANY($1::text[])
       AND updated_at > $2::timestamptz`,
      [diff.changes.map((c) => c.stockCardId), values.trackerLastAppliedAt ?? new Date(0).toISOString()],
    )
    const gameCount = fromGame.rowCount ?? 0
    if (gameCount > 0)
      reviewReasons.push(
        gameCount === 1
          ? '1 carta tiene el número del juego (ptcgpocket.gg) posterior a la última sincronización del tracker.'
          : `${count(gameCount)} cartas tienen el número del juego (ptcgpocket.gg) posterior a la última sincronización del tracker.`,
      )
    if (unknownIds.length) reviewReasons.push(`Hay ${unknownIds.length} internal_id desconocidos; revisá el catálogo.`)
    if (
      typeof values.trackerLastAppliedCommit === 'string' &&
      values.trackerLastAppliedCommit !== this.catalog.trackerCommit
    )
      reviewReasons.push(
        'El commit del catálogo cambió desde la última sincronización aplicada; revisá los internal_id.',
      )
    return {
      friendId,
      baseline,
      catalogCommit: this.catalog.trackerCommit,
      ...stats,
      requiresReview: reviewReasons.length > 0,
      reviewReasons,
    }
  }

  /**
   * T-020: what makes a ptcgpocket.gg snapshot wait for Santi instead of applying by itself — gross drops above 10 %,
   * the first sync, manual edits since the last applied one, cards the catalog does not have, expansions with copies
   * that the export does not list, and rows it cannot read.
   */
  private async dotggReview(
    client: PoolClient,
    index: CatalogIndex,
    diff: ImportDiff,
    stock: StockQuantities,
    baseline: string,
    normalized: NormalizedImport,
    remote: RemoteImport,
    parsed: ImportInput,
  ): Promise<DotggReviewView> {
    const unmatched = remote.unmatched ?? []
    const renamed = remote.renamed ?? []
    const stats = trackerDiffStats(diff, totalCopies(stock))
    const reasons: string[] = []
    const changed = diff.changes.length > 0
    if (stats.requiresReview) {
      reasons.push(`Bajan ${count(stats.removedCopies)} de ${count(stats.currentCopies)} copias (más del 10 %).`)
    }
    const applied = await client.query<{ value: unknown }>('SELECT value FROM app_settings WHERE key = $1', [
      REMOTE_KEYS.dotgg.lastApplied,
    ])
    const lastApplied = applied.rows[0]?.value
    if (changed && typeof lastApplied !== 'string') {
      reasons.push('Es la primera sincronización con ptcgpocket.gg: revisá los cambios antes de aplicarlos.')
    }
    const manual = await client.query<{ card_id: string }>(
      `SELECT card_id FROM collection_stock WHERE source = 'manual' AND card_id = ANY($1::text[])
       AND updated_at > $2::timestamptz`,
      [
        diff.changes.map((c) => c.stockCardId),
        typeof lastApplied === 'string' ? lastApplied : new Date(0).toISOString(),
      ],
    )
    const manualCount = manual.rowCount ?? 0
    if (manualCount > 0) {
      reasons.push(
        manualCount === 1
          ? '1 carta tiene un cambio manual posterior a la última sincronización aplicada.'
          : `${count(manualCount)} cartas tienen cambios manuales posteriores a la última sincronización aplicada.`,
      )
    }
    if (unmatched.length > 0) {
      const copies = unmatched.reduce((sum, row) => sum + row.copies, 0)
      reasons.push(
        `ptcgpocket.gg trae ${unmatched.length === 1 ? '1 carta' : `${count(unmatched.length)} cartas`} que el catálogo no tiene (${copies === 1 ? '1 copia' : `${count(copies)} copias`}): sincronizá el catálogo o revisá la lista.`,
      )
    }
    if (renamed.length > 0) {
      reasons.push(
        `ptcgpocket.gg trae ${renamed.length === 1 ? '1 carta' : `${count(renamed.length)} cartas`} con el nombre de otra carta del catálogo (${renamed
          .slice(0, 3)
          .map((row) => row.cardId)
          .join(', ')}${renamed.length > 3 ? '…' : ''}): puede que numere distinto esa expansión.`,
      )
    }
    const missingExpansions = changed
      ? dotggMissingExpansions(index, stock, normalized.units).map((item) => ({
          ...item,
          nameEs: index.expansionById(item.expansionId)?.nameEs ?? item.expansionId,
        }))
      : []
    if (missingExpansions.length > 0) {
      const copies = missingExpansions.reduce((sum, item) => sum + item.copies, 0)
      reasons.push(
        `La exportación no trae ninguna carta de ${missingExpansions.map((item) => item.expansionId).join(', ')} y la colección tiene ${copies === 1 ? '1 copia' : `${count(copies)} copias`} ahí: puede que ptcgpocket.gg todavía no conozca la expansión.`,
      )
    }
    if (parsed.errors.length > 0) {
      reasons.push(
        `La exportación tiene ${parsed.errors.length === 1 ? '1 fila' : `${count(parsed.errors.length)} filas`} con errores: así no se puede aplicar.`,
      )
    }
    if (normalized.conflicts.length > 0) {
      reasons.push(
        `La exportación trae reimpresiones de una misma carta con cantidades distintas (${count(normalized.conflicts.length)}): así no se puede aplicar.`,
      )
    }
    return {
      baseline,
      increased: stats.increased,
      decreased: stats.decreased,
      removedCopies: stats.removedCopies,
      currentCopies: stats.currentCopies,
      requiresReview: reasons.length > 0,
      reviewReasons: reasons,
      unmatched: [...unmatched],
      renamed: [...renamed],
      missingExpansions,
    }
  }

  /**
   * Who may write the collection right now (inside the import's transaction, under lock 994202):
   * - the tracker, only while no ptcgpocket.gg link is stored (T-020) — an unreadable one counts too, so a changed
   *   SESSION_SECRET never hands the collection back to the tracker by itself;
   * - a ptcgpocket.gg snapshot, only with its link there: when it is created and when it is applied (a pending one
   *   that came back with a backup after the link was removed does not apply);
   * - a new ptcgpocket.gg snapshot, only if the link is still the one it was read from (also by hand);
   * - an automatic run, only with its switch still on and the same friend id or link it read.
   */
  private async requireRemoteConfig(client: PoolClient, remote: RemoteImport, creating = false): Promise<void> {
    const keys = REMOTE_KEYS[remote.source]
    const rows = await client.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
      [[keys.auto, 'trackerFriendId']],
    )
    const config = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]))
    const secret = await client.query<{ value: string }>('SELECT value FROM app_secrets WHERE key = $1', [
      DOTGG_LINK_KEY,
    ])
    const stored = secret.rows[0]?.value
    const link = this.links.open(stored)
    if (remote.source === 'tracker') {
      if (stored) throw new ConflictException({ code: 'tracker_not_master', message: TRACKER_NOT_MASTER })
      if (remote.automatic && (config.trackerAutoSync !== true || config.trackerFriendId !== remote.friendId))
        throw new ConflictException({
          code: 'tracker_config_changed',
          message: 'La configuración del tracker cambió durante la consulta. No se aplicó nada.',
        })
      return
    }
    if (!link)
      throw new ConflictException({
        code: 'dotgg_not_configured',
        message: creating
          ? 'Se quitó el link de ptcgpocket.gg durante la consulta. No se aplicó nada.'
          : 'Sin el link de ptcgpocket.gg no se aplica una vista previa suya: pegalo en Ajustes y sincronizá de nuevo.',
      })
    if ((creating || remote.automatic) && this.links.fingerprint(link) !== remote.linkFingerprint)
      throw new ConflictException({
        code: 'dotgg_config_changed',
        message: 'El link de ptcgpocket.gg cambió durante la consulta. No se aplicó nada.',
      })
    if (remote.automatic && config.dotggAutoSync !== true)
      throw new ConflictException({
        code: 'dotgg_config_changed',
        message: 'Se apagó la sincronización automática con ptcgpocket.gg durante la consulta. No se aplicó nada.',
      })
  }

  /** Keep the first applied snapshot of a remote source and seven recent ones (pack luck compares them). */
  private async pruneRemoteImports(client: PoolClient, source: RemoteSource) {
    const removed = await client.query<{ id: number }>(
      `DELETE FROM collection_imports WHERE source = $1 AND (
        (status = 'applied' AND id NOT IN (
          SELECT id FROM collection_imports WHERE source = $1 AND status = 'applied' ORDER BY applied_at DESC, id DESC LIMIT 7
        ) AND id <> (SELECT id FROM collection_imports WHERE source = $1 AND status = 'applied' ORDER BY applied_at, id LIMIT 1))
        OR (status = 'discarded' AND id NOT IN (
          SELECT id FROM collection_imports WHERE source = $1 AND status = 'discarded' ORDER BY id DESC LIMIT 7
        ))
      ) RETURNING id`,
      [source],
    )
    if (removed.rows.length)
      await client.query('UPDATE collection_stock SET import_id = NULL WHERE import_id = ANY($1::int[])', [
        removed.rows.map((r) => r.id),
      ])
  }

  private toPreview(index: CatalogIndex, row: ImportRecord, stored: StoredImport): ImportPreview {
    const nameOf = (stockCardId: string): string => index.cardById(stockCardId)?.nameEs ?? stockCardId
    const changes: ImportChangeView[] = stored.diff.changes.map((change) => ({
      stockCardId: change.stockCardId,
      cardIds: change.cardIds,
      nameEs: nameOf(change.stockCardId),
      before: change.before,
      after: change.after,
    }))
    return {
      id: idToString(row.id),
      source: row.source,
      ...(stored.tracker ? { tracker: stored.tracker } : {}),
      ...(stored.dotgg ? { dotgg: stored.dotgg } : {}),
      fileName: row.fileName === '' ? null : row.fileName,
      status: row.status,
      importedAt: row.importedAt,
      appliedAt: row.appliedAt,
      sha256: row.sha256,
      rowCount: row.rowCount,
      naiveTotal: row.naiveTotal,
      dedupTotal: row.dedupTotal,
      bom: stored.meta.bom,
      lineEnding: stored.meta.lineEnding,
      errors: stored.meta.errors.map((error) => ({
        line: error.line,
        code: error.code,
        column: error.column,
        message: error.message,
      })),
      unknownIds: row.unknownIds,
      internalIdMismatches: stored.meta.internalIdMismatches,
      twinConflicts: stored.meta.conflicts,
      blocked: isBlocked(stored),
      summary: stored.diff.summary,
      changes,
      adjustmentsMatching: stored.diff.adjustmentsMatching.map((match) => ({
        adjustmentId: match.adjustmentId,
        groupId: match.groupId,
        nameEs: match.nameEs,
        playableCopies: match.playableCopies,
        stockSum: match.stockSum,
      })),
      adjustmentsHidingChange: stored.diff.adjustmentsHidingChange.map((hidden) => ({
        adjustmentId: hidden.adjustmentId,
        groupId: hidden.groupId,
        nameEs: hidden.nameEs,
        playableCopies: hidden.playableCopies,
        sumBefore: hidden.stockBefore,
        sumAfter: hidden.stockAfter,
      })),
    }
  }

  private activeView(index: CatalogIndex, adjustment: CollectionAdjustment): ActiveAdjustmentView {
    return {
      id: adjustment.id,
      functionalGroupId: adjustment.functionalGroupId,
      nameEs: index.groupById(adjustment.functionalGroupId)?.nameEs ?? adjustment.functionalGroupId,
      playableCopies: adjustment.playableCopies,
      reason: adjustment.reason,
      createdAt: new Date(adjustment.createdAt),
    }
  }

  private adjustmentView(index: CatalogIndex, stock: StockQuantities, row: AdjustmentRow): CollectionAdjustmentView {
    const group = index.groupById(row.functionalGroupId)
    let fromStock = 0
    for (const stockCardId of group?.stockCardIds ?? []) fromStock += stockValueOf(stock, stockCardId).amountOwned
    return {
      id: idToString(row.id),
      functionalGroupId: row.functionalGroupId,
      nameEs: group?.nameEs ?? row.functionalGroupId,
      playableCopies: row.playableCopies,
      fromStock,
      reason: row.reason,
      active: row.active,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      resolution: row.resolution,
    }
  }
}

/** Plain JSON copy (drops undefined, dates → ISO) typed as Prisma's input JSON. */
function toJson(value: unknown): InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as InputJsonObject
}

function readStored(row: ImportRecord): StoredImport {
  const raw = row.diffSummary as Partial<StoredImport> | null
  return {
    ...(raw?.tracker ? { tracker: raw.tracker } : {}),
    ...(raw?.dotgg ? { dotgg: raw.dotgg } : {}),
    meta: {
      bom: raw?.meta?.bom ?? true,
      lineEnding: raw?.meta?.lineEnding ?? 'LF',
      errors: raw?.meta?.errors ?? [],
      conflicts: raw?.meta?.conflicts ?? [],
      internalIdMismatches: raw?.meta?.internalIdMismatches ?? 0,
      twinRows: raw?.meta?.twinRows ?? 0,
    },
    diff: raw?.diff ?? EMPTY_DIFF,
  }
}

function isBlocked(stored: StoredImport): boolean {
  return stored.meta.errors.length > 0 || stored.meta.conflicts.length > 0
}

/** The remote source of an import row, or null for a CSV. */
export function remoteSourceOf(source: string): RemoteSource | null {
  return source === 'tracker' || source === 'dotgg' ? source : null
}

/** «5.043», as the app writes counts. */
function count(value: number): string {
  return value.toLocaleString('es-AR')
}

function notPending(row: ImportRecord): ConflictException {
  const state = row.status === 'applied' ? 'ya fue aplicada' : 'fue descartada'
  return new ConflictException({ code: 'import_not_pending', message: `La importación ${state}.` })
}

function inactive(): ConflictException {
  return new ConflictException({ code: 'adjustment_inactive', message: 'El ajuste ya no está activo.' })
}

function activeExists(groupId: string): ConflictException {
  return new ConflictException({
    code: 'adjustment_active',
    message: `Ya hay un ajuste activo para ${groupId}; resolvelo antes de crear otro.`,
  })
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}
