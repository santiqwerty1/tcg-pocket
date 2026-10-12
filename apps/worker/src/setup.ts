/**
 * The portable worker's setup (D-026, revisión del #63): token, threads and name; then a new worker in place of the
 * old one without ever leaving the PC without a worker. Everything that can fail runs before the old worker is
 * stopped (the questions, a check of the candidate configuration without saving it, the launchers); between stopping
 * the old worker and seeing the new one hold its lock, Ctrl+C is ignored, and any failure puts the configuration and
 * the launchers back and starts the old supervisor again (and says so only once it is seen running). The PC's side
 * effects come in through `SetupDeps`, so the order is tested without touching the PC.
 */
import type { FileConfig } from './config.js'

export interface RunningWorker {
  pid: number
  /** Its command line: how to start it again. */
  line: string
}

export interface StaleLock {
  lock: string
  pid: number
  /** The program that now has the PID ('' when it could not be checked). */
  line: string
}

export interface InstalledStart {
  /** The launcher that starts the new worker now. */
  launcher: string
  /** Puts back the launchers (and the logon task) as they were before. */
  restore(): void
}

/** Ctrl+C before the switch: nothing was changed. */
export class SetupInterrupted extends Error {
  constructor() {
    super('Cancelado: no cambié nada.')
  }
}

export interface SetupDeps {
  log(message: string): void
  /** Null with `--keep` (no questions). Throws `SetupInterrupted` on Ctrl+C. */
  ask: ((question: string) => Promise<string>) | null
  /** Whether Ctrl+C arrived (also while the check runs). */
  interrupted(): boolean
  /** Ctrl+C does nothing while it returns true (the switch). */
  holdInterrupts(hold: boolean): void
  readConfig(): FileConfig
  /** The configuration file as it is (null: there is none), to put it back. */
  configText(): string | null
  writeConfigText(text: string | null): void
  configPath: string
  /** `--check` with the candidate configuration, without saving it: engine, app, token. */
  check(config: FileConfig): Promise<boolean>
  /** The worker processes holding this folder's locks (supervisor first) and the locks held by other programs. */
  owners(): { workers: RunningWorker[]; stale: StaleLock[] }
  releaseLock(lock: string): void
  /** The process and its tree (its engines). */
  stop(pid: number): Promise<void>
  /** The logon start and its launchers for this executable (not started). */
  install(): InstalledStart
  start(launcher: string): void
  /** Starts an old worker again from its command line. */
  restart(line: string): void
  /** Waits (up to ~20 s) for a worker that `accept` takes to hold this folder's lock. */
  waitForWorker(accept: (worker: RunningWorker) => boolean): Promise<boolean>
  maxThreads: number
  hostname: string
  defaultServer: string
}

export interface SetupOptions {
  keep: boolean
  /** A candidate configuration prepared elsewhere (the questions asked inside a packaged app). */
  from?: FileConfig | null
}

/** The executable of a command line (its first token, quoted or not), to tell the old worker from the new one. */
export function executableOf(line: string): string {
  const match = /^\s*(?:"([^"]+)"|(\S+))/.exec(line)
  return (match?.[1] ?? match?.[2] ?? '').toLowerCase()
}

/** Runs one step of putting things back; a failure is reported and the next step still runs. */
function attempt(deps: SetupDeps, what: string, step: () => void): void {
  try {
    step()
  } catch (error) {
    deps.log(`No pude ${what} (${String(error)}).`)
  }
}

async function ask(deps: SetupDeps, question: string): Promise<string> {
  if (!deps.ask) return ''
  return deps.ask(question)
}

