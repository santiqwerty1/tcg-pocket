/**
 * Sobres de promoción (30/10/2026): `GET /api/promo-packs` — which event battle to win for the promo packs, against
 * the collection and the decks not archived. The volumes and the events are fixed data of @tcg/domain. Not
 * idempotent: `pick` is drawn among the tied volumes on every call (nothing is written).
 */
import { Controller, Get, Injectable, Module } from '@nestjs/common'
import { type PromoPlan, promoPlan } from '@tcg/domain'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CatalogService } from '../catalog/catalog.service.js'
import { CollectionModule } from '../collection/collection.module.js'
import { CollectionRepository } from '../collection/collection.repository.js'
import { CollectionService } from '../collection/collection.service.js'
import { TradesModule, TradesService } from '../trades/trades.controller.js'

export interface PromoPacksView extends PromoPlan {
  /** When the collection was last brought up to date (import or check), ISO; null = never. */
  lastImportAt: string | null
}

@Injectable()
export class PromoPacksService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly collection: CollectionRepository,
    private readonly collectionService: CollectionService,
    private readonly trades: TradesService,
  ) {}

  async plan(now: Date = new Date()): Promise<PromoPacksView> {
    const [{ stock, adjustments }, decks, lastImportAt] = await Promise.all([
      this.collection.loadState(),
      this.trades.decks(),
      this.collectionService.lastUpdatedAt(),
    ])
    return {
      ...promoPlan({ index: this.catalog.requireIndex(), stock, adjustments, decks, now }),
      lastImportAt: lastImportAt?.toISOString() ?? null,
    }
  }
}

@Controller('api/promo-packs')
export class PromoPacksController {
  constructor(private readonly promo: PromoPacksService) {}

  @Get()
  get(@CurrentSession() _session: RequestSession): Promise<PromoPacksView> {
    return this.promo.plan()
  }
}

@Module({
  imports: [CatalogModule, CollectionModule, TradesModule],
  controllers: [PromoPacksController],
  providers: [PromoPacksService],
  exports: [PromoPacksService],
})
export class PromoPacksModule {}
