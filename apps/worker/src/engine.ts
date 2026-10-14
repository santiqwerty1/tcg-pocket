/**
 * Runs engine-cli (engine/src/main.rs): JSON job in, JSON result out, `total <n>` and `progress <n>` lines on stderr.
 * Exit codes: 0 ok, 2 bad input, 3 engine failure. A run can be stopped (job cancelled, shutdown) with its signal.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Log } from './client.js'
import { type EnginePriority, setEnginePriority } from './priority.js'
import { PROBE_EVERY_MS, type ProcessSample, probeSample, probeStart } from './proc-probe.js'
import { createWorkDir, removeWorkDir } from './work-dir.js'

export interface EngineVersion {
  engineRev: string
  cliVersion: string
  cards: number
  /** What it can do beyond the commands of 0.1.0 (`perGame`, `batch`…); missing in engines from before 0.2.1. */
  features?: string[]
  /** Phase 42: how it plays; a job is played whole with one (missing before engine-cli 0.3.6). */
  gamesRev?: number
}

export interface EngineCardStatus {
  id: string
  name: string
  status: string
  complete: boolean
}

export class EngineError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly code: string | null,
    readonly signal: NodeJS.Signals | null = null,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

export interface RunOptions {
  priority?: EnginePriority | undefined
  log?: Log | undefined
  signal?: AbortSignal | undefined
  onProgress?: ((done: number, total: number | null) => void) | undefined
  /**
   * On Linux and Android: log the engine's OOM score when it starts and its memory (and the machine's) every
   * `probeEveryMs` while it plays. A job turns it on; quick commands (version, status) do not.
   */
  probe?: boolean | undefined
  probeEveryMs?: number | undefined
  /** The tick of the clock that sees this worker frozen (H-054); tests make it short. */
  clockEveryMs?: number | undefined
  /** The engine's version (`cliVersion`), for the diagnosis of a lost result. */
  cliVersion?: string | undefined
  /**
   * `resume` (H-054): the folder of a run before (`runJob` makes one otherwise), and whether a lost result keeps it:
   * its checkpoint lets the next run play only the games it does not have.
   */
  dir?: string | undefined
  keepOnLoss?: boolean | undefined
}

/** How a run went, besides its output: for the log when the result is missing. */
interface RunOutput {
  stdout: string
  stderrTail: string
  /** The last `progress` line and the `total` the engine announced (it prints both again when it ends well). */
  lastProgress: number | null
  total: number | null
  seconds: number
  lastSample: (ProcessSample & { memAvailableMb: number | null }) | null
  /**
   * How engine-cli said it ended (its last stderr line `fin …`, engine-cli 0.3.7 on: `ok`, `error N`, `pánico`,
   * `señal N`, `exit sin terminar`); null when it said nothing.
   */
  endLine: string | null
  /** From the last game that moved its progress to its end. */
  msSinceProgress: number | null
  /**
   * The longest this worker stopped while the machine ran (its monotonic clock late beyond the tick): the system froze
   * the app (and, likely, its engine).
   */
  clockGapMs: number
  /** The longest the wall clock jumped beyond the monotonic one: the machine asleep, or its time set. */
  sleepGapMs: number
}

/** How often the clock that sees the worker frozen ticks, and the gap that counts (H-054). */
const CLOCK_EVERY_MS = 10_000
export const FROZEN_GAP_MS = 30_000

/**
 * Why result.json could not be read, without its path: the chunk's error is seen in the app and over MCP, and the path
 * has the user's folder (review of #100).
 */
