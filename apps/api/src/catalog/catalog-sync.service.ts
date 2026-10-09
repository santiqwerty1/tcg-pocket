import { ConflictException, Injectable, type OnModuleInit } from '@nestjs/common'
import {
  type BuildCounts,
  buildCatalogWithReport,
  type CatalogDiff,
  type CatalogRemap,
  diffCatalog,
  isEmptyDiff,
  planCatalogRemap,
} from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import type { CatalogSyncSource, CatalogSyncStatus } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CatalogService } from './catalog.service.js'
import { CatalogRepository, type SyncChangeRow } from './catalog-repository.js'
import { type CatalogPins, type CatalogSources, fetchCatalogSources, readFixtureSources } from './catalog-sources.js'

export interface SyncRequest extends CatalogPins {
  source: CatalogSyncSource
  /** Fixtures directory override (tests). */
  fixturesDir?: string | undefined
  /**
   * Fase 40 (H-004): from the app, a sync that would take cards away (editions that leave the catalog, or a remap
   * that leaves `needs_review`: copies or deck cards it had to drop or guess) stops before writing unless confirmed.
   * The CLI does not guard (it is explicit by itself).
   */
  guard?: boolean | undefined
  confirm?: boolean | undefined
}

/** What a sync would do, without doing it (Fase 40: «Actualizar al último del tracker» shows this first). */
export interface CatalogPreview {
  trackerCommit: string
  engineRev: string
  /** The commit loaded now (null before the first sync). */
  current: string | null
  counts: BuildCounts
  diff: DiffCounts | null
  diffEmpty: boolean
  expansionsAdded: { id: string; nameEn: string; nameEs: string; cards: number }[]
  /** Editions that leave the catalog (the first 50). */
  removed: { cardId: string; nameEs: string }[]
  /** What the remap would do with the owner's data; the review notes first. */
  remap: { needsReview: boolean; empty: boolean; notes: { kind: string; review: boolean; text: string }[] } | null
  /** Of the editions added: how many the engine plays (from the card status a worker uploaded), and with which rev. */
  engine: { engineRev: string | null; plays: number; incomplete: number; unknown: number }
  /** Applying needs `confirm: true` (it would take the owner's cards away or leave things to review). */
  destructive: boolean
  warnings: string[]
}

/** Cards leave the catalog, or the remap had to drop or guess something of the owner's. */
function isDestructive(diff: CatalogDiff | null, remap: CatalogRemap | null): boolean {
  return (diff?.removed.length ?? 0) > 0 || (remap?.needsReview ?? false)
}

/** A guarded sync that would take the owner's cards away, not confirmed: the row says why, nothing was written. */
export class ConfirmRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfirmRequired'
  }
}

export type DiffCounts = { [K in keyof CatalogDiff]: number }

export interface SyncSummary {
  syncId: number
  status: CatalogSyncStatus
  source: CatalogSyncSource
  trackerCommit: string
  engineRev: string
  counts: BuildCounts
  /** Null on the first sync (nothing to compare against). */
  diff: DiffCounts | null
  diffEmpty: boolean
  nameFallbacks: number
  warnings: string[]
  durationMs: number
}

/** Upper bound of `catalog_sync_changes` rows written per sync (the full diff stays in `report`). */
const MAX_CHANGE_ROWS = 5000

function diffCounts(diff: CatalogDiff): DiffCounts {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    internalIdChanged: diff.internalIdChanged.length,
    stockChanged: diff.stockChanged.length,
    groupChanged: diff.groupChanged.length,
    nameChanged: diff.nameChanged.length,
    expansionsAdded: diff.expansionsAdded.length,
    expansionsRemoved: diff.expansionsRemoved.length,
  }
}

function changeRows(diff: CatalogDiff): SyncChangeRow[] {
  const rows: SyncChangeRow[] = []
  for (const cardId of diff.added) rows.push({ cardId, field: 'card', old: null, new: 'added' })
  for (const cardId of diff.removed) rows.push({ cardId, field: 'card', old: 'present', new: null })
  for (const change of diff.internalIdChanged)
    rows.push({ cardId: change.cardId, field: 'internalId', old: change.from, new: change.to })
  for (const change of diff.stockChanged)
    rows.push({ cardId: change.cardId, field: 'stockCardId', old: change.from, new: change.to })
  for (const change of diff.groupChanged)
    rows.push({ cardId: change.cardId, field: 'functionalGroupId', old: change.from, new: change.to })
  for (const change of diff.nameChanged)
    rows.push({ cardId: change.cardId, field: change.field, old: change.from, new: change.to })
  return rows.slice(0, MAX_CHANGE_ROWS)
}

