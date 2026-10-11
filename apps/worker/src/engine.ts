/**
 * Runs engine-cli (engine/src/main.rs): JSON job in, JSON result out, `total <n>` and `progress <n>` lines on stderr.
 * Exit codes: 0 ok, 2 bad input, 3 engine failure. A run can be stopped (job cancelled, shutdown) with its signal.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Log } from './client.js'
import { type EnginePriority, setEnginePriority } from './priority.js'
import { createWorkDir, removeWorkDir } from './work-dir.js'

export interface EngineVersion {
  engineRev: string
  cliVersion: string
  cards: number
  /** What it can do beyond the commands of 0.1.0 (`perGame`, `batch`…); missing in engines from before 0.2.1. */
  features?: string[]
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
}

function run(
  enginePath: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderrTail: string }> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason)
  return new Promise((resolve, reject) => {
    // A .js/.mjs engine is a script run with this Node (the fake engine of the tests).
    const [command, prefix] = /\.m?js$/.test(enginePath) ? [process.execPath, [enginePath]] : [enginePath, []]
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    setEnginePriority(child.pid, options.priority ?? 'normal', options.log ?? console.error)
    let stdout = ''
    let stderrTail = ''
    let total: number | null = null
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
      for (const line of chunk.split(/\r?\n/)) {
        const totalMatch = /^total (\d+)$/.exec(line.trim())
        if (totalMatch) total = Number(totalMatch[1])
        const progress = /^progress (\d+)$/.exec(line.trim())
        if (progress) options.onProgress?.(Number(progress[1]), total)
      }
    })
    const abort = () => child.kill()
    options.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort)
      reject(new EngineError(`no se pudo ejecutar ${enginePath}: ${error.message}`, null, 'spawn'))
    })
    child.on('close', (code, signal) => {
      options.log?.('motor terminado', { command: args[0], pid: child.pid, exitCode: code, signal })
      options.signal?.removeEventListener('abort', abort)
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('cancelado'))
        return
      }
      if (code === 0 && signal === null) {
        resolve({ stdout, stderrTail })
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

/** Writes the job to a temp folder, runs the command, returns the parsed result and the folder (for replays). */
export async function runJob<T>(
  enginePath: string,
  command: 'simulate' | 'batch' | 'optimize' | 'consistency',
  job: Record<string, unknown>,
  workDir: string,
  options: RunOptions = {},
): Promise<{ result: T; dir: string }> {
  const dir = createWorkDir(workDir, `${command}-`)
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
        exitCode: 0,
        signal: null,
        stdout: output.stdout.slice(-1000),
        stderr: output.stderrTail,
      })
      throw new EngineError(
        `engine-cli ${command} terminó con código 0 sin resultado válido: ${String(error)}`,
        0,
        'missing_result',
      )
    }
  } catch (error) {
    await removeWorkDir(dir)
    throw error
  }
}
