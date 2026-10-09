import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common'
import type { CardEdition } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ENV, type Env } from '../config/env.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { CatalogService, type CatalogStatus } from './catalog.service.js'
import { CatalogSyncService } from './catalog-sync.service.js'
import type { CardSearchHit, CardSummary, ExpansionView, GroupDetail } from './catalog-views.js'

const gitSha = z.string().regex(/^[0-9a-f]{40}$/, 'debe ser un sha completo de 40 caracteres')

const syncSchema = z.object({
  commit: gitSha.optional(),
  engineRev: gitSha.optional(),
  /** Reads packages/domain/test/fixtures instead of GitHub (offline). */
  fromFixtures: z.boolean().optional(),
})

const searchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  lang: z.enum(['es', 'en', 'any']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  expansion: z.string().trim().max(10).optional(),
})

const batchSchema = z.object({
  ids: z
    .string()
    .max(2000)
    .refine((value) => value.split(',').length <= 80, 'hasta 80 cartas'),
})

/** Session-protected read API over the in-memory catalog, plus the manual sync trigger (docs/API.md). */
@Controller('api')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly sync: CatalogSyncService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('catalog/status')
  status(@CurrentSession() _session: RequestSession): Promise<CatalogStatus> {
    return this.catalog.status()
  }

  /** Starts a sync in the background; follow it through `GET /api/catalog/status`. 409 while one is running. */
  @Post('catalog/sync')
  @HttpCode(202)
  runSync(
    @Body(new ZodValidationPipe(syncSchema)) body: z.infer<typeof syncSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ syncId: number }> {
    return this.sync.start({
      trackerCommit: body.commit ?? this.env.catalogCommit,
      engineRev: body.engineRev ?? this.env.engineRev,
      source: body.fromFixtures ? 'fixtures' : 'github',
    })
  }

  @Get('expansions')
  expansions(@CurrentSession() _session: RequestSession): { items: ExpansionView[] } {
    return { items: this.catalog.expansions() }
  }

  /** `?q=` searches ids, names (accent-insensitive) and rules text; `?expansion=` lists a set when `q` is absent. */
  @Get('cards')
  cards(
    @Query(new ZodValidationPipe(searchSchema)) query: z.infer<typeof searchSchema>,
    @CurrentSession() _session: RequestSession,
  ): { items: CardSearchHit[] } | { items: CardSummary[]; total: number } {
    if (query.q) return { items: this.catalog.search(query.q, { lang: query.lang, limit: query.limit }) }
    if (query.expansion) {
      const cards = this.catalog.cardsOfExpansion(query.expansion)
      return { items: cards.slice(0, query.limit), total: cards.length }
    }
    return { items: [] }
  }

  /** Fase 22: several editions at once (the cards of a game or a replay), unknown ids left out. */
  @Get('cards/batch')
  batch(
    @Query(new ZodValidationPipe(batchSchema)) query: z.infer<typeof batchSchema>,
    @CurrentSession() _session: RequestSession,
  ): { items: CardEdition[] } {
    const index = this.catalog.requireIndex()
    const ids = [...new Set(query.ids.split(',').map((id) => id.trim()))].filter(Boolean)
    return { items: ids.map((id) => index.cardById(id)).filter((card): card is CardEdition => card !== undefined) }
  }

  @Get('cards/:id')
  card(
    @Param('id') id: string,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ card: CardEdition; group: GroupDetail }> {
    return this.catalog.card(id)
  }

  @Get('groups/:id')
  async group(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<{ group: GroupDetail }> {
    return { group: await this.catalog.groupDetail(id) }
  }
}