/**
 * `catalog:sync`: fetch (or read fixtures) → build → diff against the loaded catalog → replace in one transaction →
 * record `catalog_syncs` → reload the in-memory index. Only one sync runs at a time (409 otherwise).
 * `sync()` awaits the whole pipeline (CLI, tests); `start()` returns the sync id and runs it in the background
 * (`POST /api/catalog/sync` → 202; progress in `GET /api/catalog/status`).
 */
@Injectable()
export class CatalogSyncService implements OnModuleInit {
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CatalogRepository,
    private readonly catalog: CatalogService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogSyncService.name)
  }

  /**
   * The lock lives in this process, so a `running` row found at startup belongs to a sync that died with the previous
   * process (crash, deploy): it is closed as `failed` so `GET /api/catalog/status` and the UI do not stay blocked.
   */
  async onModuleInit(): Promise<void> {
    const stale = await this.prisma.catalogSync.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', error: 'Interrumpida: el servidor se reinició mientras corría.' },
    })
    if (stale.count > 0) this.logger.warn({ count: stale.count }, 'stale running catalog syncs marked as failed')
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * Fase 40: the same fetch, build, diff and remap plan as a sync, nothing written (no row, no lock: a preview can run
   * while nothing else does, and a sync started meanwhile wins).
   */
  async preview(request: SyncRequest): Promise<CatalogPreview> {
    if (this.running) throw new ConflictException('Ya hay una sincronización en curso.')
    const prepared = await this.prepare(request)
    const { catalog, report, diff, remap, previous } = prepared
    const added = new Set(diff?.added ?? catalog.cards.map((card) => card.id))
    const addedCards = catalog.cards.filter((card) => added.has(card.id))
    const engine = await this.engineStatusOf(
      request.engineRev,
      addedCards.map((card) => card.engineId),
    )
    const names = new Map(previous?.catalog.cards.map((card) => [card.id, card.nameEs]) ?? [])
    const expansionsAdded = (diff?.expansionsAdded ?? []).map((id) => {
      const expansion = catalog.expansions.find((item) => item.id === id)
      return {
        id,
        nameEn: expansion?.nameEn ?? id,
        nameEs: expansion?.nameEs ?? id,
        cards: catalog.cards.filter((card) => card.expansionId === id).length,
      }
    })
    const notes = [...(remap?.notes ?? [])].sort((a, b) => Number(b.review) - Number(a.review))
    return {
      trackerCommit: request.trackerCommit,
      engineRev: request.engineRev,
      current: previous?.catalog.trackerCommit ?? null,
      counts: report.counts,
      diff: diff ? diffCounts(diff) : null,
      diffEmpty: diff ? isEmptyDiff(diff) : false,
      expansionsAdded,
      removed: (diff?.removed ?? []).slice(0, 50).map((cardId) => ({ cardId, nameEs: names.get(cardId) ?? cardId })),
      remap: remap ? { needsReview: remap.needsReview, empty: remap.empty, notes: notes.slice(0, 50) } : null,
      engine,
      destructive: isDestructive(diff, remap),
      warnings: prepared.warnings,
    }
  }

  /** Of these engine ids: played (complete), incomplete, unknown — by the status of `engineRev` or the newest one. */
  private async engineStatusOf(engineRev: string, engineIds: string[]): Promise<CatalogPreview['engine']> {
    const revs = await this.prisma.engineCard.groupBy({ by: ['engineRev'], _count: { _all: true } })
    const rev = revs.some((row) => row.engineRev === engineRev) ? engineRev : (revs[0]?.engineRev ?? null)
    if (!rev) return { engineRev: null, plays: 0, incomplete: 0, unknown: engineIds.length }
    const rows = await this.prisma.engineCard.findMany({
      where: { engineRev: rev, engineId: { in: engineIds } },
      select: { engineId: true, complete: true },
    })
    const complete = new Map(rows.map((row) => [row.engineId, row.complete]))
    let plays = 0
    let incomplete = 0
    for (const id of engineIds) {
      const status = complete.get(id)
      if (status === true) plays += 1
      else if (status === false) incomplete += 1
    }
    return { engineRev: rev, plays, incomplete, unknown: engineIds.length - plays - incomplete }
  }

  /** Fetch, build, diff and plan the remap: everything but writing. */
  private async prepare(request: SyncRequest) {
    const sources = await this.loadSources(request)
    const { catalog, report } = buildCatalogWithReport(sources.input)
    const previous = await this.repository.loadCatalog()
    const diff = previous ? diffCatalog(previous.catalog, catalog) : null
    // I12 (Fase 21): editions that moved between stock units or groups, or left the catalog, take the owner's data
    // with them in the same transaction; anything the remap had to guess leaves the sync in `needs_review`.
    const structuralChange =
      diff !== null && (diff.stockChanged.length > 0 || diff.groupChanged.length > 0 || diff.removed.length > 0)
    const remap: CatalogRemap | null =
      structuralChange && previous && (await this.repository.hasOwnerData())
        ? planCatalogRemap(previous.catalog, catalog, await this.repository.ownerRefs())
        : null
    const warnings = [...report.warnings]
    for (const note of remap?.notes ?? []) if (note.review) warnings.push(note.text)
    return { sources, catalog, report, previous, diff, remap, warnings }
  }

  async sync(request: SyncRequest): Promise<SyncSummary> {
    const syncId = await this.begin(request)
    return this.run(syncId, request)
  }

  async start(request: SyncRequest): Promise<{ syncId: number }> {
    const syncId = await this.begin(request)
    this.run(syncId, request).catch(() => undefined) // failures are recorded on the row and logged by run()
    return { syncId }
  }

  /** Claims the single slot and records the `running` row. */
  private async begin(request: SyncRequest): Promise<number> {
    if (this.running) throw new ConflictException('Ya hay una sincronización en curso.')
    this.running = true
    try {
      const row = await this.prisma.catalogSync.create({
        data: {
          commitSha: request.trackerCommit,
          engineRev: request.engineRev,
          source: request.source,
          status: 'running',
          fetchedAt: new Date(),
          fileHashes: {},
          counts: {},
        },
      })
      return row.id
    } catch (error) {
      this.running = false
      throw error
    }
  }

  private async run(syncId: number, request: SyncRequest): Promise<SyncSummary> {
    const started = Date.now()
    try {
      const { sources, catalog, report, diff, remap, warnings } = await this.prepare(request)
      const fileHashes = Object.fromEntries(
        Object.entries(sources.files).map(([key, file]) => [
          key,
          { path: file.path, sha256: file.sha256, bytes: file.bytes },
        ]),
      )
      await this.prisma.catalogSync.update({ where: { id: syncId }, data: { fileHashes } })
      const needsReview = remap?.needsReview ?? false
      if (request.guard && !request.confirm && isDestructive(diff, remap)) {
        throw new ConfirmRequiredError(
          'Hace falta confirmar: esta actualización saca cartas del catálogo, de la colección o de los mazos (o deja cosas para revisar). Mirá la vista previa y confirmala.',
        )
      }

      const status = needsReview ? 'needs_review' : 'applied'
      // Catalog tables, change rows and the sync status are committed together (one pg transaction).
      await this.repository.replaceCatalog(catalog, {
        syncId,
        status,
        counts: report.counts,
        craftingCost: catalog.craftingCost,
        missions: catalog.missions ?? [],
        report: {
          build: { ...report, warnings },
          diff: diff ? { counts: diffCounts(diff), detail: diff } : null,
          remap: remap ? { notes: remap.notes, empty: remap.empty } : null,
        },
        changes: diff ? changeRows(diff) : [],
        remap,
      })
      await this.catalog.reload()

      const summary: SyncSummary = {
        syncId,
        status,
        source: request.source,
        trackerCommit: request.trackerCommit,
        engineRev: request.engineRev,
        counts: report.counts,
        diff: diff ? diffCounts(diff) : null,
        diffEmpty: diff ? isEmptyDiff(diff) : false,
        nameFallbacks: report.nameFallbacks.length,
        warnings,
        durationMs: Date.now() - started,
      }
      this.logger.info({ syncId, status, cards: report.counts.cards, ms: summary.durationMs }, 'catalog sync done')
      return summary
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      this.logger.error({ syncId, err: error }, 'catalog sync failed')
      await this.prisma.catalogSync
        .update({ where: { id: syncId }, data: { status: 'failed', appliedAt: null, error: message.slice(0, 4000) } })
        .catch(() => undefined)
      throw error
    } finally {
      this.running = false
    }
  }

  private loadSources(request: SyncRequest): Promise<CatalogSources> {
    if (request.source === 'fixtures') return Promise.resolve(readFixtureSources(request, request.fixturesDir))
    return fetchCatalogSources(request)
  }
}
