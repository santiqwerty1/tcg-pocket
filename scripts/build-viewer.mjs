#!/usr/bin/env node
/**
 * Builds deckgym-core's replay viewer (AGPL-3.0, unmodified) at the engine's pinned commit into
 * `apps/web/public/viewer/`, which the PWA build copies to `dist/viewer/` (D-014). The source is fetched fresh into a
 * temporary folder: `refs/` stays read-only. Usage: `node scripts/build-viewer.mjs [--rev <sha>]`.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'web', 'public', 'viewer')
// Our fork (D-031): the engine's pinned rev is one of its commits.
const REPO = 'https://github.com/santiqwerty1/deckgym-core'

function pinnedRev() {
  const flag = process.argv.indexOf('--rev')
  if (flag >= 0 && process.argv[flag + 1]) return process.argv[flag + 1]
  const cargo = readFileSync(join(ROOT, 'engine', 'Cargo.toml'), 'utf8')
  const rev = /deckgym\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]{40})"/.exec(cargo)?.[1]
  if (!rev) throw new Error('No encontré el rev de deckgym en engine/Cargo.toml')
  return rev
}

const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
  })

const rev = pinnedRev()
const work = mkdtempSync(join(tmpdir(), 'deckgym-viewer-'))
try {
  console.log(`deckgym-core @ ${rev.slice(0, 7)} → ${OUT}`)
  run('git', ['init', '-q', 'src'], work)
  const src = join(work, 'src')
  run('git', ['fetch', '-q', '--depth', '1', REPO, rev], src)
  run('git', ['checkout', '-q', 'FETCH_HEAD'], src)
  const viewer = join(src, 'viewer')
  run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], viewer)
  // Built as is (no type check): relative to /viewer/, cards drawn without images unless the owner sets them.
  run('npx', ['vite', 'build', '--base=/viewer/', '--outDir', join(work, 'dist'), '--emptyOutDir'], viewer)
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  cpSync(join(work, 'dist'), OUT, { recursive: true })
  console.log('Listo: el viewer se sirve en /viewer/index.html?url=…')
} finally {
  rmSync(work, { recursive: true, force: true })
}
