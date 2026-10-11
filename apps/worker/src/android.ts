import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { stopAndroidWorker } from './android-stop.js'
import { isPluggedIn, whileCharging } from './battery.js'
import { dataDir, loadConfig, readFileConfig } from './config.js'
import { checkDeterminism, DETERMINISM_MISMATCH, DeterminismError } from './determinism.js'
import { acquireLock, releaseLock } from './lock.js'
import { logger, run } from './run.js'
import { androidInstallation, RESTART_FOR_UPDATE, rollBackUnhealthy } from './update.js'

const execute = promisify(execFile)
// The release folder itself (`releases/<sha256>`): Node resolves the `current` symlink of the launcher's path.
const here = dirname(fileURLToPath(import.meta.url))
const installation = androidInstallation(here)
const defaults = {
  enginePath: join(here, 'engine-cli'),
  determinismPath: join(here, 'determinism.json'),
  capThreads: true,
  allowSlowBots: false,
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--stop')) {
    // The installer runs the newly downloaded bundle against the previous install before replacing it.
    console.log(await stopAndroidWorker(dataDir(), process.env.TCG_ANDROID_WORKER_ENTRY ?? process.argv[1] ?? ''))
    return
  }
  if (args.includes('--check-engine')) {
    try {
      await checkDeterminism(defaults.enginePath, defaults.determinismPath, here)
    } catch (error) {
      if (!(error instanceof DeterminismError)) throw error
      console.error(error.message)
      process.exitCode = DETERMINISM_MISMATCH
      return
    }
    console.log('Motor y determinismo: OK')
    return
  }
  if (args.includes('--child') || args.includes('--check') || args.includes('--once')) {
    const code = await run(args, defaults, { installation })
    // The supervisor starts `current/worker.mjs` again, which now is the new release (D-026).
    if (code === RESTART_FOR_UPDATE) process.exit(code)
    return
  }
  const config = loadConfig(process.env, defaults)
  const log = logger(join(config.dataDir, 'worker.log'))
  const supervisorDir = join(config.dataDir, 'android')
  mkdirSync(supervisorDir, { recursive: true })
  if (acquireLock(supervisorDir) !== null) throw new Error('Ya hay un lanzador Android corriendo.')
  const controller = new AbortController()
  const stopSignal = () => controller.abort(null)
  process.on('SIGINT', stopSignal)
  process.on('SIGTERM', stopSignal)
  let child: ChildProcess | null = null
  let exited: Promise<void> = Promise.resolve()
  let stoppingChild = false
  // The worker ended on its own with 0 (another one already runs here, for instance): so does the launcher.
  let done = () => {}
  const finished = new Promise<void>((resolve) => {
    done = resolve
  })
  const start = async () => {
    stoppingChild = false
    child = spawn(process.execPath, [process.argv[1] ?? '', '--child'], { stdio: 'inherit' })
    const current = child
    exited = new Promise<void>((resolve, reject) => {
      current.once('error', reject)
      current.once('exit', (code, signal) => {
        child = null
        resolve()
        if (stoppingChild || controller.signal.aborted) return
        // D-026: a new release was switched in (or a bad one rolled back): the same path runs it.
        if (code === RESTART_FOR_UPDATE || ((code || signal) && installation && rollBackUnhealthy(installation, log))) {
          void start()
          return
        }
        if (code || signal) controller.abort(new Error(`El worker terminó (${code ?? signal}).`))
        else done()
      })
    })
  }
  const stop = async () => {
    const current = child
    if (!current) return
    stoppingChild = true
    current.kill('SIGTERM')
    const timeout = setTimeout(() => current.kill('SIGKILL'), 30_000)
    try {
      await exited
    } finally {
      clearTimeout(timeout)
    }
  }
  try {
    await execute('termux-wake-lock', [], { timeout: 10_000 })
    if (readFileConfig().onlyCharging) {
      console.log('Solo mientras carga: al desenchufar libero el trabajo; reviso cada 15 s.')
      await whileCharging(
        {
          charging: async () =>
            isPluggedIn(JSON.parse((await execute('termux-battery-status', [], { timeout: 10_000 })).stdout)),
          start,
          stop,
        },
        controller.signal,
      )
    } else {
      await start()
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), { once: true })
        void finished.then(() => resolve())
      })
    }
    if (controller.signal.reason instanceof Error) throw controller.signal.reason
  } finally {
    await stop()
    await execute('termux-wake-unlock', [], { timeout: 10_000 }).catch(() => undefined)
    releaseLock(supervisorDir)
    process.removeListener('SIGINT', stopSignal)
    process.removeListener('SIGTERM', stopSignal)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo arrancar el worker.')
  process.exitCode = 1
})
