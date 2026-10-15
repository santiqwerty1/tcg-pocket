/**
 * The worker loop (PLAN §3.7): claim a chunk (long-poll), run engine-cli, send a heartbeat every 30 s with the games
 * played, report the result and the sample of replays, repeat. A result that could not be sent (no network) is kept
 * in `state.json` and sent first after a restart; a chunk cut by turning the PC off goes back to the queue when its
 * lease expires and is played again (same seed, same result). With an engine that has `batch` (B2), the worker asks
 * for several pairings of one job at a time and plays them in one engine process.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { ApiError, type Chunk, type ChunkResult, type Log, type WorkerClient } from './client.js'
import type { WorkerConfig } from './config.js'
import { EngineError, endedFromOutside, engineStatus, engineVersion, type RunOptions, runJob } from './engine.js'
import { LiveRunner } from './live.js'
import { processAlive } from './lock.js'
import { CpuRegulator, watchEngines } from './regulator.js'
import type { Updater } from './update.js'
import { WORKER_VERSION } from './version.js'
import { createWorkDir, removeWorkDir, workDirInUse, workDirOwner } from './work-dir.js'

/** 0.2.0: games against a bot and consistency chunks (Fase 8); the app gives consistency chunks only from 0.2.0 on.
 * 0.2.1: consistency against the meta (D-019), given only from 0.2.1 on. */
export { WORKER_VERSION } from './version.js'

const HEARTBEAT_MS = 30_000
/** B2: a batch holds up to this many chunks, and this many games per core (8 cores: 2.000 e2 games, ~20–40 s). */
const BATCH_MAX_CHUNKS = 64
const BATCH_GAMES_PER_CORE = 250
/** An engine that prints no progress for this long is hung: it is stopped and the chunk reported (H-014). */
const STALL_MS = 10 * 60_000
/**
 * D-026: with a new engine ready, how long a game against the bot in progress may hold the restart. The bot is
 * recomputed when a game is rebuilt, so another engine could answer the owner's choices differently.
 */
const LIVE_DRAIN_MS = 6 * 60 * 60_000
/**
 * A work folder of another live worker process, or one made before 0.3.4 (no owner in its name), is left alone this
 * long: its engine may still be writing there (the S25's lost result.json, 12/10/2026).
 */
const WORK_DIR_GRACE_MS = 24 * 60 * 60_000
/**
 * The engine ended well but its result.json was gone: a problem of this worker, not of the chunk. After this many in
 * a row it stops claiming for a while (doubling up to the most), so another worker plays the chunk.
 */
const LOST_RESULTS_BEFORE_PAUSE = 2
/** B of H-054: how many times a chunk cut before its end is resumed from its checkpoint before it goes back. */
const MAX_RESUMES = 5

/** The error of a chunk resumed `times` times, saying so (the chunk's error in the app; review of #104). */
function resumedError(error: EngineError, times: number): EngineError {
  if (times === 0) return error
  const said = `${error.message} (retomado ${times} ${times === 1 ? 'vez' : 'veces'})`
  return new EngineError(said, error.exitCode, error.code, error.signal)
}
const LOST_RESULTS_PAUSE_MS = 30 * 60_000
const LOST_RESULTS_PAUSE_MAX_MS = 6 * 60 * 60_000

export interface LoopOptions {
  once?: boolean
  /** D-026: a managed install's updater; the loop stops between chunks once a new release is ready. */
  updater?: Updater | null
  /** Called once the worker is ready (engine checked, pending results sent): the release worked. */
  onReady?: () => void
}

/** Phase 42: who played a result, `cliVersion` and `build` (the fingerprint of the code, engine-cli 0.3.4 on). */
interface EngineStamp {
  cliVersion?: string
  build?: string
}

/** The exact engine for the API's cache of chunks: «0.3.4+<build>», or the version alone from older engines. */
function playedBy(result: EngineStamp): { cliVersion?: string } {
  if (!result.cliVersion) return {}
  return { cliVersion: result.build ? `${result.cliVersion}+${result.build}` : result.cliVersion }
}

interface SimulateResult extends EngineStamp {
  engineRev: string
  winsA: number
  winsB: number
  ties: number
  games: number
  turns: number
  durationMs: number
  replays: { gameId: string; index: number; seed: string; file: string; winner: string }[]
  /** Only when the job asked for it; sent as is (the API checks it against the tallies). */
  perGame?: Record<string, unknown>
}

interface BatchResult extends EngineStamp {
  engineRev: string
  /** For the whole batch: its pairings are played at the same time. */
  durationMs: number
  /** `error`: this pairing has no result (the others do). */
  pairings: (Omit<SimulateResult, 'engineRev' | 'durationMs'> & {
    seed: number
    error?: { error: string; code?: string; detail?: unknown }
  })[]
}

interface OptimizeResult extends EngineStamp {
  engineRev: string
  durationMs: number
  combinations: { cards: string[]; winsA: number; winsB: number; ties: number; games: number; turns: number }[]
}

interface TurnHistogram {
  games: number
  firstOnTurn: number[]
  never: number
}

