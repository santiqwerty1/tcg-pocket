/**
 * Starting the worker at logon (PLAN A.6: Task Scheduler «al iniciar sesión», no extra software), without a console
 * window: the task runs a small hidden launcher (`launch.vbs` in the worker folder). If Windows refuses the logon task
 * (a logon trigger usually needs an administrator), the launcher goes to the Startup folder instead. Either way the
 * worker starts right away too. Used by `install-task` (node + dist/main.js) and by the portable package
 * (`tcg-worker.exe --run`, Fase 21).
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './config.js'

const TASK = 'TCG Pocket worker'
const startup = () => join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
const startupLauncher = () => join(startup(), 'tcg-pocket-worker.vbs')

/** Runs `command` with a hidden window; the worker logs to worker.log in its folder. */
function launcherScript(command: readonly string[]): string {
  const quoted = command.map((part) => `""${part}""`).join(' ')
  return `CreateObject("WScript.Shell").Run "${quoted}", 0, False\r\n`
}

/** schtasks writes its reason («Acceso denegado.») to stderr; the error message alone only repeats the command. */
function reason(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString('latin1').trim()
  return stderr || String(error).split('\n')[0] || 'motivo desconocido'
}

/** Starts the worker now through the launcher; if one is already running, the new one exits (worker.lock). */
function startNow(launcher: string): void {
  spawn('wscript.exe', [launcher], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  console.log(`Worker arrancado (si ya había uno corriendo, sigue ese). Log: ${join(dataDir(), 'worker.log')}`)
}

/** Installs the logon start of `command` (the executable first, then its arguments) and starts it now. */
export function installAutostart(command: readonly string[]): void {
  if (process.platform !== 'win32') {
    throw new Error('La tarea programada es para Windows; en otro sistema usá systemd o cron.')
  }
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const launcher = join(dir, 'launch.vbs')
  writeFileSync(launcher, launcherScript(command))
  try {
    execFileSync(
      'schtasks',
      ['/Create', '/TN', TASK, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TR', `wscript.exe "${launcher}"`, '/F'],
      { stdio: 'pipe' },
    )
    console.log(`Tarea «${TASK}» creada: el worker arranca oculto al iniciar sesión.`)
    // A launcher left in the Startup folder (an earlier install, or the repository's worker) would start a second
    // worker at logon, and whichever came first would keep the lock.
    if (existsSync(startupLauncher())) {
      rmSync(startupLauncher())
      console.log(`Saqué el lanzador anterior de la carpeta Inicio (${startupLauncher()}).`)
    }
    startNow(launcher)
    return
  } catch (error) {
    console.log(`No se pudo crear la tarea programada (${reason(error)}); uso la carpeta Inicio.`)
  }
  writeFileSync(startupLauncher(), launcherScript(command))
  console.log(`Lanzador creado en ${startupLauncher()}: el worker arranca al iniciar sesión, sin ventana.`)
  startNow(startupLauncher())
}

export function uninstallAutostart(): void {
  try {
    execFileSync('schtasks', ['/Delete', '/TN', TASK, '/F'], { stdio: 'pipe' })
    console.log(`Tarea «${TASK}» borrada.`)
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
