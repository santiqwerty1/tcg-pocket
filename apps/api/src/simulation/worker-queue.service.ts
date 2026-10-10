/**
 * The worker protocol (PLAN §3.7): the worker on the owner's PC claims a chunk (long-poll), sends a heartbeat every
 * 30 s and posts the result. A lease lasts 3 minutes: when the PC sleeps or turns off, the chunk goes back to the queue
 * without counting as a failure; only an engine error counts (3 at most). Results are idempotent: a chunk's result
 * depends only on its seed, so a duplicate after `done` is ignored.
 */

import { EventEmitter } from 'node:events'
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { canPlayFairBots, canPlayPerGame, checkPerGame, FAIR_BOT_CODES, wantsPerGame } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import type { Prisma } from '../generated/prisma/client.js'
import { gunzipJson } from '../http/gunzip.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ConsistencyParams } from './simulations.service.js'
import { EngineStatusService } from './snapshots.service.js'
import { versionAtLeast } from './worker-version.js'

export const LEASE_MS = 3 * 60 * 1000
const MAX_FAILURES = 3
const LONG_POLL_MS = 25_000
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024

export interface WorkerHello {
  workerId: string
  name: string
  engineRev: string
  cliVersion?: string | undefined
  cores: number
  version?: string | undefined
  /** What its engine can do (`engine-cli version`), from worker 0.2.6 on. */
  engineFeatures?: string[] | undefined
  /** B2: the worker plays several pairings of one job in one engine process, up to these limits. */
  batch?: { maxChunks: number; maxGames: number } | undefined
}

/** Said to a worker that got nothing while there is work it cannot play: it writes it in its log. */
export const PER_GAME_HINT =
  'Hay simulaciones que piden resultados partida por partida y este worker no puede jugarlas: hace falta el worker 0.2.5 o más nuevo y recompilar el motor (engine-cli con perGame).'

export interface ClaimedChunk {
  chunkId: number
  jobId: number
  /** explore chunks are plain pairings (deckA against deckB) like matrix and compare. */
  kind: 'matrix' | 'compare' | 'optimize' | 'explore' | 'consistency'
  idx: number
  games: number
  firstGame: number
  /** Chunk seed as a decimal string. */
  seed: string
  players: string[]
  threads: number | null
  replaySample: number
  leaseUntil: string
  deckA: string | null
  deckB: string | null
  /** Report every game by index (`params.perGame`, H-010): pairings only, workers from 0.2.5 on. */
  perGame: boolean
  /** optimize: the engine-cli optimize job without seed/threads. */
  optimize: Prisma.JsonValue | null
  /** consistency: the key cards (engine ids), own turns reported, the deck's bot and, against the meta, the rivals. */
  consistency: {
    keyCards: string[]
    maxTurn: number
    bot: string
    rivals: { deck: string; games: number }[] | null
  } | null
}

/** Workers older than this do not know consistency chunks (they would play them as a pairing). */
export const CONSISTENCY_WORKER_VERSION = '0.2.0'
/** …and older than this do not pass the rivals of a consistency «contra el meta» (D-019) to the engine. */
export const META_CONSISTENCY_WORKER_VERSION = '0.2.1'

/** Chunks that play one pairing (deck A against deck B); optimize and consistency run their own engine commands. */
function isPairing(kind: ClaimedChunk['kind']): boolean {
  return kind !== 'optimize' && kind !== 'consistency'
}

/** Pairing chunks of a job that asked for per-game results; optimize and consistency report their own way. */
function perGamePairing(kind: ClaimedChunk['kind'], params: Prisma.JsonValue): boolean {
  return isPairing(kind) && wantsPerGame(params)
}

export interface ChunkResultInput {
  workerId: string
  engineRev: string
  winsA: number
  winsB: number
  ties: number
  games: number
  turns?: number | undefined
  durationMs: number
  extra?: Prisma.InputJsonValue | undefined
}

