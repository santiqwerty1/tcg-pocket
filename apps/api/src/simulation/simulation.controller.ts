import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { BOT_CODE_PATTERN, QUEUEABLE_SIMULATION_KINDS, SELECTABLE_ENERGIES, TOURNAMENT_FORMATS } from '@tcg/domain'
import type { Request, Response } from 'express'
import { from, interval, type Observable, startWith, switchMap, takeWhile } from 'rxjs'
import { z } from 'zod'
import { CurrentApiToken, CurrentSession, type RequestApiToken, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { abortOnClose } from '../http/abort-on-close.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { BearerTokenGuard, RequireScopes } from '../tokens/bearer-token.guard.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { SimulationAnalysisService } from './analysis.service.js'
import { EngineUpstreamService } from './engine-upstream.service.js'
import type { EngineView, JobDetailView, JobSummaryView, ReplayView } from './simulation-views.js'
import { SimulationsService } from './simulations.service.js'
import { EngineStatusService, SnapshotsService } from './snapshots.service.js'
import { MAX_REPLAY_BYTES, WorkerQueueService } from './worker-queue.service.js'

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
    kind: z.enum(['group', 'name']).optional(),
    energies,
  }),
])
const botCode = z.string().regex(BOT_CODE_PATTERN, 'Bot desconocido.')
const jobSchema = z.object({
  kind: z.enum(QUEUEABLE_SIMULATION_KINDS),
  label: z.string().trim().max(200).optional(),
  // The real limit (150 per side, MAX_DECKS_PER_SIDE) is checked by the service with a Spanish message.
  sideA: z.array(sourceSchema).min(1).max(500),
  sideB: z.array(sourceSchema).max(500).default([]),
  gamesPerPair: z.number().int().min(1).max(20_000),
  players: z.tuple([botCode, botCode]),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
  bothOrders: z.boolean().optional(),
  replaySample: z.number().int().min(0).max(5).optional(),
  cores: z.number().int().min(1).max(64).optional(),
  skipNotSimulable: z.boolean().optional(),
  perGame: z.boolean().optional(),
  optimize: z
    .object({
      remove: z
        .array(z.object({ cardId: z.string().min(1).max(20), count: z.number().int().min(1).max(2) }))
        .min(1)
        .max(20),
      candidates: z.array(z.string().min(1).max(20)).min(1).max(30),
    })
    .optional(),
})
const consistencySchema = z.object({
  deckId: z.string().trim().min(1).max(20),
  keyCards: z.array(z.string().min(1).max(20)).max(10).optional(),
  games: z.number().int().min(10).max(10_000).optional(),
  bot: botCode.optional(),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 52)
    .optional(),
})
const helloSchema = z.object({
  workerId: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(100),
  engineRev: z.string().regex(/^[0-9a-f]{40}$/),
  cliVersion: z.string().max(40).optional(),
  cores: z.number().int().min(1).max(256),
  version: z.string().max(40).optional(),
  engineFeatures: z.array(z.string().max(40)).max(32).optional(),
  batch: z
    .object({ maxChunks: z.number().int().min(1).max(256), maxGames: z.number().int().min(1).max(50_000) })
    .optional(),
})
const heartbeatSchema = z.object({
  workerId: z.string().min(8).max(64),
  gamesDone: z.number().int().min(0),
  total: z.number().int().min(0).optional(),
})
const resultSchema = z.object({
  workerId: z.string().min(8).max(64),
  engineRev: z.string().regex(/^[0-9a-f]{40}$/),
  winsA: z.number().int().min(0),
  winsB: z.number().int().min(0),
  ties: z.number().int().min(0),
  games: z.number().int().min(0),
  turns: z.number().int().min(0).optional(),
  durationMs: z.number().min(0),
  extra: z.record(z.string(), z.unknown()).optional(),
})
const failureSchema = z.object({ workerId: z.string().min(8).max(64), error: z.string().min(1).max(20_000) })
const listQuerySchema = z.object({ archived: z.enum(['true', 'false']).optional() })
const cleanupSchema = z.object({ action: z.enum(['delete_cancelled', 'archive_done']) })
const prioritySchema = z.object({ priority: z.number().int().min(0).max(2_147_483_647) })

