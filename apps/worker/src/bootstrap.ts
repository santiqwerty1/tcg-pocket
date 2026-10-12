/**
 * What tcg-worker.exe (sea.ts) loads, kept apart from it so the tests can import it without starting anything.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { PortableContext } from './portable.js'
import { isBad, readPointer } from './update.js'

export type Entry = { main: (args: readonly string[], context: PortableContext) => Promise<number> }

/** Setup and `--uninstall` change the PC (the logon start, the launchers), not just run the worker. */
export const installs = (args: readonly string[]) =>
  args.length === 0 || args.includes('--setup') || args.includes('--uninstall')

/** `a < b` for versions like 0.3.2 (a missing or unreadable one counts as the oldest). */
export function olderVersion(a: string | undefined, b: string): boolean {
  const parts = (version: string | undefined) =>
    (version ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  }
  return false
}

/** The worker version a release declares (`release.json`). */
export function releaseVersion(release: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(release, 'release.json'), 'utf8')) as { workerVersion?: string }).workerVersion
  } catch {
    return undefined
  }
}

/** The release to load: the one under check, else the pointer's when this build wrote it and it is usable. */
export function chooseRelease(folder: string, buildId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.TCG_WORKER_RELEASE) return env.TCG_WORKER_RELEASE
  const releases = join(folder, 'releases')
  const pointer = readPointer(releases)
  if (!pointer?.sha || pointer.base !== buildId || isBad(releases, pointer.sha)) return null
  const release = join(releases, pointer.sha)
  return existsSync(join(release, 'worker.cjs')) && existsSync(join(release, 'verified')) ? release : null
}

/** A release's worker, loaded from disk (an executable's own `require` only reaches built-in modules). */
export function loadRelease(release: string): Entry {
  const file = join(release, 'worker.cjs')
  const entry = createRequire(file)(file) as Partial<Entry>
  if (typeof entry.main !== 'function') throw new Error('worker.cjs no exporta main')
  return entry as Entry
}
