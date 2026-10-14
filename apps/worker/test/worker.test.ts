import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { constants, setPriority, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Chunk, type ChunkResult, type LiveGame, WorkerClient } from '../src/client.js'
import type { WorkerConfig } from '../src/config.js'
import { cutDiagnosis, EngineError, engineStatus, engineVersion, FROZEN_GAP_MS, runJob } from '../src/engine.js'
import { LiveRunner, OLD_ENGINE_COACH } from '../src/live.js'
import { parseMemAvailableMb, parseStatus, procAvailable } from '../src/proc-probe.js'
import type { ReadyRelease, Updater } from '../src/update.js'
import { WORKER_VERSION } from '../src/version.js'
import { workDirOwner } from '../src/work-dir.js'
import { Worker } from '../src/worker.js'

const FAKE_ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'fake-engine.mjs')
const REV = 'fb792ebfbaca995af9750c28101ce92a51282825'
const silent = () => undefined

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  setPriority: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(setPriority).mockReset()
})

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
    failures: [] as { chunkId: number; error: string; cause?: string; pausedUntil?: string }[],
    status: [] as string[],
  }
  let failResult = 0
  const client = {
    claim: vi.fn(async () => {
      const next = chunks.shift() ?? null
      return { chunk: next, requiredEngineRev: next ? REV : null, retryAfterSeconds: 0 }
    }),
    heartbeat: vi.fn(async () => ({
      leaseUntil: new Date(Date.now() + 180_000).toISOString(),
      cancelled: false,
      lost: false,
    })),
    result: vi.fn(async (chunkId: number, body: ChunkResult) => {
      if (failResult > 0) {
        failResult--
        throw new Error('sin red')
      }
      const accepted = !calls.results.some((call) => call.chunkId === chunkId)
      calls.results.push({ chunkId, body })
      return { accepted }
    }),
    failure: vi.fn(async (chunkId: number, body: { error: string; cause?: string; pausedUntil?: string }) => {
      calls.failures.push({
        chunkId,
        error: body.error,
        ...(body.cause ? { cause: body.cause } : {}),
        ...(body.pausedUntil ? { pausedUntil: body.pausedUntil } : {}),
      })
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

  it('classifies a zero exit without result as an engine failure and logs the exit', async () => {
    const log = vi.fn()
    await expect(runJob(FAKE_ENGINE, 'simulate', { games: 96 }, dir, { log })).rejects.toMatchObject({
      exitCode: 0,
      code: 'missing_result',
      signal: null,
    })
    expect(log).toHaveBeenCalledWith('motor terminado', expect.objectContaining({ exitCode: 0, signal: null }))
    expect(readdirSync(dir)).toEqual([])
  })

  it('an engine that ends with 0 short of its games (the S25, 12/10/2026) logs how far it got, and on Linux its memory', async () => {
    const log = vi.fn()
    await expect(runJob(FAKE_ENGINE, 'simulate', { games: 92 }, dir, { log, probeEveryMs: 50 })).rejects.toMatchObject({
      exitCode: 0,
      code: 'missing_result',
    })
    expect(log).toHaveBeenCalledWith(
      'motor terminado',
      expect.objectContaining({ exitCode: 0, signal: null, lastProgress: 60, total: 92 }),
    )
    expect(log).toHaveBeenCalledWith(
      'motor sin resultado válido',
      expect.objectContaining({ lastProgress: 60, total: 92, finished: false, resultExists: false }),
    )
    const messages = log.mock.calls.map(([message]) => message)
    if (procAvailable()) {
      // Linux and Android: how likely the system was to kill it, and its memory while it played.
      expect(log).toHaveBeenCalledWith('motor arrancado', expect.objectContaining({ oomScore: expect.any(Number) }))
      expect(log).toHaveBeenCalledWith(
        'motor: memoria',
        expect.objectContaining({ rssMb: expect.any(Number), memAvailableMb: expect.any(Number) }),
      )
    } else {
      expect(messages).not.toContain('motor arrancado')
      expect(messages).not.toContain('motor: memoria')
    }
  })

  it('a lost result says how the engine said it ended, in the log and in the message the app keeps (H-054)', async () => {
    const log = vi.fn()
    // Cut without a word (the S25): no `fin` line, and the engine's version says whether it could have said one.
    const cut = runJob(FAKE_ENGINE, 'simulate', { games: 92 }, dir, { log, cliVersion: '0.3.7' })
    await expect(cut).rejects.toMatchObject({ code: 'missing_result' })
    const message = await cut.catch((error: Error) => error.message)
    expect(message).toMatch(/\(fin: ninguna \(engine-cli 0\.3\.7\); avance 60\/92; última partida hace \d+ s/)
    // Without the folder's path (it has the user's folder): the app shows the message, MCP gives it (review of #100).
    expect(message).toMatch(/: result\.json: ENOENT$/)
    expect(message).not.toContain(dir)
    expect(log).toHaveBeenCalledWith(
      'motor sin resultado válido',
      expect.objectContaining({
        endLine: null,
        msSinceProgress: expect.any(Number),
        clockGapMs: expect.any(Number),
        sleepGapMs: expect.any(Number),
        cliVersion: '0.3.7',
      }),
    )
    // engine-cli 0.3.7 said it ended well, and the file is not there: then it is not a cut.
    const said = runJob(FAKE_ENGINE, 'simulate', { games: 91 }, dir, { log })
    await expect(said).rejects.toMatchObject({ code: 'missing_result' })
    expect(await said.catch((error: Error) => error.message)).toContain('(fin: ok; avance 91/91')
    expect(log).toHaveBeenCalledWith('motor terminado', expect.objectContaining({ endLine: 'ok' }))
  })

  it('a line that comes in two pieces is read whole (review of the diagnosis)', async () => {
    const split = runJob(FAKE_ENGINE, 'simulate', { games: 90 }, dir, {})
    await expect(split).rejects.toMatchObject({ code: 'missing_result' })
    expect(await split.catch((error: Error) => error.message)).toContain('(fin: ok; avance 90/90')
  })

  it('the clock sees the worker stopped while the engine played (H-054)', async () => {
    const log = vi.fn()
    let blocked = false
    // The worker stops 200 ms at its first progress, with a tick of 20 ms: as if the system froze it.
    const onProgress = () => {
      if (blocked) return
      blocked = true
      const until = performance.now() + 200
      while (performance.now() < until) {
        // busy: nothing else runs, the clock's ticks either
      }
    }
    await expect(
      runJob(FAKE_ENGINE, 'simulate', { games: 92 }, dir, { log, onProgress, clockEveryMs: 20 }),
    ).rejects.toMatchObject({ code: 'missing_result' })
    const ended = log.mock.calls.find(([message]) => message === 'motor terminado')?.[1] as {
      clockGapMs: number
      sleepGapMs: number
    }
    expect(ended.clockGapMs).toBeGreaterThanOrEqual(120)
    // The machine did not sleep: both clocks went the same way.
    expect(ended.sleepGapMs).toBeLessThan(100)
  })

  it('the diagnosis of a cut says a frozen worker, an asleep machine and its memory', () => {
    const output = {
      stdout: '',
      stderrTail: '',
      lastProgress: 699,
      total: 1000,
      seconds: 7000,
      lastSample: { memAvailableMb: 812 } as never,
      endLine: null,
      msSinceProgress: 1_250_000,
      clockGapMs: 1_200_000,
      sleepGapMs: 45_000,
    }
    expect(cutDiagnosis(output, '0.3.7')).toBe(
      'fin: ninguna (engine-cli 0.3.7); avance 699/1000; última partida hace 1250 s; el worker estuvo congelado hasta 1200 s seguidos; el equipo estuvo suspendido, o cambió la hora, hasta 45 s; memoria libre 812 MB',
    )
    // Gaps under the threshold say nothing.
    expect(
      cutDiagnosis({
        ...output,
        clockGapMs: FROZEN_GAP_MS - 1,
        sleepGapMs: FROZEN_GAP_MS - 1,
        lastSample: null,
        endLine: 'señal 15',
      }),
    ).toBe('fin: señal 15; avance 699/1000; última partida hace 1250 s')
  })

  it('reads /proc: MemAvailable and the status of a process', () => {
    expect(parseMemAvailableMb('MemTotal:       11534336 kB\nMemAvailable:    2097152 kB\n')).toBe(2048)
    expect(parseMemAvailableMb('MemTotal: 1 kB\n')).toBeNull()
    expect(
      parseStatus('Name:\tengine-cli\nState:\tR (running)\nVmHWM:\t  524288 kB\nVmRSS:\t  262144 kB\nThreads:\t9\n'),
    ).toEqual({ state: 'R (running)', rssMb: 256, hwmMb: 512, threads: 9 })
    expect(parseStatus('Name:\tx\n')).toEqual({ state: null, rssMb: null, hwmMb: null, threads: null })
  })

  it.each([94, 93])('classifies invalid output (%i) as an engine failure', async (games) => {
    // The file is there but bad: the engine's problem (a missing one is the worker's, «missing_result»).
    await expect(runJob(FAKE_ENGINE, 'simulate', { games }, dir)).rejects.toMatchObject({
      exitCode: 0,
      code: 'invalid_result',
    })
    expect(readdirSync(dir)).toEqual([])
  })

  it('reports an OS kill as an engine failure rather than reading result.json', async () => {
    const log = vi.fn()
    await expect(runJob(FAKE_ENGINE, 'simulate', { games: 95 }, dir, { log })).rejects.toBeInstanceOf(EngineError)
    const exit = log.mock.calls.find(([message]) => message === 'motor terminado')?.[1]
    expect(exit?.exitCode !== 0 || exit?.signal !== null).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it.each(['simulate', 'batch', 'optimize', 'consistency'] as const)(
    'requests below-normal priority for %s',
    async (command) => {
      await runJob(FAKE_ENGINE, command, { games: 10, seed: 1, pairings: [] }, dir)
      expect(setPriority).toHaveBeenCalledWith(expect.any(Number), constants.priority.PRIORITY_BELOW_NORMAL)
    },
  )

  it('keeps metadata commands at normal priority', async () => {
    await engineVersion(FAKE_ENGINE)
    await engineStatus(FAKE_ENGINE)
    expect(vi.mocked(setPriority).mock.calls.map(([, priority]) => priority)).toEqual([
      constants.priority.PRIORITY_NORMAL,
      constants.priority.PRIORITY_NORMAL,
    ])
  })

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
      priority: 'below_normal',
      allowSlowBots: true,
      name: 'test',
      enginePath: FAKE_ENGINE,
      dataDir,
      workerId: 'worker-test-1',
      autoUpdate: false,
    }
  })
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

  it('reports a missing result and continues to the next chunk without restarting the worker', async () => {
    const { client, calls } = fakeClient([chunk({ games: 96 }), chunk({ chunkId: 8 })])
    const controller = new AbortController()
    const original = vi.mocked(client.claim).getMockImplementation()
    vi.mocked(client.claim).mockImplementation(async (hello, signal) => {
      const answer = await original?.(hello, signal)
      if (!answer?.chunk) controller.abort()
      return answer as Awaited<ReturnType<WorkerClient['claim']>>
    })
    Object.assign(client, {
      liveClaim: vi.fn(async (_hello, signal: AbortSignal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { game: null }
      }),
    })
    await new Worker(config, client, silent).loop(controller.signal)
    // The engine cannot exit 0 without writing it: the chunk goes back as this worker's problem, not an attempt.
    expect(calls.failures).toEqual([{ chunkId: 7, error: expect.stringContaining('sin resultado'), cause: 'worker' }])
    expect(calls.results.map(({ chunkId }) => chunkId)).toEqual([8])
  })

  it('two lost results in a row pause the claims, so another worker plays the chunk (the S25, 12/10/2026)', async () => {
    const { client, calls } = fakeClient([
      chunk({ games: 96 }),
      chunk({ chunkId: 8, games: 96 }),
      chunk({ chunkId: 9 }),
    ])
    const controller = new AbortController()
    const original = vi.mocked(client.claim).getMockImplementation()
    const claimedAt: number[] = []
    vi.mocked(client.claim).mockImplementation(async (hello, signal) => {
      claimedAt.push(Date.now())
      const answer = await original?.(hello, signal)
      if (!answer?.chunk) controller.abort()
      return answer as Awaited<ReturnType<WorkerClient['claim']>>
    })
    Object.assign(client, {
      liveClaim: vi.fn(async (_hello, signal: AbortSignal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { game: null }
      }),
    })
    const log = vi.fn()
    const worker = new Worker(config, client, log)
    worker.lostResultsPauseMs = 400
    await worker.loop(controller.signal)
    expect(calls.failures.map(({ chunkId, cause }) => [chunkId, cause])).toEqual([
      [7, 'worker'],
      [8, 'worker'],
    ])
    // The second return says until when it pauses, so the app shows it; the first one does not pause.
    expect(calls.failures[0]?.pausedUntil).toBeUndefined()
    const until = Date.parse(calls.failures[1]?.pausedUntil ?? '')
    expect(until - (claimedAt[1] ?? 0)).toBeGreaterThanOrEqual(350)
    expect(until - (claimedAt[1] ?? 0)).toBeLessThan(5_000)
    expect(calls.results.map(({ chunkId }) => chunkId)).toEqual([9])
    expect(log).toHaveBeenCalledWith(
      'el motor perdió resultados varias veces seguidas: no tomo trabajo por un rato',
      expect.objectContaining({ inARow: 2 }),
    )
    // The third claim waited for the pause; the first lost result alone did not pause.
    expect((claimedAt[2] ?? 0) - (claimedAt[1] ?? 0)).toBeGreaterThanOrEqual(350)
    // A restart keeps it: the pause is in state.json (review of #72).
    expect(JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8')).pausedUntil).toBe(
      calls.failures[1]?.pausedUntil,
    )
  })

  /** Plays `chunks` until the queue is empty: what was reported, when each claim went and what was logged. */
  async function lossRun(chunks: Chunk[]) {
    const { client, calls } = fakeClient(chunks)
    const controller = new AbortController()
    const original = vi.mocked(client.claim).getMockImplementation()
    const claimedAt: number[] = []
    vi.mocked(client.claim).mockImplementation(async (hello, signal) => {
      claimedAt.push(Date.now())
      const answer = await original?.(hello, signal)
      if (!answer?.chunk) controller.abort()
      return answer as Awaited<ReturnType<WorkerClient['claim']>>
    })
    Object.assign(client, {
      liveClaim: vi.fn(async (_hello, signal: AbortSignal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { game: null }
      }),
    })
    const log = vi.fn()
    const worker = new Worker(config, client, log)
    worker.lostResultsPauseMs = 400
    await worker.loop(controller.signal)
    const paused = log.mock.calls.some(([message]) => String(message).startsWith('el motor perdió resultados'))
    const resumes = log.mock.calls.filter(([message]) =>
      String(message).startsWith('el motor se cortó antes de terminar'),
    ).length
    return { calls, claimedAt, paused, resumes }
  }

  it('the same chunk lost twice does not pause (it may be that chunk; the app gives it to this worker last)', async () => {
    const run = await lossRun([chunk({ games: 96 }), chunk({ games: 96 }), chunk({ chunkId: 9 })])
    expect(run.calls.failures.map(({ chunkId }) => chunkId)).toEqual([7, 7])
    expect(run.paused).toBe(false)
    expect(run.calls.failures.every((failure) => failure.pausedUntil === undefined)).toBe(true)
  })

  it('a chunk played resets the losses; an engine error in between does not (review of #72)', async () => {
    // Lost, played, lost: no pause.
    const reset = await lossRun([chunk({ games: 96 }), chunk({ chunkId: 8 }), chunk({ chunkId: 9, games: 96 })])
    expect(reset.calls.results.map(({ chunkId }) => chunkId)).toEqual([8])
    expect(reset.paused).toBe(false)
    // Lost, an engine error (a deck it refuses), lost: it pauses, as the error says nothing of a long run's end.
    rmSync(join(dataDir, 'state.json'), { force: true })
    const error = await lossRun([
      chunk({ games: 96 }),
      chunk({ chunkId: 8, games: 13 }),
      chunk({ chunkId: 9, games: 96 }),
      chunk({ chunkId: 10 }),
    ])
    expect(error.calls.failures.map(({ chunkId, cause }) => [chunkId, cause ?? 'engine'])).toEqual([
      [7, 'worker'],
      [8, 'engine'],
      [9, 'worker'],
    ])
    expect(error.paused).toBe(true)
  })

  it('with an engine that resumes, a chunk cut before its end goes on from its checkpoint (B of H-054)', async () => {
    vi.stubEnv('FAKE_ENGINE_RESUME', '1')
    try {
      // Cut once: the next run finds the checkpoint and plays to the end. Nothing goes back, nothing pauses.
      const resumed = await lossRun([chunk({ games: 89 }), chunk({ chunkId: 9 })])
      expect(resumed.calls.results.map(({ chunkId, body }) => [chunkId, body.games])).toEqual([
        [7, 89],
        [9, 10],
      ])
      expect(resumed.calls.failures).toEqual([])
      expect(resumed.paused).toBe(false)
      expect(resumed.resumes).toBe(1)
      // Cut every time: after MAX_RESUMES resumes it goes back, as before.
      rmSync(join(dataDir, 'state.json'), { force: true })
      const cut = await lossRun([chunk({ games: 88 }), chunk({ chunkId: 9 })])
      expect(cut.calls.failures.map(({ chunkId, cause }) => [chunkId, cause])).toEqual([[7, 'worker']])
      expect(cut.calls.results.map(({ chunkId }) => chunkId)).toEqual([9])
      expect(cut.resumes).toBe(5)
      // Its folder gone between two runs: nothing to resume on; it goes back as a lost result and the loop goes on.
      rmSync(join(dataDir, 'state.json'), { force: true })
      const gone = await lossRun([chunk({ games: 87 }), chunk({ chunkId: 9 })])
      expect(gone.calls.failures.map(({ chunkId, cause }) => [chunkId, cause])).toEqual([[7, 'worker']])
      expect(gone.calls.results.map(({ chunkId }) => chunkId)).toEqual([9])
      expect(gone.resumes).toBe(0)
      // Nothing left behind: every chunk's folder went with it.
      expect(readdirSync(join(dataDir, 'work'))).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  }, 30_000)

  it('an engine without resume returns a cut chunk at once, as before', async () => {
    const run = await lossRun([chunk({ games: 92 }), chunk({ chunkId: 9 })])
    expect(run.calls.failures.map(({ chunkId, cause }) => [chunkId, cause])).toEqual([[7, 'worker']])
    expect(run.resumes).toBe(0)
  })

  it('a clock set back never stretches a pause past the longest one; the claim says the platform (0.3.5)', async () => {
    const { client, calls } = fakeClient([chunk({ chunkId: 9 })])
    const controller = new AbortController()
    const original = vi.mocked(client.claim).getMockImplementation()
    const hellos: Record<string, unknown>[] = []
    vi.mocked(client.claim).mockImplementation(async (hello, signal) => {
      hellos.push(hello as unknown as Record<string, unknown>)
      const answer = await original?.(hello, signal)
      if (!answer?.chunk) controller.abort()
      return answer as Awaited<ReturnType<WorkerClient['claim']>>
    })
    Object.assign(client, {
      liveClaim: vi.fn(async (_hello, signal: AbortSignal) => {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { game: null }
      }),
    })
    const worker = new Worker(config, client, silent)
    worker.lostResultsPauseMaxMs = 300
    // As if the clock went back an hour after the pause was taken.
    Object.assign(worker, { pausedUntil: Date.now() + 60 * 60_000 })
    const started = Date.now()
    await worker.loop(controller.signal)
    expect(calls.results.map(({ chunkId }) => chunkId)).toEqual([9])
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(hellos[0]).toMatchObject({ platform: process.platform })
  })

  it('a pause saved before a restart still holds', async () => {
    const until = new Date(Date.now() + 400).toISOString()
    writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ pausedUntil: until }))
    const started = Date.now()
    const run = await lossRun([chunk({ chunkId: 9 })])
    expect(run.calls.results.map(({ chunkId }) => chunkId)).toEqual([9])
    expect((run.claimedAt[0] ?? 0) - started).toBeGreaterThanOrEqual(350)
  })

  it('a starting worker never cleans the work folder of another live process (the S25, 12/10/2026)', async () => {
    const { client } = fakeClient([])
    const worker = new Worker(config, client, silent)
    const work = join(dataDir, 'work')
    const dead = spawnSync(process.execPath, ['-e', '']).pid
    const day = 24 * 60 * 60
    const age = (name: string, seconds: number) => {
      const when = Date.now() / 1000 - seconds
      utimesSync(join(work, name), when, when)
    }
    for (const name of [
      `simulate-${process.ppid}-aaaaaa`,
      `simulate-${process.ppid}-oldold`,
      `simulate-${dead}-bbbbbb`,
      `batch-${process.pid}-cccccc`,
      'simulate-dddddd',
      'orphan-from-crash',
    ]) {
      mkdirSync(join(work, name))
    }
    age(`simulate-${process.ppid}-oldold`, day + 60)
    age('orphan-from-crash', day + 60)
    await worker.cleanWorkDir()
    // Kept: a live process's own (its engine may still write result.json there) and one from before 0.3.4, not a day old.
    expect(readdirSync(work).sort()).toEqual([`simulate-${process.ppid}-aaaaaa`, 'simulate-dddddd'].sort())
  })

  it('keeps playing across heartbeat failures and renews even after the local lease expires', async () => {
    const { client, calls } = fakeClient([chunk({ games: 99, leaseUntil: new Date(0).toISOString() })])
    const controller = new AbortController()
    vi.mocked(client.heartbeat)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        leaseUntil: new Date(Date.now() + 180_000).toISOString(),
        cancelled: false,
        lost: false,
      })
      .mockImplementationOnce(async () => {
        controller.abort()
        return { leaseUntil: null, cancelled: false, lost: false }
      })
    const log = vi.fn()
    const worker = new Worker(config, client, log)
    worker.heartbeatMs = 50
    await worker.loop(controller.signal, { once: true })
    expect(client.heartbeat).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledWith('latido fallido', expect.any(Object))
    expect(log).toHaveBeenCalledWith('latido recuperado', expect.objectContaining({ chunk: 7 }))
    expect(calls.failures).toEqual([])
    expect(readdirSync(join(dataDir, 'work'))).toEqual([])
  })

  it('cleanup preserves a running simulation, a live game, and a result awaiting upload', async () => {
    const { client } = fakeClient([])
    const worker = new Worker(config, client, silent)
    const controller = new AbortController()
    let ready!: () => void
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const simulation = runJob(FAKE_ENGINE, 'simulate', { games: 99 }, join(dataDir, 'work'), {
      signal: controller.signal,
      onProgress: ready,
    }).catch((error: unknown) => error)
    await started
    let release!: () => void
    let decide!: () => void
    const waiting = new Promise<void>((resolve) => {
      decide = resolve
    })
    const live = {
      liveDecision: vi.fn(async () => {
        decide()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { choice: null, status: 'abandoned' }
      }),
    } as unknown as WorkerClient
    const gameRun = new LiveRunner(config, live, silent, join(dataDir, 'work')).run(
      {
        id: 1,
        deckHuman: 'x',
        deckBot: 'y',
        bot: 'e2',
        seed: '1',
        choices: [],
      },
      controller.signal,
    )
    await waiting
    try {
      const pending = await worker.play(chunk(), REV, controller.signal)
      expect(pending).not.toBeNull()
      writeFileSync(join(dataDir, 'state.json'), JSON.stringify({ pending }))
      const before = readdirSync(join(dataDir, 'work'))
      // Each folder says whose it is (worker 0.3.4 on).
      expect(before.map(workDirOwner)).toEqual(before.map(() => process.pid))
      mkdirSync(join(dataDir, 'work', 'orphan-from-crash'))
      // A crash's leftover from before 0.3.4 (no owner) goes once it is a day old.
      const old = Date.now() / 1000 - 25 * 60 * 60
      utimesSync(join(dataDir, 'work', 'orphan-from-crash'), old, old)
      await worker.cleanWorkDir()
      expect(readdirSync(join(dataDir, 'work'))).toEqual(before)
    } finally {
      release()
      await gameRun
      controller.abort()
      await simulation
    }
    await worker.flushPending()
  })

  it.each(['below_normal', 'normal', 'idle'] as const)('passes configured %s priority to chunks', async (priority) => {
    const { client, calls } = fakeClient([chunk({ kind: 'explore' })])
    await new Worker({ ...config, priority }, client, silent).loop(new AbortController().signal, { once: true })
    expect(calls.results).toHaveLength(1)
    const expected = {
      below_normal: constants.priority.PRIORITY_BELOW_NORMAL,
      normal: constants.priority.PRIORITY_NORMAL,
      idle: constants.priority.PRIORITY_LOW,
    }
    expect(setPriority).toHaveBeenLastCalledWith(expect.any(Number), expected[priority])
  })

  it('logs a priority permission failure and still reports the completed chunk', async () => {
    vi.mocked(setPriority).mockImplementation((_pid, priority) => {
      if (priority !== constants.priority.PRIORITY_NORMAL) throw new Error('EPERM')
    })
    const log = vi.fn()
    const { client, calls } = fakeClient([chunk()])
    await new Worker(config, client, log).loop(new AbortController().signal, { once: true })
    expect(calls.failures).toEqual([])
    expect(calls.results).toHaveLength(1)
    expect(
      log.mock.calls.find(([message]) => message.startsWith('no se pudo cambiar la prioridad'))?.[1],
    ).toMatchObject({
      priority: 'below_normal',
      error: 'Error: EPERM',
    })
  })

  it('plays a chunk, reports the result and uploads the replays gzipped', async () => {
    const { client, calls } = fakeClient([chunk()])
    const worker = new Worker(config, client, silent)
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.status).toEqual([REV])
    expect(calls.results).toHaveLength(1)
    expect(calls.results[0]?.body).toMatchObject({ workerId: 'worker-test-1', winsA: 5, winsB: 5, games: 10 })
    // Phase 42: the engine that played it, with its build fingerprint, for the API's exact cache.
    expect(calls.results[0]?.body.cliVersion).toBe('0.1.0-fake+0123456789abcdef')
    // An engine that does not say how it plays: the API derives it from cliVersion.
    expect(calls.results[0]?.body).not.toHaveProperty('gamesRev')
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

  it.each([false, true])('sends allowSlowBots=%s in the claim hello (D-025)', async (allowSlowBots) => {
    const { client } = fakeClient([])
    await new Worker({ ...config, allowSlowBots }, client, silent).loop(new AbortController().signal, { once: true })
    expect(vi.mocked(client.claim).mock.calls[0]?.[0]).toMatchObject({ allowSlowBots })
  })

  it('phase 42: says how its engine plays (gamesRev) in the claim and in each result', async () => {
    process.env.FAKE_ENGINE_GAMES_REV = '3'
    try {
      const { client, calls } = fakeClient([chunk({ chunkId: 43, replaySample: 0 })])
      await new Worker(config, client, silent).loop(new AbortController().signal, { once: true })
      expect(vi.mocked(client.claim).mock.calls[0]?.[0]).toMatchObject({ gamesRev: 3 })
      expect(calls.results[0]?.body).toMatchObject({ gamesRev: 3 })
    } finally {
      delete process.env.FAKE_ENGINE_GAMES_REV
    }
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

  it('B2: a network failure retries the renewal cycle and keeps the shared engine running', async () => {
    const { client, calls } = batchClient([
      chunk({ chunkId: 51, games: 97, replaySample: 0 }),
      chunk({ chunkId: 52, games: 10, replaySample: 0 }),
    ])
    vi.mocked(client.heartbeat).mockRejectedValueOnce(new TypeError('fetch failed'))
    const worker = new Worker(config, client, silent)
    worker.heartbeatMs = 50
    await worker.loop(new AbortController().signal, { once: true })
    expect(calls.results.map(({ chunkId }) => chunkId)).toEqual([51, 52])
    expect(calls.failures).toEqual([])
    expect(vi.mocked(client.heartbeat).mock.calls.some(([id]) => id === 52)).toBe(true)
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
    'B2: a cancelled job stops the batch; a lost chunk stops the batch and only the remaining chunk is replayed',
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
        leaseUntil: chunkId === 43 ? null : new Date(Date.now() + 180_000).toISOString(),
        cancelled: false,
        lost: chunkId === 43,
      }))
      const watched = new Worker(config, second.client, silent)
      watched.heartbeatMs = 50
      await watched.loop(new AbortController().signal, { once: true })
      const beats = (id: number) =>
        vi.mocked(second.client.heartbeat).mock.calls.filter((call) => call[0] === id).length
      expect(beats(43)).toBe(1)
      expect(beats(44)).toBeGreaterThan(0)
      expect(second.calls.results.map((call) => call.chunkId)).toEqual([44])
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
      priority: 'below_normal',
      allowSlowBots: true,
      name: 'test',
      enginePath: FAKE_ENGINE,
      dataDir,
      workerId: 'worker-test-1',
      autoUpdate: false,
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

  it('a live game that fails tells why, not the engine’s «fin» line (review of the diagnosis)', async () => {
    const { client } = liveClient([1, 1])
    // The error is what the loop sends as the game's failure (and the owner reads).
    await expect(
      new LiveRunner(config, client, silent, dataDir).run({ ...game(), seed: '404' }, new AbortController().signal),
    ).rejects.toThrow(/^engine-cli play terminó con código 2 sin terminar la partida$/)
  })

  it.each([false, true])('requests normal priority for interactive play, coach=%s', async (coach) => {
    const { client, calls } = liveClient([1, 1])
    await new LiveRunner({ ...config, priority: 'idle' }, client, silent, dataDir).run(
      { ...game(), coach },
      new AbortController().signal,
    )
    expect(calls.end?.winner).toBe('you')
    expect(setPriority).toHaveBeenCalledExactlyOnceWith(expect.any(Number), constants.priority.PRIORITY_NORMAL)
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

  it('finishes the end and replay uploads when shutdown arrives after the server commits the end', async () => {
    const { client, calls } = liveClient([1, 1])
    const controller = new AbortController()
    const end = vi.mocked(client.liveEnd).getMockImplementation()
    if (!end) throw new Error('missing end double')
    vi.spyOn(client, 'liveEnd').mockImplementation(async (id, body, signal) => {
      await end(id, body)
      controller.abort(new Error('SIGTERM'))
      if (signal?.aborted) throw signal.reason
      return { ok: true }
    })
    const replay = vi.mocked(client.liveReplay).getMockImplementation()
    if (!replay) throw new Error('missing replay double')
    vi.spyOn(client, 'liveReplay').mockImplementation(async (id, workerId, data, signal) => {
      if (signal?.aborted) throw signal.reason
      return replay(id, workerId, data)
    })
    await new LiveRunner(config, client, silent, dataDir).run(game(), controller.signal)
    expect(calls.end?.winner).toBe('you')
    expect(calls.replay).toMatchObject({ choices: [1, 1] })
    expect(readdirSync(dataDir)).toEqual([])
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
  it.each(['claim', 'liveClaim'] as const)('retries the Android version preflight timeout for %s', async (method) => {
    vi.useFakeTimers()
    try {
      const version = { engineRev: REV, cliVersion: '0.3.3' }
      const log = vi.fn()
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
        .mockResolvedValueOnce(Response.json(version))
        .mockResolvedValueOnce(Response.json({ chunk: null, game: null, retryAfterSeconds: 0 }))
      const client = new WorkerClient('http://test', 'tcg_wk_x', log, fetchImpl)
      client.requiredEngine = version
      const pending = client[method]({
        workerId: 'worker-test',
        engineRev: REV,
        name: 'android',
        cores: 4,
        cliVersion: '0.3.3',
        version: WORKER_VERSION,
      })
      void pending.catch(() => undefined)
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toMatchObject({ game: null })
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      if (method === 'liveClaim') expect(log).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // node:timers/promises uses real timers here: three retries wait 1 + 2 + 4 seconds.
  it('live long-poll retries timeout, disconnect and 503 quietly, then returns the game', async () => {
    vi.useFakeTimers()
    try {
      const log = vi.fn()
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValueOnce(Response.json({ game: { id: 2 } }))
      const client = new WorkerClient('http://test', 'tcg_wk_x', log, fetchImpl)
      const pending = client.liveClaim({ workerId: 'worker-test', engineRev: REV, version: WORKER_VERSION })
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toEqual({ game: { id: 2 } })
      expect(log).not.toHaveBeenCalled()
      expect(fetchImpl).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('a changed Android engine still stops claims with 409 instead of retrying', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ engineRev: REV, cliVersion: 'new' }))
    const client = new WorkerClient('http://test', 'tcg_wk_x', silent, fetchImpl)
    client.requiredEngine = { engineRev: REV, cliVersion: 'old' }
    await expect(
      client.liveClaim({ workerId: 'worker-test', engineRev: REV, version: WORKER_VERSION }),
    ).rejects.toMatchObject({ status: 409 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

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

describe('self-update in the loop (D-026)', () => {
  let dataDir: string
  let config: WorkerConfig
  const READY: ReadyRelease = { engineRev: REV, cliVersion: '0.1.0-fake', sha256: 'e'.repeat(64), size: 10 }
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'tcg-worker-update-'))
    config = {
      server: 'http://test',
      token: 'tcg_wk_test',
      cores: 2,
      priority: 'below_normal',
      allowSlowBots: true,
      name: 'test',
      enginePath: FAKE_ENGINE,
      dataDir,
      workerId: 'worker-test-1',
      autoUpdate: true,
    }
  })
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

  /** What the loop uses of an Updater: `ready`, `check`, `intervalMs` and `retryInMs`. */
  function fakeUpdater(check: (updater: { ready: ReadyRelease | null }) => ReadyRelease | null = () => null) {
    const updater = { ready: null as ReadyRelease | null, intervalMs: 3_600_000, check: vi.fn(), retryInMs: () => 0 }
    updater.check.mockImplementation(async () => check(updater))
    return updater
  }

  it('finishes and uploads the chunk in progress, then stops claiming once a release is ready', async () => {
    const { client, calls } = fakeClient([chunk(), chunk({ chunkId: 8 })])
    const updater = fakeUpdater()
    vi.mocked(client.result).mockImplementationOnce(async (chunkId, body) => {
      // The release gets ready while chunk 7 is being reported.
      updater.ready = READY
      calls.results.push({ chunkId, body })
      return { accepted: true }
    })
    const onReady = vi.fn()
    const outcome = await new Worker(config, client, silent).loop(new AbortController().signal, {
      updater: updater as unknown as Updater,
      onReady,
    })
    expect(outcome).toBe('update')
    expect(onReady).toHaveBeenCalledOnce()
    expect(client.claim).toHaveBeenCalledOnce()
    expect(calls.results.map((call) => call.chunkId)).toEqual([7])
  })

  it('cuts a waiting claim short when the periodic check finds a release', async () => {
    const { client } = fakeClient([])
    vi.mocked(client.claim).mockImplementation(
      (_hello, signal) =>
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))),
    )
    let checks = 0
    const updater = fakeUpdater((self) => {
      checks++
      if (checks < 2) return null
      self.ready = READY
      return READY
    })
    updater.intervalMs = 10
    const outcome = await new Worker(config, client, silent).loop(new AbortController().signal, {
      updater: updater as unknown as Updater,
    })
    expect(outcome).toBe('update')
    expect(checks).toBe(2)
  })

  it("Android's engine gate (409) looks for the package instead of stopping the worker", async () => {
    const { client } = fakeClient([])
    vi.mocked(client.claim).mockRejectedValueOnce(new ApiError('Cambió el motor del servidor.', 409))
    const updater = fakeUpdater((self) => {
      self.ready = READY
      return READY
    })
    const outcome = await new Worker(config, client, silent).loop(new AbortController().signal, {
      updater: updater as unknown as Updater,
    })
    expect(outcome).toBe('update')
    expect(updater.check).toHaveBeenCalledOnce()
    // Without an updater the same answer stops it, as before.
    vi.mocked(client.claim).mockRejectedValueOnce(new ApiError('Cambió el motor del servidor.', 409))
    await expect(new Worker(config, client, silent).loop(new AbortController().signal)).rejects.toThrow(
      'Cambió el motor',
    )
  })

  it('a drained bot runner plays the game in progress to its end and claims no other', async () => {
    let runner: LiveRunner | null = null
    const live = {
      liveClaim: vi.fn(async (_body: unknown, signal?: AbortSignal) => {
        if (live.liveClaim.mock.calls.length === 1) {
          return {
            game: {
              id: 5,
              deckHuman: 'Energy: Grass\n2 Bulbasaur A1 1\n',
              deckBot: 'Energy: Fire\n2 Charmander A1 33\n',
              bot: 'e2',
              seed: '42',
              choices: [],
            },
          }
        }
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)))
      }),
      liveDecision: vi.fn(async () => {
        // A new release got ready mid-game.
        runner?.drain()
        return { choice: 1, status: 'running' }
      }),
      liveChoice: vi.fn(),
      liveEnd: vi.fn(async () => ({ ok: true })),
      liveReplay: vi.fn(async () => ({ ok: true })),
      liveFailure: vi.fn(async () => ({ ok: true })),
    }
    runner = new LiveRunner(config, live as unknown as WorkerClient, silent, dataDir)
    await runner.start(REV, new AbortController().signal)
    expect(live.liveEnd).toHaveBeenCalledOnce()
    expect(live.liveClaim).toHaveBeenCalledOnce()
  })
})