const replayQuerySchema = z.object({
  index: z.coerce.number().int().min(0),
  seed: z.string().regex(/^\d{1,20}$/),
  winner: z.enum(['a', 'b', 'tie']),
})
const engineStatusSchema = z.object({
  engineRev: z.string().regex(/^[0-9a-f]{40}$/),
  cards: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        name: z.string().max(200),
        status: z.string().max(40),
        complete: z.boolean(),
      }),
    )
    .max(20_000),
})
const idParam = z.coerce.number().int().positive()
const analysisQuerySchema = z.object({
  bot: botCode.optional(),
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  expansion: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  matrix: idParam.optional(),
  left: idParam.optional(),
  right: idParam.optional(),
})

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

/** Worker protocol (PLAN §3.7): bearer `tcg_wk_*` with `worker:claim`, outbound HTTPS only from the owner's PC. */
@Controller('api/worker')
@UseGuards(BearerTokenGuard)
@RequireScopes('worker:claim')
export class WorkerController {
  constructor(private readonly queue: WorkerQueueService) {}

  @Get('ping')
  ping(@CurrentApiToken() token: RequestApiToken): { ok: true; token: { name: string; kind: string } } {
    return { ok: true, token: { name: token.name, kind: token.kind } }
  }

  /** Long-poll up to 25 s. `chunk: null` = nothing to do; `retryAfterSeconds` paces the next claim. */
  @Post('claim')
  @HttpCode(200)
  async claim(
    @Body(new ZodValidationPipe(helloSchema)) body: z.infer<typeof helloSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { signal, dispose } = abortOnClose(response)
    try {
      const result = await this.queue.claim(body, signal)
      return { ...result, retryAfterSeconds: result.chunk ? 0 : result.requiredEngineRev ? 300 : 5 }
    } finally {
      dispose()
    }
  }

  @Put('chunks/:id/heartbeat')
  heartbeat(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(heartbeatSchema)) body: z.infer<typeof heartbeatSchema>,
  ) {
    return this.queue.heartbeat(id, body)
  }

  @Put('chunks/:id/result')
  result(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(resultSchema)) body: z.infer<typeof resultSchema>,
  ) {
    return this.queue.result(id, { ...body, extra: body.extra as never })
  }

  @Put('chunks/:id/failure')
  failure(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(failureSchema)) body: z.infer<typeof failureSchema>,
  ) {
    return this.queue.failure(id, body)
  }

  /** Body: the replay JSON gzipped (`Content-Type: application/gzip`), at most 8 MB. */
  @Put('chunks/:id/replays/:gameId')
  async replay(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Param(
      'gameId',
      new ZodValidationPipe(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)),
    )
    gameId: string,
    @Query(new ZodValidationPipe(replayQuerySchema)) query: z.infer<typeof replayQuerySchema>,
    @Req() request: Request,
  ) {
    const body = await readBody(request, MAX_REPLAY_BYTES)
    return this.queue.saveReplay(id, gameId, { gameIndex: query.index, seed: query.seed, winner: query.winner, body })
  }

  @Put('engine-status')
  engineStatus(@Body(new ZodValidationPipe(engineStatusSchema)) body: z.infer<typeof engineStatusSchema>) {
    return this.queue.uploadEngineStatus(body.engineRev, body.cards)
  }
}

/** Session-protected simulation API (docs/API.md «Simulación»). */
@Controller('api/simulations')
export class SimulationsController {
  constructor(
    private readonly simulations: SimulationsService,
    private readonly analysis: SimulationAnalysisService,
  ) {}

