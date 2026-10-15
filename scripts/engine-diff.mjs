// Differential test of two engine-cli builds (D-031: before updating deckgym, our fork): every deck A against every
// deck B, the same job and seed, e2 vs e2, with perGame. A pairing without any of the cards the change touches must give
// byte for byte the same result; the ones that differ are listed with the touched cards of each side, and the ones
// without any are «UNEXPLAINED» (docs/OPERACION.md, «El motor: nuestra copia de deckgym»).
// Usage: node scripts/engine-diff.mjs <old engine-cli> <new engine-cli> <decks.jsonl> <out dir> [games] [concurrency]
//   [seed base]
// Pairing i plays with seed `base × (i + 1)` (1.000.003 by default). Game g of a job uses splitmix64(seed ^ splitmix64(g)),
// so more games with the same base replay the first ones: another base plays other games.
// decks.jsonl: one JSON per line, {"side": "a" | "b", "label": "…", "text": "<deck in deckgym's format>"}.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [oldEngine, newEngine, decksFile, outDir, gamesArg, concurrencyArg, seedArg] = process.argv.slice(2)
const games = Number(gamesArg ?? 10)
const concurrency = Number(concurrencyArg ?? 4)
const seedBase = Number(seedArg ?? 1_000_003)
mkdirSync(outDir, { recursive: true })
const decks = readFileSync(decksFile, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
const sideA = decks.filter((deck) => deck.side === 'a')
const sideB = decks.filter((deck) => deck.side === 'b')

// The cards the change touches; for the first fork (018b419): Heavy Helmet / Harden (Cascoon) / Hide (Shinx) /
// Blocking Shell (Carracosta), #383; Quick-Grow Extract and Wallace, #399; Fossils, #397; the abilities that read the
// Active, #398. Edit it for another change.
const AFFECTED = [
  /Heavy Helmet/,
  /Cascoon/,
  /Shinx/,
  /Carracosta/,
  /Quick-Grow Extract/,
  /Wallace/,
  /Fossil|Old Amber/,
  /Baxcalibur/,
  /Celesteela/,
  /Vaporeon/,
]
const affected = (text) => AFFECTED.filter((pattern) => pattern.test(text)).map((p) => p.source)

function run(engine, job, name) {
  const jobFile = join(outDir, `${name}.job.json`)
  const resultFile = join(outDir, `${name}.result.json`)
  // A result from an earlier run in the same folder must not pass for this one.
  rmSync(resultFile, { force: true })
  writeFileSync(jobFile, JSON.stringify(job))
  return new Promise((resolve) => {
    const child = spawn(engine, ['simulate', jobFile, resultFile], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ code, result: null, stderr: `exit ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}` })
        return
      }
      try {
        const result = JSON.parse(readFileSync(resultFile, 'utf8'))
        resolve({ code, result })
      } catch {
        resolve({ code, result: null, stderr: stderr.trim().split('\n').slice(-3).join(' | ') })
      }
    })
  })
}

/** What has to be equal between the two engines: everything but the time and the engine's own names. */
function comparable(result) {
  if (!result) return null
  const { durationMs, engineRev, cliVersion, build, replays, ...rest } = result
  return JSON.stringify(rest)
}

const tasks = []
let index = 0
for (const a of sideA) {
  for (const b of sideB) {
    const seed = seedBase * (index + 1)
    const job = { deckA: a.text, deckB: b.text, players: ['e2', 'e2'], games, seed, threads: 2, perGame: true }
    tasks.push({ index, a, b, job })
    index++
  }
}

const differing = []
const failed = []
let done = 0
async function worker() {
  while (tasks.length > 0) {
    const task = tasks.shift()
    const [before, after] = await Promise.all([
      run(oldEngine, task.job, `old-${task.index}`),
      run(newEngine, task.job, `new-${task.index}`),
    ])
    done++
    if (!before.result || !after.result) {
      failed.push({
        index: task.index,
        a: task.a.label,
        b: task.b.label,
        old: before.stderr ?? null,
        new: after.stderr ?? null,
      })
    } else if (comparable(before.result) !== comparable(after.result)) {
      differing.push({
        index: task.index,
        a: task.a.label,
        b: task.b.label,
        affectedA: affected(task.a.text),
        affectedB: affected(task.b.text),
        old: { winsA: before.result.winsA, winsB: before.result.winsB, ties: before.result.ties },
        new: { winsA: after.result.winsA, winsB: after.result.winsB, ties: after.result.ties },
      })
    }
    if (done % 50 === 0) console.error(`${done} pairings`)
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
const unexplained = differing.filter((d) => d.affectedA.length === 0 && d.affectedB.length === 0)
const summary = {
  pairings: index,
  games,
  differing: differing.length,
  unexplained: unexplained.length,
  failed: failed.length,
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summary, differing, failed }, null, 1))
console.log(JSON.stringify(summary))
for (const d of unexplained) console.log('UNEXPLAINED', JSON.stringify(d))
for (const f of failed) console.log('FAILED', JSON.stringify(f))
