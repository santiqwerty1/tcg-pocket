/**
 * The code built into tcg-worker.exe (Node single executable application), the only part an update never replaces
 * (D-026). It picks what to run:
 *   --run         the supervisor (this code), which keeps `tcg-worker.exe --child` going and rolls back bad releases
 *   anything else the current release's `worker.cjs` (`releases/current.json`, written by this build), else this
 *                 build's own copy of the worker; TCG_WORKER_RELEASE names a release to check before switching to it
 */
import { join } from 'node:path'
import { chooseRelease, type Entry, loadRelease } from './bootstrap.js'
import { dataDir } from './config.js'
import { main as builtIn } from './portable.js'
import { logger } from './run.js'
import { supervise } from './supervisor.js'
import { markBad, windowsInstallation } from './update.js'

/** Set by scripts/package.mjs: one per built executable (the pointer's `base`). */
declare const __TCG_BUILD_ID__: string | undefined
const BUILD_ID = typeof __TCG_BUILD_ID__ === 'string' ? __TCG_BUILD_ID__ : 'dev'

async function start(): Promise<number> {
  const args = process.argv.slice(2)
  const folder = dataDir()
  const log = logger(join(folder, 'worker.log'))
  if (args.includes('--run')) {
    return supervise({ dataDir: folder, installation: windowsInstallation(folder, null, BUILD_ID), log })
  }
  const release = chooseRelease(folder, BUILD_ID)
  if (release) {
    let entry: Entry | null = null
    try {
      entry = loadRelease(release)
    } catch (error) {
      if (process.env.TCG_WORKER_RELEASE) throw error
      // Unreadable on disk: never again, and this start runs the built-in worker.
      const sha = release.split(/[\\/]/).pop() ?? ''
      markBad(join(folder, 'releases'), sha, `no se pudo cargar: ${String(error).slice(0, 300)}`)
      log('la versión bajada no se pudo cargar: uso la del ejecutable', { error: String(error).slice(0, 300) })
    }
    if (entry) return entry.main(args, { releaseDir: release, buildId: BUILD_ID })
  }
  return builtIn(args, { releaseDir: null, buildId: BUILD_ID })
}

start().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
