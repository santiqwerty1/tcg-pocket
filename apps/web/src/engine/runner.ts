/**
 * T-015: runs a «browser» game from its open page, as the worker's LiveRunner (apps/worker/src/live.ts) runs one on a
 * PC: the engine plays the bot's moves, each of the owner's decisions goes to the server, the owner's choice comes
 * back (long-poll) and the engine goes on; at the end, the result and the replay. The game is its seed and the
 * owner's choices: the page rebuilds it from the server's choices when it opens, after an undo («restart») or after
 * the engine of another page went ahead. Network cuts are retried; only the engine's own errors fail the game.
 */
import { ApiError } from '@/api/client'
import type { EngineError, GameEngine } from './browserEngine'
import type { EngineInfo, EngineJob, EngineLogEntry, EngineStep } from './protocol'

/** The server's `POST /api/play/:id/browser`. */
export interface BrowserJob extends EngineJob {
  id: number
  choices: number[]
  status: string
  engineRev: string
  /** A finished game whose replay never arrived: played again to the end to send it. */
  replayMissing: boolean
}

/** The server's answer to a decision or a wait: the owner's choice, or why there is none. */
export interface BrowserStep {
  choice: number | null
  status: string
}

export interface BrowserDecision {
  choices: number[]
  ply: number
  turn: number
  state: Record<string, unknown>
  actions: { i: number; text: string; action: unknown }[]
  log: EngineLogEntry[]
  coach?: { scores: number[]; best: number }
  /** The build of the engine that reached it: the game's own (review of #86). */
  build: string
}

export interface BrowserEnd {
  choices: number[]
  winner: 'you' | 'bot' | 'tie'
  turns: number
  state: Record<string, unknown>
  log: EngineLogEntry[]
  build: string
}

/** The engine this page loaded: its deckgym revision, how its games play and what was compiled. */
export interface PageEngine {
  engineRev: string
  gamesRev: number
  build: string
}

export interface RunnerApi {
  job(id: number, engine: PageEngine, signal: AbortSignal): Promise<BrowserJob>
  decision(id: number, body: BrowserDecision, signal: AbortSignal): Promise<BrowserStep>
  choice(id: number, body: { choices: number[]; ply: number }, signal: AbortSignal): Promise<BrowserStep>
  end(id: number, body: BrowserEnd, signal: AbortSignal): Promise<{ status: string }>
  failure(id: number, body: { choices: number[]; error: string; build: string }, signal: AbortSignal): Promise<unknown>
  replay(id: number, choices: number[], build: string, gzipped: Blob, signal: AbortSignal): Promise<unknown>
}

export type RunnerStatus =
  /** Reading the game and loading the engine. */
  | { kind: 'loading' }
  /** The bot moves (or the engine rebuilds the game up to the last choice). */
  | { kind: 'thinking' }
  /** The coach scores the options of the owner's decision. */
  | { kind: 'coach' }
  /** The owner's turn: the page waits for the choice. */
  | { kind: 'waiting' }
  /** The server cannot be reached: trying again. */
  | { kind: 'offline'; message: string }
  | { kind: 'error'; message: string }

export type RunnerResult =
  /** The game is over (or was over already): its status. */
  | { kind: 'over'; status: string }
  /** The page closed it (the signal aborted). */
  | { kind: 'stopped' }
  /** It cannot run here (another engine, the engine did not load…): the game is left as it is. */
  | { kind: 'error'; message: string }

export interface RunnerOptions {
  id: number
  api: RunnerApi
  createEngine: () => GameEngine
  signal: AbortSignal
  onStatus?: (status: RunnerStatus) => void
  /** The coach's values already computed on this page, by game and choices: a rebuild keeps them in the replay. */
  coachCache?: Map<string, number[]>
  /** How to wait between retries (tests make it instant). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const PLAYING = new Set(['queued', 'running', 'waiting'])
const MAX_RETRY_MS = 15_000
/**
 * A game that keeps going back to its start without anything new (an end the server does not take) is left after this
 * many passes in a row, with a message, instead of looping (review of #86). A choice of the owner or an undo is something
 * new, and never counts.
 */
export const MAX_PASSES = 5

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

function isEngineError(error: unknown): error is EngineError {
  return error instanceof Error && error.name === 'EngineError'
}

/** A choice the server no longer has (an undo from another page, or this page behind): rebuild from its choices. */
function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'stale_decision'
}

/** Transient: no signal, the server restarting, too many requests. */
function isTransient(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)
}

const RESTART = Symbol('restart')

