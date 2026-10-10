#!/usr/bin/env node
// Run after measure-priority.mjs, with no CI and no other local benchmarks.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { constants, getPriority, setPriority } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { requireNoLocalCI } from './priority-measurement-utils.mjs'

const dir = resolve('tmp/priority-measurement')
const reference = JSON.parse(await readFile(resolve(dir, 'report.json'), 'utf8'))
const report = {
  date: new Date().toISOString(),
  engineSha256: reference.engineSha256,
  iterationsPerThread: 20_000_000,
  runs: [],
}
function exited(child) {
  return new Promise((res, rej) => {
    child.on('error', rej)
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))))
  })
}
for (let i = 0; i < 3; i++) {
  for (const concurrent of i % 2 ? [true, false] : [false, true]) {
    const ciBefore = requireNoLocalCI()
    const load = spawn(process.execPath, [fileURLToPath(new URL('./priority-load.mjs', import.meta.url))], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const finished = exited(load)
    let lines = ''
    const ready = new Promise((res) => {
      load.stdout.on('data', (data) => {
        lines += data
        if (lines.includes('"ready":true')) res()
      })
    })
    await Promise.race([
      ready,
      finished.then(() => {
        throw new Error('load exited before ready')
      }),
    ])
    let engineDone
    let actualPriority
    const started = performance.now()
    const output = resolve(dir, `contention-${i}.json`)
    if (concurrent) {
      const engine = spawn(reference.engine, ['simulate', resolve(dir, 'job.json'), output], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      engine.stdout.resume()
      engine.stderr.resume()
      setPriority(engine.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      actualPriority = getPriority(engine.pid)
      engineDone = exited(engine).then(() => Math.round(performance.now() - started))
    }
    await finished
    const loadResult = JSON.parse(lines.trim().split(/\r?\n/).at(-1))
    const engineMs = engineDone ? await engineDone : null
    if (concurrent) {
      const { durationMs: _duration, replays: _replays, ...stable } = JSON.parse(await readFile(output, 'utf8'))
      if (!isDeepStrictEqual(stable, reference.result)) throw new Error('Results changed under contention')
    }
    const ciAfter = requireNoLocalCI()
    const run = {
      repeat: i + 1,
      concurrent,
      normalLoadMs: loadResult.durationMs,
      engineMs,
      actualPriority,
      identical: true,
      ciBefore,
      ciAfter,
    }
    report.runs.push(run)
    console.log(JSON.stringify(run))
    await writeFile(resolve(dir, 'contention-report.json'), JSON.stringify(report, null, 2))
  }
}
