/**
 * The app's worker API (docs/API.md «Simulación»), outbound HTTPS only. Network errors and 5xx are retried with
 * backoff (the PC may wake up offline); 4xx are returned to the caller.
 */
import { setTimeout as sleep } from 'node:timers/promises'

export interface Hello {
  workerId: string
  name: string
  engineRev: string
  cliVersion: string
  cores: number
  version: string
}

export interface Chunk {
  chunkId: number
  jobId: number
  /** explore (Laboratorio) chunks are plain pairings, like matrix and compare. */
  kind: 'matrix' | 'compare' | 'optimize' | 'explore'
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
  optimize: Record<string, unknown> | null
}

export interface ChunkResult {
  workerId: string
  engineRev: string
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
    options: { signal?: AbortSignal; raw?: Uint8Array; query?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<T> {
    let delay = 1000
    const url = new URL(`${this.server}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value)
    for (;;) {
      try {
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
        this.log('servidor no disponible, reintento', { path, delayMs: delay, error: String(error) })
        await sleep(delay, undefined, options.signal ? { signal: options.signal } : undefined)
        delay = Math.min(delay * 2, 300_000)
      }
    }
  }

  claim(hello: Hello, signal?: AbortSignal) {
    return this.request<{ chunk: Chunk | null; requiredEngineRev: string | null; retryAfterSeconds: number }>(
      'POST',
      '/api/worker/claim',
      hello,
      { ...(signal ? { signal } : {}), timeoutMs: 60_000 },
    )
  }

  heartbeat(chunkId: number, body: { workerId: string; gamesDone: number; total?: number }) {
    return this.request<{ leaseUntil: string | null; cancelled: boolean }>(
      'PUT',
      `/api/worker/chunks/${chunkId}/heartbeat`,
      body,
    )
  }

  result(chunkId: number, body: ChunkResult) {
    return this.request<{ accepted: boolean }>('PUT', `/api/worker/chunks/${chunkId}/result`, body)
  }

  failure(chunkId: number, body: { workerId: string; error: string }) {
    return this.request<{ status: string }>('PUT', `/api/worker/chunks/${chunkId}/failure`, body)
  }

  replay(chunkId: number, gameId: string, data: Uint8Array, meta: { index: number; seed: string; winner: string }) {
    return this.request<{ id: number }>('PUT', `/api/worker/chunks/${chunkId}/replays/${gameId}`, undefined, {
      raw: data,
      query: { index: String(meta.index), seed: meta.seed, winner: meta.winner },
    })
  }

  engineStatus(engineRev: string, cards: { id: string; name: string; status: string; complete: boolean }[]) {
    return this.request<{ cards: number; incomplete: number }>('PUT', '/api/worker/engine-status', { engineRev, cards })
  }
}