/** Resolves with the exit code: 0 with a new worker running, 1 otherwise (and the old one running if there was one). */
export async function runSetup(deps: SetupDeps, options: SetupOptions): Promise<number> {
  const current = { ...deps.readConfig(), ...(options.from ?? {}) }
  const hasToken = current.token?.startsWith('tcg_wk_') === true
  if ((options.keep || !deps.ask) && !hasToken) {
    deps.log(
      `Sin preguntas hace falta un token de worker en ${deps.configPath}: corré el setup con preguntas. No cambié nada.`,
    )
    return 1
  }
  const server = current.server ?? deps.defaultServer
  deps.log(`Servidor: ${server}`)
  let token = current.token ?? ''
  while (deps.ask && !options.keep) {
    const answer = await ask(
      deps,
      hasToken
        ? 'Token del worker (Enter = dejar el que está): '
        : 'Token del worker (en la app: Más → Tokens de API → nuevo, tipo worker): ',
    )
    if (!answer && hasToken) break
    if (answer.startsWith('tcg_wk_')) {
      token = answer
      break
    }
    if (!answer) {
      deps.log(
        'Sin token no hay worker: creá uno de tipo worker en la app y volvé a abrir este programa. No cambié nada.',
      )
      return 1
    }
    deps.log('Ese no es un token de worker: empieza con tcg_wk_.')
  }
  const suggested = current.cores ?? deps.maxThreads
  const coresAnswer = options.keep
    ? ''
    : await ask(
        deps,
        `Hilos a usar (esta PC tiene ${deps.maxThreads}; la prioridad baja deja CPU a la CI; Enter = ${suggested}): `,
      )
  const parsed = Number(coresAnswer)
  const cores = coresAnswer && Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, deps.maxThreads) : suggested
  const name = current.name ?? deps.hostname
  const nameAnswer = options.keep ? '' : await ask(deps, `Nombre de esta PC en la app (Enter = ${name}): `)

  const { workers, stale } = deps.owners()
  if (workers.length > 0) {
    for (const { pid, line } of workers) deps.log(`Worker corriendo: PID ${pid} — ${line}`)
    if (!options.keep && deps.ask) {
      const answer = await ask(deps, '¿Lo detengo para usar este? Lo que esté jugando vuelve a la cola. [S/n]: ')
      if (/^n/i.test(answer)) {
        deps.log('No toco nada. Cerralo (Administrador de tareas o cerrar sesión) y volvé a abrir este programa.')
        return 1
      }
    }
  }

  // D-026: the engine is the package's (the updates replace it); an old `enginePath` would only confuse.
  const { enginePath: _engine, ...kept } = current
  const config: FileConfig = {
    ...kept,
    server,
    token,
    cores,
    priority: current.priority ?? 'below_normal',
    name: nameAnswer || name,
  }
  deps.log('Probando el motor y la conexión con la app (sin guardar nada todavía)…')
  if (!(await deps.check(config)) || deps.interrupted()) {
    deps.log(deps.interrupted() ? 'Cancelado: no cambié nada.' : 'La prueba falló (ver arriba): no cambié nada.')
    return 1
  }

  // Everything that can fail, before the old worker stops: the configuration and the launchers.
  const previousConfig = deps.configText()
  deps.writeConfigText(`${JSON.stringify(config, null, 2)}\n`)
  deps.log(`Configuración guardada en ${deps.configPath}.`)
  let installed: InstalledStart
  try {
    installed = deps.install()
  } catch (error) {
    attempt(deps, `volver a dejar ${deps.configPath}`, () => deps.writeConfigText(previousConfig))
    deps.log(`No se pudo instalar el arranque (${String(error)}): dejé todo como estaba.`)
    return 1
  }
  const putBack = () => {
    attempt(deps, 'volver a dejar los lanzadores', () => installed.restore())
    attempt(deps, `volver a dejar ${deps.configPath}`, () => deps.writeConfigText(previousConfig))
  }
  if (deps.interrupted()) {
    putBack()
    deps.log('Cancelado: dejé todo como estaba.')
    return 1
  }
  for (const { lock, pid, line } of stale) {
    if (line) {
      // The PID was reused by another program after the worker died: the lock is stale and would stop the new one.
      deps.releaseLock(lock)
      deps.log(`El lock ${lock} era del PID ${pid}, que ahora es otro programa (${line}): lo liberé.`)
    } else {
      deps.log(
        `No pude ver qué programa es el PID ${pid}, dueño de ${lock}. Si es un worker, cerralo desde el Administrador de tareas; si no, borrá ese archivo. Mientras siga ahí, el worker nuevo no arranca.`,
      )
    }
  }

  // The switch: only stopping and starting. Ctrl+C waits; a failure puts everything back.
  const old = new Set(workers.map((worker) => worker.pid))
  deps.holdInterrupts(true)
  try {
    for (const { pid } of workers) await deps.stop(pid)
    if (workers.length > 0) deps.log('Worker anterior detenido (con sus motores).')
    deps.start(installed.launcher)
    if (!(await deps.waitForWorker((worker) => !old.has(worker.pid)))) throw new Error('el worker nuevo no arrancó')
  } catch (error) {
    // Each step on its own, and the old worker comes back whatever fails here (an antivirus holding a .vbs).
    putBack()
    const supervisor = workers[0]
    if (!supervisor) {
      deps.log(
        `No se pudo terminar (${String(error)}): dejé la configuración y el arranque como estaban. Mirá worker.log.`,
      )
      return 1
    }
    // A new worker that took the lock late would keep it (and run with the old configuration): out first.
    const late = new Set<number>()
    try {
      for (const worker of deps.owners().workers) {
        if (old.has(worker.pid)) continue
        late.add(worker.pid)
        await deps.stop(worker.pid)
      }
    } catch (stopError) {
      deps.log(`No pude detener al worker nuevo (${String(stopError)}).`)
    }
    // Only the old supervisor (or the old single process): a loose child could take the lock from it.
    attempt(deps, 'volver a arrancar el worker anterior', () => deps.restart(supervisor.line))
    const exe = executableOf(supervisor.line)
    const back = await deps
      .waitForWorker((worker) => !late.has(worker.pid) && executableOf(worker.line) === exe)
      .catch(() => false)
    deps.log(
      back
        ? `No se pudo terminar (${String(error)}): volví a dejar todo como estaba, con el worker anterior corriendo.`
        : `No se pudo terminar (${String(error)}) y el worker anterior no volvió a arrancar: arrancalo a mano (${supervisor.line}).`,
    )
    return 1
  } finally {
    deps.holdInterrupts(false)
  }
  deps.log(
    '\nListo: el worker queda corriendo y arranca solo cada vez que inicies sesión. En la app lo ves en Más → Simulación.',
  )
  deps.log('Se actualiza solo cuando la app tiene una versión nueva (entre partidas, nunca a mitad de un chunk).')
  return 0
}
