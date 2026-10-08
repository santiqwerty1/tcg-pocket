import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Chunk, type ChunkResult, type LiveGame, WorkerClient } from '../src/client.js'
import type { WorkerConfig } from '../src/config.js'
import { EngineError, engineStatus, engineVersion, runJob } from '../src/engine.js'
import { LiveRunner } from '../src/live.js'
import { Worker } from '../src/worker.js'

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'fake-engine.mjs')
const REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
const silent = () => undefined

function chunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    chunkId: 7,
    jobId: 1,
    kind: 'matrix',
    idx: 0,
    games: 10,
    firstGame: 0,
    seed: '20261008',
    players: ['e2', 'e2'],
    threads: null,
    replaySample: 2,
    leaseUntil: new Date(Date.now() + 180_000).toISOString(),
    deckA: 'Energy: Grass\n2 Bulbasaur A1 1\n',
    deckB: 'Energy: Fire\n2 Charmander A1 33\n',
    optimize: null,
    ...overrides,
  }
}

/** The worker API as the worker sees it, recording calls; `result` can be made to fail. */
function fakeClient(chunks: Chunk[]) {
  const calls = {
    results: [] as { chunkId: number; body: ChunkResult }[],
    replays: [] as { chunkId: number; gameId: string; data: Uint8Array; meta: Record<string, unknown> }[],
    failures: [] as { chunkId: number; error: string }[],
    status: [] as string[],
  }
  let failResult = 0
  const client = {
    claim: vi.fn(async () => {
      const next = chunks.shift() ?? null
      return { chunk: next, requiredEngineRev: next ? REV : null, retryAfterSeconds: 0 }
    }),
    heartbeat: vi.fn(async () => ({ leaseUntil: null, cancelled: false })),
    result: vi.fn(async (chunkId: number, body: ChunkResult) => {
      if (failResult > 0) {
        failResult--
        throw new Error('sin red')
      }
      const accepted = !calls.results.some((call) => call.chunkId === chunkId)
      calls.results.push({ chunkId, body })
      return { accepted }
    }),
    failure: vi.fn(async (chunkId: number, body: { error: string }) => {
      calls.failures.push({ chunkId, error: body.error })
      return { status: 'queued' }
    }),
    replay: vi.fn(async (chunkId: number, gameId: string, data: Uint8Array, meta: Record<string, unknown>) => {
      calls.replays.push({ chunkId, gameId, data, meta })
      return { id: calls.replays.length }
    }),
    engineStatus: vi.fn(async (engineRev: string) => {
      calls.status.push(engineRev)
      return { cards: 2, incomplete: 1 }
    }),
  }
  return { client: client as unknown as WorkerClient, calls, failNextResult: () => failResult++ }
}

describe('engine runner', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tcg-worker-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads version and status, and runs a job with progress', async () => {
    expect(await engineVersion(FAKE_ENGINE)).toMatchObject({ engineRev: REV })
    expect(await engineStatus(FAKE_ENGINE)).toHaveLength(2)
    const progress: [number, number | null][] = []
    const { result, dir: jobDir } = await runJob<{ winsA: number; replays: unknown[] }>(
      FAKE_ENGINE,
      'simulate',
      { deckA: 'x', deckB: 'y', players: ['r', 'r'], games: 4, seed: 1, threads: 1, replaySample: 1 },
      dir,
      { onProgress: (done, total) => progress.push([done, total]) },
    )
    expect(result.winsA).toBe(2)
    expect(result.replays).toHaveLength(1)
    expect(progress.at(-1)).toEqual([4, 4])
    expect(readdirSync(jobDir)).toContain('result.json')
  })

  it('turns a failed run into EngineError with the JSON message and code, and cleans its folder', async () => {
    const error = await runJob(FAKE_ENGINE, 'simulate', { games: 13, seed: 1 }, dir).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect(error).toMatchObject({ exitCode: 3, code: 'bad_deck' })
    expect((error as Error).message).toContain('deck inválido')
    expect(readdirSync(dir)).toEqual([])
  })

  it('stops the engine when the signal aborts', async () => {
    const controller = new AbortController()
    const run = runJob(FAKE_ENGINE, 'simulate', { games: 99, seed: 1 }, dir, {
      signal: controller.signal,
      onProgress: () => controller.abort(new Error('cancelado')),
    })
    await expect(run).rejects.toThrow('cancelado')
  })
})

