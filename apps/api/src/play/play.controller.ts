/** Playing against a bot (Fase 8, docs/API.md «Jugar contra un bot»): the owner's side and the worker's side. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SELECTABLE_ENERGIES, TOURNAMENT_FORMATS } from '@tcg/domain'
import type { Request } from 'express'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import type { Prisma } from '../generated/prisma/client.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { GameReviewService, type GameReviewView } from './game-review.service.js'
import {
  type LiveGameSummaryView,
  LiveGamesService,
  type LiveGameView,
  MAX_LIVE_REPLAY_BYTES,
} from './live-games.service.js'
import { PlayRivalsService, type RecentListsView } from './play-rivals.service.js'
import { type PuzzleAnswerView, type PuzzleListView, PuzzlesService, type PuzzleView } from './puzzles.service.js'

const energies = z.array(z.enum(SELECTABLE_ENERGIES)).max(3).optional()
const sourceSchema = z.union([
  z.object({ deckId: z.string().trim().min(1).max(20), energies }),
  z.object({
    listKey: z.string().regex(/^[0-9a-f]{14}$/),
    era: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,8}$/)
      .optional(),
    format: z.enum(TOURNAMENT_FORMATS).optional(),
    energies,
  }),
])
const createSchema = z.object({
  human: sourceSchema,
  rival: sourceSchema,
  bot: z
    .string()
    .regex(/^(r|w|aa|et|v|er|m|e[1-9])$/, 'Bot desconocido.')
    .optional(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
  /** Modo entrenador (Fase 20). */
  coach: z.boolean().optional(),
})
const hintSchema = z.object({ ply: z.number().int().min(1) })
const recentSchema = z.object({
  days: z.coerce.number().int().min(1).max(60).optional(),
  top: z.coerce.number().int().min(1).max(64).optional(),
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  format: z.enum(TOURNAMENT_FORMATS).optional(),
})
const rematchSchema = z.object({ sameSeed: z.boolean().optional() })
const reviewSchema = z.object({
  from: z.coerce.number().int().min(0).max(200).optional(),
  to: z.coerce.number().int().min(0).max(200).optional(),
  detail: z.enum(['summary', 'full']).optional(),
})
const choiceSchema = z.object({ ply: z.number().int().min(1), i: z.number().int().min(0).max(500) })
const idParam = z.coerce.number().int().positive()
const workerId = z.string().min(8).max(64)
const claimSchema = z.object({
  workerId,
  engineRev: z.string().regex(/^[0-9a-f]{40}$/),
  version: z.string().max(20).optional(),
})
const decisionSchema = z.object({
  workerId,
  ply: z.number().int().min(1),
  turn: z.number().int().min(0),
  state: z.record(z.string(), z.unknown()),
  actions: z
    .array(z.object({ i: z.number().int().min(0), text: z.string().max(2000), action: z.unknown() }))
    .min(1)
    .max(500),
  log: z.array(z.record(z.string(), z.unknown())).max(20_000),
  /** Modo entrenador: the engine's value of each option. */
  coach: z.object({ scores: z.array(z.number()).max(500), best: z.number().int().min(0) }).optional(),
})
const waitSchema = z.object({ workerId, ply: z.number().int().min(1) })
const endSchema = z.object({
  workerId,
  winner: z.enum(['you', 'bot', 'tie']),
  turns: z.number().int().min(0),
  state: z.record(z.string(), z.unknown()),
  log: z.array(z.record(z.string(), z.unknown())).max(20_000),
})
const failureSchema = z.object({ workerId, error: z.string().min(1).max(20_000) })

/** The owner's side: start a game, read it, answer each decision. */
@Controller('api/play')
export class PlayController {
  constructor(
    private readonly games: LiveGamesService,
    private readonly rivals: PlayRivalsService,
    private readonly reviews: GameReviewService,
  ) {}

