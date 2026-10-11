import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEnv } from '../config/env.js'
import { TrackerClient } from './tracker-client.js'

function client() {
  return new TrackerClient(
    parseEnv({
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      SESSION_SECRET: 'x'.repeat(32),
      TRACKER_COLLECTION_ANON_KEY: 'test-public-anon-key',
    }),
  )
}
const row = { internal_id: 65600, amount_owned: 1, collected: true }
const head = () => new Response(null, { headers: { 'content-range': '*/1' } })
afterEach(() => vi.useRealTimers())

describe('TrackerClient retries', () => {
  it.each(['2', 'Sun, 11 Oct 2026 15:00:02 GMT'])('respects Retry-After %s on 429', async (retryAfter) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-11T15:00:00Z'))
    const tracker = client()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': retryAfter } }))
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(Response.json([row]))
      .mockResolvedValueOnce(Response.json([]))
    tracker.fetchImpl = fetch
    const result = tracker.collection('1111222233334444')
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual([row])
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('retries a timeout while reading the body, then finishes the exact snapshot', async () => {
    vi.useFakeTimers()
    const tracker = client()
    const stalled = Response.json([row])
    vi.spyOn(stalled, 'json').mockRejectedValue(new DOMException('body timed out', 'TimeoutError'))
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(head())
      .mockResolvedValueOnce(stalled)
      .mockResolvedValueOnce(Response.json([row]))
      .mockResolvedValueOnce(Response.json([]))
    tracker.fetchImpl = fetch
    const result = tracker.collection('1111222233334444')
    await vi.advanceTimersByTimeAsync(250)
    expect(await result).toEqual([row])
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('reports missing configuration before contacting the tracker', async () => {
    const env = parseEnv({ DATABASE_URL: 'postgresql://test:test@localhost/test', SESSION_SECRET: 'x'.repeat(32) })
    const unconfigured = new TrackerClient(env)
    unconfigured.fetchImpl = vi.fn()
    await expect(unconfigured.collection('1111222233334444')).rejects.toMatchObject({ code: 'tracker_config' })
    expect(unconfigured.fetchImpl).not.toHaveBeenCalled()
  })
})
