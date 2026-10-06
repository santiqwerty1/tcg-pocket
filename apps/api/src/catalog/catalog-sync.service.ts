import { ConflictException, Injectable } from '@nestjs/common'
import { type BuildCounts, buildCatalogWithReport, type CatalogDiff, diffCatalog, isEmptyDiff } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import type { CatalogSyncSource, CatalogSyncStatus } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CatalogService } from './catalog.service.js'
import { CatalogRepository } from './catalog-repository.js'
import { type CatalogPins, type CatalogSources, fetchCatalogSources, readFixtureSources } from './catalog-sources.js'

export interface SyncRequest extends CatalogPins {
  source: CatalogSyncSource
  /** Fixtures directory override (tests). */
  fixturesDir?: string | undefined
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

function changeRows(diff: CatalogDiff): { cardId: string; field: string; old: unknown; new: unknown }[] {
  const rows: { cardId: string; field: string; old: unknown; new: unknown }[] = []
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
export class CatalogSyncService {
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: CatalogRepository,
    private readonly catalog: CatalogService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogSyncService.name)
  }

  get isRunning(): boolean {
    return this.running
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
      const sources = await this.loadSources(request)
      const fileHashes = Object.fromEntries(
        Object.entries(sources.files).map(([key, file]) => [
          key,
          { path: file.path, sha256: file.sha256, bytes: file.bytes },
        ]),
      )
      await this.prisma.catalogSync.update({ where: { id: syncId }, data: { fileHashes } })

      const { catalog, report } = buildCatalogWithReport(sources.input)
      const previous = await this.repository.loadCatalog()
      const diff = previous ? diffCatalog(previous.catalog, catalog) : null

      // TODO(I12): when stock units or groups change and the owner has data, remap collection stock, adjustments and
      // deck cards in the same transaction. Until then the sync applies the catalog and flags `needs_review`.
      const structuralChange = diff !== null && (diff.stockChanged.length > 0 || diff.groupChanged.length > 0)
      const needsReview = structuralChange && (await this.repository.hasOwnerData())
      const warnings = [...report.warnings]
      if (needsReview) {
        warnings.push(
          `Stock units or functional groups changed (${diff?.stockChanged.length ?? 0} stock, ${diff?.groupChanged.length ?? 0} groups) with owner data present: review the collection and decks (remap not implemented yet).`,
        )
      }

      const replaced = await this.repository.replaceCatalog(catalog)
      const status: CatalogSyncStatus = needsReview ? 'needs_review' : 'applied'
      await this.prisma.$transaction(async (tx) => {
        if (diff) {
          const rows = changeRows(diff)
          if (rows.length > 0) {
            await tx.catalogSyncChange.createMany({
              data: rows.map((change) => ({
                syncId,
                cardId: change.cardId,
                field: change.field,
                old: change.old === null ? undefined : (change.old as string | number),
                new: change.new === null ? undefined : (change.new as string | number),
              })),
            })
          }
        }
        await tx.catalogSync.update({
          where: { id: syncId },
          data: {
            status,
            appliedAt: new Date(),
            counts: { ...report.counts, deleted: replaced.deleted },
            craftingCost: catalog.craftingCost,
            report: JSON.parse(
              JSON.stringify({
                build: { ...report, warnings },
                diff: diff ? { counts: diffCounts(diff), detail: diff } : null,
              }),
            ),
          },
        })
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
