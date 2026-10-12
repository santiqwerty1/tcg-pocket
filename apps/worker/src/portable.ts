/**
 * The portable worker («paquete del worker»): `tcg-worker.exe` (Node and this worker in one executable) next to
 * `engine-cli.exe`, for another PC without the repository, Node or Rust. More PCs play the chunks of a simulation in
 * parallel; each one claims its own.
 *
 *   tcg-worker.exe                setup: token, cores and name; a check against the engine and the app; logon start
 *   tcg-worker.exe --setup --keep the same without questions, keeping config.json (from a script or a Claude session)
 *   tcg-worker.exe --run          what the logon start runs: the supervisor, which keeps a `--child` going (D-026)
 *   tcg-worker.exe --check        configuration, engine, server reachability and updates
 *   tcg-worker.exe --once         at most one chunk, then exit
 *   tcg-worker.exe --uninstall    removes the logon start
 *   tcg-worker.exe --check-engine the engine check of a downloaded release (run by the updater, D-026)
 *
 * This module is also the code of each downloaded release (`worker.cjs`): `sea.ts`, built into the executable, loads
 * the current release and calls its `main`. Keep `main` and `PortableContext` compatible with older executables.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { installAutostart, startNow, uninstallAutostart } from './autostart.js'
import { type ConfigDefaults, configFile, dataDir, type FileConfig, readFileConfig } from './config.js'
import { checkDeterminism, DETERMINISM_MISMATCH, DeterminismError } from './determinism.js'
import { insidePackage, runOutside } from './outside.js'
import { run } from './run.js'
import { type RunningWorker, runSetup, type SetupDeps, SetupInterrupted, type StaleLock } from './setup.js'
import { type Installation, windowsInstallation } from './update.js'
import { WORKER_VERSION } from './version.js'

const DEFAULT_SERVER = 'https://tcg-pocket.fly.dev'

/** What tcg-worker.exe tells the code it runs (the contract between the executable and its releases). */
export interface PortableContext {
  /** The downloaded release being run, or null for the code built into the executable. */
  releaseDir: string | null
  /** The executable's build: its releases' pointer carries it, so a zip installed by hand starts on its own code. */
  buildId: string
}

function defaultsOf(context: PortableContext): ConfigDefaults {
  const folder = context.releaseDir ?? dirname(process.execPath)
  return {
    enginePath: join(folder, process.platform === 'win32' ? 'engine-cli.exe' : 'engine-cli'),
    packageEngine: true,
  }
}

function installationOf(context: PortableContext): Installation | null {
  return process.platform === 'win32' ? windowsInstallation(dataDir(), context.releaseDir, context.buildId) : null
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A process's command line (Windows), to be sure a lock's PID still is a worker before stopping it. */
function commandLine(pid: number): string {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  )
  return result.status === 0 ? result.stdout.trim() : ''
}

/** tcg-worker.exe (any copy) or the repository's `node …apps/worker/dist/main.js`. */
export const looksLikeWorker = (line: string) =>
  /tcg-worker\.exe|[\\/]apps[\\/]worker[\\/]dist[\\/]main\.js/i.test(line)

/**
 * Who holds this folder's locks: the supervisor and the worker, supervisor first (stopping the worker first would
 * make the supervisor start it again; restarting the supervisor brings its worker back), and the locks whose PID now
 * belongs to another program (or cannot be checked).
 */
function lockOwners(): { workers: RunningWorker[]; stale: StaleLock[] } {
  const workers: RunningWorker[] = []
  const stale: StaleLock[] = []
  for (const lock of [join(dataDir(), 'supervisor', 'worker.lock'), join(dataDir(), 'worker.lock')]) {
    try {
      const pid = Number(readFileSync(lock, 'utf8').trim())
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !alive(pid)) continue
      const line = commandLine(pid)
      if (looksLikeWorker(line)) workers.push({ pid, line })
      else stale.push({ lock, pid, line })
    } catch {
      // No lock.
    }
  }
  return { workers, stale }
}

/**
 * Answers read line by line: with stdin redirected from a file, `rl.question` dropped the lines already buffered and
 * the setup ended at EOF halfway (11/10/2026). The iterator keeps them in order; at the end of the file every question
 * gets Enter. Ctrl+C is not Enter: it throws `SetupInterrupted`. With a terminal the question is readline's prompt, so
 * Backspace never erases it.
 */
