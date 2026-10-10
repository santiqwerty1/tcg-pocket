import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Chunk, type ChunkResult, type LiveGame, WorkerClient } from '../src/client.js'
import type { WorkerConfig } from '../src/config.js'
import { EngineError, engineStatus, engineVersion, runJob } from '../src/engine.js'
import { LiveRunner, OLD_ENGINE_COACH } from '../src/live.js'
import { WORKER_VERSION } from '../src/version.js'
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
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pendings[0].chunkId).toBe(9)

    const restarted = new Worker(config, client, silent)
    await restarted.loop(new AbortController().signal, { once: true })
    expect(calls.results.map((call) => call.chunkId)).toEqual([9])
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pendings).toEqual([])
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

  it('H-010: a pairing with perGame sends every game in extra; without it, nothing extra', async () => {
    const { client, calls } = fakeClient([
      chunk({ chunkId: 20, perGame: true, replaySample: 0 }),
      chunk({ chunkId: 21 }),
    ])
    const worker = new Worker(config, client, silent)
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.failures).toHaveLength(0)
    expect(calls.results[0]?.body).toMatchObject({ winsA: 5, winsB: 5, games: 10 })
    expect(calls.results[0]?.body.extra).toEqual({
      perGame: {
        winners: 'AAAAABBBBB',
        starters: 'ABABABABAB',
        endings: 'PPPPPPPPPP',
        turns: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        stagesA: '1111111111',
        stagesB: '0000000000',
      },
    })
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.results[1]?.body.extra).toBeUndefined()
  })

  it('H-010: a pairing with perGame fails clearly on an engine that ignores the flag', async () => {
    process.env.FAKE_ENGINE_OLD = '1'
    try {
      const { client, calls } = fakeClient([chunk({ chunkId: 22, perGame: true })])
      await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
      expect(calls.results).toHaveLength(0)
      expect(calls.failures[0]?.error).toContain('recompilá el motor')
      expect(readdirSync(join(dataDir, 'work'))).toEqual([])
    } finally {
      delete process.env.FAKE_ENGINE_OLD
    }
  })

  it('reports its engine’s features in the claim, and writes the app’s hint once while it does not change', async () => {
    const lines: string[] = []
    const log = (message: string) => {
      lines.push(message)
    }
    const { client } = fakeClient([])
    const hint = 'Hay simulaciones que piden resultados partida por partida y este worker no puede jugarlas.'
    const stop = new AbortController()
    let claims = 0
    // Two claims with the hint (written once), one that gets a chunk (no hint), and the hint again (written again).
    vi.mocked(client.claim).mockImplementation(async () => {
      claims++
      if (claims === 4) stop.abort()
      if (claims === 3) {
        return { chunk: chunk({ chunkId: 42, replaySample: 0 }), requiredEngineRev: null, retryAfterSeconds: 0 }
      }
      return { chunk: null, requiredEngineRev: null, retryAfterSeconds: 0, hint }
    })
    await new Worker(config, client, log).loop(stop.signal, { once: false })
    expect(vi.mocked(client.claim).mock.calls[0]?.[0]).toMatchObject({
      version: WORKER_VERSION,
      engineFeatures: ['perGame', 'batch'],
    })
    expect(lines.filter((line) => line === hint)).toHaveLength(2)
  })

  it('an engine without features is not said to have any', async () => {
    process.env.FAKE_ENGINE_OLD = '1'
    try {
      const { client } = fakeClient([chunk({ chunkId: 41, replaySample: 0 })])
      await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
      expect(vi.mocked(client.claim).mock.calls[0]?.[0]).not.toHaveProperty('engineFeatures')
    } finally {
      delete process.env.FAKE_ENGINE_OLD
    }
  })

  it('B2: asks for batches when the engine has them, plays them in one run and reports each chunk', async () => {
    const batch = [
      chunk({ chunkId: 30, idx: 0, games: 60, seed: '500', replaySample: 1, perGame: true }),
      chunk({ chunkId: 31, idx: 1, games: 60, seed: '501', replaySample: 0, perGame: true }),
      chunk({ chunkId: 32, idx: 2, games: 30, seed: '502', replaySample: 0, perGame: true }),
    ]
    const { client, calls } = fakeClient([])
    vi.mocked(client.claim).mockResolvedValueOnce({
      chunk: batch[0] as Chunk,
      chunks: batch,
      requiredEngineRev: null,
      retryAfterSeconds: 0,
    })
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(vi.mocked(client.claim).mock.calls[0]?.[0]).toMatchObject({
      version: WORKER_VERSION,
      batch: { maxChunks: 64, maxGames: 500 },
    })
    expect(calls.failures).toEqual([])
    expect(calls.results.map((call) => call.chunkId)).toEqual([30, 31, 32])
    expect(calls.results[2]?.body).toMatchObject({ winsA: 15, winsB: 15, games: 30, durationMs: 180 })
    expect(calls.results[0]?.body.extra).toMatchObject({ perGame: { winners: expect.stringMatching(/^[AB]{60}$/) } })
    expect(calls.replays.map((replay) => replay.chunkId)).toEqual([30])
    expect(JSON.parse(gunzipSync(calls.replays[0]?.data ?? new Uint8Array()).toString())).toMatchObject({ pairing: 0 })
    expect(readdirSync(join(dataDir, 'work'))).toEqual([])
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pendings).toEqual([])
  })

  it('B2: a result left by a worker before 0.2.7 (state.json with `pending`) is still sent', async () => {
    const result = { workerId: 'worker-test-1', engineRev: REV, winsA: 1, winsB: 1, ties: 0, games: 2, durationMs: 5 }
    writeFileSync(
      join(dataDir, 'state.json'),
      JSON.stringify({ statusUploaded: REV, pending: { chunkId: 40, result, replays: [], dir: null } }),
    )
    const { client, calls } = fakeClient([])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results).toEqual([{ chunkId: 40, body: result }])
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'))).toMatchObject({ pending: null, pendings: [] })
  })

  it('B2: an engine without batch is never asked for one', async () => {
    process.env.FAKE_ENGINE_OLD = '1'
    try {
      const { client } = fakeClient([chunk({ chunkId: 33, replaySample: 0 })])
      await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
      expect(vi.mocked(client.claim).mock.calls[0]?.[0]).not.toHaveProperty('batch')
    } finally {
      delete process.env.FAKE_ENGINE_OLD
    }
  })

  /** A worker whose first claim answers `chunks` (a batch), then nothing. */
  function batchClient(chunks: Chunk[]) {
    const fake = fakeClient([])
    vi.mocked(fake.client.claim).mockResolvedValueOnce({
      chunk: chunks[0] as Chunk,
      chunks,
      requiredEngineRev: null,
      retryAfterSeconds: 0,
    })
    return fake
  }

  it('B2: a pairing that fails in the engine fails its own chunk only; the others report their results', async () => {
    const { client, calls } = batchClient([
      chunk({ chunkId: 34, games: 60, replaySample: 0 }),
      chunk({ chunkId: 35, games: 13, replaySample: 0 }),
      chunk({ chunkId: 36, games: 20, replaySample: 1 }),
    ])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results.map((call) => call.chunkId)).toEqual([34, 36])
    expect(calls.failures).toEqual([{ chunkId: 35, error: 'deck inválido' }])
    expect(calls.replays.map((replay) => replay.chunkId)).toEqual([36])
    expect(readdirSync(join(dataDir, 'work'))).toEqual([])
  })

  it('B2: a batch that fails as a whole is played chunk by chunk, so only a chunk that fails alone counts it', async () => {
    const { client, calls } = batchClient([
      chunk({ chunkId: 37, games: 60, replaySample: 0 }),
      chunk({ chunkId: 38, games: 11, replaySample: 0 }),
    ])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.failures).toEqual([])
    expect(calls.results.map((call) => call.chunkId)).toEqual([37, 38])
    expect(calls.results[1]?.body).toMatchObject({ games: 11 })
  })

  it('B2: a batch that hangs is played chunk by chunk too: only the chunk that hangs again is reported', async () => {
    const { client, calls } = batchClient([
      chunk({ chunkId: 39, games: 98, replaySample: 0 }),
      chunk({ chunkId: 40, games: 10, replaySample: 0 }),
    ])
    const worker = new Worker(config, client, silent)
    worker.heartbeatMs = 50
    worker.stallMs = 300
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.failures.map((failure) => failure.chunkId)).toEqual([39])
    expect(calls.results.map((call) => call.chunkId)).toEqual([40])
  })

  // D-023: real engine processes need room to start and stop on the shared CI machine.
  it(
    'B2: a cancelled job stops the batch; a chunk that is lost is not renewed but still reported',
    async () => {
      const hung = [chunk({ chunkId: 41, games: 98, replaySample: 0 }), chunk({ chunkId: 42, games: 10 })]
      const { client, calls } = batchClient(hung)
      vi.mocked(client.heartbeat).mockResolvedValue({ leaseUntil: null, cancelled: true, lost: false })
      const worker = new Worker(config, client, silent)
      worker.heartbeatMs = 50
      await worker.loop(new AbortController().signal, { once: true })
      expect(calls.results).toEqual([])
      expect(calls.failures).toEqual([])

      // The engine takes 300 ms (97 games): heartbeats run, chunk 43 is lost after the first one, 44 is renewed.
      const second = batchClient([
        chunk({ chunkId: 43, games: 97, replaySample: 0 }),
        chunk({ chunkId: 44, games: 20 }),
      ])
      vi.mocked(second.client.heartbeat).mockImplementation(async (chunkId: number) => ({
        leaseUntil: null,
        cancelled: false,
        lost: chunkId === 43,
      }))
      const watched = new Worker(config, second.client, silent)
      watched.heartbeatMs = 50
      await watched.loop(new AbortController().signal, { once: true })
      const beats = (id: number) =>
        vi.mocked(second.client.heartbeat).mock.calls.filter((call) => call[0] === id).length
      expect(beats(43)).toBe(1)
      expect(beats(44)).toBeGreaterThan(1)
      expect(second.calls.results.map((call) => call.chunkId)).toEqual([43, 44])
    },
    process.env.CI ? 20_000 : 5_000,
  )

  it('reports an engine failure instead of a result', async () => {
    const { client, calls } = fakeClient([chunk({ chunkId: 10, games: 13 })])
    await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results).toHaveLength(0)
    expect(calls.failures).toHaveLength(1)
    expect(calls.failures[0]?.error).toContain('deck inválido')
  })

  it('H-014: an engine that prints no progress is stopped by the watchdog and the chunk reported', async () => {
    const { client, calls } = fakeClient([chunk({ chunkId: 12, games: 98 })])
    const worker = new Worker(config, client, silent)
    worker.heartbeatMs = 50
    worker.stallMs = 300
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.results).toHaveLength(0)
    expect(calls.failures).toEqual([{ chunkId: 12, error: 'El motor no avanzó en 0 min y se cortó (¿colgado?).' }])
  })

  // D-023: real engine processes need room to start and stop on the shared CI machine.
  it(
    'H-014: a chunk that is no longer its own (requeued, or another worker has it) is let go without a failure',
    async () => {
      const { client, calls } = fakeClient([chunk({ chunkId: 13, games: 99 })])
      vi.mocked(client.heartbeat).mockResolvedValue({ leaseUntil: null, cancelled: false, lost: true })
      const worker = new Worker(config, client, silent)
      worker.heartbeatMs = 50
      await worker.loop(new AbortController().signal, { once: true })
      expect(calls.results).toHaveLength(0)
      expect(calls.failures).toHaveLength(0)
      expect(client.heartbeat).toHaveBeenCalled()
    },
    process.env.CI ? 20_000 : 5_000,
  )

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

  it('modo entrenador: the job asks for the coach and its scores go to the app; an old engine is a clear failure', async () => {
    const { client } = liveClient([1, 1])
    const decide = client.liveDecision as unknown as ReturnType<typeof vi.fn>
    await new LiveRunner(config, client, silent, dataDir).run({ ...game(), coach: true }, new AbortController().signal)
    expect(decide.mock.calls.map(([, body]) => body.coach)).toEqual([
      { scores: [-120.5, 30], best: 1 },
      { scores: [-120.5, 30], best: 1 },
    ])
    const plain = liveClient([1, 1])
    await new LiveRunner(config, plain.client, silent, dataDir).run(game(), new AbortController().signal)
    const plainDecide = plain.client.liveDecision as unknown as ReturnType<typeof vi.fn>
    expect(plainDecide.mock.calls.every(([, body]) => body.coach === undefined)).toBe(true)
    const old = liveClient([1, 1])
    await expect(
      new LiveRunner(config, old.client, silent, dataDir).run(
        { ...game(), seed: '666', coach: true },
        new AbortController().signal,
      ),
    ).rejects.toThrow(OLD_ENGINE_COACH)
  })

  it('an undo (Fase 22): the app says «restart», the engine stops without a failure', async () => {
    const { client, calls } = liveClient([1])
    const choice = client.liveChoice as unknown as ReturnType<typeof vi.fn>
    choice.mockImplementationOnce(async () => ({ choice: null, status: 'restart' }))
    const logs: string[] = []
    await new LiveRunner(config, client, (message) => logs.push(message), dataDir).run(
      game(),
      new AbortController().signal,
    )
    expect(calls.decisions).toHaveLength(1)
    expect(calls.end).toBeNull()
    expect(calls.failures).toEqual([])
    expect(logs).toContain('partida reiniciada para deshacer una jugada')
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
