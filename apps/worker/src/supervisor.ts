/**
 * The Windows worker's supervisor (D-026): `tcg-worker.exe --run`, what the logon start runs, keeps a child
 * `tcg-worker.exe --child` going. A child that switched to a new release exits with `RESTART_FOR_UPDATE` and is
 * started again (the executable then loads that release); a new release that exits with an error before it was ever
 * ready is rolled back and the child started on the one before. The supervisor itself is the code built into the
 * executable and never loads a downloaded release: only a zip installed by hand replaces it.
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Log } from './client.js'
import { acquireLock, releaseLock } from './lock.js'
import { type Installation, RESTART_FOR_UPDATE, rollBackUnhealthy } from './update.js'

export interface SupervisorOptions {
  dataDir: string
  installation: Pick<Installation, 'releases' | 'activate'>
  log: Log
  /** Runs one child to its end and resolves with its exit code (tests pass their own). */
  runChild?: () => Promise<number | null>
}

/** `tcg-worker.exe --child`, hidden, with nothing to read or write: the worker logs to worker.log itself. */
export function runExecutableChild(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--child'], { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
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
  try {
    for (;;) {
      const code = await runChild()
      if (code === RESTART_FOR_UPDATE) continue
      // Each rollback marks a release bad, so this ends: at worst on the code built into the executable.
      if (code !== 0 && rollBackUnhealthy(options.installation, options.log)) continue
      return code ?? 1
    }
  } finally {
    releaseLock(dir)
  }
}
