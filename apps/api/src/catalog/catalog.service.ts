import { Inject, Injectable, NotFoundException, type OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { type CardEdition, CatalogIndex, type SearchLang } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import type { CatalogSync } from '../generated/prisma/client.js'
import { idToString } from '../http/ids.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CatalogRepository } from './catalog-repository.js'
import {
  type CardSearchHit,
  type CardSummary,
  type ExpansionView,
  type GroupDetail,
  toCardSummary,
  toGroupSummary,
  toPackView,
} from './catalog-views.js'
import { deckUsageOfCards } from './deck-usage.js'

export interface CatalogStatus {
  loaded: boolean
  trackerCommit: string | null
  engineRev: string | null
  /** When the loaded catalog was applied. */
  syncedAt: Date | null
  pinned: { trackerCommit: string; engineRev: string }
  counts: { cards: number; expansions: number; packs: number; groups: number; stockUnits: number } | null
  /** Most recent sync of any status (running, applied, needs_review, failed). */
  lastSync: {
    id: number
    status: CatalogSync['status']
    source: CatalogSync['source']
    commitSha: string
    engineRev: string
    startedAt: Date
    finishedAt: Date | null
    report: unknown
    error: string | null
  } | null
}

/** The catalog loaded in memory (a `CatalogIndex`) from the database; reloaded after every sync. */
@Injectable()
export class CatalogService implements OnModuleInit {
  private index: CatalogIndex | null = null
  private loadedSync: CatalogSync | null = null
  /** The last time loading a sync applied elsewhere failed (null after a good one). */
  private reloadFailure: { at: Date; message: string } | null = null
  private catchingUp = false

  constructor(
    private readonly repository: CatalogRepository,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CatalogService.name)
  }

  async onModuleInit(): Promise<void> {
    await this.reload()
  }

  async reload(): Promise<void> {
    const started = Date.now()
    const loaded = await this.repository.loadCatalog()
    // A database without a catalog after one was loaded (an applied row with no cards) keeps the one in memory.
    if (!loaded && this.index) throw new Error('la base no tiene cartas para la sincronización aplicada')
    this.index = loaded ? new CatalogIndex(loaded.catalog) : null
    this.loadedSync = loaded?.sync ?? null
    if (loaded) {
      this.logger.info(
        { cards: loaded.catalog.cards.length, commit: loaded.catalog.trackerCommit, ms: Date.now() - started },
        'catalog loaded',
      )
    } else this.logger.warn('no catalog in the database yet: run `pnpm -F @tcg/api catalog:sync`')
  }

  /**
   * Another process applied a newer sync (a `catalog-sync.js` CLI next to the API): the catalog in memory is behind
   * the database's, so the screens show the old one and the collection's imports refuse with `catalog_changed`. Loads
   * the new one, like a sync of this process does at its end. `true` when it reloaded; a failure is kept for the alert.
   */
  async reloadIfBehind(): Promise<boolean> {
    // One at a time: a load slower than the minute does not start a second copy of the catalog next to it.
    if (this.catchingUp) return false
    this.catchingUp = true
    try {
      const latest = await this.repository.latestAppliedSync()
      if (!latest || latest.id === this.loadedSync?.id) return false
      try {
        await this.reload()
        this.reloadFailure = null
        this.logger.info({ syncId: latest.id, commit: latest.commitSha }, 'catalog applied by another process loaded')
        return true
      } catch (error) {
        this.reloadFailure = { at: new Date(), message: error instanceof Error ? error.message : String(error) }
        this.logger.error({ err: error, syncId: latest.id }, 'loading the catalog applied by another process failed')
        return false
      }
    } finally {
      this.catchingUp = false
    }
  }

  /**
   * The commit of the last sync applied in the database: what «Sincronizar» repeats and what a commit is compared with,
   * also while the memory is behind (repeating the memory's would undo a CLI's sync).
   */
  async appliedCommit(): Promise<string | null> {
    return (await this.repository.latestAppliedSync())?.commitSha ?? this.trackerCommit
  }

  /** The sync in memory against the last one applied in the database (the `catalog_memory` alert). */
  async memoryState(): Promise<{
    loaded: { id: number; commitSha: string } | null
    latest: { id: number; commitSha: string; appliedAt: Date | null } | null
    failure: { at: Date; message: string } | null
  }> {
    const latest = await this.repository.latestAppliedSync()
    return {
      loaded: this.loadedSync ? { id: this.loadedSync.id, commitSha: this.loadedSync.commitSha } : null,
      latest: latest ? { id: latest.id, commitSha: latest.commitSha, appliedAt: latest.appliedAt } : null,
      failure: this.reloadFailure,
    }
  }

  get loaded(): boolean {
    return this.index !== null
  }

  get loadedSyncId(): number | null {
    return this.loadedSync?.id ?? null
  }

  get trackerCommit(): string | null {
    return this.index?.catalog.trackerCommit ?? null
  }

  get engineRev(): string | null {
    return this.index?.catalog.engineRev ?? null
  }

  /** The in-memory index; 503 while the catalog has not been synced. */
  requireIndex(): CatalogIndex {
    if (!this.index) throw new ServiceUnavailableException('El catálogo todavía no está sincronizado.')
    return this.index
  }

  async status(): Promise<CatalogStatus> {
    const catalog = this.index?.catalog ?? null
    const latest = await this.prisma.catalogSync.findFirst({ orderBy: { id: 'desc' } })
    return {
      loaded: catalog !== null,
      trackerCommit: catalog?.trackerCommit ?? null,
      engineRev: catalog?.engineRev ?? null,
      syncedAt: this.loadedSync?.appliedAt ?? null,
      pinned: { trackerCommit: this.env.catalogCommit, engineRev: this.env.engineRev },
      counts: catalog
        ? {
            cards: catalog.cards.length,
            expansions: catalog.expansions.length,
            packs: catalog.packs.length,
            groups: catalog.groups.length,
            stockUnits: catalog.stockUnits.length,
          }
        : null,
      lastSync: latest
        ? {
            id: latest.id,
            status: latest.status,
            source: latest.source,
            commitSha: latest.commitSha,
            engineRev: latest.engineRev,
            startedAt: latest.fetchedAt,
            finishedAt: latest.appliedAt,
            report: latest.report,
            error: latest.error,
          }
        : null,
    }
  }

  expansions(): ExpansionView[] {
    const index = this.requireIndex()
    return index.catalog.expansions.map((expansion) => ({
      ...expansion,
      packs: index.packsOfExpansion(expansion.id).map(toPackView),
    }))
  }

  search(query: string, options: { lang?: SearchLang | undefined; limit?: number | undefined }): CardSearchHit[] {
    const index = this.requireIndex()
    return index.search(query, options).map((hit) => {
      const group = index.groupById(hit.card.functionalGroupId)
      if (!group) throw new Error(`card ${hit.card.id} references unknown group ${hit.card.functionalGroupId}`)
      return { card: toCardSummary(hit.card), group: toGroupSummary(group), score: hit.score, matchedOn: hit.matchedOn }
    })
  }

  cardsOfExpansion(expansionId: string): CardSummary[] {
    const index = this.requireIndex()
    if (!index.expansionById(expansionId)) throw new NotFoundException(`Expansión ${expansionId} no encontrada.`)
    return index.cardsOfExpansion(expansionId).map(toCardSummary)
  }

  async card(id: string): Promise<{ card: CardEdition; group: GroupDetail }> {
    const card = this.requireIndex().cardById(id)
    if (!card) throw new NotFoundException(`Carta ${id} no encontrada.`)
    return { card, group: await this.groupDetail(card.functionalGroupId) }
  }

  /** Group + owner data: stock per edition, playable copies (I4), active adjustment and deck usage. */
  async groupDetail(id: string): Promise<GroupDetail> {
    const index = this.requireIndex()
    const group = index.groupById(id)
    if (!group) throw new NotFoundException(`Carta funcional ${id} no encontrada.`)
    const cards = index.cardsOfGroup(id)
    const [stockRows, adjustment, decks] = await Promise.all([
      this.prisma.collectionStock.findMany({ where: { cardId: { in: group.stockCardIds } } }),
      this.prisma.collectionAdjustment.findFirst({ where: { functionalGroupId: id, active: true } }),
      deckUsageOfCards(this.prisma, group.cardIds),
    ])
    const stockByCardId = new Map(stockRows.map((row) => [row.cardId, row]))
    const fromStock = group.stockCardIds.reduce(
      (sum, stockId) => sum + (stockByCardId.get(stockId)?.amountOwned ?? 0),
      0,
    )
    return {
      ...toGroupSummary(group),
      playable: adjustment ? adjustment.playableCopies : fromStock,
      fromStock,
      adjustment: adjustment
        ? {
            id: idToString(adjustment.id),
            playableCopies: adjustment.playableCopies,
            reason: adjustment.reason,
            createdAt: adjustment.createdAt,
          }
        : null,
      editions: cards.map((card) => {
        const stock = stockByCardId.get(card.stockCardId)
        const unit = index.stockById(card.stockCardId)
        return {
          card: toCardSummary(card),
          owned: stock?.amountOwned ?? 0,
          collected: stock?.collected ?? false,
          twinCardIds: (unit?.cardIds ?? []).filter((twinId) => twinId !== card.id),
        }
      }),
      decks,
    }
  }
}
