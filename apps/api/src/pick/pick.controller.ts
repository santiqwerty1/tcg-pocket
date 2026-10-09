/** ¿Qué mazo llevo hoy? (Fase 15, docs/API.md «Mazos»). */
import { Controller, Get, Module, Query } from '@nestjs/common'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { LabModule } from '../lab/lab.controller.js'
import { MatchesModule } from '../matches/matches.module.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { PickService, type PickView } from './pick.service.js'

const querySchema = z.object({
  sort: z.enum(['tournament', 'matches', 'lab']).optional(),
  /** Fase 44: weigh the rivals by today's tournament meta (default) or by «mi meta». */
  meta: z.enum(['tournament', 'mine']).optional(),
})

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
}

@Module({
  imports: [MatchesModule, TournamentsModule, LabModule],
  controllers: [PickController],
  providers: [PickService],
  exports: [PickService],
})
export class PickModule {}