interface ConsistencyResult {
  engineRev: string
  durationMs: number
  games: number
  /** «meta» when it played the rivals; missing in engines from before D-019. */
  mode?: string
  ready: { first: TurnHistogram; second: TurnHistogram }
  attack: { first: TurnHistogram; second: TurnHistogram }
}

interface PendingUpload {
  chunkId: number
  result: ChunkResult
  replays: { gameId: string; index: number; seed: string; winner: string; file: string }[]
  dir: string | null
}

interface State {
  /** Engine revision whose card status was already uploaded. */
  statusUploaded?: string
  /** Workers before 0.2.7 kept one. */
  pending?: PendingUpload | null
  /** Results still to send, in order (a batch leaves one per chunk). */
  pendings?: PendingUpload[]
  /** No claims until then (lost results, worker 0.3.4): a restart keeps the pause instead of playing the chunk again. */
  pausedUntil?: string
}

function pendingOf(state: State): PendingUpload[] {
  return [...(state.pending ? [state.pending] : []), ...(state.pendings ?? [])]
}

export class Worker {
  private readonly stateFile: string
  private readonly workDir: string
  /** Tests shorten them. */
  heartbeatMs = HEARTBEAT_MS
  stallMs = STALL_MS
  liveDrainMs = LIVE_DRAIN_MS
  lostResultsPauseMs = LOST_RESULTS_PAUSE_MS
  /** How often the CPU regulator is asked whether it still reads (tests make it short). */
  regulatorPingEveryMs: number | undefined = undefined
  lostResultsPauseMaxMs = LOST_RESULTS_PAUSE_MAX_MS
  /**
   * Engine runs in a row that ended with 0 and no result, and their chunks (reset by a chunk played; an engine error
   * in between does not reset them: it says nothing of whether this machine lets a long run end), and the pause.
   */
  private lostResults = 0
  private readonly lostChunks = new Set<number>()
  private pausedUntil = 0
  /** Whether the engine plays several pairings in one process (`features` of `engine-cli version`). */
  private batchable = false
  /** B of H-054: whether the engine resumes a pairing from its checkpoint (`features`: `resume`). */
  private resumable = false
  /** Phase 42: how the engine plays (`gamesRev`), from `engine-cli version`; missing in older engines. */
  private gamesRev: number | undefined
  /** The engine's version (`engine-cli version`), for the diagnosis of a lost result (H-054). */
  private cliVersion: string | undefined

  constructor(
    private readonly config: WorkerConfig,
    private readonly client: WorkerClient,
    private readonly log: Log,
  ) {
    this.stateFile = join(config.dataDir, 'state.json')
    this.workDir = join(config.dataDir, 'work')
    mkdirSync(this.workDir, { recursive: true })
  }

  private async readState(): Promise<State> {
    if (!existsSync(this.stateFile)) return {}
    try {
      return JSON.parse(await readFile(this.stateFile, 'utf8')) as State
    } catch {
      return {}
    }
  }

  private async writeState(state: State): Promise<void> {
    await writeFile(this.stateFile, JSON.stringify(state, null, 2))
  }

  /** Engine version, and its card status uploaded once per revision (the app marks «no simulable» with it). */
  async prepare(signal?: AbortSignal): Promise<{ engineRev: string; cliVersion: string; engineFeatures: string[] }> {
    const version = await engineVersion(this.config.enginePath, signal)
    this.batchable = version.features?.includes('batch') ?? false
    this.resumable = version.features?.includes('resume') ?? false
    this.gamesRev = typeof version.gamesRev === 'number' ? version.gamesRev : undefined
    this.cliVersion = version.cliVersion
    const state = await this.readState()
    if (state.statusUploaded !== version.engineRev) {
      const cards = await engineStatus(this.config.enginePath, signal)
      const summary = await this.client.engineStatus(version.engineRev, cards, signal)
      this.log('estado del motor subido', { engineRev: version.engineRev.slice(0, 7), ...summary })
      await this.writeState({ ...state, statusUploaded: version.engineRev })
    }
    return { engineRev: version.engineRev, cliVersion: version.cliVersion, engineFeatures: version.features ?? [] }
  }

  /** Phase 42: `gamesRev` for a claim or a result, when the engine says it. */
  private revision(): { gamesRev?: number } {
    return this.gamesRev === undefined ? {} : { gamesRev: this.gamesRev }
  }

  /** Sends the results left over by a previous run (no network, PC turned off right after a chunk). */
  async flushPending(signal?: AbortSignal): Promise<void> {
    await this.uploadAll(pendingOf(await this.readState()), signal)
  }

  /** Keeps the results in `state.json` and sends them one by one, dropping each from the state once sent. */
  private async uploadAll(pendings: PendingUpload[], signal?: AbortSignal): Promise<void> {
    let left = [...pendings]
    await this.writeState({ ...(await this.readState()), pending: null, pendings: left })
    for (const pending of pendings) {
      await this.upload(pending, signal)
      left = left.slice(1)
      await this.writeState({ ...(await this.readState()), pending: null, pendings: left })
    }
  }

