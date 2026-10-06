import { Inject, Injectable, NotFoundException, type OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { type CardEdition, CatalogIndex, type SearchLang } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'
import type { CatalogSync } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CatalogRepository } from './catalog-repository.js'
import {
  type CardSearchHit,
  type CardSummary,
  type ExpansionView,
  type GroupDeckUsage,
  type GroupDetail,
  toCardSummary,
  toGroupSummary,
  toPackView,
} from './catalog-views.js'

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
    this.index = loaded ? new CatalogIndex(loaded.catalog) : null
    this.loadedSync = loaded?.sync ?? null
    if (loaded) {
      this.logger.info(
        { cards: loaded.catalog.cards.length, commit: loaded.catalog.trackerCommit, ms: Date.now() - started },
        'catalog loaded',
      )
    } else this.logger.warn('no catalog in the database yet: run `pnpm -F @tcg/api catalog:sync`')
  }

  get loaded(): boolean {
    return this.index !== null
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
    const [stockRows, adjustment, deckRows] = await Promise.all([
      this.prisma.collectionStock.findMany({ where: { cardId: { in: group.stockCardIds } } }),
      this.prisma.collectionAdjustment.findFirst({ where: { functionalGroupId: id, active: true } }),
      this.prisma.deckCard.findMany({
        where: { cardId: { in: group.cardIds }, deck: { archivedAt: null } },
        include: { deck: { select: { id: true, name: true, builtInGame: true } } },
      }),
    ])
    const stockByCardId = new Map(stockRows.map((row) => [row.cardId, row]))
    const fromStock = group.stockCardIds.reduce(
      (sum, stockId) => sum + (stockByCardId.get(stockId)?.amountOwned ?? 0),
      0,
    )
    const decksById = new Map<number, GroupDeckUsage>()
    for (const row of deckRows) {
      const usage = decksById.get(row.deck.id)
      if (usage) usage.count += row.count
      else
        decksById.set(row.deck.id, {
          id: row.deck.id,
          name: row.deck.name,
          count: row.count,
          builtInGame: row.deck.builtInGame,
        })
    }
    return {
      ...toGroupSummary(group),
      playable: adjustment ? adjustment.playableCopies : fromStock,
      fromStock,
      adjustment: adjustment
        ? {
            id: adjustment.id,
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
      decks: [...decksById.values()].sort((a, b) => a.id - b.id),
    }
  }
}
