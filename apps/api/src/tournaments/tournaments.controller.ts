import { Body, Controller, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common'
import { TOURNAMENT_FORMATS } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CollectionModule } from '../collection/collection.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { LimitlessClient, LimitlessTransport } from './limitless.client.js'
import { TournamentDataVersion, TournamentSettings } from './tournament-settings.js'
import { TournamentSyncService } from './tournament-sync.service.js'
import type {
  ArchetypeDetailView,
  ArchetypesView,
  BuildableView,
  DeckVersionDetailView,
  DeckVersionsView,
  ListDetailView,
  ListsView,
  MatchupMatrixView,
  MetaTrendsView,
  ScopeView,
  SetReleaseView,
  StatusView,
  TournamentRowView,
  UnknownCardView,
  UnlockView,
} from './tournament-views.js'
import { TournamentsService } from './tournaments.service.js'

const setCode = z.string().regex(/^[A-Za-z0-9-]{1,8}$/, 'Código de set inválido.')
const scopeSchema = z.object({
  era: setCode.optional(),
  format: z.enum(TOURNAMENT_FORMATS).optional(),
})
const limit = z.coerce.number().int().min(1).max(500).optional()
const listsQuerySchema = scopeSchema.extend({
  kind: z.enum(['group', 'name']).optional(),
  archetype: z.string().min(1).max(200).optional(),
  limit,
  minLists: z.coerce.number().int().min(1).max(1000).optional(),
})
const listQuerySchema = scopeSchema.extend({ kind: z.enum(['group', 'name']).optional() })
const archetypeQuerySchema = scopeSchema.extend({
  card: z.string().min(1).max(20).optional(),
  minCount: z.coerce.number().int().min(1).max(2).optional(),
})
const limitedScopeSchema = scopeSchema.extend({ limit })
const trendsQuerySchema = scopeSchema.extend({
  days: z.coerce.number().int().min(3).max(30).optional(),
  minLists: z.coerce.number().int().min(1).max(100).optional(),
})
const matchupsQuerySchema = scopeSchema.extend({ top: z.coerce.number().int().min(2).max(30).optional() })
const syncSchema = z.object({ backfillDays: z.number().int().min(1).max(180).optional() })
const setReleaseSchema = z.object({
  nameEn: z.string().trim().min(1).max(80),
  releaseDate: z.iso.date(),
  opensEra: z.boolean(),
})
const aliasSchema = z.object({ canonicalId: z.string().min(1).max(200).nullable() })
const listKey = z.string().regex(/^[0-9a-f]{14}$/, 'Lista inválida.')

/** Session-protected tournaments API (docs/API.md «Torneos»). Data: Limitless (play.limitlesstcg.com). */
@Controller('api/tournaments')
export class TournamentsController {
  constructor(
    private readonly tournaments: TournamentsService,
    private readonly sync: TournamentSyncService,
  ) {}

  @Get('status')
  status(@CurrentSession() _session: RequestSession): Promise<StatusView> {
    return this.tournaments.status()
  }

  /** Starts a run in the background (202); `backfillDays` downloads further back. */
  @Post('sync')
  @HttpCode(202)
  startSync(
    @Body(new ZodValidationPipe(syncSchema)) body: z.infer<typeof syncSchema>,
    @CurrentSession() _session: RequestSession,
  ): { started: boolean } {
    return {
      started: this.sync.start(
        body.backfillDays === undefined ? {} : { kind: 'backfill', backfillDays: body.backfillDays },
      ),
    }
  }

  @Get('archetypes')
  archetypes(
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ArchetypesView> {
    return this.tournaments.archetypes(query)
  }

  /** Fase 11: what is played more and less, this week against the week before. */
  @Get('trends')
  trends(
    @Query(new ZodValidationPipe(trendsQuerySchema)) query: z.infer<typeof trendsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MetaTrendsView> {
    return this.tournaments.trends(query)
  }

  /** Fase 9: the most played archetypes against each other, from the era's pairings. */
  @Get('matchups')
  matchups(
    @Query(new ZodValidationPipe(matchupsQuerySchema)) query: z.infer<typeof matchupsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MatchupMatrixView> {
    return this.tournaments.matchupMatrix(query)
  }

  /** `none` = lists without archetype. `card` (functional card or edition id) adds «con y sin». */
  @Get('archetypes/:id')
  archetype(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(archetypeQuerySchema)) query: z.infer<typeof archetypeQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ArchetypeDetailView> {
    return this.tournaments.archetype(id, query)
  }

  @Put('archetypes/:id/alias')
  async setAlias(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(aliasSchema)) body: z.infer<typeof aliasSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ archetypeId: string; canonicalId: string | null }> {
    await this.tournaments.setAlias(id, body.canonicalId)
    return { archetypeId: id, canonicalId: body.canonicalId }
  }

  @Get('lists')
  lists(
    @Query(new ZodValidationPipe(listsQuerySchema)) query: z.infer<typeof listsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ListsView> {
    return this.tournaments.lists(query)
  }

  @Get('lists/:key')
  list(
    @Param('key', new ZodValidationPipe(listKey)) key: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<ListDetailView> {
    return this.tournaments.list(key, query)
  }

  @Get('buildable')
  buildable(
    @Query(new ZodValidationPipe(limitedScopeSchema)) query: z.infer<typeof limitedScopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<BuildableView> {
    return this.tournaments.buildable(query)
  }

  /** «Versión de torneo» of every active deck: the list of its archetype worth aiming at and what it lacks. */
  @Get('decks/versions')
  deckVersions(
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckVersionsView> {
    return this.tournaments.deckVersions(query)
  }

  @Get('decks/:id/version')
  deckVersion(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckVersionDetailView> {
    return this.tournaments.deckVersion(id, query)
  }

  @Get('unlock')
  unlock(
    @Query(new ZodValidationPipe(limitedScopeSchema)) query: z.infer<typeof limitedScopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<UnlockView> {
    return this.tournaments.unlock(query)
  }

  @Get('events')
  events(
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ scope: ScopeView; rows: TournamentRowView[] }> {
    return this.tournaments.tournaments(query)
  }

  @Get('unknown-cards')
  unknownCards(
    @Query(new ZodValidationPipe(scopeSchema)) query: z.infer<typeof scopeSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ scope: ScopeView; cards: UnknownCardView[] }> {
    return this.tournaments.unknownCards(query)
  }

  @Get('sets')
  async sets(@CurrentSession() _session: RequestSession): Promise<{ items: SetReleaseView[] }> {
    return { items: await this.tournaments.setReleases() }
  }

  /** Adds a set or fixes its release date (the era of every tournament is recomputed). */
  @Put('sets/:code')
  saveSet(
    @Param('code', new ZodValidationPipe(setCode)) code: string,
    @Body(new ZodValidationPipe(setReleaseSchema)) body: z.infer<typeof setReleaseSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<SetReleaseView> {
    return this.tournaments.saveSetRelease({ code, ...body })
  }
}

@Module({
  imports: [CatalogModule, CollectionModule],
  controllers: [TournamentsController],
  providers: [
    LimitlessTransport,
    LimitlessClient,
    TournamentDataVersion,
    TournamentSettings,
    TournamentSyncService,
    TournamentsService,
  ],
  exports: [TournamentsService, TournamentSyncService, TournamentDataVersion, LimitlessTransport],
})
export class TournamentsModule {}