@Injectable()
export class WorkerQueueService {
  /** Graceful shutdown/unplug: ownership is checked in each update; this never counts as an engine failure. */
  async release(workerId: string) {
    const chunks = await this.prisma.simulationChunk.updateMany({
      where: { workerId, status: 'leased' },
      data: { status: 'queued', workerId: null, leaseUntil: null, gamesDone: 0 },
    })
    this.notifyQueued()
    return { chunks: chunks.count }
  }
  /** Wakes long-polling claims when something is queued. */
  private readonly queued = new EventEmitter()
  /** How long a claim waits for work (tests shorten it). */
  longPollMs = LONG_POLL_MS
  /** Who decides what an explore job plays next when a round ends (the Laboratorio, T-008). */
  private roundHandler: ((jobId: number) => Promise<void>) | null = null
  /** What runs when a job ends well (the confirmation of an optimize, H-011.5). */
  private doneHandler: ((jobId: number) => Promise<void>) | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineStatusService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkerQueueService.name)
    this.queued.setMaxListeners(50)
  }

  notifyQueued(): void {
    this.queued.emit('queued')
  }

  /** `handler` runs after a job (not a search) ends with every chunk done; its errors are logged, not thrown. */
  onJobDone(handler: (jobId: number) => Promise<void>): void {
    this.doneHandler = handler
  }

  /** An explore job does not end when its chunks do: `handler` queues the next round or finishes it. */
  onExploreRound(handler: (jobId: number) => Promise<void>): void {
    this.roundHandler = handler
  }

  private async seen(hello: WorkerHello): Promise<void> {
    await this.prisma.workerNode.upsert({
      where: { id: hello.workerId },
      create: {
        id: hello.workerId,
        name: hello.name,
        engineRev: hello.engineRev,
        cliVersion: hello.cliVersion ?? null,
        cores: hello.cores,
        version: hello.version ?? null,
        engineFeatures: hello.engineFeatures ?? [],
      },
      update: {
        name: hello.name,
        engineRev: hello.engineRev,
        cliVersion: hello.cliVersion ?? null,
        cores: hello.cores,
        version: hello.version ?? null,
        engineFeatures: hello.engineFeatures ?? [],
        lastSeenAt: new Date(),
      },
    })
  }

  /**
   * One attempt: a claimable chunk of a job for this engine, locked and leased atomically. The job with the fewest
   * chunks left goes first (a quick comparison does not wait hours behind a 780-pairing matrix); then the oldest job,
   * then chunk order. The chunks left are counted once per job (B2): counted for every candidate row, a claim took
   * 2,4 s locally and ~4 s in production with a matrix of 3.900 chunks in the queue, four times what a 60-game chunk
   * of the Laboratorio plays. While a search waits for its next round, matrix chunks are held back (B3); quick
   * comparisons are not, and after two minutes without a new round the matrix goes on.
   */
  private async tryClaim(hello: WorkerHello): Promise<ClaimedChunk[]> {
    // H-002: versions compared as numbers here, not as text in SQL («0.2.10» < «0.2.2» as text).
    const consistency = versionAtLeast(hello.version, CONSISTENCY_WORKER_VERSION)
    const metaConsistency = versionAtLeast(hello.version, META_CONSISTENCY_WORKER_VERSION)
    // perGame needs both: a worker that forwards it and an engine that plays it (capabilities.ts).
    const perGame = canPlayPerGame(hello)
    // H-018: a job played with the f bots needs an engine that says it has them («fairBots», capabilities.ts).
    const fairBot = canPlayFairBots(hello)
    const fairBotCodes = [...FAIR_BOT_CODES]
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE simulation_chunks SET status = 'leased', lease_until = now() + interval '3 minutes',
        worker_id = ${hello.workerId}, games_done = 0, started_at = COALESCE(started_at, now())
      WHERE id = (
        WITH pending AS MATERIALIZED (
          SELECT job_id, count(*) AS left_count FROM simulation_chunks
          WHERE status IN ('queued', 'leased') GROUP BY job_id),
        -- B3: a search between two rounds (nothing pending, a chunk finished in the last two minutes) is having its
        -- next round prepared; a matrix chunk taken now would make it wait up to minutes.
        between_rounds AS MATERIALIZED (
          SELECT EXISTS (
            SELECT 1 FROM simulation_jobs e
            WHERE e.kind = 'explore' AND e.status = 'running' AND e.engine_rev = ${hello.engineRev}
              AND NOT EXISTS (SELECT 1 FROM pending q WHERE q.job_id = e.id)
              AND EXISTS (SELECT 1 FROM simulation_chunks d
                          WHERE d.job_id = e.id AND d.finished_at > now() - interval '2 minutes')) AS waiting)
        SELECT c.id FROM simulation_chunks c
          JOIN simulation_jobs j ON j.id = c.job_id
          JOIN pending p ON p.job_id = j.id
          CROSS JOIN between_rounds b
        WHERE j.status IN ('queued', 'running') AND j.engine_rev = ${hello.engineRev}
          AND (j.kind <> 'matrix' OR NOT b.waiting)
          AND (j.kind <> 'consistency' OR ${consistency}::boolean)
          AND (j.kind <> 'consistency' OR COALESCE(j.params->'consistency'->>'mode', 'goldfish') <> 'meta'
               OR ${metaConsistency}::boolean)
          AND (COALESCE(j.params->>'perGame', 'false') <> 'true' OR ${perGame}::boolean)
          AND (NOT (j.players && ${fairBotCodes}::text[]) OR ${fairBot}::boolean)
          AND (c.status = 'queued' OR (c.status = 'leased' AND c.lease_until < now()))
        ORDER BY p.left_count, j.created_at, j.id, c.idx
        FOR UPDATE OF c SKIP LOCKED
        LIMIT 1)
      RETURNING id`
    const id = rows[0]?.id
    if (id === undefined) return []
    const first = await this.prisma.simulationChunk.findUniqueOrThrow({ where: { id }, include: { job: true } })
    const job = first.job
    if (job.status === 'queued') {
      await this.prisma.simulationJob.update({
        where: { id: job.id },
        data: { status: 'running', startedAt: new Date() },
      })
    }
    const more = hello.batch && isPairing(job.kind) ? await this.claimMore(hello, first) : []
    const chunks = more.length === 0 ? [first] : await this.chunksInOrder([first.id, ...more])
    const texts = await this.prisma.deckSnapshot.findMany({
      where: {
        id: {
          in: chunks.flatMap((chunk) => [chunk.snapshotAId, chunk.snapshotBId]).filter((x): x is number => x !== null),
        },
      },
      select: { id: true, deckgymText: true },
    })
    const text = (snapshotId: number | null) => texts.find((row) => row.id === snapshotId)?.deckgymText ?? null
    const consistencyParams =
      job.kind === 'consistency' ? (job.params as { consistency?: Partial<ConsistencyParams> }).consistency : undefined
    const rivalTexts = consistencyParams?.rivals?.length
      ? await this.prisma.deckSnapshot.findMany({
          where: { id: { in: consistencyParams.rivals.map((rival) => rival.snapshot) } },
          select: { id: true, deckgymText: true },
        })
      : []
    return chunks.map((chunk) => ({
      chunkId: chunk.id,
      jobId: chunk.jobId,
      kind: job.kind,
      idx: chunk.idx,
      games: chunk.games,
      firstGame: chunk.firstGame,
      seed: chunk.seed.toString(),
      players: job.players,
      threads: job.cores,
      replaySample: chunk.firstGame === 0 ? job.replaySample : 0,
      leaseUntil: (chunk.leaseUntil ?? new Date(Date.now() + LEASE_MS)).toISOString(),
      deckA: text(chunk.snapshotAId),
      deckB: text(chunk.snapshotBId),
      perGame: perGamePairing(job.kind, job.params),
      optimize: job.kind === 'optimize' ? ((job.params as { engineJob?: Prisma.JsonValue }).engineJob ?? null) : null,
      consistency:
        job.kind === 'consistency'
          ? {
              keyCards: consistencyParams?.engineIds ?? [],
              maxTurn: consistencyParams?.maxTurn ?? 8,
              bot: consistencyParams?.bot ?? job.players[0] ?? 'e2',
              rivals: consistencyParams?.rivals?.length
                ? consistencyParams.rivals.map((rival) => ({
                    deck: rivalTexts.find((row) => row.id === rival.snapshot)?.deckgymText ?? '',
                    games: rival.games,
                  }))
                : null,
            }
          : null,
    }))
  }

  /**
   * B2: more claimable chunks of the same job for a worker that plays them in one engine process (`batch` in its
   * hello), in chunk order, up to its limits of chunks and games. Each keeps its own seed, lease and result.
   */
  private async claimMore(hello: WorkerHello, first: { id: number; jobId: number; games: number }): Promise<number[]> {
    const batch = hello.batch
    if (!batch || batch.maxChunks <= 1 || first.games >= batch.maxGames) return []
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      WITH candidates AS (
        SELECT id, games, idx FROM simulation_chunks
        WHERE job_id = ${first.jobId} AND id <> ${first.id}
          AND (status = 'queued' OR (status = 'leased' AND lease_until < now()))
        ORDER BY idx
        FOR UPDATE SKIP LOCKED
        LIMIT ${batch.maxChunks - 1}),
      picked AS (
        SELECT id FROM (SELECT id, sum(games) OVER (ORDER BY idx) AS games_so_far FROM candidates) t
        WHERE games_so_far <= ${batch.maxGames - first.games})
      UPDATE simulation_chunks SET status = 'leased', lease_until = now() + interval '3 minutes',
        worker_id = ${hello.workerId}, games_done = 0, started_at = COALESCE(started_at, now())
      WHERE id IN (SELECT id FROM picked)
      RETURNING id`
    return rows.map((row) => row.id)
  }

  private async chunksInOrder(ids: number[]) {
    const rows = await this.prisma.simulationChunk.findMany({ where: { id: { in: ids } }, orderBy: { idx: 'asc' } })
    // The first one claimed stays first: it is the one an old reader of `chunk` would play.
    return [...rows.filter((row) => row.id === ids[0]), ...rows.filter((row) => row.id !== ids[0])]
  }

  /**
   * Claims a chunk, waiting up to 25 s for one. Null = nothing to do; `requiredEngineRev` tells a worker with another
   * engine which one the queued jobs need.
   */
  async claim(
    hello: WorkerHello,
    signal?: AbortSignal,
  ): Promise<{
    chunk: ClaimedChunk | null
    chunks?: ClaimedChunk[]
    requiredEngineRev: string | null
    hint?: string
  }> {
    // `chunk` is the first one (what a worker without `batch` plays); `chunks`, all of them, only for `batch`.
    const answer = (chunks: ClaimedChunk[], requiredEngineRev: string | null = null) => ({
      chunk: chunks[0] ?? null,
      ...(hello.batch ? { chunks } : {}),
      requiredEngineRev,
    })
    if (signal?.aborted) return answer([])
    await this.seen(hello)
    const take = async () => {
      if (signal?.aborted) return []
      const chunks = await this.tryClaim(hello)
      if (signal?.aborted) {
        if (chunks.length > 0) {
          await this.prisma.simulationChunk.updateMany({
            where: { id: { in: chunks.map((chunk) => chunk.chunkId) }, workerId: hello.workerId, status: 'leased' },
            data: { status: 'queued', leaseUntil: null, workerId: null },
          })
          this.notifyQueued()
        }
        return []
      }
      return chunks
    }
    const immediate = await take()
    if (immediate.length > 0) return answer(immediate)
    if (signal?.aborted) return answer([])
    const other = await this.prisma.simulationJob.findFirst({
      where: { status: { in: ['queued', 'running'] }, engineRev: { not: hello.engineRev } },
      select: { engineRev: true },
    })
    if (other) return answer([], other.engineRev)
    // H-003: on the timeout the listener has to go too, or one is left behind every ~30 s.
    const queued = this.queued
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, this.longPollMs)
      function done() {
        clearTimeout(timer)
        queued.off('queued', done)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      queued.once('queued', done)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted) done()
      timer.unref?.()
    })
    if (signal?.aborted) return answer([])
    const chunks = await take()
    if (chunks.length > 0) return answer(chunks)
    if (signal?.aborted) return answer([])
    const hint = await this.hintFor(hello)
    return { ...answer([]), ...(hint ? { hint } : {}) }
  }

  /** Why a worker that got nothing cannot take what is waiting for its engine, if that is the case. */
  private async hintFor(hello: WorkerHello): Promise<string | null> {
    if (canPlayPerGame(hello)) return null
    const waiting = await this.prisma.simulationChunk.count({
      where: {
        job: {
          status: { in: ['queued', 'running'] },
          engineRev: hello.engineRev,
          kind: { in: ['matrix', 'compare', 'explore'] },
          params: { path: ['perGame'], equals: true },
        },
        OR: [{ status: 'queued' }, { status: 'leased', leaseUntil: { lt: new Date() } }],
      },
    })
    return waiting > 0 ? PER_GAME_HINT : null
  }

  private async requireChunk(id: number) {
    const chunk = await this.prisma.simulationChunk.findUnique({ where: { id }, include: { job: true } })
    if (!chunk) throw new NotFoundException(`Chunk ${id} no encontrado.`)
    return chunk
  }

  /**
   * Renews the lease while the worker plays; tells it to stop when the job was cancelled, and that the chunk is no
   * longer its own (`lost`, H-014) when it went back to the queue, failed or another worker holds it — a late
   * heartbeat used to lease such a chunk again. A worker whose own lease expired can still renew it.
   */
  async heartbeat(
    id: number,
    input: { workerId: string; gamesDone: number; total?: number | undefined },
  ): Promise<{ leaseUntil: string | null; cancelled: boolean; lost: boolean }> {
    const chunk = await this.requireChunk(id)
    if (chunk.job.status === 'cancelled' || chunk.status === 'cancelled') {
      return { leaseUntil: null, cancelled: true, lost: false }
    }
    if (chunk.status === 'done') return { leaseUntil: null, cancelled: false, lost: false }
    const leaseUntil = new Date(Date.now() + LEASE_MS)
    const renewed = await this.prisma.simulationChunk.updateMany({
      where: { id, status: 'leased', workerId: input.workerId },
      data: {
        leaseUntil,
        gamesDone: Math.min(input.gamesDone, input.total ?? chunk.games),
        ...(chunk.job.kind === 'optimize' && input.total ? { games: input.total } : {}),
      },
    })
    await this.prisma.workerNode.updateMany({ where: { id: input.workerId }, data: { lastSeenAt: new Date() } })
    if (renewed.count === 0) return { leaseUntil: null, cancelled: false, lost: true }
    return { leaseUntil: leaseUntil.toISOString(), cancelled: false, lost: false }
  }

  /**
   * A result that does not add up counts as an engine failure of the chunk (422): the same seed gives the same
   * result, so turning it down without failing the chunk would hand it out, play it and turn it down forever.
   */
  async result(id: number, input: ChunkResultInput): Promise<{ accepted: boolean }> {
    const chunk = await this.requireChunk(id)
    if (chunk.status === 'done' || chunk.status === 'cancelled') return { accepted: false }
    const problem =
      input.winsA + input.winsB + input.ties !== input.games
        ? 'winsA + winsB + ties tiene que sumar games.'
        : chunk.job.kind !== 'optimize' && input.games !== chunk.games
          ? `El chunk tiene ${chunk.games} partidas, no ${input.games}.`
          : perGamePairing(chunk.job.kind, chunk.job.params)
            ? checkPerGame((input.extra as { perGame?: unknown } | undefined)?.perGame, input)
            : null
    if (problem) {
      await this.failure(id, { workerId: input.workerId, error: `Resultado inválido: ${problem}` })
      throw new UnprocessableEntityException({ code: 'invalid_result', message: problem })
    }
    await this.prisma.simulationChunk.update({
      where: { id },
      data: {
        status: 'done',
        winsA: input.winsA,
        winsB: input.winsB,
        ties: input.ties,
        games: input.games,
        gamesDone: input.games,
        turns: input.turns === undefined ? null : BigInt(input.turns),
        durationMs: Math.round(input.durationMs),
        engineRev: input.engineRev,
        ...(input.extra === undefined ? {} : { extra: input.extra }),
        error: null,
        leaseUntil: null,
        finishedAt: new Date(),
      },
    })
    await this.settle(chunk.jobId)
    return { accepted: true }
  }

  /** An engine error: the chunk is retried up to 3 times, then it fails (the job keeps its other results). */
  async failure(id: number, input: { workerId: string; error: string }): Promise<{ status: string }> {
    const chunk = await this.requireChunk(id)
    if (chunk.status === 'done' || chunk.status === 'cancelled') return { status: chunk.status }
    // H-014: only the worker that holds the chunk can fail it (a late report must not requeue another's work).
    if (chunk.status !== 'leased' || (chunk.workerId !== null && chunk.workerId !== input.workerId)) {
      return { status: chunk.status }
    }
    const attempt = chunk.attempt + 1
    const status = attempt >= MAX_FAILURES ? 'failed' : 'queued'
    await this.prisma.simulationChunk.update({
      where: { id },
      data: { status, attempt, error: input.error.slice(0, 2000), leaseUntil: null, workerId: null },
    })
    this.logger.warn({ chunk: id, attempt, error: input.error.slice(0, 300) }, 'simulation chunk failed')
    if (status === 'failed') await this.settle(chunk.jobId)
    else this.notifyQueued()
    return { status }
  }

  /** A job ends when every chunk is done, failed or cancelled (an explore job, when the Laboratorio says so). */
  async settle(jobId: number): Promise<void> {
    const pending = await this.prisma.simulationChunk.count({
      where: { jobId, status: { in: ['queued', 'leased'] } },
    })
    if (pending > 0) return
    if (this.roundHandler) {
      const job = await this.prisma.simulationJob.findUnique({ where: { id: jobId }, select: { kind: true } })
      if (job?.kind === 'explore') {
        await this.roundHandler(jobId)
        return
      }
    }
    const failed = await this.prisma.simulationChunk.count({ where: { jobId, status: 'failed' } })
    const status = failed > 0 ? 'failed' : 'done'
    const error = failed > 0 ? `${failed} cruces fallaron en el motor; el resto quedó.` : null
    // H-011.5: an optimize that ends well is marked for its confirmation in the same update, so a crash right after
    // never loses it (SimulationsService.confirmOptimize claims the mark; the jobs from before #32 kept no `remove`).
    const ended = await this.prisma.$executeRaw`
      UPDATE "simulation_jobs"
      SET "status" = CAST(${status} AS "SimulationJobStatus"), "finished_at" = ${new Date()}, "error" = ${error},
        "params" = CASE
          WHEN ${failed === 0} AND "kind" = 'optimize' AND "params"->'remove' IS NOT NULL
            AND "params"->'confirmation' IS NULL
          THEN jsonb_set("params", '{confirmation}', '{"pending": true}'::jsonb)
          ELSE "params" END
      WHERE "id" = ${jobId} AND "status" IN ('queued', 'running')`
    if (ended > 0 && failed === 0 && this.doneHandler) {
      await this.doneHandler(jobId).catch((error: unknown) => {
        this.logger.warn({ job: jobId, error: String(error).slice(0, 300) }, 'after a finished job')
      })
    }
  }

  async saveReplay(
    chunkId: number,
    gameId: string,
    input: { gameIndex: number; seed: string; winner: 'a' | 'b' | 'tie'; body: Buffer },
  ): Promise<{ id: number }> {
    await this.requireChunk(chunkId)
    if (input.body.length > MAX_REPLAY_BYTES) {
      throw new BadRequestException({ code: 'too_large', message: 'La repetición supera 8 MB comprimida.' })
    }
    try {
      gunzipJson(input.body)
    } catch {
      throw new BadRequestException({
        code: 'invalid_replay',
        message: 'La repetición no es un JSON comprimido con gzip.',
      })
    }
    const data = new Uint8Array(input.body)
    const row = await this.prisma.simulationReplay.upsert({
      where: { chunkId_gameId: { chunkId, gameId } },
      create: {
        chunkId,
        gameId,
        gameIndex: input.gameIndex,
        seed: input.seed,
        winner: input.winner,
        dataGz: data,
        sizeBytes: input.body.length,
      },
      update: { dataGz: data, sizeBytes: input.body.length, seed: input.seed, winner: input.winner },
    })
    return { id: row.id }
  }

  async uploadEngineStatus(
    engineRev: string,
    cards: { id: string; name: string; status: string; complete: boolean }[],
  ): Promise<{ cards: number; incomplete: number }> {
    await this.engine.upload(engineRev, cards)
    return { cards: cards.length, incomplete: cards.filter((card) => !card.complete).length }
  }
}
