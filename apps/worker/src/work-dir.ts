import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Shared by simulation and live games. Register synchronously, before any cleanup can see the folder.
const inUse = new Set<string>()

/**
 * `<prefix><pid>-XXXXXX`: the folder says which process made it, so a worker that starts never cleans the work of
 * another one that is still alive (worker 0.3.4 on; the S25's lost result.json of 12/10/2026).
 */
export function createWorkDir(root: string, prefix: string): string {
  const dir = mkdtempSync(join(root, `${prefix}${process.pid}-`))
  inUse.add(resolve(dir))
  return dir
}

/** The PID in a work folder's name; null for a folder made before worker 0.3.4 (or by someone else). */
export function workDirOwner(name: string): number | null {
  const match = /^[a-z]+-(\d+)-[A-Za-z0-9]{6}$/.exec(name)
  return match ? Number(match[1]) : null
}

export function workDirInUse(dir: string): boolean {
  return inUse.has(resolve(dir))
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  inUse.delete(resolve(dir))
}
