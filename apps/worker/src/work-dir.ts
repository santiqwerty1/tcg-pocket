import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Shared by simulation and live games. Register synchronously, before any cleanup can see the folder.
const inUse = new Set<string>()

export function createWorkDir(root: string, prefix: string): string {
  const dir = mkdtempSync(join(root, prefix))
  inUse.add(resolve(dir))
  return dir
}

export function workDirInUse(dir: string): boolean {
  return inUse.has(resolve(dir))
}

export async function removeWorkDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  inUse.delete(resolve(dir))
}
