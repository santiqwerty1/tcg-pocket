/**
 * The worker protocol (PLAN §3.7): the worker on the owner's PC claims a chunk (long-poll), sends a heartbeat every
 * 30 s and posts the result. A lease lasts 3 minutes: when the PC sleeps or turns off, the chunk goes back to the queue
 * without counting as a failure; only an engine error counts (3 at most). Results are idempotent: a chunk's result
 * depends only on its seed, so a duplicate after `done` is ignored.
 */
import { EventEmitter } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EngineStatusService } from './snapshots.service.js'

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
}

export interface ClaimedChunk {
  chunkId: number
  jobId: number
  /** explore chunks are plain pairings (deckA against deckB) like matrix and compare. */
  kind: 'matrix' | 'compare' | 'optimize' | 'explore'
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
  /** optimize: the engine-cli optimize job without seed/threads. */
  optimize: Prisma.JsonValue | null
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
  /** Wakes long-polling claims when something is queued. */
  private readonly queued = new EventEmitter()
  /** How long a claim waits for work (tests shorten it). */
  longPollMs = LONG_POLL_MS
  /** Who decides what an explore job plays next when a round ends (the Laboratorio, T-008). */
  private roundHandler: ((jobId: number) => Promise<void>) | null = null

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
      },
      update: {
        name: hello.name,
        engineRev: hello.engineRev,
        cliVersion: hello.cliVersion ?? null,
        cores: hello.cores,
        version: hello.version ?? null,
        lastSeenAt: new Date(),
      },
    })
  }

  /**
   * One attempt: a claimable chunk of a job for this engine, locked and leased atomically. The job with the fewest
   * chunks left goes first (a quick comparison does not wait hours behind a 780-pairing matrix); then the oldest job,
   * then chunk order.
   */
  private async tryClaim(hello: WorkerHello): Promise<ClaimedChunk | null> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      UPDATE simulation_chunks SET status = 'leased', lease_until = now() + interval '3 minutes',
        worker_id = ${hello.workerId}, games_done = 0, started_at = COALESCE(started_at, now())
      WHERE id = (
        SELECT c.id FROM simulation_chunks c JOIN simulation_jobs j ON j.id = c.job_id
        WHERE j.status IN ('queued', 'running') AND j.engine_rev = ${hello.engineRev}
          AND (c.status = 'queued' OR (c.status = 'leased' AND c.lease_until < now()))
        ORDER BY (SELECT count(*) FROM simulation_chunks r
                  WHERE r.job_id = j.id AND r.status IN ('queued', 'leased')), j.created_at, j.id, c.idx
        FOR UPDATE OF c SKIP LOCKED
        LIMIT 1)
      RETURNING id`
    const id = rows[0]?.id
    if (id === undefined) return null
    const chunk = await this.prisma.simulationChunk.findUniqueOrThrow({ where: { id }, include: { job: true } })
    if (chunk.job.status === 'queued') {
      await this.prisma.simulationJob.update({
        where: { id: chunk.jobId },
        data: { status: 'running', startedAt: new Date() },
      })
    }
    const texts = await this.prisma.deckSnapshot.findMany({
      where: { id: { in: [chunk.snapshotAId, chunk.snapshotBId].filter((x): x is number => x !== null) } },
      select: { id: true, deckgymText: true },
    })
    const text = (snapshotId: number | null) => texts.find((row) => row.id === snapshotId)?.deckgymText ?? null
    return {
      chunkId: chunk.id,
      jobId: chunk.jobId,
      kind: chunk.job.kind,
      idx: chunk.idx,
      games: chunk.games,
      firstGame: chunk.firstGame,
      seed: chunk.seed.toString(),
      players: chunk.job.players,
      threads: chunk.job.cores,
      replaySample: chunk.firstGame === 0 ? chunk.job.replaySample : 0,
      leaseUntil: (chunk.leaseUntil ?? new Date(Date.now() + LEASE_MS)).toISOString(),
      deckA: text(chunk.snapshotAId),
      deckB: text(chunk.snapshotBId),
      optimize:
        chunk.job.kind === 'optimize'
          ? ((chunk.job.params as { engineJob?: Prisma.JsonValue }).engineJob ?? null)
          : null,
    }
  }

  /**
   * Claims a chunk, waiting up to 25 s for one. Null = nothing to do; `requiredEngineRev` tells a worker with another
   * engine which one the queued jobs need.
   */
  async claim(hello: WorkerHello): Promise<{ chunk: ClaimedChunk | null; requiredEngineRev: string | null }> {
    await this.seen(hello)
    const immediate = await this.tryClaim(hello)
    if (immediate) return { chunk: immediate, requiredEngineRev: null }
    const other = await this.prisma.simulationJob.findFirst({
      where: { status: { in: ['queued', 'running'] }, engineRev: { not: hello.engineRev } },
      select: { engineRev: true },
    })
    if (other) return { chunk: null, requiredEngineRev: other.engineRev }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, this.longPollMs)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      this.queued.once('queued', done)
      timer.unref?.()
    })
    return { chunk: await this.tryClaim(hello), requiredEngineRev: null }
  }

  private async requireChunk(id: number) {
    const chunk = await this.prisma.simulationChunk.findUnique({ where: { id }, include: { job: true } })
    if (!chunk) throw new NotFoundException(`Chunk ${id} no encontrado.`)
    return chunk
  }

  /** Renews the lease while the worker plays; tells it to stop when the job was cancelled. */
  async heartbeat(
    id: number,
    input: { workerId: string; gamesDone: number; total?: number | undefined },
  ): Promise<{ leaseUntil: string | null; cancelled: boolean }> {
    const chunk = await this.requireChunk(id)
    if (chunk.job.status === 'cancelled' || chunk.status === 'cancelled') return { leaseUntil: null, cancelled: true }
    if (chunk.status === 'done') return { leaseUntil: null, cancelled: false }
    const leaseUntil = new Date(Date.now() + LEASE_MS)
    await this.prisma.simulationChunk.update({
      where: { id },
      data: {
        status: 'leased',
        leaseUntil,
        workerId: input.workerId,
        gamesDone: Math.min(input.gamesDone, input.total ?? chunk.games),
        ...(chunk.job.kind === 'optimize' && input.total ? { games: input.total } : {}),
      },
    })
    await this.prisma.workerNode.updateMany({ where: { id: input.workerId }, data: { lastSeenAt: new Date() } })
    return { leaseUntil: leaseUntil.toISOString(), cancelled: false }
  }

  async result(id: number, input: ChunkResultInput): Promise<{ accepted: boolean }> {
    const chunk = await this.requireChunk(id)
    if (chunk.status === 'done' || chunk.status === 'cancelled') return { accepted: false }
    if (input.winsA + input.winsB + input.ties !== input.games) {
      throw new BadRequestException({ code: 'validation', message: 'winsA + winsB + ties tiene que sumar games.' })
    }
    if (chunk.job.kind !== 'optimize' && input.games !== chunk.games) {
      throw new BadRequestException({
        code: 'validation',
        message: `El chunk tiene ${chunk.games} partidas, no ${input.games}.`,
      })
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
    await this.prisma.simulationJob.updateMany({
      where: { id: jobId, status: { in: ['queued', 'running'] } },
      data: {
        status: failed > 0 ? 'failed' : 'done',
        finishedAt: new Date(),
        error: failed > 0 ? `${failed} cruces fallaron en el motor; el resto quedó.` : null,
      },
    })
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
      JSON.parse(gunzipSync(input.body).toString('utf8'))
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
