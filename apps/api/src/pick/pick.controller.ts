/** ¿Qué mazo llevo hoy? (Fase 15, docs/API.md «Mazos»). */
import { Body, Controller, Get, HttpCode, Module, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { LabModule } from '../lab/lab.controller.js'
import type { LabRefreshView } from '../lab/lab-views.js'
import { MatchesModule } from '../matches/matches.module.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { PickService, type PickView } from './pick.service.js'

const querySchema = z.object({
  sort: z.enum(['tournament', 'matches', 'lab']).optional(),
  /** Fase 44: weigh the rivals by today's tournament meta (default) or by «mi meta». */
  meta: z.enum(['tournament', 'mine']).optional(),
})

const refreshSchema = z.object({ dryRun: z.boolean().optional() }).default({})

@Controller('api/decks-today')
export class PickController {
  constructor(private readonly pick: PickService) {}

  @Get()
  today(
    @Query(new ZodValidationPipe(querySchema)) query: z.infer<typeof querySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<PickView> {
    return this.pick.today(query.sort, query.meta)
  }

  /**
   * «Actualizar todos» (14/10): tests against this era's meta of the decks whose list has no score of this era and
   * engine (with `dryRun`: how many and how long).
   */
  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LabRefreshView> {
    return this.pick.refreshLab(body.dryRun ?? false)
  }
}

@Module({
  imports: [MatchesModule, TournamentsModule, LabModule, CatalogModule],
  controllers: [PickController],
  providers: [PickService],
  exports: [PickService],
})
export class PickModule {}
