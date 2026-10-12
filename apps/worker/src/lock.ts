/**
 * One worker per folder: two processes with the same worker id would share `state.json`, `work/` and the leases of
 * each other's chunks. The lock is `worker.lock` with the PID; a lock whose process is gone (PC turned off, killed) is
 * taken over.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The PID of the worker already running in `dir`, or null after taking the lock for this process. */
export function acquireLock(dir: string, pid = process.pid): number | null {
  const file = join(dir, 'worker.lock')
  try {
    writeFileSync(file, String(pid), { flag: 'wx' })
    return null
  } catch {
    const holder = Number(readFileSync(file, 'utf8').trim())
    if (Number.isInteger(holder) && holder > 0 && holder !== pid && processAlive(holder)) return holder
    writeFileSync(file, String(pid))
    return null
  }
}

export function releaseLock(dir: string, pid = process.pid): void {
  const file = join(dir, 'worker.lock')
  try {
    if (Number(readFileSync(file, 'utf8').trim()) === pid) rmSync(file)
  } catch {
    // Already gone.
  }
}
