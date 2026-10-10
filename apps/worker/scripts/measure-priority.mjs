#!/usr/bin/env node
// D-023 / T-015: an isolated engine; never changes the priority of an existing process.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { availableParallelism, constants, cpus, getPriority, setPriority } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { isDeepStrictEqual } from 'node:util'
import { requireNoLocalCI } from './priority-measurement-utils.mjs'

const engine = resolve(process.argv[2] ?? 'engine/target-priority/release/engine-cli.exe')
const dir = resolve('tmp/priority-measurement')
const ciBefore = requireNoLocalCI()
await mkdir(dir, { recursive: true })
const deck = /const deck = `([^`]+)`/.exec(await readFile(new URL('./package-android.mjs', import.meta.url), 'utf8'))[1]
const job = {
  deckA: deck,
  deckB: deck,
  players: ['e2', 'e2'],
  seed: 20261010,
  games: 200,
  threads: availableParallelism(),
  replaySample: 0,
  perGame: true,
}
const input = resolve(dir, 'job.json')
await writeFile(input, JSON.stringify(job, null, 2))
const priorities = {
  normal: constants.priority.PRIORITY_NORMAL,
  below_normal: constants.priority.PRIORITY_BELOW_NORMAL,
  idle: constants.priority.PRIORITY_LOW,
}
const report = {
  date: new Date().toISOString(),
  engine,
  cpu: cpus()[0].model,
  logicalProcessors: cpus().length,
  ciBefore,
  engineSha256: createHash('sha256')
    .update(await readFile(engine))
    .digest('hex'),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  job,
  runs: [],
}
let reference
for (let i = 0; i < 3; i++) {
  for (const priority of i % 2 ? ['below_normal', 'normal', 'idle'] : ['normal', 'below_normal', 'idle']) {
    const output = resolve(dir, `${i}-${priority}.json`)
    const before = cpus()
    const started = performance.now()
    const child = spawn(engine, ['simulate', input, output], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    setPriority(child.pid, priorities[priority])
    const actualPriority = getPriority(child.pid)
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr = (stderr + data).slice(-4000)
    })
    await new Promise((res, rej) => {
      child.on('error', rej)
      child.on('close', (code) => (code === 0 ? res() : rej(new Error(stderr))))
    })
    const wallMs = performance.now() - started
    const { durationMs, replays: _replays, ...stable } = JSON.parse(await readFile(output, 'utf8'))
    reference ??= stable
    if (!isDeepStrictEqual(stable, reference)) throw new Error('Results changed with priority')
    const perCpuBusyPercent = cpus().map((cpu, index) => {
      const previous = before[index].times
      const elapsed = Object.keys(cpu.times).reduce((sum, key) => sum + cpu.times[key] - previous[key], 0)
      return Math.round(100 * (1 - (cpu.times.idle - previous.idle) / elapsed))
    })
    const ciAfter = requireNoLocalCI()
    const run = {
      repeat: i + 1,
      priority,
      actualPriority,
      wallMs: Math.round(wallMs),
      durationMs,
      identical: true,
      perCpuBusyPercent,
      ciAfter,
    }
    report.runs.push(run)
    console.log(JSON.stringify(run))
    await writeFile(
      resolve(dir, 'report.json'),
      JSON.stringify(
        {
          ...report,
          result: reference,
          resultHash: createHash('sha256').update(JSON.stringify(reference)).digest('hex'),
        },
        null,
        2,
      ),
    )
  }
}
