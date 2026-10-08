/**
 * The only Limitless client of the app (PLAN §3.5, docs/fase0/limitless.md §7). The API allows 50 requests per
 * 5 minutes per IP and its `RateLimit` counters are inconsistent between backends, so the client keeps its own
 * budget of 40 calls in any 300 s window, also pauses when the header says 2 or fewer remain, and treats a 429 as the
 * authoritative signal: it waits `max(Retry-After, t, 60 s)` and tries again — a 429 pauses the job, never aborts it.
 * 5xx and network errors back off 1, 2, 4, 8 and 16 minutes before giving up on that request.
 */
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { ENV, type Env } from '../config/env.js'

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export interface Clock {
  now(): number
  /** Resolves after `ms`, or rejects with the signal's reason when it aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal?.reason)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}

/** How the client reaches Limitless and measures time; the e2e tests swap both for fakes. */
@Injectable()
export class LimitlessTransport {
  fetch: FetchLike = (url, init) => fetch(url, init)
  clock: Clock = systemClock
}

/** Calls in any window of `WINDOW_MS` (Limitless allows 50; 10 stay free for anything else on the same IP). */
export const LIMITLESS_BUDGET = 40
export const LIMITLESS_WINDOW_MS = 300_000
const MIN_429_WAIT_MS = 60_000
const BACKOFF_MS = [60_000, 120_000, 240_000, 480_000, 960_000]
const REQUEST_TIMEOUT_MS = 30_000

export class LimitlessError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'LimitlessError'
  }
}

/** `"50-in-5min"; r=49; t=300` → remaining calls and seconds until the window resets. */
export function parseRateLimit(header: string | null): { remaining: number; resetSeconds: number } | null {
  if (!header) return null
  const r = /(?:^|;)\s*r=(\d+)/.exec(header)
  const t = /(?:^|;)\s*t=(\d+)/.exec(header)
  if (!r || !t) return null
  return { remaining: Number(r[1]), resetSeconds: Number(t[1]) }
}

export interface CallStats {
  calls: number
  waitedMs: number
}

@Injectable()
export class LimitlessClient {
  /** Timestamps of the calls of the last window, oldest first. */
  private readonly recent: number[] = []
  private pausedUntil = 0

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly transport: LimitlessTransport,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LimitlessClient.name)
  }

  /** Calls made in the current window (what the acceptance log checks: never above 40). */
  callsInWindow(): number {
    this.forget()
    return this.recent.length
  }

  /** GET `path` (e.g. `/tournaments?game=POCKET`), JSON. Throws `LimitlessError` on 4xx or after the backoff. */
  async get(path: string, stats: CallStats, signal: AbortSignal): Promise<unknown> {
    let failures = 0
    for (;;) {
      await this.waitForSlot(stats, signal)
      const startedAt = this.transport.clock.now()
      this.recent.push(startedAt)
      stats.calls += 1
      let status: number | null = null
      try {
        const response = await this.transport.fetch(`${this.env.limitlessBaseUrl}${path}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
          headers: { Accept: 'application/json' },
        })
        status = response.status
        const rate = parseRateLimit(response.headers.get('ratelimit'))
        this.logger.info(
          { path, status, inWindow: this.callsInWindow(), remaining: rate?.remaining ?? null },
          'limitless call',
        )
        if (rate && rate.remaining <= 2)
          this.pausedUntil = Math.max(this.pausedUntil, startedAt + rate.resetSeconds * 1000)
        if (status === 429) {
          const retryAfter = Number(response.headers.get('retry-after') ?? '0') * 1000
          const waitMs = Math.max(retryAfter, (rate?.resetSeconds ?? 0) * 1000, MIN_429_WAIT_MS)
          this.logger.warn({ path, waitMs }, 'limitless 429: pausing')
          await this.wait(waitMs, stats, signal)
          continue
        }
        if (status >= 500) throw new LimitlessError(`Limitless respondió ${status}`, status)
        if (status >= 400) throw new LimitlessError(`Limitless respondió ${status} para ${path}`, status)
        return await response.json()
      } catch (error) {
        if (signal.aborted) throw signal.reason
        const retryable = !(error instanceof LimitlessError) || (error.status !== null && error.status >= 500)
        if (!retryable) throw error
        const backoff = BACKOFF_MS[failures]
        failures += 1
        if (backoff === undefined) {
          throw error instanceof LimitlessError ? error : new LimitlessError(String(error), status)
        }
        this.logger.warn({ path, status, failures, backoffMs: backoff, err: error }, 'limitless error: backing off')
        await this.wait(backoff, stats, signal)
      }
    }
  }

  private forget(): void {
    const from = this.transport.clock.now() - LIMITLESS_WINDOW_MS
    while (this.recent.length > 0 && (this.recent[0] ?? 0) <= from) this.recent.shift()
  }

  private async waitForSlot(stats: CallStats, signal: AbortSignal): Promise<void> {
    for (;;) {
      this.forget()
      const now = this.transport.clock.now()
      if (now < this.pausedUntil) {
        await this.wait(this.pausedUntil - now, stats, signal)
        continue
      }
      if (this.recent.length < LIMITLESS_BUDGET) return
      const oldest = this.recent[0] ?? now
      await this.wait(oldest + LIMITLESS_WINDOW_MS - now + 1, stats, signal)
    }
  }

  private async wait(ms: number, stats: CallStats, signal: AbortSignal): Promise<void> {
    stats.waitedMs += ms
    await this.transport.clock.sleep(ms, signal)
  }
}
