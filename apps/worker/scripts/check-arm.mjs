#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

// Linux/WSL: check an ARM package against its native reference using qemu-user, with 1 and 2 threads.
const folder = resolve(process.argv[2] ?? 'apps/worker/build/android-package/tcg-worker')
const reference = JSON.parse(readFileSync(join(folder, 'determinism.json'), 'utf8'))
const run = (args) =>
  execFileSync('qemu-aarch64', [join(folder, 'engine-cli'), ...args], { encoding: 'utf8', timeout: 120_000 })
const version = JSON.parse(run(['version']))
if (version.engineRev !== reference.version.engineRev || version.cliVersion !== reference.version.cliVersion)
  throw new Error('ARM version differs')
const work = mkdtempSync(join(tmpdir(), 'tcg-arm-'))
try {
  for (const test of reference.cases) {
    for (const threads of [1, 2]) {
      const input = join(work, 'job.json'),
        output = join(work, 'result.json')
      writeFileSync(input, JSON.stringify({ ...test.job, threads }))
      run(['simulate', input, output])
      // The build fingerprint names the target (phase 42): ARM and the native reference differ there, not in the games.
      const {
        durationMs: _duration,
        replays: _replays,
        build: _build,
        ...actual
      } = JSON.parse(readFileSync(output, 'utf8'))
      if (!isDeepStrictEqual(actual, test.expected))
        throw new Error(`ARM differs: ${test.job.players.join('/')} threads=${threads}`)
      console.log(`ARM agrees: ${test.job.players.join('/')} threads=${threads} (${actual.games} games)`)
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
