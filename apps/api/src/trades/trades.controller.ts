/**
 * Lista de intercambio (Fase 31): `GET /api/trades?rarities=` — what the collection could give and what the decks
 * not archived lack, by rarity (trades are same-rarity), with the text to paste in a chat for the chosen rarities.
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import { type CardId, RARITIES, type Rarity, type TradeDeck, type TradeList, tradeList, tradeText } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CatalogService } from '../catalog/catalog.service.js'
import { CollectionModule } from '../collection/collection.module.js'
import { CollectionRepository } from '../collection/collection.repository.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { PacksModule } from '../packs/packs.controller.js'
import { PacksService } from '../packs/packs.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

export interface TradesView extends TradeList {
  /** Rarities the text covers (the asked ones, or those with something to ask for; else ◊◊◊ and up). */
  rarities: Rarity[]
  text: string
  totals: { wants: number; gives: number; spare: number }
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly collection: CollectionRepository,
    private readonly packs: PacksService,
  ) {}

  /** The decks not archived, as copies per functional group (also used by the promo packs). */
  async decks(): Promise<TradeDeck[]> {
    const index = this.catalog.requireIndex()
    const decks = await this.prisma.deck.findMany({
      where: { archivedAt: null, currentRevisionId: { not: null } },
      orderBy: { id: 'asc' },
      select: { name: true, currentRevisionId: true },
    })
    const revisions = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: decks.flatMap((deck) => (deck.currentRevisionId ? [deck.currentRevisionId] : [])) } },
          select: { id: true, cards: true },
        })
      ).map((row) => [row.id, row.cards as unknown as { cardId: string; count: number }[]]),
    )
    return decks.map((deck) => {
      const groups = new Map<CardId, number>()
      for (const entry of revisions.get(deck.currentRevisionId ?? 0) ?? []) {
        const group = index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId
        groups.set(group, (groups.get(group) ?? 0) + entry.count)
      }
      return { name: deck.name, groups }
    })
  }

  async trades(rarities?: Rarity[]): Promise<TradesView> {
    const [{ stock, adjustments }, decks, rules] = await Promise.all([
      this.collection.loadState(),
      this.decks(),
      this.packs.rarityRules(),
    ])
    const tradeable = new Set(rules.filter((rule) => rule.tradeable).map((rule) => rule.rarity))
    const list = tradeList({
      index: this.catalog.requireIndex(),
      stock,
      adjustments,
      decks,
      tradeableRarity: (rarity) => tradeable.has(rarity),
    })
    const withWants = list.byRarity.filter((row) => row.wants.length > 0).map((row) => row.rarity)
    const chosen =
      rarities && rarities.length > 0
        ? rarities
        : withWants.length > 0
          ? withWants
          : RARITIES.filter((rarity) => tradeable.has(rarity) && RARITIES.indexOf(rarity) >= RARITIES.indexOf('◊◊◊'))
    return {
      ...list,
      rarities: chosen,
      text: tradeText(list, { rarities: chosen }),
      totals: {
        wants: list.wants.length,
        gives: list.gives.length,
        spare: list.gives.reduce((sum, give) => sum + give.spare, 0),
      },
    }
  }
}

const querySchema = z.object({
  rarities: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(RARITIES)).optional()),
})

@Controller('api/trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  @Get()
  get(
    @Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<TradesView> {
    return this.trades.trades(query.rarities)
  }
}

@Module({
  imports: [CatalogModule, CollectionModule, PacksModule],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}
