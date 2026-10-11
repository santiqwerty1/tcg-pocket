/**
 * The Windows worker's supervisor (D-026): `tcg-worker.exe --run`, what the logon start runs, keeps a child
 * `tcg-worker.exe --child` going. A child that switched to a new release exits with `RESTART_FOR_UPDATE` and is
 * started again (the executable then loads that release); a new release that exits with an error before it was ever
 * ready is started again, and after three failures rolled back (`afterFailedStart`). Restarts are paced: never a
 * tight loop. The supervisor itself is the code built into the executable and never loads a downloaded release: only
 * a zip installed by hand replaces it.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Log } from './client.js'
import { acquireLock, releaseLock } from './lock.js'
import { afterFailedStart, type Installation, RESTART_FOR_UPDATE, RestartPacer } from './update.js'

export interface ChildExit {
  code: number | null
  signal: string | null
}

export interface SupervisorOptions {
  dataDir: string
  installation: Pick<Installation, 'releases' | 'activate'>
  log: Log
  /** Runs one child to its end (tests pass their own). */
  runChild?: () => Promise<ChildExit>
  /** Tests skip the waits between restarts. */
  wait?: (ms: number) => Promise<unknown>
}

/** `tcg-worker.exe --child`, hidden, with nothing to read or write: the worker logs to worker.log itself. */
export function runExecutableChild(): Promise<ChildExit> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--child'], { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

/** Resolves with the last child's exit code; 0 at once when another supervisor already runs in this folder. */
export async function supervise(options: SupervisorOptions): Promise<number> {
  const dir = join(options.dataDir, 'supervisor')
  mkdirSync(dir, { recursive: true })
  const holder = acquireLock(dir)
  if (holder !== null) {
    options.log('ya hay un worker corriendo en esta carpeta; no arranco otro', { pid: holder })
    return 0
  }
  const runChild = options.runChild ?? runExecutableChild
  const wait = options.wait ?? ((ms: number) => sleep(ms))
  const pacer = new RestartPacer()
  try {
    for (;;) {
      const exit = await runChild()
      if (exit.code === RESTART_FOR_UPDATE) {
        await wait(pacer.delayMs('update'))
        continue
      }
      if (afterFailedStart(options.installation, exit, options.log) === 'restart') {
        await wait(pacer.delayMs('failure'))
        continue
      }
      return exit.code ?? 1
    }
  } finally {
    releaseLock(dir)
  }
}