function resultProblem(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string') return `result.json: ${code}`
  return `result.json: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * What a run that lost its result says about its end, for the chunk's error in the app (H-054). With exit code 0, no
 * `fin` line means an engine older than 0.3.7, or a process ended through `_exit` (a SIGKILL is seen as a signal).
 */
export function cutDiagnosis(output: RunOutput, cliVersion?: string): string {
  const said = output.endLine ?? `ninguna${cliVersion ? ` (engine-cli ${cliVersion})` : ''}`
  const parts = [`fin: ${said}`]
  if (output.total !== null) parts.push(`avance ${output.lastProgress ?? 0}/${output.total}`)
  if (output.msSinceProgress !== null) parts.push(`última partida hace ${Math.round(output.msSinceProgress / 1000)} s`)
  if (output.clockGapMs >= FROZEN_GAP_MS)
    parts.push(`el worker estuvo congelado hasta ${Math.round(output.clockGapMs / 1000)} s seguidos`)
  if (output.sleepGapMs >= FROZEN_GAP_MS)
    parts.push(`el equipo estuvo suspendido, o cambió la hora, hasta ${Math.round(output.sleepGapMs / 1000)} s`)
  if (output.lastSample?.memAvailableMb != null) parts.push(`memoria libre ${output.lastSample.memAvailableMb} MB`)
  return parts.join('; ')
}

function run(enginePath: string, args: string[], options: RunOptions = {}): Promise<RunOutput> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason)
  return new Promise((resolve, reject) => {
    // A .js/.mjs engine is a script run with this Node (the fake engine of the tests).
    const [command, prefix] = /\.m?js$/.test(enginePath) ? [process.execPath, [enginePath]] : [enginePath, []]
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    setEnginePriority(child.pid, options.priority ?? 'normal', options.log ?? console.error)
    const startedAt = Date.now()
    let stdout = ''
    let stderrTail = ''
    let total: number | null = null
    let lastProgress: number | null = null
    let lastSample: RunOutput['lastSample'] = null
    let endLine: string | null = null
    let lastProgressAt: number | null = null
    let clockGapMs = 0
    let sleepGapMs = 0
    let clock: ReturnType<typeof setInterval> | null = null
    let probing: ReturnType<typeof setInterval> | null = null
    let readClock: (() => void) | null = null
    if (options.probe) {
      // A tick late by more than its period on the monotonic clock: the system froze this worker meanwhile. The wall
      // clock going further than the monotonic one: the machine slept (the monotonic one stops then) or its time moved.
      const every = options.clockEveryMs ?? CLOCK_EVERY_MS
      let monotonic = performance.now()
      let wall = Date.now()
      readClock = () => {
        const nowMonotonic = performance.now()
        const nowWall = Date.now()
        clockGapMs = Math.max(clockGapMs, Math.round(nowMonotonic - monotonic - every))
        sleepGapMs = Math.max(sleepGapMs, Math.round(nowWall - wall - (nowMonotonic - monotonic)))
        monotonic = nowMonotonic
        wall = nowWall
      }
      clock = setInterval(readClock, every)
      clock.unref()
    }
    if (options.probe && child.pid !== undefined) {
      const pid = child.pid
      const start = probeStart(pid)
      if (start) options.log?.('motor arrancado', { command: args[0], pid, ...start })
      probing = setInterval(() => {
        const sample = probeSample(pid)
        if (!sample) return
        lastSample = sample
        options.log?.('motor: memoria', { pid, gamesDone: lastProgress, total, ...sample })
      }, options.probeEveryMs ?? PROBE_EVERY_MS)
      probing.unref()
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    const readLine = (line: string) => {
      const totalMatch = /^total (\d+)$/.exec(line.trim())
      if (totalMatch) total = Number(totalMatch[1])
      const progress = /^progress (\d+)$/.exec(line.trim())
      if (progress) {
        const now = Number(progress[1])
        if (now !== lastProgress) lastProgressAt = Date.now()
        lastProgress = now
        options.onProgress?.(lastProgress, total)
      }
      const end = /^fin (.+)$/.exec(line.trim())
      if (end?.[1]) endLine = end[1]
    }
    // Whole lines only: a line can arrive in two pieces, and its first piece alone would be read wrong (review of the
    // diagnosis: «fin ok» lost under load).
    let partial = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
      const lines = (partial + chunk).split(/\r?\n/)
      // Capped, as the tail: a stderr without line breaks does not grow it without end (review of #100).
      partial = (lines.pop() ?? '').slice(-4000)
      for (const line of lines) readLine(line)
    })
    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      if (probing) clearInterval(probing)
      if (clock) clearInterval(clock)
      options.signal?.removeEventListener('abort', abort)
      reject(new EngineError(`no se pudo ejecutar ${enginePath}: ${error.message}`, null, 'spawn'))
    })
    child.on('close', (code, signal) => {
      if (probing) clearInterval(probing)
      if (clock) clearInterval(clock)
      // A last reading: a freeze that ends with the engine would not reach the next tick (review of #100).
      readClock?.()
      // A last line without its line break.
      if (partial) readLine(partial)
      partial = ''
      const seconds = Math.round((Date.now() - startedAt) / 1000)
      const msSinceProgress = lastProgressAt === null ? null : Date.now() - lastProgressAt
      options.log?.('motor terminado', {
        command: args[0],
        pid: child.pid,
        exitCode: code,
        signal,
        endLine,
        ...(total !== null ? { lastProgress, total, seconds, msSinceProgress } : {}),
        ...(clock ? { clockGapMs, sleepGapMs } : {}),
      })
      options.signal?.removeEventListener('abort', abort)
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('cancelado'))
        return
      }
      if (code === 0 && signal === null) {
        resolve({
          stdout,
          stderrTail,
          lastProgress,
          total,
          seconds,
          lastSample,
          endLine,
          msSinceProgress,
          clockGapMs,
          sleepGapMs,
        })
        return
      }
      let message = stderrTail.trim() || `engine-cli terminó con código ${code}, señal ${signal}`
      let errorCode: string | null = null
      try {
        const parsed = JSON.parse(stdout.trim()) as { error?: string; code?: string; detail?: unknown }
        if (parsed.error) message = parsed.detail ? `${parsed.error}: ${JSON.stringify(parsed.detail)}` : parsed.error
        errorCode = parsed.code ?? null
      } catch {
        // stdout was not JSON: keep the stderr tail.
      }
      reject(new EngineError(message, code, errorCode, signal))
    })
  })
}

export async function engineVersion(enginePath: string, signal?: AbortSignal): Promise<EngineVersion> {
  return JSON.parse((await run(enginePath, ['version'], { signal })).stdout) as EngineVersion
}

export async function engineStatus(enginePath: string, signal?: AbortSignal): Promise<EngineCardStatus[]> {
  return JSON.parse((await run(enginePath, ['status'], { signal })).stdout) as EngineCardStatus[]
}

/** What is in a folder, for the log; null if it is gone (also if it goes while reading it). */
function entriesOf(dir: string): string[] | null {
  try {
    return readdirSync(dir).slice(0, 20)
  } catch {
    return null
  }
}

/** Writes the job to a temp folder, runs the command, returns the parsed result and the folder (for replays). */
export async function runJob<T>(
  enginePath: string,
  command: 'simulate' | 'batch' | 'optimize' | 'consistency',
  job: Record<string, unknown>,
  workDir: string,
  options: RunOptions = {},
): Promise<{ result: T; dir: string }> {
  const dir = options.dir ?? createWorkDir(workDir, `${command}-`)
  const jobFile = join(dir, 'job.json')
  const resultFile = join(dir, 'result.json')
  try {
    await writeFile(
      jobFile,
      JSON.stringify({
        ...job,
        ...(command === 'simulate' || command === 'batch' ? { replayDir: join(dir, 'replays') } : {}),
      }),
    )
    const output = await run(enginePath, [command, jobFile, resultFile], {
      probe: true,
      ...options,
      priority: options.priority ?? 'below_normal',
    })
    try {
      const result: unknown = JSON.parse(await readFile(resultFile, 'utf8'))
      if (!result || typeof result !== 'object' || Array.isArray(result))
        throw new Error('el resultado no es un objeto JSON')
      return { result: result as T, dir }
    } catch (error) {
      options.log?.('motor sin resultado válido', {
        command,
        enginePath,
        dir,
        directoryExists: existsSync(dir),
        resultExists: existsSync(resultFile),
        // What is left (job.json without result.json: only the file went; nothing: the folder was made again).
        entries: entriesOf(dir),
        pid: process.pid,
        exitCode: 0,
        signal: null,
        // Short of its total: the process ended before playing every game (the S25: 699–954 of 1000, exit 0).
        lastProgress: output.lastProgress,
        total: output.total,
        finished: output.total !== null && output.lastProgress === output.total,
        seconds: output.seconds,
        lastSample: output.lastSample,
        // H-054: how it said it ended, the time since its last game and whether this worker was frozen meanwhile.
        endLine: output.endLine,
        msSinceProgress: output.msSinceProgress,
        clockGapMs: output.clockGapMs,
        sleepGapMs: output.sleepGapMs,
        cliVersion: options.cliVersion,
        stdout: output.stdout.slice(-1000),
        stderr: output.stderrTail,
      })
      // The diagnosis goes in the message too: the app keeps it as the chunk's error («Devuelto por el worker: …»).
      throw new EngineError(
        `engine-cli ${command} terminó con código 0 sin resultado válido (${cutDiagnosis(output, options.cliVersion)}): ${resultProblem(error)}`,
        0,
        // engine-cli exits 0 only after writing it: a missing file means its process was ended from outside before
        // the end (the S25, 12/10/2026) or the file was removed, this worker's problem; a bad one is the engine's.
        existsSync(resultFile) ? 'invalid_result' : 'missing_result',
      )
    }
  } catch (error) {
    // A lost result with a checkpoint: the folder stays for the run that resumes it.
    const resumable = options.keepOnLoss && error instanceof EngineError && error.code === 'missing_result'
    if (!resumable) await removeWorkDir(dir)
    throw error
  }
}
