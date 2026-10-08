import type { PinoLogger } from 'nestjs-pino'
import { describe, expect, it } from 'vitest'
import type { Env } from '../config/env.js'
import {
  type CallStats,
  type Clock,
  type FetchLike,
  LIMITLESS_BUDGET,
  LIMITLESS_WINDOW_MS,
  LimitlessClient,
  LimitlessError,
  parseRateLimit,
} from './limitless.client.js'

/** A clock whose sleeps advance time instantly. */
function fakeClock(): Clock & { slept: number[] } {
  let now = 1_000_000
  const slept: number[] = []
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
      now += ms
    },
  }
}

const logger = { setContext: () => {}, info: () => {}, warn: () => {} } as unknown as PinoLogger
const env = { limitlessBaseUrl: 'https://limitless.test/api' } as Env

function response(status: number, headers: Record<string, string> = {}, body: unknown = []) {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function client(fetchImpl: FetchLike, clock: Clock) {
  return new LimitlessClient(env, { fetch: fetchImpl, clock }, logger)
}

describe('LimitlessClient', () => {
  it('reads the RateLimit header', () => {
    expect(parseRateLimit('"50-in-5min"; r=49; t=300')).toEqual({ remaining: 49, resetSeconds: 300 })
    expect(parseRateLimit(null)).toBeNull()
    expect(parseRateLimit('garbage')).toBeNull()
  })

  it('never makes more than 40 calls in any 5-minute window (acceptance: the log shows ≤ 40 per 5 min)', async () => {
    const clock = fakeClock()
    const times: number[] = []
    const fetchImpl: FetchLike = async () => {
      times.push(clock.now())
      return response(200, { ratelimit: '"50-in-5min"; r=40; t=300' })
    }
    const limitless = client(fetchImpl, clock)
    const stats: CallStats = { calls: 0, waitedMs: 0 }
    const signal = new AbortController().signal
    for (let i = 0; i < 130; i++) await limitless.get('/tournaments', stats, signal)
    expect(stats.calls).toBe(130)
    for (const [i, start] of times.entries()) {
      const inWindow = times.filter((t) => t >= start && t < start + LIMITLESS_WINDOW_MS).length
      expect(inWindow, `window starting at call ${i}`).toBeLessThanOrEqual(LIMITLESS_BUDGET)
    }
    expect(stats.waitedMs).toBeGreaterThan(2 * LIMITLESS_WINDOW_MS)
  })

  it('a 429 pauses (Retry-After, at least 60 s) and the same request goes on; it never aborts', async () => {
    const clock = fakeClock()
    let n = 0
    const fetchImpl: FetchLike = async () => {
      n += 1
      if (n <= 3) return response(429, { 'retry-after': '90', ratelimit: '"50-in-5min"; r=0; t=30' })
      return response(200, {}, [{ id: 'x' }])
    }
    const stats: CallStats = { calls: 0, waitedMs: 0 }
    const result = await client(fetchImpl, clock).get('/tournaments', stats, new AbortController().signal)
    expect(result).toEqual([{ id: 'x' }])
    expect(stats.calls).toBe(4)
    expect(clock.slept.filter((ms) => ms === 90_000)).toHaveLength(3)
  })

  it('pauses when the header says 2 or fewer calls remain', async () => {
    const clock = fakeClock()
    const fetchImpl: FetchLike = async () => response(200, { ratelimit: '"50-in-5min"; r=1; t=45' })
    const limitless = client(fetchImpl, clock)
    const stats: CallStats = { calls: 0, waitedMs: 0 }
    const signal = new AbortController().signal
    await limitless.get('/a', stats, signal)
    await limitless.get('/b', stats, signal)
    expect(clock.slept).toEqual([45_000])
  })

  it('5xx backs off 1, 2, 4, 8 and 16 minutes, then gives up; 4xx fails at once', async () => {
    const clock = fakeClock()
    const failing: FetchLike = async () => response(503)
    const stats: CallStats = { calls: 0, waitedMs: 0 }
    await expect(client(failing, clock).get('/x', stats, new AbortController().signal)).rejects.toBeInstanceOf(
      LimitlessError,
    )
    expect(stats.calls).toBe(6)
    expect(clock.slept).toEqual([60_000, 120_000, 240_000, 480_000, 960_000])

    const missing: FetchLike = async () => response(404)
    const once: CallStats = { calls: 0, waitedMs: 0 }
    await expect(client(missing, fakeClock()).get('/y', once, new AbortController().signal)).rejects.toMatchObject({
      status: 404,
    })
    expect(once.calls).toBe(1)
  })

  it('stops waiting when the run is aborted (shutdown)', async () => {
    const controller = new AbortController()
    const clock: Clock = {
      now: () => 0,
      sleep: async (_ms, signal) => {
        controller.abort(new Error('shutdown'))
        throw signal?.reason
      },
    }
    const fetchImpl: FetchLike = async () => response(429)
    await expect(client(fetchImpl, clock).get('/x', { calls: 0, waitedMs: 0 }, controller.signal)).rejects.toThrow(
      'shutdown',
    )
  })
})