export function prompter(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
) {
  const terminal = input.isTTY === true
  const rl = createInterface({ input, output, terminal })
  let interrupted = false
  rl.on('SIGINT', () => {
    interrupted = true
    rl.close()
  })
  const lines = rl[Symbol.asyncIterator]()
  return {
    async ask(question: string): Promise<string> {
      if (interrupted) throw new SetupInterrupted()
      if (terminal) {
        rl.setPrompt(question)
        rl.prompt()
      } else output.write(question)
      const next = await lines.next()
      if (interrupted) throw new SetupInterrupted()
      if (next.done) {
        output.write('\n')
        return ''
      }
      return String(next.value).trim()
    },
    /** Ctrl+C from the process (stdin redirected): the waiting question throws. */
    interrupt() {
      interrupted = true
      rl.close()
    },
    get interrupted() {
      return interrupted
    },
    close: () => rl.close(),
  }
}

/** Whether a worker that is not one of `old` holds this folder's lock, waiting up to `timeoutMs`. */
async function workerHoldsLock(old: ReadonlySet<number>, timeoutMs = 20_000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (lockOwners().workers.some((worker) => !old.has(worker.pid))) return true
    await sleep(1000)
  }
  return false
}

/** `--check` with a candidate configuration and nothing saved: the environment overrides config.json while it runs. */
async function checkCandidate(context: PortableContext, config: FileConfig): Promise<boolean> {
  const overrides: Record<string, string> = {
    TCG_WORKER_TOKEN: config.token ?? '',
    TCG_SERVER: config.server ?? DEFAULT_SERVER,
    TCG_WORKER_CORES: String(config.cores ?? ''),
    TCG_WORKER_NAME: config.name ?? '',
    TCG_WORKER_PRIORITY: config.priority ?? 'below_normal',
  }
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]))
  Object.assign(process.env, overrides)
  try {
    return (await run(['--check'], defaultsOf(context), { installation: installationOf(context) })) === 0
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** The PC's side of the setup (`setup.ts`), for this executable. */
function setupDeps(context: PortableContext, prompt: ReturnType<typeof prompter> | null): SetupDeps {
  let interrupted = false
  let holding = false
  // Ctrl+C: before the switch it cancels (a waiting question throws); during the switch it waits.
  process.on('SIGINT', () => {
    if (holding) {
      console.log('\nEsperá: estoy cambiando de worker; en unos segundos termina.')
      return
    }
    interrupted = true
    prompt?.interrupt()
  })
  const file = configFile()
  return {
    log: (message) => console.log(message),
    ask: prompt ? (question) => prompt.ask(question) : null,
    interrupted: () => interrupted || (prompt?.interrupted ?? false),
    holdInterrupts: (hold) => {
      holding = hold
    },
    readConfig: readFileConfig,
    configText: () => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    writeConfigText: (text) => {
      if (text === null) rmSync(file, { force: true })
      else {
        mkdirSync(dataDir(), { recursive: true })
        writeFileSync(file, text, { mode: 0o600 })
      }
    },
    configPath: file,
    check: (config) => checkCandidate(context, config),
    owners: lockOwners,
    releaseLock: (lock) => rmSync(lock, { force: true }),
    stop: async (pid) => {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
    },
    install: () => installAutostart([process.execPath, '--run'], { start: false }),
    start: startNow,
    // The old command line as it was (its own environment comes from this process: we are outside any package here).
    restart: (line) => spawn(line, { shell: true, detached: true, stdio: 'ignore', windowsHide: true }).unref(),
    waitForWorker: (old) => workerHoldsLock(old),
    maxThreads: availableParallelism(),
    hostname: hostname(),
    defaultServer: DEFAULT_SERVER,
  }
}

/**
 * Inside a packaged app (a Claude session), setup reads and writes the app's private copy of AppData, and what it
 * starts dies with the app. So it runs itself again outside, through WMI, with `--setup --keep` (the answers asked
 * here go in a file in TEMP, which is real for both), and shows what that one did.
 */
async function setupFromOutside(answers: FileConfig | null): Promise<number> {
  const id = randomUUID()
  const from = answers ? join(tmpdir(), `tcg-worker-setup-${id}.json`) : null
  const output = join(tmpdir(), `tcg-worker-setup-${id}.log`)
  const result = join(tmpdir(), `tcg-worker-setup-${id}.code`)
  try {
    if (from) writeFileSync(from, JSON.stringify(answers), { mode: 0o600 })
    // A process created through WMI does not inherit this one's environment: the worker's own variables go with it.
    // cmd and a plain redirection: the bytes the worker writes (UTF-8) reach the file as they are (PowerShell would
    // decode them with the console's code page and write them back as UTF-16).
    const environment = Object.entries(process.env)
      .filter(([key, value]) => /^TCG_WORKER_(DIR|AUTOSTART_NAME)$/.test(key) && value)
      .map(([key, value]) => `set "${key}=${value}" & `)
      .join('')
    const args = ['--setup', '--keep', ...(from ? ['--from', from] : []), '--result', result]
    const command = `"${process.execPath}" ${args.map((arg) => `"${arg}"`).join(' ')}`
    console.log('Esto corre dentro de una app empaquetada: hago el setup desde afuera de ella…')
    const finished = await runOutside(`cmd.exe /d /s /c "${environment}${command} > "${output}" 2>&1"`, 6 * 60_000)
    if (existsSync(output)) console.log(readFileSync(output, 'utf8').trim())
    if (!finished) console.log('El setup de afuera no terminó a tiempo: mirá worker.log antes de repetirlo.')
    return existsSync(result) ? Number(readFileSync(result, 'utf8').trim()) || 0 : 1
  } finally {
    for (const path of [from, output, result]) if (path) rmSync(path, { force: true })
  }
}

/** Double click, `--setup [--keep]`: see `setup.ts`. */
async function setup(context: PortableContext, args: readonly string[]): Promise<number> {
  console.log(`TCG Pocket: worker de simulación ${WORKER_VERSION}\n`)
  const keep = args.includes('--keep')
  const fromIndex = args.indexOf('--from')
  const resultIndex = args.indexOf('--result')
  const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : undefined
  let from: FileConfig | null = null
  if (fromFile) {
    from = JSON.parse(readFileSync(fromFile, 'utf8')) as FileConfig
    rmSync(fromFile, { force: true })
  }
  const prompt = keep ? null : prompter()
  let code = 1
  try {
    if (await insidePackage()) {
      // The questions here (this process has the console), everything else outside.
      let answers: FileConfig | null = null
      if (prompt) {
        const current = readFileConfig()
        const token = await prompt.ask('Token del worker (Enter = dejar el que está): ')
        const cores = await prompt.ask(`Hilos a usar (Enter = ${current.cores ?? availableParallelism()}): `)
        const name = await prompt.ask(`Nombre de esta PC en la app (Enter = ${current.name ?? hostname()}): `)
        answers = {
          ...(token ? { token } : {}),
          ...(Number(cores) > 0 ? { cores: Number(cores) } : {}),
          ...(name ? { name } : {}),
        }
      }
      code = await setupFromOutside(answers)
    } else {
      code = await runSetup(setupDeps(context, prompt), { keep: keep || from !== null, from })
    }
  } catch (error) {
    console.log(`\nNo se pudo terminar: ${error instanceof Error ? error.message : String(error)}`)
    code = 1
  } finally {
    const resultFile = resultIndex >= 0 ? args[resultIndex + 1] : undefined
    if (resultFile) writeFileSync(resultFile, String(code))
    if (prompt && !prompt.interrupted) await prompt.ask('\nEnter para cerrar.').catch(() => '')
    prompt?.close()
  }
  return code
}

/** Resolves with the process's exit code (`RESTART_FOR_UPDATE` from `--child` after switching releases). */
export async function main(args: readonly string[], context: PortableContext): Promise<number> {
  if (args.includes('--uninstall')) {
    uninstallAutostart()
    return 0
  }
  if (args.includes('--check-engine')) {
    if (!context.releaseDir) throw new Error('--check-engine prueba una versión bajada (TCG_WORKER_RELEASE).')
    const reference = join(context.releaseDir, 'determinism.json')
    if (!existsSync(reference)) throw new Error('La versión no trae su prueba de determinismo.')
    const work = join(context.releaseDir, 'check')
    mkdirSync(work, { recursive: true })
    try {
      // A few seconds at normal priority: at below normal, a PC busy with the CI starved it past its time limit.
      await checkDeterminism(defaultsOf(context).enginePath ?? '', reference, work, undefined, {
        priority: 'normal',
        caseTimeoutMs: 120_000,
      })
    } catch (error) {
      if (!(error instanceof DeterminismError)) throw error
      console.error(error.message)
      return DETERMINISM_MISMATCH
    }
    console.log('Motor y determinismo: OK')
    return 0
  }
  if (args.some((arg) => arg === '--run' || arg === '--child' || arg === '--check' || arg === '--once')) {
    return run(
      args.filter((arg) => arg !== '--run' && arg !== '--child'),
      defaultsOf(context),
      { installation: installationOf(context) },
    )
  }
  return setup(context, args)
}
