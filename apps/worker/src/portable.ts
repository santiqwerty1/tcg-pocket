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
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { availableParallelism, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { installAutostart, startNow, uninstallAutostart } from './autostart.js'
import { type ConfigDefaults, configFile, dataDir, readFileConfig, writeFileConfig } from './config.js'
import { checkDeterminism, DETERMINISM_MISMATCH, DeterminismError } from './determinism.js'
import { insidePackage, processesRunning, startOutside, visibleOutside, writeOutside } from './outside.js'
import { run } from './run.js'
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
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 },
  )
  return result.status === 0 ? result.stdout.trim() : ''
}

/** tcg-worker.exe (any copy) or the repository's `node …apps/worker/dist/main.js`. */
export const looksLikeWorker = (line: string) =>
  /tcg-worker\.exe|[\\/]apps[\\/]worker[\\/]dist[\\/]main\.js/i.test(line)

interface LockOwner {
  lock: string
  pid: number
  line: string
}

/**
 * Who holds this folder's locks: the supervisor and the worker, supervisor first (stopping the worker first would
 * make the supervisor start it again), and the locks whose PID now belongs to another program (or cannot be checked).
 */
function lockOwners(): { workers: LockOwner[]; others: LockOwner[] } {
  const workers: LockOwner[] = []
  const others: LockOwner[] = []
  for (const lock of [join(dataDir(), 'supervisor', 'worker.lock'), join(dataDir(), 'worker.lock')]) {
    try {
      const pid = Number(readFileSync(lock, 'utf8').trim())
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !alive(pid)) continue
      const line = commandLine(pid)
      ;(looksLikeWorker(line) ? workers : others).push({ lock, pid, line })
    } catch {
      // No lock.
    }
  }
  return { workers, others }
}

/** The process and everything it started: its engine-cli would otherwise keep playing a chunk nobody uploads. */
function stopTree(pid: number): void {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

/**
 * Answers read line by line: with stdin redirected from a file, `rl.question` dropped the lines already buffered and
 * the setup ended at EOF halfway (11/10/2026). The iterator keeps them in order; at EOF every question gets Enter.
 */
export function prompter(
  input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
) {
  const rl = createInterface({ input, output, terminal: input.isTTY === true })
  const lines = rl[Symbol.asyncIterator]()
  return {
    async ask(question: string): Promise<string> {
      output.write(question)
      const next = await lines.next()
      if (next.done) output.write('\n')
      return next.done ? '' : String(next.value).trim()
    },
    close: () => rl.close(),
  }
}

/** Waits for this `tcg-worker.exe --run` (by its path) to be running; whether it showed up. */
async function workerStarted(timeoutMs = 20_000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (processesRunning(process.execPath, '--run').length > 0) return true
    await sleep(1000)
  }
  return false
}

/**
 * Setup (double click, or `--setup`): token, threads and name, a check of the engine and the app, the logon start
 * and the worker started. `--setup --keep` asks nothing and keeps what config.json has (a token is required). Order
 * (revisión del 11/10): everything is asked and checked before an older worker is stopped, and if the new one does
 * not start, the old one is started again: setup never leaves the PC without a worker. From a packaged app (a Claude
 * session), what the real worker needs is written and started from outside it (`outside.ts`).
 */
