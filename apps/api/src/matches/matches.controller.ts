import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { MATCH_MODES, MATCH_NOTE_MAX_LENGTH, MATCH_RESULTS, OPPONENT_MAX_LENGTH } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import type { DeckComparisonView, MatchStatsView, MatchSuggestionsView, MatchView } from './match-views.js'
import { MatchesService } from './matches.service.js'

const isoDateTime = z.iso.datetime({ offset: true, message: 'Fecha ISO 8601 inválida.' })
const deckIdField = z.string().trim().min(1).max(20)
const matchInputSchema = z.object({
  deckId: deckIdField,
  result: z.enum(MATCH_RESULTS),
  opponent: z
    .string()
    .max(OPPONENT_MAX_LENGTH, `El rival puede tener hasta ${OPPONENT_MAX_LENGTH} caracteres.`)
    .nullable()
    .optional(),
  wentFirst: z.boolean().nullable().optional(),
  mode: z.enum(MATCH_MODES).optional(),
  note: z.string().max(MATCH_NOTE_MAX_LENGTH).optional(),
  playedAt: isoDateTime.optional(),
})
const matchPatchSchema = matchInputSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Mandá al menos un campo.' })
const listQuerySchema = z.object({
  deckId: deckIdField.optional(),
  mode: z.enum(MATCH_MODES).optional(),
  result: z.enum(MATCH_RESULTS).optional(),
  opponent: z.string().max(OPPONENT_MAX_LENGTH).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
const statsQuerySchema = z.object({
  deckId: deckIdField.optional(),
  mode: z.enum(MATCH_MODES).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
})
const comparisonQuerySchema = z.object({ mode: z.enum(MATCH_MODES).optional() })

/** Session-protected matches API (docs/API.md «Partidas»). Static routes go first so they never match `:id`. */
@Controller('api/matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ items: MatchView[]; total: number }> {
    return this.matches.list(query)
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(matchInputSchema)) body: z.infer<typeof matchInputSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MatchView> {
    return this.matches.create(body, 'ui')
  }

  @Get('suggestions')
  suggestions(@CurrentSession() _session: RequestSession): Promise<MatchSuggestionsView> {
    return this.matches.suggestions()
  }

  @Get('stats')
  stats(
    @Query(new ZodValidationPipe(statsQuerySchema)) query: z.infer<typeof statsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MatchStatsView> {
    return this.matches.stats(query)
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<MatchView> {
    return this.matches.get(id)
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(matchPatchSchema)) body: z.infer<typeof matchPatchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MatchView> {
    return this.matches.patch(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.matches.delete(id)
  }
}

/** `GET /api/decks/:id/comparison`: the three-column view of a deck (own matches / tournament / simulation). */
@Controller('api/decks')
export class DeckComparisonController {
  constructor(private readonly matches: MatchesService) {}

  @Get(':id/comparison')
  comparison(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(comparisonQuerySchema)) query: z.infer<typeof comparisonQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckComparisonView> {
    return this.matches.comparison(id, query.mode)
  }
}