export async function runBrowserGame(options: RunnerOptions): Promise<RunnerResult> {
  const { id, api, signal } = options
  const sleep = options.sleep ?? defaultSleep
  const cache = options.coachCache ?? new Map<string, number[]>()
  const report = (status: RunnerStatus) => {
    if (!signal.aborted) options.onStatus?.(status)
  }
  /** One call to the server, again and again while the failure is transient. */
  async function call<T>(send: () => Promise<T>, then: RunnerStatus): Promise<T> {
    let wait = 1000
    let retried = false
    for (;;) {
      try {
        const result = await send()
        if (retried) report(then)
        return result
      } catch (error) {
        if (signal.aborted || !isTransient(error)) throw error
        retried = true
        report({ kind: 'offline', message: (error as ApiError).message })
        await sleep(wait, signal)
        if (signal.aborted) throw error
        wait = Math.min(wait * 2, MAX_RETRY_MS)
      }
    }
  }

  /** The owner chose something in this pass (it is not stuck). */
  let chose = false

  async function play(engine: GameEngine, job: BrowserJob, build: string): Promise<RunnerResult | typeof RESTART> {
    const applied: number[] = []
    const fail = async (error: EngineError, what: string): Promise<RunnerResult> => {
      await call(() => api.failure(id, { choices: applied, error: `${what}: ${error.message}`, build }, signal), {
        kind: 'thinking',
      })
      return { kind: 'over', status: 'failed' }
    }
    report({ kind: 'thinking' })
    let step: EngineStep
    try {
      await engine.start(job)
      step = await engine.advance()
    } catch (error) {
      if (isEngineError(error)) return fail(error, 'El motor no pudo empezar la partida')
      throw error
    }
    const log: EngineLogEntry[] = []
    for (;;) {
      log.push(...step.log)
      if (step.type === 'end') {
        try {
          if (job.status !== 'done') {
            const body: BrowserEnd = {
              choices: applied,
              winner: step.winner,
              turns: step.turns,
              state: step.state,
              log,
              build,
            }
            const ended = await call(() => api.end(id, body, signal), { kind: 'thinking' })
            if (ended.status !== 'done') {
              return PLAYING.has(ended.status) ? RESTART : { kind: 'over', status: ended.status }
            }
          }
          const replay = await engine.replay()
          await call(() => api.replay(id, applied, build, replay, signal), { kind: 'thinking' })
        } catch (error) {
          if (isStale(error)) return RESTART
          throw error
        }
        return { kind: 'over', status: 'done' }
      }
      const key = `${id}:${applied.join('.')}`
      const cached = job.coach ? cache.get(key) : undefined
      if (cached) await engine.restoreCoach(cached)
      let choice = job.choices[applied.length]
      if (choice === undefined) {
        let coach: BrowserDecision['coach']
        if (job.coach) {
          if (!cached) report({ kind: 'coach' })
          const scored = await engine.coach()
          cache.set(key, scored.values)
          coach = { scores: scored.scores, best: scored.best }
        }
        const decision: BrowserDecision = {
          choices: [...applied],
          ply: step.ply,
          turn: step.turn,
          state: step.state,
          actions: step.actions,
          log: [...log],
          ...(coach ? { coach } : {}),
          build,
        }
        let answer = await call(() => api.decision(id, decision, signal), { kind: 'waiting' })
        while (answer.choice === null) {
          if (answer.status === 'restart') return RESTART
          if (answer.status === 'waiting') {
            report({ kind: 'waiting' })
            const wait = { choices: decision.choices, ply: decision.ply }
            answer = await call(() => api.choice(id, wait, signal), { kind: 'waiting' })
          } else if (answer.status === 'running' || answer.status === 'queued') {
            // The decision went away without a choice (another page rebuilt the game): ask again.
            answer = await call(() => api.decision(id, decision, signal), { kind: 'waiting' })
          } else {
            return { kind: 'over', status: answer.status }
          }
        }
        choice = answer.choice
        chose = true
        report({ kind: 'thinking' })
      }
      applied.push(choice)
      try {
        step = await engine.advance(choice)
      } catch (error) {
        if (isEngineError(error)) return fail(error, `El motor rechazó la jugada ${applied.length}`)
        throw error
      }
    }
  }

  let engine: GameEngine | null = null
  try {
    // The engine first: the server is told the one this page loaded, not the manifest it read (review of #86). Loading
    // is not playing: an engine that does not load leaves the game as it is.
    report({ kind: 'loading' })
    engine = options.createEngine()
    let info: EngineInfo
    try {
      info = await engine.info()
    } catch (error) {
      throw new Error(`No se pudo cargar el motor en este dispositivo: ${(error as Error).message}`)
    }
    const loaded: PageEngine = { engineRev: info.engineRev, gamesRev: info.gamesRev, build: info.build }
    // Passes in a row that went back to the start with nothing new: no choice of the owner, the same choices as before.
    let stuck = 0
    let before: string | null = null
    for (let pass = 0; ; pass++) {
      if (pass > 0) await sleep(200, signal)
      report({ kind: 'loading' })
      const job = await call(() => api.job(id, loaded, signal), { kind: 'loading' })
      if (!PLAYING.has(job.status) && !(job.status === 'done' && job.replayMissing)) {
        return { kind: 'over', status: job.status }
      }
      const choices = job.choices.join('.')
      stuck = pass > 0 && !chose && choices === before ? stuck + 1 : 0
      if (stuck >= MAX_PASSES) {
        throw new Error('La partida volvió a empezar varias veces sin poder seguir: recargá la app.')
      }
      before = choices
      chose = false
      const result = await play(engine, job, loaded.build)
      if (result !== RESTART) return result
    }
  } catch (error) {
    if (signal.aborted) return { kind: 'stopped' }
    const message = error instanceof Error ? error.message : String(error)
    report({ kind: 'error', message })
    return { kind: 'error', message }
  } finally {
    engine?.dispose()
  }
}
