import { EventEmitter } from 'node:events'
import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { poolOptions } from './pool-options.js'

/** A client that connects and ends at once, without a database: pg-pool takes it through `options.Client`. */
class FakeClient extends EventEmitter {
  _queryable = true
  _ending = false
  connect(callback: (error?: Error) => void) {
    queueMicrotask(() => callback())
  }
  end(callback?: () => void) {
    this._ending = true
    queueMicrotask(() => {
      this.emit('end')
      callback?.()
    })
  }
}

/** The real pg-pool with these options over fake clients, counting the connections it opens. */
function fakePool(cli: boolean) {
  const pool = new pg.Pool({
    ...poolOptions({ databaseUrl: 'postgresql://x', cli }),
    Client: FakeClient,
  } as unknown as pg.PoolConfig)
  const opened: unknown[] = []
  pool.on('connect', (client) => opened.push(client))
  return { pool, opened }
}

/** A burst of `width` connections at once, all released. */
async function burst(pool: pg.Pool, width: number) {
  const clients = await Promise.all(Array.from({ length: width }, () => pool.connect()))
  for (const client of clients) client.release()
}

describe('poolOptions on the real pg-pool (infra-egress)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the API keeps the extra connections a minute idle and the last one for good', async () => {
    vi.useFakeTimers()
    const { pool, opened } = fakePool(false)
    await burst(pool, 3)
    expect(pool.totalCount).toBe(3)
    // pg's 10 s would have closed two by now: the next burst, ~15–20 s later, reuses them.
    await vi.advanceTimersByTimeAsync(20_000)
    await burst(pool, 3)
    expect(opened).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(pool.totalCount).toBe(3)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(pool.totalCount).toBe(1)
    // min: 1 never closes, and the next query uses it.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(pool.totalCount).toBe(1)
    await burst(pool, 1)
    expect(opened).toHaveLength(3)
    await pool.end()
  })

  it('a CLI takes at most 6 and closes the extra ones after 10 s', async () => {
    vi.useFakeTimers()
    const { pool } = fakePool(true)
    expect(pool.options.max).toBe(6)
    await burst(pool, 3)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(pool.totalCount).toBe(1)
    await pool.end()
  })
})
