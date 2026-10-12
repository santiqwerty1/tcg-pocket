/**
 * The app's worker API (docs/API.md «Simulación»), outbound HTTPS only. Network errors and 5xx are retried with
 * backoff (the PC may wake up offline); 4xx are returned to the caller.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { setTimeout as sleep } from 'node:timers/promises'

/** The worker package the server offers for a platform (D-026); servers before it send only the engine. */
export interface PackageInfo {
  platform?: string
  workerVersion?: string
  engineRev: string
  cliVersion: string
  sha256?: string
  size?: number
}

export interface Hello {
  workerId: string
  name: string
  engineRev: string
  cliVersion: string
  cores: number
  version: string
  allowSlowBots?: boolean
  /** What the engine can do (`features` of `engine-cli version`); missing in engines from before 0.2.1. */
  engineFeatures?: string[]
  /** B2: several pairings of one job in one engine process, up to these limits (only with an engine that has `batch`). */
  batch?: { maxChunks: number; maxGames: number }
  /** Phase 42: how its engine plays (`gamesRev` of `engine-cli version`). */
  gamesRev?: number
}

export interface Chunk {
  chunkId: number
  jobId: number
  /** explore (Laboratorio) chunks are plain pairings, like matrix and compare. */
  kind: 'matrix' | 'compare' | 'optimize' | 'explore' | 'consistency'
  idx: number
  games: number
  firstGame: number
  seed: string
  players: string[]
  threads: number | null
  replaySample: number
  leaseUntil: string
  deckA: string | null
  deckB: string | null
  /** Pairings: report every game by index (H-010); missing from servers before 0.2.5 of the worker. */
  perGame?: boolean
  optimize: Record<string, unknown> | null
  /** consistency chunks (Fase 8): key cards as engine ids, own turns reported, the deck's bot and, against the meta
   * (D-019), the rival decks with their games. */
  consistency?: {
    keyCards: string[]
    maxTurn: number
    bot: string
    rivals?: { deck: string; games: number }[] | null
  } | null
}

/** A game against a bot to run (Fase 8): the decks, the bot, the seed and the owner's choices so far. */
export interface LiveGame {
  id: number
  deckHuman: string
  deckBot: string
  bot: string
  seed: string
  choices: number[]
  /** Modo entrenador (Fase 20): the engine scores every option of each decision. */
  coach?: boolean
}

