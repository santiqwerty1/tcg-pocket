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
  type CsvError,
  type CsvRow,
  diffImport,
  type ImportDiff,
  manualEdit,
  missionProgress,
  normalizeImportRows,
  type PackLuck,
  packLuck,
  parseTrackerCsv,
  planAdjustmentConversion,
  playableCopies,
  type StockQuantities,
  stockValueOf,
  type TwinConflict,
  totalCopies,
  writeTrackerCsv,
} from '@tcg/domain'
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
  ImportChangeView,
  ImportListItem,
  ImportPreview,
  MissionsView,
  Page,
  StockItem,
  StockPatchResult,
} from './collection-views.js'

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

/** What `collection_imports.diff_summary` holds: parse metadata (fixed) plus the diff (refreshed while pending). */
interface StoredImport {
  meta: {
    bom: boolean
    lineEnding: string
    errors: CsvError[]
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
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------------------------

  async summary(): Promise<CollectionSummaryView> {
    const index = this.catalog.requireIndex()
    const [{ stock, adjustments }, lastImport, collectedCount] = await Promise.all([
      this.repository.loadState(),
      this.prisma.collectionImport.findFirst({ where: { status: 'applied' }, orderBy: { appliedAt: 'desc' } }),
      this.prisma.collectionStock.count({ where: { collected: true } }),
    ])
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
      lastImportAt: lastImport?.appliedAt ?? null,
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
        reward: item.mission.reward,
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
    const normalized = normalizeImportRows(parsed.rows, index)
    const { stock, adjustments } = await this.repository.loadState()
    const diff = diffImport(index, stock, normalized.units, adjustments)
    const stored: StoredImport = {
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
    const row = await this.prisma.collectionImport.create({
      data: {
        fileName: source.fileName ?? '',
        sha256: createHash('sha256').update(source.bytes).digest('hex'),
        rowCount: parsed.rows.length,
        naiveTotal: normalized.naiveTotal,
        dedupTotal: normalized.dedupTotal,
        unknownIds: normalized.unknownIds,
        diffSummary: toJson(stored),
        rawFileGz: gzipSync(source.bytes),
        rows: {
          createMany: {
            data: parsed.rows.map((csvRow) => ({
              cardId: csvRow.id,
              internalId: csvRow.internalId,
              numberOwned: csvRow.numberOwned,
              collected: csvRow.collected,
            })),
            skipDuplicates: true,
          },
        },
      },
    })
    return this.toPreview(index, row, stored)
  }

  async listImports(): Promise<ImportListItem[]> {
    const rows = await this.prisma.collectionImport.findMany({ orderBy: { id: 'desc' }, omit: { rawFileGz: true } })
    return rows.map((row) => {
      const stored = readStored(row)
      return {
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

  /** The preview; a pending import is diffed again against the current stock (it may have moved since). */
  async importPreview(rawId: string): Promise<ImportPreview> {
    const index = this.catalog.requireIndex()
    const row = await this.requireImport(rawId)
    const stored = readStored(row)
    if (row.status === 'pending') {
      const { stock, adjustments } = await this.repository.loadState()
      stored.diff = diffImport(index, stock, this.unitsOf(index, row.rows), adjustments)
    }
    return this.toPreview(index, row, stored)
  }

  /**
   * Applies a pending import in one SQL transaction: every changed stock unit is upserted (source `import`), the
   * row is marked `applied` with the diff that was actually applied. 409 when not pending or blocked.
   */
  async applyImport(rawId: string): Promise<{ applied: true; summary: ImportDiff['summary'] }> {
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
    const incoming = this.unitsOf(index, row.rows)
    const adjustments = await this.repository.loadActiveAdjustments()
    const client = await this.prisma.pool.connect()
    try {
      await client.query('BEGIN')
      const locked = await client.query<{ status: string }>(
        'SELECT status FROM collection_imports WHERE id = $1 FOR UPDATE',
        [row.id],
      )
      if (locked.rows[0]?.status !== 'pending') throw notPending(row)
      const currentRows = await client.query<{ card_id: string; amount_owned: number; collected: boolean }>(
        'SELECT card_id, amount_owned, collected FROM collection_stock',
      )
      const current = stockFromRows(
        currentRows.rows.map((r) => ({ cardId: r.card_id, amountOwned: r.amount_owned, collected: r.collected })),
      )
      const diff = diffImport(index, current, incoming, adjustments)
      const appliedAt = new Date()
      await upsertMany(
        client,
        'collection_stock',
        ['card_id', 'amount_owned', 'collected', 'source', 'import_id', 'updated_at'],
        diff.changes.map((change) => [
          change.stockCardId,
          change.after.amountOwned,
          change.after.collected,
          'import',
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
    await this.prisma.collectionImport.update({ where: { id: row.id }, data: { status: 'discarded' } })
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
