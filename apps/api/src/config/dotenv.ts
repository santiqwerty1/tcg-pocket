/**
 * Loads the repo-root `.env` into `process.env` outside production, without overriding variables that are already
 * set (same semantics as `node --env-file`). No dependency: Node 24 ships `util.parseEnv`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

/** `apps/api`, both from `src/config` (vitest, prisma.config.ts) and from `dist/config` (built). */
export const API_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
export const REPO_ROOT = resolve(API_ROOT, '../..')

export function loadDotEnv(file: string = resolve(REPO_ROOT, '.env')): string[] {
  if (process.env.NODE_ENV === 'production') return []
  if (!existsSync(file)) return []
  const parsed = parseEnv(readFileSync(file, 'utf8'))
  const applied: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] !== undefined) continue
    process.env[key] = value
    applied.push(key)
  }
  return applied
}