  @Get('analysis')
  readAnalysis(
    @Query(new ZodValidationPipe(analysisQuerySchema)) query: z.infer<typeof analysisQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.analysis.read(query)
  }

  @Post(':id/priority')
  @HttpCode(200)
  priority(
    @Param('id', new ZodValidationPipe(idParam)) id: number,
    @Body(new ZodValidationPipe(prioritySchema)) body: z.infer<typeof prioritySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<JobSummaryView> {
    return this.simulations.setPriority(String(id), body.priority)
  }

  /** The list (archived jobs left out), or only the archived ones with `?archived=true`. */
  @Get()
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.simulations.listView(query.archived === 'true')
  }

  /** Delete every cancelled job, or archive every finished one. */
  @Post('cleanup')
  @HttpCode(200)
  cleanup(
    @Body(new ZodValidationPipe(cleanupSchema)) body: z.infer<typeof cleanupSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<{ count: number }> {
    return this.simulations.cleanup(body.action)
  }

  @Get('engine')
  engine(@CurrentSession() _session: RequestSession): Promise<EngineView> {
    return this.simulations.engineView()
  }

  /** What a job would play, without queueing it: snapshots with «no simulable» reasons and an estimate. */
  @Post('preview')
  @HttpCode(200)
  preview(
    @Body(new ZodValidationPipe(jobSchema)) body: z.infer<typeof jobSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.simulations.preview(body)
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(jobSchema)) body: z.infer<typeof jobSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<JobSummaryView> {
    return this.simulations.create(body)
  }

  /** How soon a deck has its key attacker ready (Fase 8): one chunk of goldfish games. */
  @Post('consistency')
  @HttpCode(201)
  consistency(
    @Body(new ZodValidationPipe(consistencySchema)) body: z.infer<typeof consistencySchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<JobSummaryView> {
    return this.simulations.createConsistency(body)
  }

  /** The latest finished consistency of a deck: `result` against a passive rival, `meta` against the meta. */
  @Get('consistency/deck/:deckId')
  async deckConsistency(@Param('deckId') deckId: string, @CurrentSession() _session: RequestSession) {
    const latest = await this.simulations.deckConsistency(deckId)
    return { result: latest.goldfish, meta: latest.meta }
  }

  /** The replay JSON as the engine wrote it, for deckgym's own viewer (`/viewer/index.html?url=…`, D-014). */
  @Get('replays/:id/raw')
  replayRaw(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<unknown> {
    return this.simulations.replayRaw(id)
  }

  @Get('replays/:id')
  replay(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<ReplayView> {
    return this.simulations.replay(id)
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<JobDetailView> {
    return this.simulations.detail(id)
  }

  /** Server-sent events: the job's progress every 2 s until it ends. */
  @Sse(':id/events')
  events(@Param('id') id: string, @CurrentSession() _session: RequestSession): Observable<MessageEvent> {
    let finished = false
    return interval(2000).pipe(
      startWith(0),
      takeWhile(() => !finished),
      switchMap(() =>
        from(
          this.simulations.progressOf(id).then((summary) => {
            finished = !['queued', 'running'].includes(summary.status)
            return { data: summary } satisfies MessageEvent
          }),
        ),
      ),
    )
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<JobSummaryView> {
    return this.simulations.cancel(id)
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<JobSummaryView> {
    return this.simulations.archive(id, true)
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<JobSummaryView> {
    return this.simulations.archive(id, false)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.simulations.remove(id)
  }
}

@Module({
  imports: [TokensModule, CatalogModule, TournamentsModule],
  controllers: [WorkerController, SimulationsController],
  providers: [
    EngineStatusService,
    EngineUpstreamService,
    SnapshotsService,
    WorkerQueueService,
    SimulationsService,
    SimulationAnalysisService,
  ],
  exports: [
    SimulationsService,
    SnapshotsService,
    EngineStatusService,
    WorkerQueueService,
    EngineUpstreamService,
    SimulationAnalysisService,
  ],
})
export class SimulationModule {}
