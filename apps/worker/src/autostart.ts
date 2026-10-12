/**
 * Starting the worker at logon (PLAN A.6: Task Scheduler «al iniciar sesión», no extra software), without a console
 * window: the task runs a small hidden launcher (`launch.vbs` in the worker folder). If Windows refuses the logon task
 * (a logon trigger usually needs an administrator), the launcher goes to the Startup folder instead. Either way the
 * worker starts right away too. Used by `install-task` (node + dist/main.js) and by the portable package
 * (`tcg-worker.exe --run`, Fase 21).
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dataDir } from './config.js'

// TCG_WORKER_AUTOSTART_NAME: another task and Startup file (a second install, or a test that must not touch the
// PC's own launcher).
const name = () => process.env.TCG_WORKER_AUTOSTART_NAME
const TASK = () => name() ?? 'TCG Pocket worker'
const startup = () => join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const startupLauncher = () => join(startup(), `${name() ?? 'tcg-pocket-worker'}.vbs`)

/**
 * Runs `command` with a hidden window; the worker logs to worker.log in its folder. A data folder chosen with
 * TCG_WORKER_DIR goes into the launcher too: the worker started at logon (or from outside a package) does not have
 * the environment of the setup that installed it.
 */
export function launcherScript(command: readonly string[]): string {
  const quoted = command.map((part) => `""${part}""`).join(' ')
  const folder = process.env.TCG_WORKER_DIR
  const lines = ['Set shell = CreateObject("WScript.Shell")']
  if (folder) lines.push(`shell.Environment("Process")("TCG_WORKER_DIR") = "${folder.replace(/"/g, '""')}"`)
  lines.push(`shell.Run "${quoted}", 0, False`)
  return `${lines.join('\r\n')}\r\n`
}

/**
 * A launcher in UTF-16 with a BOM: Windows Script Host reads that as Unicode (anything else as the ANSI code page, which
 * breaks a path with an accent, such as a user folder named Sebastián).
 */
function writeLauncher(path: string, script: string): void {
  writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]))
}

/** The file as it was (null: there was none), to put it back. */
const snapshot = (path: string): Buffer | null => (existsSync(path) ? readFileSync(path) : null)
const putBack = (path: string, before: Buffer | null) => {
  if (before) writeFileSync(path, before)
  else rmSync(path, { force: true })
}

/** The logon task's definition (XML, as schtasks gives it), or null when there is none: to put it back. */
function taskDefinition(): Buffer | null {
  try {
    return execFileSync('schtasks', ['/Query', '/TN', TASK(), '/XML'], { stdio: 'pipe' })
  } catch {
    return null
  }
}

/** schtasks writes its reason («Acceso denegado.») to stderr; the error message alone only repeats the command. */
function reason(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString('latin1').trim()
  return stderr || String(error).split('\n')[0] || 'motivo desconocido'
}

/** Starts the worker now through the launcher; if one is already running, the new one exits (worker.lock). */
export function startNow(launcher: string): void {
  spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  console.log(`Worker arrancado (si ya había uno corriendo, sigue ese). Log: ${join(dataDir(), 'worker.log')}`)
}

/** What `installAutostart` did: the launcher that starts the worker, and how to put everything back. */
export interface Autostart {
  launcher: string
  /** The launchers (and a logon task this created) as they were before: setup's way back if the switch fails. */
  restore(): void
}

/**
 * Installs the logon start of `command` (the executable first, then its arguments) and, unless `start` is false
 * (setup starts it itself, maybe from outside a package), starts it now.
 */
export function installAutostart(command: readonly string[], options: { start?: boolean } = {}): Autostart {
  const start = options.start ?? true
  if (process.platform !== 'win32') {
    throw new Error('La tarea programada es para Windows; en otro sistema usá systemd o cron.')
  }
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const launcher = join(dir, 'launch.vbs')
  const script = launcherScript(command)
  const before = { launcher: snapshot(launcher), startup: snapshot(startupLauncher()), task: taskDefinition() }
  let touchedTask = false
  /** Every step on its own: one that fails does not keep the others from being put back. */
  const restore = () => {
    const failures: string[] = []
    const step = (what: string, action: () => void) => {
      try {
        action()
      } catch (error) {
        failures.push(`${what}: ${String(error)}`)
      }
    }
    step(launcher, () => putBack(launcher, before.launcher))
    step(startupLauncher(), () => putBack(startupLauncher(), before.startup))
    if (touchedTask) {
      step(`la tarea «${TASK()}»`, () => {
        if (!before.task) {
          execFileSync('schtasks', ['/Delete', '/TN', TASK(), '/F'], { stdio: 'pipe' })
          return
        }
        // `/F` replaced its definition (its launcher, if TCG_WORKER_DIR pointed elsewhere): the one it had goes back.
        const saved = join(tmpdir(), `tcg-worker-task-${randomUUID()}.xml`)
        writeFileSync(saved, before.task)
        try {
          execFileSync('schtasks', ['/Create', '/TN', TASK(), '/XML', saved, '/F'], { stdio: 'pipe' })
        } finally {
          rmSync(saved, { force: true })
        }
      })
    }
    if (failures.length > 0) throw new Error(`no pude volver a dejar: ${failures.join('; ')}`)
  }
  try {
    writeLauncher(launcher, script)
    try {
      touchedTask = true
      execFileSync(
        'schtasks',
        ['/Create', '/TN', TASK(), '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TR', `wscript.exe "${launcher}"`, '/F'],
        { stdio: 'pipe' },
      )
    } catch (error) {
      touchedTask = false
      console.log(`No se pudo crear la tarea programada (${reason(error)}); uso la carpeta Inicio.`)
      writeLauncher(startupLauncher(), script)
      console.log(`Lanzador creado en ${startupLauncher()}: el worker arranca al iniciar sesión, sin ventana.`)
      if (start) startNow(startupLauncher())
      return { launcher: startupLauncher(), restore }
    }
    console.log(`Tarea «${TASK()}» creada: el worker arranca oculto al iniciar sesión.`)
    // A launcher left in the Startup folder (an earlier install, or the repository's worker) would start a second
    // worker at logon, and whichever came first would keep the lock.
    if (existsSync(startupLauncher())) {
      rmSync(startupLauncher())
      console.log(`Saqué el lanzador anterior de la carpeta Inicio (${startupLauncher()}).`)
    }
    if (start) startNow(launcher)
    return { launcher, restore }
  } catch (error) {
    // Halfway: what was already written goes back before the error goes up.
    try {
      restore()
    } catch (restoreError) {
      console.log(String(restoreError))
    }
    throw error
  }
}

export function uninstallAutostart(): void {
  try {
    execFileSync('schtasks', ['/Delete', '/TN', TASK(), '/F'], { stdio: 'pipe' })
    console.log(`Tarea «${TASK()}» borrada.`)
  } catch {
    // There was no task.
  }
  for (const file of [startupLauncher(), join(dataDir(), 'launch.vbs')]) {
    if (existsSync(file)) {
      rmSync(file)
      console.log(`Lanzador ${file} borrado.`)
    }
  }
  console.log(
    'Si el worker está corriendo, sigue hasta que cierres sesión o lo termines desde el Administrador de tareas.',
  )
}
