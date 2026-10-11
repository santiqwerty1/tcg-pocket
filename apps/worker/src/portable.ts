/**
 * The portable worker («paquete del worker»): `tcg-worker.exe` (Node and this worker in one executable) next to
 * `engine-cli.exe`, for another PC without the repository, Node or Rust. More PCs play the chunks of a simulation in
 * parallel; each one claims its own.
 *
 *   tcg-worker.exe                setup: token, cores and name; a check against the engine and the app; logon start
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
import { installAutostart, uninstallAutostart } from './autostart.js'
import { type ConfigDefaults, configFile, dataDir, readFileConfig, writeFileConfig } from './config.js'
import { checkDeterminism, DETERMINISM_MISMATCH, DeterminismError } from './determinism.js'
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

async function setup(context: PortableContext): Promise<void> {
  console.log(`TCG Pocket: worker de simulación ${WORKER_VERSION}\n`)
  const current = readFileConfig()
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    // An older worker (another folder, or the repository's) keeps the lock: the new one would not start.
    const { workers, others } = lockOwners()
    if (workers.length > 0) {
      for (const { pid, line } of workers) console.log(`Worker corriendo: PID ${pid} — ${line}`)
      const answer = (
        await rl.question('¿Lo detengo para usar este? Lo que esté jugando vuelve a la cola. [S/n]: ')
      ).trim()
      if (/^n/i.test(answer)) {
        console.log('No toco nada. Cerralo (Administrador de tareas o cerrar sesión) y volvé a abrir este programa.')
        return
      }
      for (const { pid } of workers) {
        stopTree(pid)
        for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
      }
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
    const server = current.server ?? DEFAULT_SERVER
    console.log(`Servidor: ${server}`)
    const hasToken = current.token?.startsWith('tcg_wk_') === true
    let token = current.token ?? ''
    for (;;) {
      const answer = (
        await rl.question(
          hasToken
            ? 'Token del worker (Enter = dejar el que está): '
            : 'Token del worker (en la app: Más → Tokens de API → nuevo, tipo worker): ',
        )
      ).trim()
      if (!answer && hasToken) break
      if (answer.startsWith('tcg_wk_')) {
        token = answer
        break
      }
      console.log('Ese no es un token de worker: empieza con tcg_wk_.')
    }
    const max = availableParallelism()
    const suggested = current.cores ?? max
    const coresAnswer = (
      await rl.question(
        `Hilos a usar (esta PC tiene ${max}; la prioridad baja deja CPU a la CI; Enter = ${suggested}): `,
      )
    ).trim()
    const parsed = Number(coresAnswer)
    const cores = coresAnswer && Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : suggested
    const name = current.name ?? hostname()
    const nameAnswer = (await rl.question(`Nombre de esta PC en la app (Enter = ${name}): `)).trim()
    // D-026: the engine is the package's (the updates replace it); an old `enginePath` would only confuse.
    const { enginePath: _engine, ...kept } = current
    writeFileConfig({
      ...kept,
      server,
      token,
      cores,
      priority: current.priority ?? 'below_normal',
      name: nameAnswer || name,
    })
    console.log(`\nConfiguración guardada en ${configFile()}.`)
    console.log('Probando el motor y la conexión con la app…')
    await run(['--check'], defaultsOf(context), { installation: installationOf(context) })
    installAutostart([process.execPath, '--run'])
    console.log(
      '\nListo: el worker queda corriendo y arranca solo cada vez que inicies sesión. En la app lo ves en Más → Simulación.',
    )
    console.log('Se actualiza solo cuando la app tiene una versión nueva (entre partidas, nunca a mitad de un chunk).')
  } catch (error) {
    console.log(`\nNo se pudo terminar: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rl.question('\nEnter para cerrar.')
    rl.close()
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
  await setup(context)
  return 0
}
