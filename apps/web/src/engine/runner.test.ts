import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { EngineError, type GameEngine } from './browserEngine'
import type { EngineJob, EngineStep } from './protocol'
import { type BrowserJob, type BrowserStep, type RunnerApi, type RunnerStatus, runBrowserGame } from './runner'

const REV = 'a'.repeat(40)

/** A stand-in engine: `decisions` decisions of two options each, then the end; the coach scores by ply. */
class FakeEngine implements GameEngine {
  started: EngineJob | null = null
  ply = 0
  choices: number[] = []
  restored: number[][] = []
  disposed = false
  private readonly decisions: number
  private readonly rev: string
  constructor(decisions = 3, rev = REV) {
    this.decisions = decisions
    this.rev = rev
  }
  async info() {
    return { engineRev: this.rev, version: '0.1.0' }
  }
  async start(job: EngineJob) {
    this.started = job
    this.ply = 0
    this.choices = []
    return {}
  }
  private step(): EngineStep {
    const log = [{ turn: this.ply, actor: 1, text: `bot ${this.ply}` }]
    if (this.ply >= this.decisions) {
      return { type: 'end', winner: 'you', turns: 7, state: { end: true }, log }
    }
    this.ply += 1
    return {
      type: 'decide',
      ply: this.ply,
      turn: this.ply,
      state: { ply: this.ply },
      actions: [
        { i: 0, text: 'EndTurn', action: 'EndTurn' },
        { i: 1, text: 'Attack', action: 'Attack' },
      ],
      log,
    }
  }
  async advance(choice?: number) {
    if (choice !== undefined) {
      if (choice > 1) throw new EngineError('elegí un número de 0 a 1', false)
      this.choices.push(choice)
    }
    return this.step()
  }
  async coach() {
    return { scores: [this.ply, 10], best: 1, values: [this.ply + 0.04, 10.01] }
  }
  async restoreCoach(values: number[]) {
    this.restored.push(values)
  }
  async replay() {
    return new Blob(['gz'])
  }
  dispose() {
    this.disposed = true
  }
}

/** A server keeping a browser game's choices, as LiveGamesService does (without the database). */
function fakeServer(initial: Partial<BrowserJob> = {}) {
  const game = {
    status: 'running',
    choices: [] as number[],
    coach: false,
    replay: null as Blob | null,
    ...initial,
  }
  /** Choices the owner makes when asked, in order. */
  const owner: number[] = []
  const prefix = (choices: number[]) => choices.every((choice, i) => game.choices[i] === choice)
  const api = {
    job: vi.fn<RunnerApi['job']>(
      async (id): Promise<BrowserJob> => ({
        id,
        deckHuman: 'Energy: Grass',
        deckBot: 'Energy: Fire',
        bot: 'e2',
        seed: '77',
        choices: [...game.choices],
        coach: game.coach,
        status: game.status,
        engineRev: REV,
        replayMissing: game.status === 'done' && game.replay === null,
      }),
    ),
    decision: vi.fn<RunnerApi['decision']>(async (_id, body): Promise<BrowserStep> => {
      if (game.status !== 'running' && game.status !== 'waiting') return { choice: null, status: game.status }
      if (!prefix(body.choices)) return { choice: null, status: 'restart' }
      const made = game.choices[body.ply - 1]
      if (made !== undefined) return { choice: made, status: game.status }
      game.status = 'waiting'
      return { choice: null, status: 'waiting' }
    }),
    choice: vi.fn<RunnerApi['choice']>(async (_id, body): Promise<BrowserStep> => {
      if (!prefix(body.choices)) return { choice: null, status: 'restart' }
      const next = owner.shift()
      if (next !== undefined && game.choices.length === body.ply - 1) {
        game.choices.push(next)
        game.status = 'running'
      }
      return { choice: game.choices[body.ply - 1] ?? null, status: game.status }
    }),
    end: vi.fn<RunnerApi['end']>(async (_id, body) => {
      if (body.choices.join('.') !== game.choices.join('.')) {
        throw new ApiError(409, 'stale_decision', 'La partida cambió: recargala.')
      }
      game.status = 'done'
      return { status: 'done' }
    }),
    failure: vi.fn<RunnerApi['failure']>(async () => {
      game.status = 'failed'
      return { ok: true }
    }),
    replay: vi.fn<RunnerApi['replay']>(async (_id, _choices, gzipped) => {
      game.replay = gzipped
      return { ok: true }
    }),
  } satisfies RunnerApi
  return { game, owner, api }
}

