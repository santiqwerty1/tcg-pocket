/** Laboratorio de mazos (T-008, docs/API.md «Laboratorio»): session-protected, like the rest of the PWA's API. */
import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common'
import {
  BOT_CODE_PATTERN,
  EXPLORE_LIMITS,
  EXPLORE_POOLS,
  MAX_GAUNTLET_SIZE,
  SELECTABLE_ENERGIES,
  TOURNAMENT_FORMATS,
} from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { LabService, MAX_TEST_DECKS } from './lab.service.js'
import type { LabBankView, LabCoreView, LabJobsView, LabJobView } from './lab-views.js'

const energies = z.array(z.enum(SELECTABLE_ENERGIES)).max(3).optional()
const era = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,8}$/)
  .optional()
const scopeSchema = z.object({
  era,
  format: z.enum(TOURNAMENT_FORMATS).optional(),
  size: z.coerce.number().int().min(1).max(MAX_GAUNTLET_SIZE).optional(),
  /** T-017 D4: against the era's most played (default), «mi meta» or one archetype (`archetypeId`). */
  objective: z.enum(['meta', 'mine', 'rival']).optional(),
  archetypeId: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,120}$/)
    .optional(),
  halfLifeDays: z.coerce.number().int().min(1).max(365).optional(),
})

const deckSchema = z.union([
  z.object({ deckId: z.string().trim().min(1).max(20), energies }),
  z.object({
    listKey: z.string().regex(/^[0-9a-f]{14}$/),
    era,
    format: z.enum(TOURNAMENT_FORMATS).optional(),
    energies,
  }),
  z.object({ text: z.string().min(1).max(20_000), name: z.string().trim().max(200).optional(), energies }),
  z.object({
    cards: z
      .array(z.object({ cardId: z.string().min(1).max(20), count: z.number().int().min(1).max(20) }))
      .min(1)
      .max(40),
    energies: z.array(z.enum(SELECTABLE_ENERGIES)).min(1).max(3),
    name: z.string().trim().max(200).optional(),
  }),
])
const botCode = z.string().regex(BOT_CODE_PATTERN, 'Bot desconocido.')
const runSchema = scopeSchema.extend({
  players: z.tuple([botCode, botCode]).optional(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
  label: z.string().trim().max(200).optional(),
  cores: z.number().int().min(1).max(64).optional(),
  dryRun: z.boolean().optional(),
})
const testSchema = runSchema.extend({
  decks: z.array(deckSchema).min(1).max(MAX_TEST_DECKS),
  gamesPerRival: z.number().int().min(10).max(5000).optional(),
})
const consistencySchema = scopeSchema.extend({
  deckId: z.string().trim().min(1).max(20),
  keyCards: z.array(z.string().min(1).max(20)).max(10).optional(),
  games: z.number().int().min(10).max(10_000).optional(),
  /** Both sides play with it; «et» (passive) is the goldfish measure, not this one. */
  bot: z
    .string()
    .regex(BOT_CODE_PATTERN, 'Bot desconocido.')
    .refine((code) => code !== 'et', 'Bot desconocido.')
    .optional(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
})
const coreSchema = z.object({
  cards: z.array(z.string().trim().min(1).max(20)).min(1).max(4),
  energies,
  pool: z.enum(['collection', 'all']).optional(),
  era,
  format: z.enum(TOURNAMENT_FORMATS).optional(),
  eventId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
})
const limit = ([min, max]: readonly [number, number]) => z.number().min(min).max(max).optional()
const exploreSchema = runSchema.extend({
  deck: deckSchema,
  eventId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  locked: z.array(z.string().min(1).max(20)).max(20).optional(),
  config: z
    .object({
      gamesPerRival: limit(EXPLORE_LIMITS.gamesPerRival),
      variantsPerRound: limit(EXPLORE_LIMITS.variantsPerRound),
      maxRounds: limit(EXPLORE_LIMITS.maxRounds),
      patience: limit(EXPLORE_LIMITS.patience),
      confirmGames: limit(EXPLORE_LIMITS.confirmGames),
      acceptZ: limit(EXPLORE_LIMITS.acceptZ),
      verifyGames: limit(EXPLORE_LIMITS.verifyGames),
      verifyZ: limit(EXPLORE_LIMITS.verifyZ),
      pool: z.enum(EXPLORE_POOLS).optional(),
      /** Fase 42: each rival's games by its weight (default true). */
      byWeight: z.boolean().optional(),
      /** Fase 42: the bot that plays the confirmation again («robusto» / «sensible al bot»); null, none (default e3). */
      confirmBot: botCode.nullable().optional(),
      /** Fase 42, carreras: a search round in two halves, the clearly worse variants out after the first (default true). */
      race: z.boolean().optional(),
    })
    .optional(),
})

@Controller('api/lab')
export class LabController {
  constructor(private readonly lab: LabService) {}

  /** The meta bank of an era: the archetypes, their lists and weights. */
  @Get('bank')
  bank(
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LabBankView> {
    return this.lab.bank(query)
  }

  @Get('jobs')
  jobs(@CurrentSession() _session: RequestSession): Promise<LabJobsView> {
    return this.lab.jobs()
  }

  @Get('jobs/:id')
  job(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<LabJobView> {
    return this.lab.job(id)
  }

  /** T-017 D2: «Frenar y confirmar» a search: the round in play ends with what it has, then the confirmation. */
  @Post('jobs/:id/stop')
  @HttpCode(200)
  stop(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<LabJobView> {
    return this.lab.stop(id)
  }

  /** Decks against the meta bank (with `dryRun`: what it would play and how long). */
  @Post('test')
  @HttpCode(200)
  test(
    @Body(new ZodValidationPipe(testSchema)) body: z.infer<typeof testSchema>,
    @CurrentSession() _s: RequestSession,
  ) {
    return this.lab.test(body)
  }

  /** How soon a deck has its key attacker ready in real games against the meta bank (D-019). */
  @Post('consistency')
  @HttpCode(201)
  consistency(
    @Body(new ZodValidationPipe(consistencySchema)) body: z.infer<typeof consistencySchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.lab.consistency(body)
  }

  /** Fase 19: a first list around 1–4 cards, from the era's lists that play them (queues nothing). */
  @Post('core')
  @HttpCode(200)
  core(
    @Body(new ZodValidationPipe(coreSchema)) body: z.infer<typeof coreSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LabCoreView> {
    return this.lab.core(body)
  }

  /** The automatic search of variants of a deck against the meta bank (with `dryRun`: the plan). */
  @Post('explore')
  @HttpCode(200)
  explore(
    @Body(new ZodValidationPipe(exploreSchema)) body: z.infer<typeof exploreSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.lab.explore(body)
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule, SimulationModule],
  controllers: [LabController],
  providers: [LabService],
  exports: [LabService],
})
export class LabModule {}