  private async upload(pending: PendingUpload, signal?: AbortSignal): Promise<void> {
    let accepted: boolean
    try {
      accepted = (await this.client.result(pending.chunkId, pending.result, signal)).accepted
    } catch (error) {
      // 400/404/409: the app does not want it (job deleted, chunk taken over). Drop it; auth errors stop the worker.
      if (!(error instanceof ApiError) || error.status === 401 || error.status === 403) throw error
      this.log('el servidor rechazó el resultado; lo descarto', { chunk: pending.chunkId, error: error.message })
      if (pending.dir) await removeWorkDir(pending.dir)
      return
    }
    if (accepted) {
      for (const replay of pending.replays) {
        try {
          const data = gzipSync(await readFile(replay.file))
          await this.client.replay(pending.chunkId, replay.gameId, data, replay, signal)
        } catch (error) {
          this.log('no se pudo subir una repetición', {
            chunk: pending.chunkId,
            game: replay.gameId,
            error: String(error),
          })
        }
      }
    }
    if (pending.dir) await removeWorkDir(pending.dir)
    this.log(accepted ? 'resultado subido' : 'resultado ya estaba', {
      chunk: pending.chunkId,
      record: `${pending.result.winsA}-${pending.result.winsB}-${pending.result.ties}`,
      seconds: Math.round(pending.result.durationMs / 1000),
    })
  }