function run(api: RunnerApi, engine: GameEngine, extra: Partial<Parameters<typeof runBrowserGame>[0]> = {}) {
  const statuses: RunnerStatus['kind'][] = []
  const result = runBrowserGame({
    id: 5,
    engineRev: REV,
    api,
    createEngine: () => engine,
    signal: new AbortController().signal,
    onStatus: (status) => statuses.push(status.kind),
    sleep: async () => undefined,
    ...extra,
  })
  return { result, statuses }
}

describe('the browser runner (T-015)', () => {
  it('plays a whole game: each decision to the server, the owner’s choice back, then the end and the replay', async () => {
    const { game, owner, api } = fakeServer()
    owner.push(1, 0, 1)
    const engine = new FakeEngine()
    const { result, statuses } = run(api, engine)
    expect(await result).toEqual({ kind: 'over', status: 'done' })
    expect(engine.started).toMatchObject({ seed: '77', bot: 'e2' })
    expect(engine.choices).toEqual([1, 0, 1])
    expect(api.decision.mock.calls.map(([, body]) => [body.ply, body.choices])).toEqual([
      [1, []],
      [2, [1]],
      [3, [1, 0]],
    ])
    // The log goes along with each decision and at the end, as a worker sends it.
    expect(api.decision.mock.calls[2]?.[1].log).toHaveLength(3)
    expect(api.end.mock.calls[0]?.[1]).toMatchObject({ choices: [1, 0, 1], winner: 'you', turns: 7 })
    expect(api.end.mock.calls[0]?.[1].log).toHaveLength(4)
    expect(api.replay).toHaveBeenCalledWith(5, [1, 0, 1], expect.any(Blob), expect.any(AbortSignal))
    expect(game.status).toBe('done')
    expect(statuses).toEqual(expect.arrayContaining(['loading', 'thinking', 'waiting']))
    expect(engine.disposed).toBe(true)
  })

  it('rebuilds the game from the server’s choices without asking them again', async () => {
    const { owner, api } = fakeServer({ choices: [1, 0], status: 'waiting' })
    owner.push(0)
    const engine = new FakeEngine()
    expect(await run(api, engine).result).toEqual({ kind: 'over', status: 'done' })
    expect(engine.choices).toEqual([1, 0, 0])
    expect(api.decision.mock.calls.map(([, body]) => body.ply)).toEqual([3])
  })

  it('starts again from the server’s choices after an undo («restart»)', async () => {
    const { game, owner, api } = fakeServer()
    const engine = new FakeEngine()
    // After the first choice, the owner goes back to it from another page: the next wait says «restart».
    api.choice.mockImplementationOnce(async () => {
      game.choices = [1]
      game.status = 'running'
      return { choice: 1, status: 'running' }
    })
    api.choice.mockImplementationOnce(async () => {
      game.choices = []
      game.status = 'running'
      return { choice: null, status: 'restart' }
    })
    owner.push(0, 1, 0)
    expect(await run(api, engine).result).toEqual({ kind: 'over', status: 'done' })
    expect(api.job).toHaveBeenCalledTimes(2)
    expect(engine.choices).toEqual([0, 1, 0])
    expect(api.end.mock.calls[0]?.[1].choices).toEqual(game.choices)
  })

  it('sends the coach’s values and keeps them for a rebuild', async () => {
    const { game, owner, api } = fakeServer({ coach: true })
    owner.push(1, 1, 1)
    const cache = new Map<string, number[]>()
    const engine = new FakeEngine()
    const first = run(api, engine, { coachCache: cache })
    expect(await first.result).toEqual({ kind: 'over', status: 'done' })
    expect(api.decision.mock.calls[0]?.[1].coach).toEqual({ scores: [1, 10], best: 1 })
    expect(first.statuses).toContain('coach')
    expect(cache.get('5:1')).toEqual([2.04, 10.01])

    // The replay did not arrive: the page plays the game again to the end, restoring the values instead of scoring.
    game.replay = null
    const again = new FakeEngine()
    const coach = vi.spyOn(again, 'coach')
    expect(await run(api, again, { coachCache: cache }).result).toEqual({ kind: 'over', status: 'done' })
    expect(again.restored).toEqual([
      [1.04, 10.01],
      [2.04, 10.01],
      [3.04, 10.01],
    ])
    expect(coach).not.toHaveBeenCalled()
    expect(api.end).toHaveBeenCalledTimes(1)
    expect(api.replay).toHaveBeenCalledTimes(2)
  })

  it('tries again while the server cannot be reached', async () => {
    const { owner, api } = fakeServer()
    owner.push(0, 0, 0)
    api.decision.mockRejectedValueOnce(new ApiError(0, 'network', 'Sin conexión con el servidor.'))
    api.decision.mockRejectedValueOnce(new ApiError(503, 'http_503', 'El servidor falló.'))
    const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => undefined)
    const { result, statuses } = run(api, new FakeEngine(), { sleep })
    expect(await result).toEqual({ kind: 'over', status: 'done' })
    expect(statuses.filter((kind) => kind === 'offline')).toHaveLength(2)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000])
  })

  it('fails the game when the engine rejects a choice the server kept (another engine)', async () => {
    const { api } = fakeServer({ choices: [1, 5], status: 'waiting' })
    expect(await run(api, new FakeEngine()).result).toEqual({ kind: 'over', status: 'failed' })
    expect(api.failure).toHaveBeenCalledWith(
      5,
      { choices: [1, 5], error: 'El motor rechazó la jugada 2: elegí un número de 0 a 1' },
      expect.any(AbortSignal),
    )
  })

  it('leaves the game as it is when the engine is another one or does not load', async () => {
    const { api } = fakeServer()
    const other = run(api, new FakeEngine(3, 'b'.repeat(40)))
    expect(await other.result).toMatchObject({ kind: 'error', message: expect.stringContaining('recargá la app') })
    expect(other.statuses).toContain('error')
    const broken = new FakeEngine()
    vi.spyOn(broken, 'info').mockRejectedValue(new EngineError('sin red', true))
    expect(await run(api, broken).result).toMatchObject({
      kind: 'error',
      message: 'No se pudo cargar el motor en este dispositivo: sin red',
    })
    expect(api.failure).not.toHaveBeenCalled()
  })

  it('does nothing for a game already over, and stops when the page closes', async () => {
    const over = fakeServer({ status: 'abandoned' })
    const create = vi.fn(() => new FakeEngine())
    expect(await run(over.api, new FakeEngine(), { createEngine: create }).result).toEqual({
      kind: 'over',
      status: 'abandoned',
    })
    expect(create).not.toHaveBeenCalled()

    const { api } = fakeServer()
    const controller = new AbortController()
    api.choice.mockImplementation(async (_id, _body, signal) => {
      controller.abort()
      throw signal.reason ?? new DOMException('aborted', 'AbortError')
    })
    const engine = new FakeEngine()
    expect(await run(api, engine, { signal: controller.signal }).result).toEqual({ kind: 'stopped' })
    expect(engine.disposed).toBe(true)
  })
})
