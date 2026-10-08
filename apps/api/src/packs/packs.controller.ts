import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post } from '@nestjs/common'
import { RARITIES } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import type { PackView, RarityRuleView, RecommendationView } from './pack-views.js'
import { assertPackId, PacksService } from './packs.service.js'

const collectionGoalSchema = z.object({
  rarities: z.array(z.enum(RARITIES)).max(RARITIES.length),
  copies: z.number().int().min(1).max(5),
})
const recommendSchema = z.object({
  model: z.enum(['corrected', 'tracker']).optional(),
  alpha: z.number().min(0).max(1).optional(),
  collection: collectionGoalSchema.nullable().optional(),
  onlyAvailable: z.boolean().optional(),
  limitedBoost: z.number().min(1).max(5).optional(),
  deckTarget: z.enum(['saved', 'tournament']).optional(),
})
const packPatchSchema = z
  .object({
    available: z.boolean().optional(),
    limited: z.boolean().optional(),
    limitedUntil: z.iso.date().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Mandá al menos un campo.' })
const rarityRuleSchema = z
  .object({
    points: z.number().int().min(0).max(100_000).nullable().optional(),
    verified: z.boolean().optional(),
    tradeable: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Mandá al menos un campo.' })

/** Session-protected packs API (docs/API.md «Sobres»). */
@Controller('api')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Get('packs')
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: PackView[] }> {
    return { items: await this.packs.list() }
  }

  /** Read-only, but a POST: the goals travel in the body. */
  @Post('packs/recommend')
  @HttpCode(200)
  recommend(
    @Body(new ZodValidationPipe(recommendSchema)) body: z.infer<typeof recommendSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RecommendationView> {
    return this.packs.recommend(body)
  }

  @Patch('packs/:expansionId/:name')
  updatePack(
    @Param('expansionId') expansionId: string,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(packPatchSchema)) body: z.infer<typeof packPatchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<PackView> {
    return this.packs.updatePack(assertPackId(expansionId, name), body)
  }

  @Get('rarity-rules')
  async rarityRules(@CurrentSession() _session: RequestSession): Promise<{ items: RarityRuleView[] }> {
    return { items: await this.packs.rarityRules() }
  }

  @Patch('rarity-rules/:rarity')
  setRarityRule(
    @Param('rarity') rarity: string,
    @Body(new ZodValidationPipe(rarityRuleSchema)) body: z.infer<typeof rarityRuleSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RarityRuleView> {
    return this.packs.setRarityRule(rarity, body)
  }
}

@Module({
  imports: [CatalogModule, CollectionModule, TournamentsModule],
  controllers: [PacksController],
  providers: [PacksService],
  exports: [PacksService],
})
export class PacksModule {}