describe('worker loop', () => {
  let dataDir: string
  let config: WorkerConfig
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tcg-worker-data-'))
    config = {
      server: 'http://test',
      token: 'tcg_wk_test',
      cores: 2,
      name: 'test',
      enginePath: FAKE_ENGINE,
      dataDir,
      workerId: 'worker-test-1',
    }
  })
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

  it('plays a chunk, reports the result and uploads the replays gzipped', async () => {
    const { client, calls } = fakeClient([chunk()])
    const worker = new Worker(config, client, silent)
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.status).toEqual([REV])
    expect(calls.results).toHaveLength(1)
    expect(calls.results[0]?.body).toMatchObject({ workerId: 'worker-test-1', winsA: 5, winsB: 5, games: 10 })
    expect(calls.replays).toHaveLength(2)
    const first = calls.replays[0]
    expect(JSON.parse(gunzipSync(first?.data ?? new Uint8Array()).toString())).toMatchObject({ index: 0 })
    expect(first?.meta).toMatchObject({ index: 0, seed: '20261008', winner: 'a' })
    // Work folder emptied, nothing pending.
    expect(readdirSync(join(dataDir, 'work'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pending).toBeNull()

    // The engine status goes up once per engine revision.
    const again = fakeClient([chunk({ chunkId: 8 })])
    await new Worker(config, again.client, silent).loop(new AbortController().signal, { once: true })
    expect(again.calls.status).toEqual([])
  })

  it('keeps a result it could not send and sends it first after a restart', async () => {
    const { client, calls, failNextResult } = fakeClient([chunk({ chunkId: 9, replaySample: 0 })])
    failNextResult()
    await expect(new Worker(config, client, silent).loop(new AbortController().signal, { once: true })).rejects.toThrow(
      'sin red',
    )
    expect(calls.results).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pending.chunkId).toBe(9)

    const restarted = new Worker(config, client, silent)
    await restarted.loop(new AbortController().signal, { once: true })
    expect(calls.results.map((call) => call.chunkId)).toEqual([9])
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pending).toBeNull()
  })

  it('drops a result the app rejects (job deleted) and goes on', async () => {
    const { client, calls } = fakeClient([chunk({ chunkId: 12, replaySample: 1 })])
    ;(client.result as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('PUT /api/worker/chunks/12/result: 404 Chunk 12 no encontrado.', 404),
    )
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results).toHaveLength(0)
    expect(calls.replays).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pending).toBeNull()
    expect(readdirSync(join(dataDir, 'work'))).toEqual([])
  })

  it('reports an engine failure instead of a result', async () => {
    const { client, calls } = fakeClient([chunk({ chunkId: 10, games: 13 })])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results).toHaveLength(0)
    expect(calls.failures).toHaveLength(1)
    expect(calls.failures[0]?.error).toContain('deck inválido')
  })

  it('a consistency chunk: ready and never-ready games as the tallies, the histograms in extra', async () => {
    const { client, calls } = fakeClient([
      chunk({
        kind: 'consistency',
        games: 20,
        deckB: null,
        replaySample: 0,
        consistency: { keyCards: ['B1 036'], maxTurn: 3, bot: 'e2' },
      }),
    ])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results[0]?.body).toMatchObject({ winsA: 18, winsB: 2, ties: 0, games: 20 })
    expect(calls.results[0]?.body.extra).toMatchObject({ ready: { first: { games: 10, never: 1 } } })
  })

  it('a consistency chunk against the meta passes the rivals to the engine (D-019)', async () => {
    const { client, calls } = fakeClient([
      chunk({
        kind: 'consistency',
        games: 20,
        deckB: null,
        replaySample: 0,
        consistency: {
          keyCards: ['B1 036'],
          maxTurn: 3,
          bot: 'e2',
          rivals: [
            { deck: 'rival 1', games: 12 },
            { deck: 'rival 2', games: 8 },
          ],
        },
      }),
    ])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.failures).toHaveLength(0)
    expect(calls.results[0]?.body).toMatchObject({ games: 20 })
  })

  it('a consistency chunk against the meta fails on an engine that ignores the rivals', async () => {
    process.env.FAKE_ENGINE_OLD = '1'
    try {
      const { client, calls } = fakeClient([
        chunk({
          kind: 'consistency',
          games: 20,
          deckB: null,
          replaySample: 0,
          consistency: { keyCards: ['B1 036'], maxTurn: 3, bot: 'e2', rivals: [{ deck: 'rival', games: 20 }] },
        }),
      ])
      await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
      expect(calls.results).toHaveLength(0)
      expect(calls.failures[0]?.error).toContain('recompilá el motor')
    } finally {
      delete process.env.FAKE_ENGINE_OLD
    }
  })

  it('sums optimize combinations into the chunk result and keeps them in extra', async () => {
    const { client, calls } = fakeClient([
      chunk({
        chunkId: 11,
        kind: 'optimize',
        deckA: null,
        deckB: null,
        optimize: { deck: 'x', candidates: ['A1 001'] },
      }),
    ])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results[0]?.body).toMatchObject({ winsA: 3, winsB: 1, ties: 0, games: 4, turns: 38 })
    expect(calls.results[0]?.body.extra).toMatchObject({ combinations: [expect.anything(), expect.anything()] })
  })
})