export interface ChunkResult {
  workerId: string
  engineRev: string
  /** Phase 42: the engine that played it, «0.3.4+<build>» (the API's cache reuses a result only with the same). */
  cliVersion?: string
  /** Phase 42: how that engine plays; the API fixes it for the whole job with its first result. */
  gamesRev?: number
  winsA: number
  winsB: number
  ties: number
  games: number
  turns?: number
  durationMs: number
  extra?: Record<string, unknown>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type Log = (message: string, data?: Record<string, unknown>) => void

export class WorkerClient {
  /** Android checks the image's exact engine before every chunk/game claim, also after a server update. */
  requiredEngine: { engineRev: string; cliVersion: string } | null = null
  constructor(
    private readonly server: string,
    private readonly token: string,
    private readonly log: Log,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** JSON request with retries on network errors and 5xx (1 s, 2 s, 4 s … up to 5 min, forever unless aborted). */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: {
      signal?: AbortSignal
      raw?: Uint8Array
      query?: Record<string, string>
      timeoutMs?: number
      /** One attempt, no retries (heartbeats: the next one comes anyway, H-014). */
      once?: boolean
      /** Expected disconnects of live long-polls should not fill the worker log. */
      quiet?: boolean
      maxDelayMs?: number
    } = {},
  ): Promise<T> {
    const checkEngine = async () => {
      if (this.requiredEngine && method === 'POST' && ['/api/worker/claim', '/api/worker/live/claim'].includes(path)) {
        const required = await this.request<{ engineRev: string; cliVersion: string }>(
          'GET',
          '/api/worker/packages/android-arm64/version',
          undefined,
          { once: true, timeoutMs: 15_000, ...(options.signal ? { signal: options.signal } : {}) },
        )
        if (
          required.engineRev !== this.requiredEngine.engineRev ||
          required.cliVersion !== this.requiredEngine.cliVersion
        ) {
          throw new ApiError(
            'Cambió el motor del servidor. Volvé a correr el instalador Android antes de tomar trabajo.',
            409,
          )
        }
      }
    }
    let delay = 1000
    const url = new URL(`${this.server}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    for (;;) {
      try {
        await checkEngine()
        const signals = [AbortSignal.timeout(options.timeoutMs ?? 60_000), ...(options.signal ? [options.signal] : [])]
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            ...(options.raw
              ? { 'Content-Type': 'application/gzip' }
              : body !== undefined
                ? { 'Content-Type': 'application/json' }
                : {}),
          },
          ...(options.raw
            ? { body: Buffer.from(options.raw) }
            : body !== undefined
              ? { body: JSON.stringify(body) }
              : {}),
          signal: AbortSignal.any(signals),
        })
        if (response.status >= 500) throw new ApiError(`${method} ${path}: ${response.status}`, response.status)
        const text = await response.text()
        const parsed = text ? (JSON.parse(text) as unknown) : null
        if (response.status >= 400) {
          const message =
            (parsed as { error?: { message?: string }; message?: string } | null)?.error?.message ??
            (parsed as { message?: string } | null)?.message ??
            text
          throw new ApiError(`${method} ${path}: ${response.status} ${message}`, response.status)
        }
        return parsed as T
      } catch (error) {
        if (options.signal?.aborted) throw error
        if (error instanceof ApiError && error.status < 500) throw error
        if (options.once) throw error
        if (!options.quiet)
          this.log('servidor no disponible, reintento', { path, delayMs: delay, error: String(error) })
        await sleep(delay, undefined, options.signal ? { signal: options.signal } : undefined)
        delay = Math.min(delay * 2, options.maxDelayMs ?? 300_000)
      }
    }
  }

  claim(hello: Hello, signal?: AbortSignal) {
    return this.request<{
      chunk: Chunk | null
      /** With `batch` in the hello: every chunk claimed, `chunk` first (servers before B2 leave it out). */
      chunks?: Chunk[]
      requiredEngineRev: string | null
      retryAfterSeconds: number
      /** Why there is waiting work this worker cannot play (an old engine, for instance). */
      hint?: string
    }>('POST', '/api/worker/claim', hello, { ...(signal ? { signal } : {}), timeoutMs: 60_000 })
  }

  release(workerId: string) {
    return this.request('POST', '/api/worker/release', { workerId }, { once: true, timeoutMs: 10_000 })
  }

  /** What the server offers for `platform`: version, engine and the package's sha256 (D-026). One attempt. */
  packageInfo(platform: string, signal?: AbortSignal) {
    return this.request<PackageInfo>('GET', `/api/worker/packages/${platform}/version`, undefined, {
      once: true,
      timeoutMs: 15_000,
      ...(signal ? { signal } : {}),
    })
  }

  /**
   * Streams the package of `platform` to `file`, hashing it on the way (never the whole package in memory). Returns
   * what arrived; the caller compares it with what `packageInfo` announced. One attempt: the next check retries.
   */
  async download(
    platform: string,
    file: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<{ sha256: string; size: number; announced: string | null }> {
    const response = await this.fetchImpl(new URL(`${this.server}/api/worker/packages/${platform}`), {
      headers: { Authorization: `Bearer ${this.token}` },
      // Code comes from the configured server only, never from wherever a redirect points (D-026).
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(signal ? [signal] : [])]),
    })
    if (!response.ok || !response.body) {
      throw new ApiError(`GET /api/worker/packages/${platform}: ${response.status}`, response.status)
    }
    const hash = createHash('sha256')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length
        if (size > maxBytes) return done(new Error(`el paquete pasa de ${maxBytes} bytes`))
        hash.update(chunk)
        done(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), meter, createWriteStream(file))
    return { sha256: hash.digest('hex'), size, announced: response.headers.get('x-checksum-sha256') }
  }

  heartbeat(chunkId: number, body: { workerId: string; gamesDone: number; total?: number }, signal?: AbortSignal) {
    return this.request<{ leaseUntil: string | null; cancelled: boolean; lost?: boolean }>(
      'PUT',
      `/api/worker/chunks/${chunkId}/heartbeat`,
      body,
      { once: true, timeoutMs: 20_000, ...(signal ? { signal } : {}) },
    )
  }

  result(chunkId: number, body: ChunkResult, signal?: AbortSignal) {
    return this.request<{ accepted: boolean }>('PUT', `/api/worker/chunks/${chunkId}/result`, body, {
      ...(signal ? { signal } : {}),
    })
  }

  failure(chunkId: number, body: { workerId: string; error: string }, signal?: AbortSignal) {
    return this.request<{ status: string }>('PUT', `/api/worker/chunks/${chunkId}/failure`, body, {
      ...(signal ? { signal } : {}),
    })
  }

  replay(
    chunkId: number,
    gameId: string,
    data: Uint8Array,
    meta: { index: number; seed: string; winner: string },
    signal?: AbortSignal,
  ) {
    return this.request<{ id: number }>('PUT', `/api/worker/chunks/${chunkId}/replays/${gameId}`, undefined, {
      raw: data,
      query: { index: String(meta.index), seed: meta.seed, winner: meta.winner },
      ...(signal ? { signal } : {}),
    })
  }

  liveClaim(
    body: {
      workerId: string
      engineRev: string
      version: string
      engineFeatures?: string[]
      cliVersion?: string
      gamesRev?: number
    },
    signal?: AbortSignal,
  ) {
    return this.request<{ game: LiveGame | null }>('POST', '/api/worker/live/claim', body, {
      ...(signal ? { signal } : {}),
      timeoutMs: 60_000,
      quiet: true,
      maxDelayMs: 30_000,
    })
  }

  liveDecision(
    id: number,
    body: {
      workerId: string
      ply: number
      turn: number
      state: Record<string, unknown>
      actions: { i: number; text: string; action: unknown }[]
      log: Record<string, unknown>[]
      coach?: { scores: number[]; best: number }
    },
    signal?: AbortSignal,
  ) {
    return this.request<{ choice: number | null; status: string }>('PUT', `/api/worker/live/${id}/decision`, body, {
      ...(signal ? { signal } : {}),
    })
  }

  liveChoice(id: number, body: { workerId: string; ply: number }, signal?: AbortSignal) {
    return this.request<{ choice: number | null; status: string }>('POST', `/api/worker/live/${id}/choice`, body, {
      ...(signal ? { signal } : {}),
      timeoutMs: 60_000,
      quiet: true,
      maxDelayMs: 30_000,
    })
  }

  liveEnd(
    id: number,
    body: {
      workerId: string
      winner: 'you' | 'bot' | 'tie'
      turns: number
      state: Record<string, unknown>
      log: Record<string, unknown>[]
    },
    signal?: AbortSignal,
  ) {
    return this.request<{ ok: true }>('PUT', `/api/worker/live/${id}/end`, body, { ...(signal ? { signal } : {}) })
  }

  liveFailure(id: number, body: { workerId: string; error: string }, signal?: AbortSignal) {
    return this.request<{ ok: true }>('PUT', `/api/worker/live/${id}/failure`, body, {
      ...(signal ? { signal } : {}),
    })
  }

  liveReplay(id: number, workerId: string, data: Uint8Array, signal?: AbortSignal) {
    return this.request<{ ok: true }>('PUT', `/api/worker/live/${id}/replay`, undefined, {
      raw: data,
      query: { workerId },
      ...(signal ? { signal } : {}),
    })
  }

  engineStatus(
    engineRev: string,
    cards: { id: string; name: string; status: string; complete: boolean }[],
    signal?: AbortSignal,
  ) {
    return this.request<{ cards: number; incomplete: number }>(
      'PUT',
      '/api/worker/engine-status',
      { engineRev, cards },
      { ...(signal ? { signal } : {}) },
    )
  }
}