  /** Plays one claimed chunk; returns the upload to send. */
  async play(chunk: Chunk, engineRev: string, signal: AbortSignal): Promise<PendingUpload | null> {
    let gamesDone = 0
    let total: number | null = null
    const controller = new AbortController()
    const stop = () => controller.abort(new Error('detenido'))
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    // H-014: one heartbeat at a time, a single attempt each; and a watchdog for an engine that stopped printing
    // progress (a PC that slept is not a hung engine: the gap in the ticks says so).
    let lastProgressAt = Date.now()
    let lastTickAt = Date.now()
    let beating = false
    let disconnected = false
    let stalled = false
    const tick = () => {
      if (controller.signal.aborted) return
      const now = Date.now()
      if (now - lastTickAt > this.heartbeatMs * 2) lastProgressAt = now
      lastTickAt = now
      if (now - lastProgressAt > this.stallMs) {
        stalled = true
        this.log('el motor no avanza: lo corto', { chunk: chunk.chunkId, seconds: Math.round(this.stallMs / 1000) })
        controller.abort(new Error('colgado'))
        return
      }
      if (beating) return
      beating = true
      void this.client
        .heartbeat(
          chunk.chunkId,
          { workerId: this.config.workerId, gamesDone, ...(total ? { total } : {}) },
          controller.signal,
        )
        .then((answer) => {
          if (disconnected) {
            this.log('latido recuperado', { chunk: chunk.chunkId, leaseUntil: answer.leaseUntil })
            disconnected = false
          }
          if (answer.cancelled) {
            this.log('simulación cancelada en la app', { chunk: chunk.chunkId })
            controller.abort(new Error('cancelado'))
          } else if (answer.lost || (answer.lost === false && !answer.leaseUntil)) {
            this.log('el chunk ya no es de este worker; lo suelto', { chunk: chunk.chunkId })
            controller.abort(new Error('perdido'))
          }
        })
        .catch((error) => {
          if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
            this.log('el chunk ya no está disponible; lo suelto', { chunk: chunk.chunkId, status: error.status })
            controller.abort(new Error('perdido'))
            return
          }
          disconnected = true
          if (!controller.signal.aborted) this.log('latido fallido', { chunk: chunk.chunkId, error: String(error) })
        })
        .finally(() => {
          beating = false
        })
    }
    const beat = setInterval(tick, this.heartbeatMs)
    const threads = this.config.capThreads
      ? Math.min(chunk.threads ?? this.config.cores, this.config.cores)
      : (chunk.threads ?? this.config.cores)
    const track = (done: number, all: number | null) => {
      gamesDone = done
      lastProgressAt = Date.now()
      if (all !== null) total = all
    }
    try {
      if (chunk.kind === 'optimize') {
        const { result, dir } = await runJob<OptimizeResult>(
          this.config.enginePath,
          'optimize',
          { ...chunk.optimize, seed: Number(chunk.seed), threads },
          this.workDir,
          {
            signal: controller.signal,
            onProgress: track,
            priority: this.config.priority,
            log: this.log,
            cliVersion: this.cliVersion,
          },
        )
        const totals = result.combinations.reduce(
          (sum, item) => ({
            winsA: sum.winsA + item.winsA,
            winsB: sum.winsB + item.winsB,
            ties: sum.ties + item.ties,
            games: sum.games + item.games,
            turns: sum.turns + item.turns,
          }),
          { winsA: 0, winsB: 0, ties: 0, games: 0, turns: 0 },
        )
        return {
          chunkId: chunk.chunkId,
          result: {
            workerId: this.config.workerId,
            engineRev: result.engineRev,
            ...playedBy(result),
            ...this.revision(),
            ...totals,
            durationMs: result.durationMs,
            extra: { combinations: result.combinations },
          },
          replays: [],
          dir,
        }
      }
      if (chunk.kind === 'consistency') {
        const { result, dir } = await runJob<ConsistencyResult>(
          this.config.enginePath,
          'consistency',
          {
            deck: chunk.deckA,
            keyCards: chunk.consistency?.keyCards ?? [],
            bot: chunk.consistency?.bot ?? 'e2',
            maxTurn: chunk.consistency?.maxTurn ?? 8,
            games: chunk.games,
            seed: Number(chunk.seed),
            threads,
            ...(chunk.consistency?.rivals?.length ? { rivals: chunk.consistency.rivals } : {}),
          },
          this.workDir,
          {
            signal: controller.signal,
            onProgress: track,
            priority: this.config.priority,
            log: this.log,
            cliVersion: this.cliVersion,
          },
        )
        // An engine from before D-019 ignores the rivals and would measure the goldfish curve instead.
        if (chunk.consistency?.rivals?.length && result.mode !== 'meta') {
          await removeWorkDir(dir)
          throw new EngineError(
            'engine-cli no conoce la consistencia contra el meta: recompilá el motor (cargo build).',
            null,
            'old_engine',
          )
        }
        // The tallies the queue keeps: games ready by the last turn reported, and games never ready.
        const never = result.ready.first.never + result.ready.second.never
        return {
          chunkId: chunk.chunkId,
          result: {
            workerId: this.config.workerId,
            engineRev: result.engineRev,
            ...this.revision(),
            winsA: result.games - never,
            winsB: never,
            ties: 0,
            games: result.games,
            durationMs: result.durationMs,
            extra: { ready: result.ready, attack: result.attack },
          },
          replays: [],
          dir,
        }
      }
      const { result, dir } = await this.simulateResuming(
        chunk,
        {
          deckA: chunk.deckA,
          deckB: chunk.deckB,
          players: chunk.players,
          games: chunk.games,
          seed: Number(chunk.seed),
          threads,
          replaySample: chunk.replaySample,
          ...(chunk.perGame ? { perGame: true } : {}),
        },
        {
          signal: controller.signal,
          onProgress: track,
          priority: this.config.priority,
          log: this.log,
          cliVersion: this.cliVersion,
        },
      )
      // An engine from before H-010 ignores the flag: the paired comparison of the Laboratorio needs every game.
      if (chunk.perGame && !result.perGame) {
        await removeWorkDir(dir)
        throw new EngineError(
          'engine-cli no informa las partidas una por una: recompilá el motor (cargo build).',
          null,
          'old_engine',
        )
      }
      return {
        chunkId: chunk.chunkId,
        result: {
          workerId: this.config.workerId,
          engineRev: result.engineRev,
          ...playedBy(result),
          ...this.revision(),
          winsA: result.winsA,
          winsB: result.winsB,
          ties: result.ties,
          games: result.games,
          turns: result.turns,
          durationMs: result.durationMs,
          ...(result.perGame ? { extra: { perGame: result.perGame } } : {}),
        },
        replays: result.replays.map((replay) => ({ ...replay })),
        dir,
      }
    } catch (error) {
      if (stalled) {
        const minutes = Math.round(this.stallMs / 60_000)
        await this.client
          .failure(
            chunk.chunkId,
            {
              workerId: this.config.workerId,
              error: `El motor no avanzó en ${minutes} min y se cortó (¿colgado?).`,
            },
            signal,
          )
          .catch((reported: unknown) => {
            if (!(reported instanceof ApiError) || reported.status === 401 || reported.status === 403) throw reported
          })
        return null
      }
      if (controller.signal.aborted) return null
      if (error instanceof EngineError && error.code === 'missing_result') {
        await this.returnLost(chunk, error, signal)
        return null
      }
      if (error instanceof EngineError) {
        this.log('el motor falló', { chunk: chunk.chunkId, code: error.code, error: error.message.slice(0, 500) })
        await this.client
          .failure(chunk.chunkId, { workerId: this.config.workerId, error: error.message }, signal)
          .catch((reported: unknown) => {
            if (!(reported instanceof ApiError) || reported.status === 401 || reported.status === 403) throw reported
            this.log('el servidor rechazó la falla', { chunk: chunk.chunkId, error: reported.message })
          })
        return null
      }
      throw error
    } finally {
      clearInterval(beat)
      signal.removeEventListener('abort', stop)
      void engineRev
    }
  }

  /**
   * B of H-054: with an engine that has `resume`, a chunk's games go to a checkpoint in its folder as they finish, and
   * an engine ended from outside before its end (`endedFromOutside`: exit 0 and no result.json, the S25, or a SIGKILL
   * or SIGTERM it did not get from this worker) runs again there: it plays only the games the checkpoint does not
   * have, with the same seeds, and its result is the one of a run in one go. At most `MAX_RESUMES` times; then the
   * chunk goes as the last run ended (`returnLost` for a lost result, a failure for a signal, as before). A cancel, a
   * lost lease or a shutdown (the signal) never resumes.
   */
  private async simulateResuming(
    chunk: Chunk,
    job: Record<string, unknown>,
    options: RunOptions & { signal: AbortSignal },
  ): Promise<{ result: SimulateResult; dir: string }> {
    if (!this.resumable) return runJob<SimulateResult>(this.config.enginePath, 'simulate', job, this.workDir, options)
    const dir = createWorkDir(this.workDir, 'simulate-')
    const checkpoint = join(dir, 'progress.txt')
    // The cut that started the resumes: what goes back if they cannot go on.
    let cut: EngineError | null = null
    for (let resumes = 0; ; resumes++) {
      try {
        return await runJob<SimulateResult>(this.config.enginePath, 'simulate', { ...job, checkpoint }, this.workDir, {
          ...options,
          dir,
          keepOnLoss: true,
        })
      } catch (error) {
        const lost = endedFromOutside(error)
        if (lost) cut = error
        // A resumed run that fails for something else than the engine (its folder gone, a file it cannot write) is
        // still the cut it resumed: the chunk goes as that cut would (a lost result goes back without spending an
        // attempt; review).
        if (!lost && cut && !(error instanceof EngineError) && !options.signal.aborted) {
          await removeWorkDir(dir)
          throw resumedError(cut, resumes)
        }
        // Its folder must still be there: a resume plays on what its checkpoint kept.
        if (lost && resumes < MAX_RESUMES && !options.signal.aborted && existsSync(dir)) {
          this.log('el motor se cortó antes de terminar: retomo el chunk desde su avance', {
            chunk: chunk.chunkId,
            resume: resumes + 1,
            error: error.message.slice(0, 300),
          })
          continue
        }
        if (!lost) throw error
        await removeWorkDir(dir)
        throw resumedError(error, resumes)
      }
    }
  }

  /**
   * The engine ended with 0 and no result.json: engine-cli exits 0 only after writing it, so something outside ended
   * its process (the S25's system, 12/10/2026). The chunk goes back without spending an attempt (`cause: 'worker'`).
   * Losses of two different chunks in a row pause the claims (the same chunk twice may be that chunk: the app gives it
   * to this worker last, and its returns are capped).
   */
  private async returnLost(chunk: Chunk, error: EngineError, signal: AbortSignal): Promise<void> {
    this.lostResults++
    this.lostChunks.add(chunk.chunkId)
    this.log('el motor terminó bien pero su resultado no está: devuelvo el chunk sin gastar un intento', {
      chunk: chunk.chunkId,
      job: chunk.jobId,
      inARow: this.lostResults,
      pid: process.pid,
      error: error.message.slice(0, 500),
    })
    // The pause goes with the return, so the app shows it (Simulación, workers_status) while nothing is claimed.
    if (this.lostChunks.size >= LOST_RESULTS_BEFORE_PAUSE) {
      const pause = Math.min(
        this.lostResultsPauseMs * 2 ** (this.lostChunks.size - LOST_RESULTS_BEFORE_PAUSE),
        this.lostResultsPauseMaxMs,
      )
      this.pausedUntil = Date.now() + pause
      this.log('el motor perdió resultados varias veces seguidas: no tomo trabajo por un rato', {
        inARow: this.lostResults,
        chunks: this.lostChunks.size,
        minutes: Math.round(pause / 60_000),
      })
      await this.writeState({ ...(await this.readState()), pausedUntil: new Date(this.pausedUntil).toISOString() })
    }
    const pausedUntil = this.pausedUntil > Date.now() ? { pausedUntil: new Date(this.pausedUntil).toISOString() } : {}
    await this.client
      .failure(
        chunk.chunkId,
        { workerId: this.config.workerId, error: error.message, cause: 'worker', ...pausedUntil },
        signal,
      )
      .catch((reported: unknown) => {
        if (!(reported instanceof ApiError) || reported.status === 401 || reported.status === 403) throw reported
        this.log('el servidor rechazó la devolución', { chunk: chunk.chunkId, error: reported.message })
      })
  }

  /**
   * B2: several pairings of one job in one engine process (`engine-cli batch`): the threads stay busy until the last
   * game, and the claim, the start of the engine and the slowest game are paid once per batch instead of once per
   * chunk. Each chunk keeps its seed, its lease (a heartbeat each, one request at a time) and its own result. A
   * cancelled job stops the batch; losing any chunk stops the shared process and retries the remaining chunks
   * individually. A pairing that fails in the engine fails its own chunk;
   * a batch that fails as a whole, or hangs, is played again chunk by chunk, so nothing else is blamed for it.
   */
  async playBatch(chunks: Chunk[], engineRev: string, signal: AbortSignal): Promise<PendingUpload[]> {
    const first = chunks[0] as Chunk
    const total = chunks.reduce((sum, chunk) => sum + chunk.games, 0)
    let gamesDone = 0
    const controller = new AbortController()
    const stop = () => controller.abort(new Error('detenido'))
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const lost = new Set<number>()
    let lastProgressAt = Date.now()
    let lastTickAt = Date.now()
    let beating = false
    let stalled = false
    // The engine counts the games of the whole batch: they are handed to the chunks in order for the progress bar.
    const doneOf = (index: number) => {
      const before = chunks.slice(0, index).reduce((sum, chunk) => sum + chunk.games, 0)
      return Math.max(0, Math.min((chunks[index] as Chunk).games, gamesDone - before))
    }
    const renew = async () => {
      for (const [index, chunk] of chunks.entries()) {
        if (controller.signal.aborted) return
        if (lost.has(chunk.chunkId)) continue
        try {
          const answer = await this.client.heartbeat(
            chunk.chunkId,
            { workerId: this.config.workerId, gamesDone: doneOf(index) },
            controller.signal,
          )
          if (answer.cancelled) {
            this.log('simulación cancelada en la app', { chunk: chunk.chunkId })
            controller.abort(new Error('cancelado'))
            return
          }
          if (answer.lost || (answer.lost === false && !answer.leaseUntil)) {
            lost.add(chunk.chunkId)
            this.log('el chunk ya no es de este worker; corto el lote', { chunk: chunk.chunkId })
            controller.abort(new Error('perdido'))
            return
          }
        } catch (error) {
          if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
            lost.add(chunk.chunkId)
            controller.abort(new Error('perdido'))
            return
          }
          if (!controller.signal.aborted) this.log('latido fallido', { chunk: chunk.chunkId, error: String(error) })
          // One network timeout must not make a 64-chunk renewal cycle wait 64 × 20 s.
          // Retry the cycle on the next tick; expired leases still renew if nobody took them.
          return
        }
      }
      if (lost.size === chunks.length) controller.abort(new Error('perdido'))
    }
    const tick = () => {
      if (controller.signal.aborted) return
      const now = Date.now()
      if (now - lastTickAt > this.heartbeatMs * 2) lastProgressAt = now
      lastTickAt = now
      if (now - lastProgressAt > this.stallMs) {
        stalled = true
        this.log('el motor no avanza: lo corto', { chunks: chunks.length, seconds: Math.round(this.stallMs / 1000) })
        controller.abort(new Error('colgado'))
        return
      }
      if (beating) return
      beating = true
      void renew().finally(() => {
        beating = false
      })
    }
    const beat = setInterval(tick, this.heartbeatMs)
    const failOne = async (chunk: Chunk, message: string) => {
      await this.client
        .failure(chunk.chunkId, { workerId: this.config.workerId, error: message }, signal)
        .catch((reported: unknown) => {
          if (!(reported instanceof ApiError) || reported.status === 401 || reported.status === 403) throw reported
          this.log('el servidor rechazó la falla', { chunk: chunk.chunkId, error: reported.message })
        })
    }
    let fallback: string
    try {
      const { result, dir } = await runJob<BatchResult>(
        this.config.enginePath,
        'batch',
        {
          players: first.players,
          threads: this.config.capThreads
            ? Math.min(first.threads ?? this.config.cores, this.config.cores)
            : (first.threads ?? this.config.cores),
          ...(first.perGame ? { perGame: true } : {}),
          pairings: chunks.map((chunk) => ({
            deckA: chunk.deckA,
            deckB: chunk.deckB,
            games: chunk.games,
            seed: Number(chunk.seed),
            replaySample: chunk.replaySample,
          })),
        },
        this.workDir,
        {
          signal: controller.signal,
          priority: this.config.priority,
          log: this.log,
          cliVersion: this.cliVersion,
          onProgress: (done) => {
            gamesDone = done
            lastProgressAt = Date.now()
          },
        },
      )
      const missingPerGame = first.perGame && result.pairings.some((pairing) => !pairing.error && !pairing.perGame)
      if (result.pairings.length !== chunks.length || missingPerGame) {
        await removeWorkDir(dir)
        throw new EngineError(
          'engine-cli devolvió un lote incompleto: recompilá el motor (cargo build).',
          null,
          'old_engine',
        )
      }
      const pendings: PendingUpload[] = []
      for (const [index, chunk] of chunks.entries()) {
        const pairing = result.pairings[index] as BatchResult['pairings'][number]
        if (pairing.error) {
          // Only this pairing failed (a deck the engine refuses, a game that panicked): only its chunk counts it.
          const message = pairing.error.detail
            ? `${pairing.error.error}: ${JSON.stringify(pairing.error.detail)}`
            : pairing.error.error
          this.log('un cruce del lote falló', {
            chunk: chunk.chunkId,
            code: pairing.error.code,
            error: message.slice(0, 500),
          })
          await failOne(chunk, message)
          continue
        }
        pendings.push({
          chunkId: chunk.chunkId,
          result: {
            workerId: this.config.workerId,
            engineRev: result.engineRev,
            ...playedBy(result),
            ...this.revision(),
            winsA: pairing.winsA,
            winsB: pairing.winsB,
            ties: pairing.ties,
            games: pairing.games,
            turns: pairing.turns,
            // Played together: each chunk gets the share of the batch's time its games are.
            durationMs: Math.round((result.durationMs * chunk.games) / total),
            ...(pairing.perGame ? { extra: { perGame: pairing.perGame } } : {}),
          },
          replays: pairing.replays.map((replay) => ({ ...replay })),
          dir: null,
        })
      }
      // Every chunk's replays are in the batch's folder: it goes with the last upload (now, if none goes up).
      const last = pendings.at(-1)
      if (last) last.dir = dir
      else await removeWorkDir(dir)
      return pendings
    } catch (error) {
      if (stalled) fallback = `el motor no avanzó en ${Math.round(this.stallMs / 60_000)} min`
      else if (lost.size > 0) fallback = 'un chunk del lote ya no es de este worker'
      else if (controller.signal.aborted) return []
      else if (error instanceof EngineError) fallback = error.message
      else throw error
    } finally {
      clearInterval(beat)
      signal.removeEventListener('abort', stop)
    }
    // The batch as a whole failed or hung: each chunk on its own, so a failure or a hang counts only for its chunk.
    this.log('el lote falló; juego sus chunks de a uno', { chunks: chunks.length, reason: fallback.slice(0, 300) })
    for (const chunk of chunks) {
      if (signal.aborted) break
      if (lost.has(chunk.chunkId)) continue
      // Ownership may have changed while the shared engine was stopping. Recheck before replaying.
      if (lost.size > 0) {
        try {
          const answer = await this.client.heartbeat(
            chunk.chunkId,
            { workerId: this.config.workerId, gamesDone: 0 },
            signal,
          )
          if (answer.cancelled || answer.lost || (answer.lost === false && !answer.leaseUntil)) continue
        } catch (error) {
          this.log('no pude renovar el chunk; queda para otro reclamo', { chunk: chunk.chunkId, error: String(error) })
          continue
        }
      }
      const pending = await this.play(chunk, engineRev, signal)
      if (pending) await this.uploadAll([pending], signal)
    }
    return []
  }

  /**
   * Claims and plays chunks until `signal` aborts (or once, for tests and `--once`). With an updater, resolves with
   * «update» once a new release is ready and nothing is left half played: the caller switches and restarts.
   */
  async loop(outerSignal: AbortSignal, options: LoopOptions = {}): Promise<'update' | undefined> {
    const controller = new AbortController()
    const stop = () => controller.abort(outerSignal.reason)
    outerSignal.addEventListener('abort', stop, { once: true })
    if (outerSignal.aborted) stop()
    const signal = controller.signal
    const updater = options.once ? null : (options.updater ?? null)
    // Cuts a claim's long-poll short when a release becomes ready (a chunk being played is never cut).
    const wake = new AbortController()
    let live: Promise<void> | null = null
    let liveRunner: LiveRunner | null = null
    let watching: Promise<void> | null = null
    let regulator: CpuRegulator | null = null
    try {
      const { engineRev, cliVersion, engineFeatures } = await this.prepare(signal)
      // The CPU regulator (Windows, pedido de Santi del 14/10/2026): with an engine that has it and unless turned off.
      if (this.config.cpuRegulator && process.platform === 'win32' && engineFeatures.includes('regulate')) {
        // Sized from the whole machine: `cores` is each engine's threads (autorrevisión).
        regulator = new CpuRegulator({
          enginePath: this.config.enginePath,
          dataDir: this.config.dataDir,
          ping: engineFeatures.includes('regulatePing'),
          ...(this.regulatorPingEveryMs !== undefined ? { pingEveryMs: this.regulatorPingEveryMs } : {}),
          log: this.log,
        })
        watchEngines(regulator)
        regulator.start()
      }
      await this.flushPending(signal)
      this.log('worker listo', {
        // Two at once on one folder show up as two PIDs (the S25, 12/10/2026).
        pid: process.pid,
        server: this.config.server,
        engineRev: engineRev.slice(0, 7),
        cores: this.config.cores,
        name: this.config.name,
      })
      options.onReady?.()
      if (updater) watching = this.watchUpdates(updater, signal, () => wake.abort())
      // Games against a bot run next to the chunks (they wait on the owner most of the time).
      if (!options.once) {
        liveRunner = new LiveRunner(this.config, this.client, this.log, this.workDir)
        live = liveRunner.start(engineRev, signal, engineFeatures, { cliVersion, ...this.revision() })
      }
      // The app's hint about waiting work this worker cannot play, written once each time it changes.
      let lastHint: string | null = null
      // A pause from before a restart still holds (capped, in case the clock moved).
      const saved = Date.parse((await this.readState()).pausedUntil ?? '')
      if (saved > Date.now()) {
        this.pausedUntil = Math.max(this.pausedUntil, Math.min(saved, Date.now() + this.lostResultsPauseMaxMs))
        this.log('sigo en pausa por resultados perdidos', { until: new Date(this.pausedUntil).toISOString() })
      }
      while (!signal.aborted && !updater?.ready) {
        if (Date.now() < this.pausedUntil) {
          // A clock set back would stretch it: never longer than the longest pause from now (review of #72).
          this.pausedUntil = Math.min(this.pausedUntil, Date.now() + this.lostResultsPauseMaxMs)
          await sleep(this.pausedUntil - Date.now(), undefined, {
            signal: AbortSignal.any([signal, wake.signal]),
          }).catch(() => undefined)
          continue
        }
        let claim: Awaited<ReturnType<WorkerClient['claim']>>
        try {
          claim = await this.client.claim(
            {
              workerId: this.config.workerId,
              name: this.config.name,
              engineRev,
              cliVersion,
              cores: this.config.cores,
              version: WORKER_VERSION,
              allowSlowBots: this.config.allowSlowBots,
              platform: process.platform,
              ...(engineFeatures.length ? { engineFeatures } : {}),
              ...this.revision(),
              ...(this.batchable
                ? { batch: { maxChunks: BATCH_MAX_CHUNKS, maxGames: this.config.cores * BATCH_GAMES_PER_CORE } }
                : {}),
            },
            AbortSignal.any([signal, wake.signal]),
          )
        } catch (error) {
          if (signal.aborted || updater?.ready) break
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            this.log('el token no sirve: creá uno de tipo worker en la app', { status: error.status })
            throw error
          }
          if (updater && error instanceof ApiError && error.status === 409) {
            // Android's exact-engine gate: the app moved to another engine, and its package brings it.
            this.log('el servidor cambió de motor: busco la versión nueva')
            if (await updater.check(signal)) break
            // Never faster than the wait of a failed preparation (a cut download is not retried every minute).
            await sleep(Math.max(60_000, updater.retryInMs()), undefined, { signal }).catch(() => undefined)
            continue
          }
          throw error
        }
        if ((claim.hint ?? null) !== lastHint) {
          lastHint = claim.hint ?? null
          if (lastHint) this.log(lastHint, { version: WORKER_VERSION, engine: cliVersion })
        }
        if (!claim.chunk) {
          if (claim.requiredEngineRev && updater) {
            // The app's package brings the engine its queue asks for: look now instead of in ten minutes.
            if (await updater.check(signal)) break
          } else if (claim.requiredEngineRev) {
            this.log('la cola pide otro motor: actualizá engine/Cargo.toml y compilá', {
              required: claim.requiredEngineRev.slice(0, 7),
              have: engineRev.slice(0, 7),
            })
          }
          if (options.once) return
          await sleep(claim.retryAfterSeconds * 1000, undefined, { signal }).catch(() => undefined)
          continue
        }
        const chunks = claim.chunks?.length ? claim.chunks : [claim.chunk]
        let pendings: PendingUpload[]
        if (chunks.length > 1) {
          this.log('lote reclamado', {
            job: claim.chunk.jobId,
            chunks: chunks.map((chunk) => chunk.chunkId),
            games: chunks.reduce((sum, chunk) => sum + chunk.games, 0),
            kind: claim.chunk.kind,
          })
          pendings = await this.playBatch(chunks, engineRev, signal)
        } else {
          const chunk = claim.chunk
          this.log('chunk reclamado', {
            job: chunk.jobId,
            chunk: chunk.chunkId,
            idx: chunk.idx,
            games: chunk.games,
            kind: chunk.kind,
          })
          const pending = await this.play(chunk, engineRev, signal)
          pendings = pending ? [pending] : []
        }
        if (pendings.length > 0) {
          this.lostResults = 0
          this.lostChunks.clear()
          await this.uploadAll(pendings, signal)
        }
        if (options.once) return
      }
      const ready = updater?.ready
      if (ready && !signal.aborted) {
        liveRunner?.drain()
        // Same engine: a game in progress is rebuilt by the next start from the owner's choices, so no waiting.
        const sameEngine = ready.engineRev === engineRev && ready.cliVersion === cliVersion
        if (live && !sameEngine) {
          this.log('espero que termine la partida contra el bot antes de cambiar de versión')
          await Promise.race([live, sleep(this.liveDrainMs, undefined, { signal }).catch(() => undefined)])
        }
        return 'update'
      }
      return undefined
    } finally {
      controller.abort()
      await live
      await watching
      if (regulator) {
        watchEngines(null)
        await regulator.stop()
      }
      outerSignal.removeEventListener('abort', stop)
    }
  }

  /** Asks for a new release every `updater.intervalMs` (the start already asked once); `ready` once there is one. */
  private async watchUpdates(updater: Updater, signal: AbortSignal, ready: () => void): Promise<void> {
    while (!signal.aborted) {
      await sleep(updater.intervalMs, undefined, { signal }).catch(() => undefined)
      if (signal.aborted) return
      if (await updater.check(signal)) {
        ready()
        return
      }
    }
  }

  /**
   * Removes work folders left by a crash (results are in state.json, folders without one are useless). Never one of
   * another live worker process, nor one with no owner in its name (before 0.3.4), until it is a day old: its engine
   * may still be writing there, and its result.json would vanish (the S25, 12/10/2026).
   */
  async cleanWorkDir(): Promise<void> {
    const keep = new Set(pendingOf(await this.readState()).flatMap((pending) => (pending.dir ? [pending.dir] : [])))
    for (const entry of await readdir(this.workDir)) {
      const path = join(this.workDir, entry)
      if (keep.has(path) || workDirInUse(path)) continue
      const owner = workDirOwner(entry)
      const someoneElse = owner === null || (owner !== process.pid && processAlive(owner))
      if (someoneElse) {
        const modified = (await stat(path).catch(() => null))?.mtimeMs
        if (modified === undefined) continue
        if (Date.now() - modified < WORK_DIR_GRACE_MS) {
          if (owner !== null) {
            this.log('otro proceso worker usa esta carpeta de trabajo; no la borro', {
              dir: entry,
              pid: owner,
              me: process.pid,
            })
          }
          continue
        }
      }
      await rm(path, { recursive: true, force: true })
    }
  }
}