describe('games against a bot (Fase 8)', () => {
  let dataDir: string
  let config: WorkerConfig
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tcg-worker-live-'))
    config = {
      server: 'http://test',
      token: 'tcg_wk_test',
      cores: 2,
      name: 'test',
      enginePath: FAKE_ENGINE,
      dataDir,
      workerId: 'worker-test-1',
    }
  })
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

  const game = (choices: number[] = []): LiveGame => ({
    id: 5,
    deckHuman: 'Energy: Grass\n2 Bulbasaur A1 1\n',
    deckBot: 'Energy: Fire\n2 Charmander A1 33\n',
    bot: 'e2',
    seed: '42',
    choices,
  })

  /** The app's side: each decision is answered with the next of `answers` (null = abandoned). */
  function liveClient(answers: (number | null)[]) {
    const calls = {
      decisions: [] as { ply: number; actions: number; log: number }[],
      end: null as null | { winner: string; turns: number; log: number },
      replay: null as null | Record<string, unknown>,
      failures: [] as string[],
    }
    const client = {
      liveDecision: vi.fn(async (_id: number, body: { ply: number; actions: unknown[]; log: unknown[] }) => {
        calls.decisions.push({ ply: body.ply, actions: body.actions.length, log: body.log.length })
        return { choice: null, status: 'waiting' }
      }),
      liveChoice: vi.fn(async () => {
        const next = answers.shift()
        return next === null || next === undefined
          ? { choice: null, status: 'abandoned' }
          : { choice: next, status: 'running' }
      }),
      liveEnd: vi.fn(async (_id: number, body: { winner: string; turns: number; log: unknown[] }) => {
        calls.end = { winner: body.winner, turns: body.turns, log: body.log.length }
        return { ok: true }
      }),
      liveReplay: vi.fn(async (_id: number, _worker: string, data: Uint8Array) => {
        calls.replay = JSON.parse(gunzipSync(data).toString())
        return { ok: true }
      }),
      liveFailure: vi.fn(async (_id: number, body: { error: string }) => {
        calls.failures.push(body.error)
        return { ok: true }
      }),
    }
    return { client: client as unknown as WorkerClient, calls }
  }

  it('relays each decision with the log so far, sends the choices to the engine and reports the end', async () => {
    const { client, calls } = liveClient([1, 1])
    const runner = new LiveRunner(config, client, silent, dataDir)
    await runner.run(game(), new AbortController().signal)
    expect(calls.decisions).toEqual([
      { ply: 1, actions: 2, log: 1 },
      { ply: 2, actions: 2, log: 2 },
    ])
    expect(calls.end).toEqual({ winner: 'you', turns: 4, log: 3 })
    expect(calls.replay).toMatchObject({ choices: [1, 1] })
    expect(calls.failures).toEqual([])
    expect(readdirSync(dataDir)).toEqual([])
  })

  it('rebuilds a game from the choices the app already has, asking only for the new ones', async () => {
    const { client, calls } = liveClient([0])
    await new LiveRunner(config, client, silent, dataDir).run(game([1]), new AbortController().signal)
    expect(calls.decisions.map((decision) => decision.ply)).toEqual([2])
    expect(calls.end?.winner).toBe('bot')
    expect(calls.replay).toMatchObject({ choices: [1, 0] })
  })

  it('stops the engine when the owner abandons the game, without reporting a failure', async () => {
    const { client, calls } = liveClient([null])
    await new LiveRunner(config, client, silent, dataDir).run(game(), new AbortController().signal)
    expect(calls.decisions).toHaveLength(1)
    expect(calls.end).toBeNull()
    expect(calls.failures).toEqual([])
  })
})

describe('worker client', () => {
  it('retries network errors and 5xx, returns 4xx to the caller', async () => {
    const responses = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('', { status: 503 })),
      () => Promise.resolve(Response.json({ accepted: true })),
    ]
    const fetchImpl = vi.fn(() => (responses.shift() as () => Promise<Response>)())
    vi.useFakeTimers()
    try {
      const client = new WorkerClient('http://test', 'tcg_wk_x', silent, fetchImpl as unknown as typeof fetch)
      const pending = client.result(1, {
        workerId: 'w',
        engineRev: REV,
        winsA: 1,
        winsB: 0,
        ties: 0,
        games: 1,
        durationMs: 1,
      })
      await vi.runAllTimersAsync()
      expect(await pending).toEqual({ accepted: true })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      const [, init] = fetchImpl.mock.calls[2] as unknown as [URL, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tcg_wk_x')
    } finally {
      vi.useRealTimers()
    }

    const forbidden = new WorkerClient('http://test', 'tcg_wk_x', silent, (async () =>
      Response.json({ error: { message: 'Token sin permiso.' } }, { status: 403 })) as unknown as typeof fetch)
    const error = await forbidden.heartbeat(1, { workerId: 'w', gamesDone: 0 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403 })
    expect((error as Error).message).toContain('Token sin permiso.')
  })
})

describe('worker lock', () => {
  it('lets one worker per folder run and takes over a lock left by a dead process', async () => {
    const { acquireLock, releaseLock } = await import('../src/lock.js')
    const dir = mkdtempSync(join(tmpdir(), 'tcg-worker-lock-'))
    try {
      expect(acquireLock(dir)).toBeNull()
      // This test process holds it: another PID is told who runs.
      expect(acquireLock(dir, process.pid + 1_000_000)).toBe(process.pid)
      releaseLock(dir)
      // A PID that does not exist anymore does not block.
      expect(acquireLock(dir, 999_999_991)).toBeNull()
      expect(acquireLock(dir)).toBeNull()
      releaseLock(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
