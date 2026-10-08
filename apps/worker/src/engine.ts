/**
 * Runs engine-cli (engine/src/main.rs): JSON job in, JSON result out, `total <n>` and `progress <n>` lines on stderr.
 * Exit codes: 0 ok, 2 bad input, 3 engine failure. A run can be stopped (job cancelled, shutdown) with its signal.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface EngineVersion {
  engineRev: string
  cliVersion: string
  cards: number
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
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

export interface RunOptions {
  signal?: AbortSignal | undefined
  onProgress?: ((done: number, total: number | null) => void) | undefined
}

function run(enginePath: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // A .js/.mjs engine is a script run with this Node (the fake engine of the tests).
    const [command, prefix] = /\.m?js$/.test(enginePath) ? [process.execPath, [enginePath]] : [enginePath, []]
    const child = spawn(command, [...prefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
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
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (options.signal?.aborted) {
        reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('cancelado'))
        return
      }
      if (code === 0) {
        resolve(stdout)
        return
      }
      let message = stderrTail.trim() || `engine-cli terminó con código ${code}`
      let errorCode: string | null = null
      try {
        const parsed = JSON.parse(stdout.trim()) as { error?: string; code?: string; detail?: unknown }
        if (parsed.error) message = parsed.detail ? `${parsed.error}: ${JSON.stringify(parsed.detail)}` : parsed.error
        errorCode = parsed.code ?? null
      } catch {
        // stdout was not JSON: keep the stderr tail.
      }
      reject(new EngineError(message, code, errorCode))
    })
  })
}

export async function engineVersion(enginePath: string): Promise<EngineVersion> {
  return JSON.parse(await run(enginePath, ['version'])) as EngineVersion
}

export async function engineStatus(enginePath: string): Promise<EngineCardStatus[]> {
  return JSON.parse(await run(enginePath, ['status'])) as EngineCardStatus[]
}

/** Writes the job to a temp folder, runs the command, returns the parsed result and the folder (for replays). */
export async function runJob<T>(
  enginePath: string,
  command: 'simulate' | 'optimize',
  job: Record<string, unknown>,
  workDir: string,
  options: RunOptions = {},
): Promise<{ result: T; dir: string }> {
  const dir = await mkdtemp(join(workDir, `${command}-`))
  const jobFile = join(dir, 'job.json')
  const resultFile = join(dir, 'result.json')
  await writeFile(
    jobFile,
    JSON.stringify({ ...job, ...(command === 'simulate' ? { replayDir: join(dir, 'replays') } : {}) }),
  )
  try {
    await run(enginePath, [command, jobFile, resultFile], options)
    return { result: JSON.parse(await readFile(resultFile, 'utf8')) as T, dir }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
