/** Ranked by season and rank (14/10, docs/API.md «Ranked»). */
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common'
import { RANKS } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { RankedService } from './ranked.service.js'
import type { RankChangeView, RankedView } from './ranked-views.js'

const viewQuerySchema = z.object({ season: z.string().trim().min(1).max(20).optional() })
const seasonSchema = z.object({
  name: z.string().trim().min(1).max(60),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
})
const rankSchema = z.object({
  rank: z.enum(RANKS),
  /** Master Ball points. */
  points: z.number().int().min(0).max(100_000).nullable().optional(),
  /** When it changed (ISO 8601); now when absent. */
  at: z.iso.datetime({ offset: true }).optional(),
})
const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,20}$/, 'Código de temporada inválido.')

@Controller('api/ranked')
export class RankedController {
  constructor(private readonly ranked: RankedService) {}

  @Get()
  view(
    @Query(new ZodValidationPipe(viewQuerySchema)) query: z.infer<typeof viewQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RankedView> {
    return this.ranked.view(query.season)
  }

  /** Creates or corrects a season (its days may not overlap another's). */
  @Put('seasons/:code')
  setSeason(
    @Param('code', new ZodValidationPipe(codeSchema)) code: string,
    @Body(new ZodValidationPipe(seasonSchema)) body: z.infer<typeof seasonSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.ranked.setSeason(code, body)
  }

  @Delete('seasons/:code')
  @HttpCode(204)
  async deleteSeason(
    @Param('code', new ZodValidationPipe(codeSchema)) code: string,
    @CurrentSession() _session: RequestSession,
  ): Promise<void> {
    await this.ranked.deleteSeason(code)
  }

  /** Notes the rank (now, or when it changed). */
  @Post('ranks')
  @HttpCode(201)
  addRank(
    @Body(new ZodValidationPipe(rankSchema)) body: z.infer<typeof rankSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RankChangeView> {
    return this.ranked.addRank(body)
  }

  @Delete('ranks/:id')
  @HttpCode(204)
  async deleteRank(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.ranked.deleteRank(id)
  }
}

@Module({
  controllers: [RankedController],
  providers: [RankedService],
  exports: [RankedService],
})
export class RankedModule {}
