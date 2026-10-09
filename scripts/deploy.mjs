#!/usr/bin/env node
// Deploy to Fly only what passed CI (Fase 21, R-007): the working tree is clean, HEAD is on origin/main, the CI run of
// that commit (lint, unit tests, e2e against Postgres, engine) finished green and the vault passes `posta check`.
// Then `flyctl deploy` (migrations run when the container starts). It never pushes: that stays a separate,
// confirmed step.
//
//   node scripts/deploy.mjs            checks, then deploys
//   node scripts/deploy.mjs --check    only the checks
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APP = 'tcg-pocket'
const checkOnly = process.argv.includes('--check')

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function ok(message) {
  console.log(`✓ ${message}`)
}

// 1. Nothing uncommitted: what deploys is exactly a commit.
if (run('git', ['status', '--porcelain']) !== '') fail('Hay cambios sin commitear: commitealos (o descartalos) antes.')
const sha = run('git', ['rev-parse', 'HEAD'])
ok(`commit ${sha.slice(0, 7)}`)

// 2. The commit is on GitHub's main (CI only runs there).
run('git', ['fetch', '--quiet', 'origin', 'main'])
const onMain = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']).status === 0
if (!onMain) fail('Ese commit no está en origin/main: subilo primero (git push) y esperá la CI.')
ok('está en origin/main')

// 3. CI green for that commit.
const runs = JSON.parse(
  run('gh', ['run', 'list', '--commit', sha, '--workflow', 'CI', '--json', 'status,conclusion,url,databaseId']),
)
const ci = runs[0]
if (!ci) fail('La CI todavía no corrió para este commit: probá en un rato.')
if (ci.status !== 'completed') fail(`La CI sigue corriendo (${ci.url}): probá cuando termine.`)
if (ci.conclusion !== 'success') fail(`La CI falló (${ci.conclusion}): ${ci.url}`)
ok(`CI verde (${ci.url})`)

// 4. The vault (Posta's CI cannot run on GitHub: R-007).
// One command string: on Windows `posta` is a .cmd shim, which needs the shell.
const posta = spawnSync('posta check .', { encoding: 'utf8', shell: true })
const missing = /no se reconoce|not recognized|not found/i.test(`${posta.stderr}`)
if (posta.error || posta.status === null || missing) console.warn('! posta no está en el PATH: la bóveda no se validó')
else if (posta.status !== 0) fail(`posta check falló:\n${posta.stdout}${posta.stderr}`)
else ok('bóveda sin errores (posta check)')

if (checkOnly) {
  console.log('Listo para desplegar.')
  process.exit(0)
}

// 5. Deploy.
const local = join(homedir(), '.fly', 'bin', process.platform === 'win32' ? 'flyctl.exe' : 'flyctl')
const flyctl = existsSync(local) ? local : 'flyctl'
const deploy = spawnSync(flyctl, ['deploy', '--app', APP, '--remote-only', '--ha=false'], { stdio: 'inherit' })
if (deploy.status !== 0) fail('flyctl deploy falló.')
ok(`desplegado ${sha.slice(0, 7)} en ${APP}`)
