/** Playing against a bot (Fase 8, docs/API.md «Jugar contra un bot»): the owner's side and the worker's side. */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  type MessageEvent,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common'
import { BOT_CODE_PATTERN, SELECTABLE_ENERGIES, TOURNAMENT_FORMATS } from '@tcg/domain'
import type { Request, Response } from 'express'
import { Observable } from 'rxjs'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import type { Prisma } from '../generated/prisma/client.js'
import { abortOnClose } from '../http/abort-on-close.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { SimulationModule } from '../simulation/simulation.controller.js'
import { WorkerQueueService } from '../simulation/worker-queue.service.js'
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
  bot: z.string().regex(BOT_CODE_PATTERN, 'Bot desconocido.').optional(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
  /** Modo entrenador (Fase 20). */
  coach: z.boolean().optional(),
  /** T-015: «browser» plays it with the engine of this device (WebAssembly), which must be the server's. */
  runner: z.enum(['worker', 'browser']).optional(),
  engineRev: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
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
const rematchSchema = z.object({
  sameSeed: z.boolean().optional(),
  /** T-015: the engine of the page, for the rematch of a browser game. */
  engineRev: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
})
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
  /** What its engine can play (#16, worker 0.2.6 on): a game against an f bot (H-018) needs «fairBots». */
  engineFeatures: z.array(z.string().max(40)).max(20).optional(),
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

// T-015: the game's open page runs the engine (WebAssembly) and sends what a worker would, with the choices it played.
const choices = z.array(z.number().int().min(0).max(500)).max(5000)
const browserJobSchema = z.object({ engineRev: z.string().regex(/^[0-9a-f]{40}$/) })
const browserDecisionSchema = decisionSchema.omit({ workerId: true }).extend({ choices })
const browserWaitSchema = z.object({ choices, ply: z.number().int().min(1) })
const browserEndSchema = endSchema.omit({ workerId: true }).extend({ choices })
const browserFailureSchema = z.object({ choices, error: z.string().min(1).max(20_000) })
/** The replay's choices in the query (`1.0.3`; none when the owner never chose), its body gzipped like a worker's. */
const browserReplaySchema = z.object({
  choices: z
    .string()
    .max(20_000)
    .regex(/^(\d{1,3}(\.\d{1,3})*)?$/)
    .optional()
    .transform((text) => (text ? text.split('.').map(Number) : [])),
})

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

  /**
   * Fase 33: the game, pushed as it changes (server-sent events) — when the bot moves, when it is the owner's turn, from
   * another device — instead of polling every second. A ping every 15 s keeps the connection and the owner's presence
   * (no «te toca» push while the page is open). It ends once the game is over and its replay is in.
   */
  @Sse(':id/events')
  events(@Param('id') id: string, @CurrentSession() _session: RequestSession): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false
      let busy = false
      let again = false
      let unwatch: (() => void) | null = null
      const push = async () => {
        if (closed) return
        if (busy) {
          again = true
          return
        }
        busy = true
        try {
          do {
            again = false
            const game = await this.games.get(id)
            if (closed) return
            unwatch ??= this.games.watch(game.id, () => void push())
            subscriber.next({ data: game })
            const over =
              game.status === 'failed' || game.status === 'abandoned' || (game.status === 'done' && game.replay)
            if (over) {
              subscriber.complete()
              return
            }
          } while (again && !closed)
        } catch (error) {
          subscriber.error(error)
        } finally {
          busy = false
        }
      }
      const ping = setInterval(() => {
        if (unwatch === null) return
        this.games.stillWatching(Number(id))
        subscriber.next({ type: 'ping', data: '' })
      }, 15_000)
      void push()
      return () => {
        closed = true
        clearInterval(ping)
        unwatch?.()
      }
    })
  }

  /** T-015: what the engine of the page needs to run a browser game (only with the game's engine revision). */
  @Get(':id/browser')
  browserJob(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(browserJobSchema)) query: z.infer<typeof browserJobSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.games.browserJob(id, query.engineRev)
  }

  /** T-015: the page's engine asks the owner (like a worker's decision, without a lease). */
  @Put(':id/browser/decision')
  browserDecision(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(browserDecisionSchema)) body: z.infer<typeof browserDecisionSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.games.browserDecision(id, {
      ...body,
      state: body.state as Prisma.JsonValue,
      actions: body.actions as { i: number; text: string; action: Prisma.JsonValue }[],
      log: body.log as Prisma.InputJsonValue,
    })
  }

  /** T-015: long-poll up to 25 s for the owner's choice at `ply`. */
  @Post(':id/browser/choice')
  @HttpCode(200)
  async browserChoice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(browserWaitSchema)) body: z.infer<typeof browserWaitSchema>,
    @Res({ passthrough: true }) response: Response,
    @CurrentSession() _session: RequestSession,
  ) {
    const { signal, dispose } = abortOnClose(response)
    try {
      return await this.games.browserChoice(id, body, signal)
    } finally {
      dispose()
    }
  }

  @Put(':id/browser/end')
  browserEnd(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(browserEndSchema)) body: z.infer<typeof browserEndSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.games.browserEnd(id, {
      ...body,
      state: body.state as Prisma.InputJsonValue,
      log: body.log as Prisma.InputJsonValue,
    })
  }

  @Put(':id/browser/failure')
  browserFailure(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(browserFailureSchema)) body: z.infer<typeof browserFailureSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.games.browserFailure(id, body)
  }

  /** Body: the replay JSON gzipped (`Content-Type: application/gzip`), at most 8 MB. */
  @Put(':id/browser/replay')
  async browserReplay(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(browserReplaySchema)) query: z.infer<typeof browserReplaySchema>,
    @Req() request: Request,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.games.browserReplay(id, query.choices, await readBody(request, MAX_LIVE_REPLAY_BYTES))
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
  async claim(
    @Body(new ZodValidationPipe(claimSchema)) body: z.infer<typeof claimSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { signal, dispose } = abortOnClose(response)
    try {
      return await this.games.claim(body, signal)
    } finally {
      dispose()
    }
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
  async choice(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(waitSchema)) body: z.infer<typeof waitSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { signal, dispose } = abortOnClose(response)
    try {
      return await this.games.choice(id, body, signal)
    } finally {
      dispose()
    }
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

/** Coordinates shutdown across both queues without a dependency from SimulationModule back to PlayModule. */
@Controller('api/worker')
@UseGuards(BearerTokenGuard)
@RequireScopes('worker:claim')
export class WorkerReleaseController {
  constructor(
    private readonly queue: WorkerQueueService,
    private readonly games: LiveGamesService,
  ) {}

  @Post('release')
  @HttpCode(200)
  async release(@Body(new ZodValidationPipe(z.object({ workerId: z.string().uuid() }))) body: { workerId: string }) {
    const chunks = await this.queue.release(body.workerId)
    const games = await this.games.releaseWorker(body.workerId)
    return { ...chunks, games }
  }
}

@Module({
  imports: [TokensModule, CatalogModule, SimulationModule, TournamentsModule],
  controllers: [PlayController, LiveWorkerController, PuzzlesController, WorkerReleaseController],
  providers: [LiveGamesService, PlayRivalsService, PuzzlesService, GameReviewService],
  exports: [LiveGamesService, GameReviewService],
})
export class PlayModule {}
