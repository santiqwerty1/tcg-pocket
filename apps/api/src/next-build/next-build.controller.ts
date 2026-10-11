/** ¿Qué mazo armo después? (Fase 44, docs/API.md «Mazos»). */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import {
  DEFAULT_RARITY_RULES,
  type DeckCardEntry,
  type NextBuildCost,
  nextBuildCost,
  TOURNAMENT_FORMATS,
} from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CatalogService } from '../catalog/catalog.service.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { PacksModule } from '../packs/packs.controller.js'
import { PacksService } from '../packs/packs.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { NextBuildView } from '../tournaments/tournament-views.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

const querySchema = z.object({
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  format: z.enum(TOURNAMENT_FORMATS).optional(),
  maxMissing: z.coerce.number().int().min(0).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
})

@Injectable()
export class NextBuildService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tournaments: TournamentsService,
    private readonly packs: PacksService,
  ) {}

  async next(query: z.infer<typeof querySchema>): Promise<NextBuildView> {
    const index = this.catalog.requireIndex()
    const rules = new Map((await this.packs.rarityRules()).map((rule) => [rule.rarity, rule]))
    const costs = new Map<string, NextBuildCost>()
    const cost = (groupId: string): NextBuildCost => {
      let known = costs.get(groupId)
      if (!known) {
        known = nextBuildCost(index, groupId, (rarity) => {
          const rule = rules.get(rarity)
          return rule
            ? { points: rule.points, verified: rule.verified, tradeable: rule.tradeable }
            : DEFAULT_RARITY_RULES[rarity]
        })
        costs.set(groupId, known)
      }
      return known
    }
    // The archetypes of my active decks: the one chosen in the deck, or the one its closest lists suggest.
    const decks = await this.prisma.deck.findMany({
      where: { archivedAt: null },
      select: { currentRevisionId: true, tournamentArchetypeId: true },
    })
    const revisions = await this.prisma.deckRevision.findMany({
      where: { id: { in: decks.map((deck) => deck.currentRevisionId).filter((id): id is number => id !== null) } },
      select: { id: true, cards: true },
    })
    const cardsOf = new Map(revisions.map((row) => [row.id, row.cards as unknown as DeckCardEntry[]]))
    const today = await this.tournaments.todayExpectations({ era: query.era, format: query.format }).catch(() => null)
    const built = new Set<string>()
    for (const deck of decks) {
      const cards = deck.currentRevisionId === null ? undefined : cardsOf.get(deck.currentRevisionId)
      if (!cards || !today) continue
      try {
        const id = today.place(cards, deck.tournamentArchetypeId ?? null).archetype?.archetype.id
        if (id) built.add(id)
      } catch {
        // A deck the era cannot place counts for no archetype.
      }
    }
    return this.tournaments.nextBuilds(query, { cost, built: (id) => built.has(id) })
  }
}

@Controller('api/decks-next')
export class NextBuildController {
  constructor(private readonly next: NextBuildService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<NextBuildView> {
    return this.next.next(query)
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule, PacksModule],
  controllers: [NextBuildController],
  providers: [NextBuildService],
  exports: [NextBuildService],
})
export class NextBuildModule {}
