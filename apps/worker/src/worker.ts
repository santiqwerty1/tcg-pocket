/**
 * The worker loop (PLAN §3.7): claim a chunk (long-poll), run engine-cli, send a heartbeat every 30 s with the games
 * played, report the result and the sample of replays, repeat. A result that could not be sent (no network) is kept
 * in `state.json` and sent first after a restart; a chunk cut by turning the PC off goes back to the queue when its
 * lease expires and is played again (same seed, same result).
 */
import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'
import { ApiError, type Chunk, type ChunkResult, type Log, type WorkerClient } from './client.js'
import type { WorkerConfig } from './config.js'
import { EngineError, engineStatus, engineVersion, runJob } from './engine.js'
import { LiveRunner } from './live.js'
import { WORKER_VERSION } from './version.js'

/** 0.2.0: games against a bot and consistency chunks (Fase 8); the app gives consistency chunks only from 0.2.0 on.
 * 0.2.1: consistency against the meta (D-019), given only from 0.2.1 on. */
export { WORKER_VERSION } from './version.js'

const HEARTBEAT_MS = 30_000
/** An engine that prints no progress for this long is hung: it is stopped and the chunk reported (H-014). */
const STALL_MS = 10 * 60_000

interface SimulateResult {
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

interface OptimizeResult {
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
  pending?: PendingUpload | null
}

export class Worker {
  private readonly stateFile: string
  private readonly workDir: string
  /** Tests shorten them. */
  heartbeatMs = HEARTBEAT_MS
  stallMs = STALL_MS

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
  async prepare(): Promise<{ engineRev: string; cliVersion: string; engineFeatures: string[] }> {
    const version = await engineVersion(this.config.enginePath)
    const state = await this.readState()
    if (state.statusUploaded !== version.engineRev) {
      const cards = await engineStatus(this.config.enginePath)
      const summary = await this.client.engineStatus(version.engineRev, cards)
      this.log('estado del motor subido', { engineRev: version.engineRev.slice(0, 7), ...summary })
      await this.writeState({ ...state, statusUploaded: version.engineRev })
    }
    return { engineRev: version.engineRev, cliVersion: version.cliVersion, engineFeatures: version.features ?? [] }
  }

  /** Sends a result left over by a previous run (no network, PC turned off right after a chunk). */
  async flushPending(): Promise<void> {
    const state = await this.readState()
    if (!state.pending) return
    await this.upload(state.pending)
    await this.writeState({ ...state, pending: null })
  }