  /** Fase 23: the exact lists that placed well in the last days, to play against (before `:id`). */
  @Get('recent-lists')
  recentLists(
    @Query(new ZodValidationPipe(recentSchema)) query: z.infer<typeof recentSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<RecentListsView> {
    return this.rivals.recentLists(query)
  }

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: LiveGameSummaryView[] }> {
    return { items: await this.games.list() }
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LiveGameView> {
    return this.games.create(body)
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<LiveGameView> {
    return this.games.get(id)
  }

  @Post(':id/choice')
  @HttpCode(200)
  choose(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(choiceSchema)) body: z.infer<typeof choiceSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LiveGameView> {
    return this.games.choose(id, body)
  }

  /** Modo entrenador: reveal the coach's option for the pending decision. */
  @Post(':id/hint')
  @HttpCode(200)
  hint(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(hintSchema)) body: z.infer<typeof hintSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LiveGameView> {
    return this.games.hint(id, body)
  }

  /** Fase 22: back to the previous decision (the PC rebuilds the game up to it). */
  @Post(':id/undo')
  @HttpCode(200)
  undo(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<LiveGameView> {
    return this.games.undo(id)
  }

  /** Fase 22: same decks and bot; `sameSeed` for the very same shuffle. */
  @Post(':id/rematch')
  @HttpCode(201)
  rematch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rematchSchema)) body: z.infer<typeof rematchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<LiveGameView> {
    return this.games.rematch(id, body)
  }

  @Post(':id/abandon')
  @HttpCode(200)
  abandon(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<LiveGameView> {
    return this.games.abandon(id)
  }

  /** Fase 29: the game told turn by turn in Spanish, with the coach's opinion (what the MCP gives Claude). */
  @Get(':id/review')
  review(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(reviewSchema)) query: z.infer<typeof reviewSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<GameReviewView> {
    return this.reviews.review(id, { fromTurn: query.from, toTurn: query.to, detail: query.detail })
  }

  /** The replay of a finished game, for deckgym's viewer (`/viewer/index.html?url=/api/play/:id/replay/raw`). */
  @Get(':id/replay/raw')
  replay(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<unknown> {
    return this.games.replayRaw(id)
  }
}

async function readBody(request: Request, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const part of request as AsyncIterable<Buffer>) {
    size += part.length
    if (size > limit) throw new BadRequestException({ code: 'too_large', message: 'Cuerpo demasiado grande.' })
    parts.push(part)
  }
  return Buffer.concat(parts)
}

const answerSchema = z.object({ i: z.number().int().min(0).max(500) })

/** Fase 24: situations to solve, from the owner's finished games with the coach. */
@Controller('api/puzzles')
export class PuzzlesController {
  constructor(private readonly puzzles: PuzzlesService) {}

  @Get()
  list(@CurrentSession() _session: RequestSession): Promise<PuzzleListView> {
    return this.puzzles.list()
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<PuzzleView> {
    return this.puzzles.get(id)
  }

  @Post(':id/answer')
  @HttpCode(200)
  answer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<PuzzleAnswerView> {
    return this.puzzles.answer(id, body)
  }
}

/** The worker's side (bearer `tcg_wk_*` with `worker:claim`): claim a game, relay decisions and the end. */
@Controller('api/worker/live')
@UseGuards(BearerTokenGuard)
@RequireScopes('worker:claim')
export class LiveWorkerController {
  constructor(private readonly games: LiveGamesService) {}

  /** Long-poll up to 25 s: a game to run (new or abandoned by another worker) or `game: null`. */
  @Post('claim')
  @HttpCode(200)
  claim(@Body(new ZodValidationPipe(claimSchema)) body: z.infer<typeof claimSchema>) {
    return this.games.claim(body)
  }

  @Put(':id/decision')
  decision(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>,
  ) {
    return this.games.decision(id, {
      ...body,
      state: body.state as Prisma.JsonValue,
      actions: body.actions as { i: number; text: string; action: Prisma.JsonValue }[],
      log: body.log as Prisma.InputJsonValue,
    })
  }

  /** Long-poll up to 25 s for the owner's choice at `ply`; renews the lease. */
  @Post(':id/choice')
  @HttpCode(200)
  choice(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(waitSchema)) body: z.infer<typeof waitSchema>,
  ) {
    return this.games.choice(id, body)
  }

  @Put(':id/end')
  end(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(endSchema)) body: z.infer<typeof endSchema>,
  ) {
    return this.games.end(id, {
      ...body,
      state: body.state as Prisma.InputJsonValue,
      log: body.log as Prisma.InputJsonValue,
    })
  }

  @Put(':id/failure')
  failure(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(failureSchema)) body: z.infer<typeof failureSchema>,
  ) {
    return this.games.failure(id, body)
  }

  /** Body: the replay JSON gzipped (`Content-Type: application/gzip`), at most 8 MB. */
  @Put(':id/replay')
  async replay(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Query('workerId', new ZodValidationPipe(workerId)) worker: string,
    @Req() request: Request,
  ) {
    return this.games.saveReplay(id, worker, await readBody(request, MAX_LIVE_REPLAY_BYTES))
  }
}

@Module({
  imports: [TokensModule, CatalogModule, SimulationModule, TournamentsModule],
  controllers: [PlayController, LiveWorkerController, PuzzlesController],
  providers: [LiveGamesService, PlayRivalsService, PuzzlesService, GameReviewService],
  exports: [LiveGamesService, GameReviewService],
})
export class PlayModule {}
