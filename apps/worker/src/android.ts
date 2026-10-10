import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { isPluggedIn, whileCharging } from './battery.js'
import { loadConfig, readFileConfig } from './config.js'
import { checkDeterminism } from './determinism.js'
import { acquireLock, releaseLock } from './lock.js'
import { run } from './run.js'

const execute = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const defaults = {
  enginePath: join(here, 'engine-cli'),
  determinismPath: join(here, 'determinism.json'),
  capThreads: true,
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--check-engine')) {
    await checkDeterminism(defaults.enginePath, defaults.determinismPath, here)
    console.log('Motor y determinismo: OK')
    return
  }
  if (args.includes('--child') || args.includes('--check') || args.includes('--once')) {
    return run(args, defaults)
  }
  const config = loadConfig(process.env, defaults)
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
  const start = async () => {
    stoppingChild = false
    child = spawn(process.execPath, [process.argv[1] ?? '', '--child'], { stdio: 'inherit' })
    const current = child
    exited = new Promise<void>((resolve, reject) => {
      current.once('error', reject)
      current.once('exit', (code, signal) => {
        child = null
        if ((code || signal) && !stoppingChild && !controller.signal.aborted)
          controller.abort(new Error(`El worker terminó (${code ?? signal}).`))
        resolve()
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
        void exited.then(() => resolve())
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