  private async upload(pending: PendingUpload): Promise<void> {
    let accepted: boolean
    try {
      accepted = (await this.client.result(pending.chunkId, pending.result)).accepted
    } catch (error) {
      // 400/404/409: the app does not want it (job deleted, chunk taken over). Drop it; auth errors stop the worker.
      if (!(error instanceof ApiError) || error.status === 401 || error.status === 403) throw error
      this.log('el servidor rechazó el resultado; lo descarto', { chunk: pending.chunkId, error: error.message })
      if (pending.dir) await rm(pending.dir, { recursive: true, force: true })
      return
    }
    if (accepted) {
      for (const replay of pending.replays) {
        try {
          const data = gzipSync(await readFile(replay.file))
          await this.client.replay(pending.chunkId, replay.gameId, data, replay)
        } catch (error) {
          this.log('no se pudo subir una repetición', {
            chunk: pending.chunkId,
            game: replay.gameId,
            error: String(error),
          })
        }
      }
    }
    if (pending.dir) await rm(pending.dir, { recursive: true, force: true })
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
    // H-014: one heartbeat at a time, a single attempt each; and a watchdog for an engine that stopped printing
    // progress (a PC that slept is not a hung engine: the gap in the ticks says so).
    let lastProgressAt = Date.now()
    let lastTickAt = Date.now()
    let beating = false
    let stalled = false
    const tick = () => {
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
          if (answer.cancelled) {
            this.log('simulación cancelada en la app', { chunk: chunk.chunkId })
            controller.abort(new Error('cancelado'))
          } else if (answer.lost) {
            this.log('el chunk ya no es de este worker; lo suelto', { chunk: chunk.chunkId })
            controller.abort(new Error('perdido'))
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) this.log('latido fallido', { chunk: chunk.chunkId, error: String(error) })
        })
        .finally(() => {
          beating = false
        })
    }
    const beat = setInterval(tick, this.heartbeatMs)
    const threads = chunk.threads ?? this.config.cores
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
          { signal: controller.signal, onProgress: track },
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
          { signal: controller.signal, onProgress: track },
        )
        // An engine from before D-019 ignores the rivals and would measure the goldfish curve instead.
        if (chunk.consistency?.rivals?.length && result.mode !== 'meta') {
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
      const { result, dir } = await runJob<SimulateResult>(
        this.config.enginePath,
        'simulate',
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
        this.workDir,
        { signal: controller.signal, onProgress: track },
      )
      // An engine from before H-010 ignores the flag: the paired comparison of the Laboratorio needs every game.
      if (chunk.perGame && !result.perGame) {
        await rm(dir, { recursive: true, force: true })
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
          .failure(chunk.chunkId, {
            workerId: this.config.workerId,
            error: `El motor no avanzó en ${minutes} min y se cortó (¿colgado?).`,
          })
          .catch((reported: unknown) => {
            if (!(reported instanceof ApiError) || reported.status === 401 || reported.status === 403) throw reported
          })
        return null
      }
      if (controller.signal.aborted) return null
      if (error instanceof EngineError) {
        this.log('el motor falló', { chunk: chunk.chunkId, code: error.code, error: error.message.slice(0, 500) })
        await this.client
          .failure(chunk.chunkId, { workerId: this.config.workerId, error: error.message })
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

  /** Claims and plays chunks until `signal` aborts (or once, for tests and `--once`). */
  async loop(signal: AbortSignal, options: { once?: boolean } = {}): Promise<void> {
    const { engineRev, cliVersion, engineFeatures } = await this.prepare()
    await this.flushPending()
    this.log('worker listo', {
      server: this.config.server,
      engineRev: engineRev.slice(0, 7),
      cores: this.config.cores,
      name: this.config.name,
    })
    // Games against a bot run next to the chunks (they wait on the owner most of the time).
    const live = options.once
      ? null
      : new LiveRunner(this.config, this.client, this.log, this.workDir).start(engineRev, signal, engineFeatures)
    // The app's hint about waiting work this worker cannot play, written once each time it changes.
    let lastHint: string | null = null
    while (!signal.aborted) {
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
            ...(engineFeatures.length ? { engineFeatures } : {}),
          },
          signal,
        )
      } catch (error) {
        if (signal.aborted) break
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          this.log('el token no sirve: creá uno de tipo worker en la app', { status: error.status })
          throw error
        }
        throw error
      }
      if ((claim.hint ?? null) !== lastHint) {
        lastHint = claim.hint ?? null
        if (lastHint) this.log(lastHint, { version: WORKER_VERSION, engine: cliVersion })
      }
      if (!claim.chunk) {
        if (claim.requiredEngineRev) {
          this.log('la cola pide otro motor: actualizá engine/Cargo.toml y compilá', {
            required: claim.requiredEngineRev.slice(0, 7),
            have: engineRev.slice(0, 7),
          })
        }
        if (options.once) return
        await sleep(claim.retryAfterSeconds * 1000, undefined, { signal }).catch(() => undefined)
        continue
      }
      const chunk = claim.chunk
      this.log('chunk reclamado', {
        job: chunk.jobId,
        chunk: chunk.chunkId,
        idx: chunk.idx,
        games: chunk.games,
        kind: chunk.kind,
      })
      const pending = await this.play(chunk, engineRev, signal)
      if (pending) {
        const state = await this.readState()
        await this.writeState({ ...state, pending })
        await this.upload(pending)
        await this.writeState({ ...(await this.readState()), pending: null })
      }
      if (options.once) return
    }
    await live
  }

  /** Removes work folders left by a crash (results are in state.json, folders without one are useless). */
  async cleanWorkDir(): Promise<void> {
    const state = await this.readState()
    const keep = state.pending?.dir ?? null
    for (const entry of await readdir(this.workDir)) {
      const path = join(this.workDir, entry)
      if (path !== keep) await rm(path, { recursive: true, force: true })
    }
  }
}
