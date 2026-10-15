import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { MATCH_MODES, MATCH_NOTE_MAX_LENGTH, MATCH_RESULTS, OPPONENT_CARDS_MAX, OPPONENT_MAX_LENGTH } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import type {
  DeckComparisonView,
  DeckMatchupsView,
  LuckView,
  MatchStatsView,
  MatchSuggestionsView,
  MatchView,
  MyMetaView,
  RivalSuggestionsView,
  UnclassifiedView,
} from './match-views.js'
import { MatchesService } from './matches.service.js'

const isoDateTime = z.iso.datetime({ offset: true, message: 'Fecha ISO 8601 inválida.' })
const deckIdField = z.string().trim().min(1).max(20)
const seenCardsSchema = z
  .array(z.object({ cardId: z.string().trim().min(1).max(20), count: z.number().int().min(1).max(2) }))
  .max(OPPONENT_CARDS_MAX, `Hasta ${OPPONENT_CARDS_MAX} cartas.`)
/** «A1-89x2,B1-121»: the cards seen in a query string. */
const seenCardsQuerySchema = z.object({
  cards: z
    .string()
    .max(400)
    .transform((text) =>
      text
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
          const [cardId, count] = part.split('x')
          return { cardId: (cardId ?? '').trim(), count: Number(count ?? 1) }
        }),
    )
    .pipe(seenCardsSchema),
})
const classifySchema = z
  .object({
    matchIds: z.array(z.string().trim().min(1).max(20)).max(500).optional(),
    /** Reclassify every match of a rival typed before (by its key: case and accents do not matter). */
    from: z.string().trim().min(1).max(OPPONENT_MAX_LENGTH).optional(),
    /** `null`: back to «sin clasificar» («Deshacer»). */
    opponent: z.string().trim().min(1).max(OPPONENT_MAX_LENGTH).nullable(),
  })
  .refine((body) => (body.matchIds?.length ?? 0) > 0 || body.from !== undefined, {
    message: 'Mandá las partidas o el rival a reclasificar.',
  })
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
  /** Fase 28: the phone's id of the match (sending it again stores it once). */
  clientRef: z.uuid().optional(),
  /** 14/10: the rival's cards seen («2 Greninja»): any edition of each name, one or two copies. */
  opponentCards: seenCardsSchema.optional(),
  /** Fase 28: how long ago it was played, by the phone's own clock (a wrong clock does not matter). */
  playedAgoMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 60 * 60 * 1000)
    .optional(),
})
const matchPatchSchema = matchInputSchema
  .omit({ clientRef: true, playedAgoMs: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Mandá al menos un campo.' })
const listQuerySchema = z.object({
  deckId: deckIdField.optional(),
  mode: z.enum(MATCH_MODES).optional(),
  result: z.enum(MATCH_RESULTS).optional(),
  opponent: z.string().max(OPPONENT_MAX_LENGTH).optional(),
  /** «exact»: only that rival (a stats row or an archetype opening its history); «contains» (default): a search. */
  opponentMatch: z.enum(['contains', 'exact']).optional(),
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
const myMetaQuerySchema = z.object({
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  mode: z.enum(MATCH_MODES).optional(),
  days: z.coerce.number().int().min(1).max(3650).optional(),
})
const luckQuerySchema = z.object({
  deckId: z.string().trim().min(1).max(20),
  opponent: z.string().trim().max(OPPONENT_MAX_LENGTH).optional(),
  mode: z.enum(MATCH_MODES).optional(),
})

/** Session-protected matches API (docs/API.md «Partidas»). Static routes go first so they never match `:id`. */
@Controller('api/matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  /** Fase 13: is the deck's record (overall or against a rival) unusual for what tournaments expect? */
  @Get('luck')
  luck(
    @Query(new ZodValidationPipe(luckQuerySchema)) query: z.infer<typeof luckQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LuckView> {
    return this.matches.luck(query.deckId, query.opponent || undefined, query.mode)
  }

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

  /** Fase 44: «mi meta», the rivals of my matches as tournament archetypes, the recent ones weighing more. */
  @Get('my-meta')
  myMeta(
    @Query(new ZodValidationPipe(myMetaQuerySchema)) query: z.infer<typeof myMetaQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<MyMetaView> {
    return this.matches.myMeta(query)
  }

  /** 14/10: the current era's archetypes for the rival's cards seen (`?cards=A1-89x2,B1-121`). */
  @Get('rival-suggestions')
  rivalSuggestions(
    @Query(new ZodValidationPipe(seenCardsQuerySchema)) query: z.infer<typeof seenCardsQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RivalSuggestionsView> {
    return this.matches.rivalSuggestions(query.cards)
  }

  /** 14/10: the matches without a rival and with cards seen, grouped to classify; the rivals that are no archetype. */
  @Get('unclassified')
  unclassified(@CurrentSession() _session: RequestSession): Promise<UnclassifiedView> {
    return this.matches.unclassified()
  }

  /** 14/10: how many matches wait for a rival (what «Hoy» shows). */
  @Get('unclassified/count')
  unclassifiedCount(@CurrentSession() _session: RequestSession): Promise<{ matches: number }> {
    return this.matches.unclassifiedCount()
  }

  /** 14/10: one rival for some matches (by id) or for every match of a rival typed before (`from`). */
  @Post('classify')
  @HttpCode(200)
  classify(
    @Body(new ZodValidationPipe(classifySchema)) body: z.infer<typeof classifySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ updated: number; opponent: string | null; previous: { id: string; opponent: string | null }[] }> {
    return this.matches.classify(body)
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

  /** Fase 9: against each rival, own matches and the tournament matchup of the deck's archetype. */
  @Get(':id/matchups')
  matchups(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(comparisonQuerySchema)) query: z.infer<typeof comparisonQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DeckMatchupsView> {
    return this.matches.deckMatchups(id, query.mode)
  }
}