async function setup(context: PortableContext, options: { keep: boolean }): Promise<number> {
  console.log(`TCG Pocket: worker de simulación ${WORKER_VERSION}\n`)
  const current = readFileConfig()
  const prompt = options.keep ? null : prompter()
  const ask = async (question: string) => (prompt ? prompt.ask(question) : '')
  try {
    const server = current.server ?? DEFAULT_SERVER
    console.log(`Servidor: ${server}`)
    const hasToken = current.token?.startsWith('tcg_wk_') === true
    if (options.keep && !hasToken) {
      throw new Error(
        `--keep conserva la configuración, pero ${configFile()} no tiene un token de worker: corré el setup con preguntas.`,
      )
    }
    let token = current.token ?? ''
    while (!options.keep) {
      const answer = await ask(
        hasToken
          ? 'Token del worker (Enter = dejar el que está): '
          : 'Token del worker (en la app: Más → Tokens de API → nuevo, tipo worker): ',
      )
      if (!answer && hasToken) break
      if (answer.startsWith('tcg_wk_')) {
        token = answer
        break
      }
      if (!answer)
        throw new Error('Sin token no hay worker: creá uno de tipo worker en la app y volvé a abrir este programa.')
      console.log('Ese no es un token de worker: empieza con tcg_wk_.')
    }
    const max = availableParallelism()
    const suggested = current.cores ?? max
    const coresAnswer = await ask(
      `Hilos a usar (esta PC tiene ${max}; la prioridad baja deja CPU a la CI; Enter = ${suggested}): `,
    )
    const parsed = Number(coresAnswer)
    const cores = coresAnswer && Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : suggested
    const name = current.name ?? hostname()
    const nameAnswer = await ask(`Nombre de esta PC en la app (Enter = ${name}): `)

    // An older worker (another folder, or the repository's) keeps the lock: the new one would not start.
    const { workers, others } = lockOwners()
    let stopOld = workers.length > 0
    if (workers.length > 0) {
      for (const { pid, line } of workers) console.log(`Worker corriendo: PID ${pid} — ${line}`)
      if (!options.keep) {
        const answer = await ask('¿Lo detengo para usar este? Lo que esté jugando vuelve a la cola. [S/n]: ')
        stopOld = !/^n/i.test(answer)
      }
      if (!stopOld) {
        console.log('No toco nada. Cerralo (Administrador de tareas o cerrar sesión) y volvé a abrir este programa.')
        return 1
      }
    }

    // D-026: the engine is the package's (the updates replace it); an old `enginePath` would only confuse.
    const { enginePath: _engine, ...kept } = current
    const config = {
      ...kept,
      server,
      token,
      cores,
      priority: current.priority ?? 'below_normal',
      name: nameAnswer || name,
    }
    writeFileConfig(config)
    console.log(`\nConfiguración guardada en ${configFile()}.`)
    console.log('Probando el motor y la conexión con la app…')
    // Before anything is stopped: a bad token or an unreachable app leaves the old worker running.
    await run(['--check'], defaultsOf(context), { installation: installationOf(context) })

    for (const { pid } of workers) {
      stopTree(pid)
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
    }
    if (workers.length > 0) {
      console.log('Worker anterior detenido (con sus motores). Lo que jugaba vuelve a la cola en hasta 3 minutos.')
    }
    for (const { lock, pid, line } of others) {
      if (line) {
        // The PID was reused by another program after the worker died: the lock is stale and would stop the new one.
        rmSync(lock, { force: true })
        console.log(`El lock ${lock} era del PID ${pid}, que ahora es otro programa (${line}): lo liberé.`)
      } else {
        console.log(
          `No pude ver qué programa es el PID ${pid}, dueño de ${lock}. Si es un worker, cerralo desde el Administrador de tareas; si no, borrá ese archivo. Mientras siga ahí, el worker nuevo no arranca.`,
        )
      }
    }

    const autostart = installAutostart([process.execPath, '--run'], { start: false })
    const packaged = await insidePackage()
    if (packaged) {
      // A Claude session (or another packaged app): its writes to new AppData folders stay in its private copy, and
      // what it starts dies with it. The real worker must find its files and run outside.
      console.log('Esto corre dentro de una app empaquetada: escribo y arranco el worker desde afuera de ella.')
      const files = [{ path: configFile(), content: `${JSON.stringify(config, null, 2)}\n` }, ...autostart.files]
      const seen = await visibleOutside(files.map((file) => file.path))
      for (const [i, file] of files.entries()) {
        if (seen[i]) continue
        if (!(await writeOutside(file.path, file.content)))
          throw new Error(`No pude escribir ${file.path} desde afuera.`)
        console.log(`Escrito desde afuera: ${file.path}`)
      }
      if (startOutside(`wscript.exe "${autostart.launcher}"`) === null) {
        throw new Error('No pude arrancar el worker desde afuera (WMI).')
      }
    } else startNow(autostart.launcher)

    if (process.platform === 'win32' && !(await workerStarted())) {
      // Never a PC without a worker: the one that ran before comes back.
      for (const { line } of workers) startOutside(line)
      throw new Error(
        workers.length > 0
          ? 'El worker nuevo no arrancó: volví a arrancar el anterior. Mirá worker.log.'
          : 'El worker nuevo no arrancó. Mirá worker.log.',
      )
    }
    console.log(
      '\nListo: el worker queda corriendo y arranca solo cada vez que inicies sesión. En la app lo ves en Más → Simulación.',
    )
    console.log('Se actualiza solo cuando la app tiene una versión nueva (entre partidas, nunca a mitad de un chunk).')
    return 0
  } catch (error) {
    console.log(`\nNo se pudo terminar: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  } finally {
    if (prompt) {
      await prompt.ask('\nEnter para cerrar.')
      prompt.close()
    }
  }
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
  return setup(context, { keep: args.includes('--keep') })
}
