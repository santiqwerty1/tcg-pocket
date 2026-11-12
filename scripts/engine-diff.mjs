// Differential test of two engine-cli builds (D-031: before updating deckgym, our fork): every deck A against every
// deck B, the same job and seed, the same bot on both sides (e2 by default), with perGame. A pairing without any of the
// cards the change touches must give byte for byte the same result; the ones that differ are listed with the touched
// cards of each side, and the ones without any are «UNEXPLAINED». One that only the old engine fails, with a touched
// card, is «FIXED» (its error is listed, to check it is the one the change fixes); any other failure is «FAILED»
// (docs/OPERACION.md, «El motor: nuestra copia de deckgym»).
// Usage: node scripts/engine-diff.mjs <old engine-cli> <new engine-cli> <decks.jsonl> <out dir> [games] [concurrency]
//   [seed base] [bot]
// Pairing i plays with seed `base × (i + 1)` (1.000.003 by default). Game g of a job uses splitmix64(seed ^ splitmix64(g)),
// so more games with the same base replay the first ones: another base plays other games. `bot` is any code engine-cli
// takes (e2 by default; g2 is the app's since 23/10/2026, D-029).
// decks.jsonl: one JSON per line, {"side": "a" | "b", "label": "…", "text": "<deck in deckgym's format>"}.
// A change to the shape of what deckgym hashes in `State` changes more than its rules: `forecast_action` samples the
// branches of an effect with more than MAX_FORECAST_BRANCHES (20) results, as the search bots see it, with a seed from
// the hash of `State`, so a new field (of `State` or of `PlayedCard`) or an enum variant inserted before others
// (`SimpleAction`, `CardEffect`, `TurnEffect`) makes e2 see other branches and play other games (Puppy-Loving Girl has
// hundreds). Then the old engine to compare is a control: the old deckgym with the new shape, written where the new
// code writes it but without the new rule, through a `[patch]` with `path` in engine/Cargo.toml (docs/OPERACION.md,
// «El motor: nuestra copia de deckgym»).
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [oldEngine, newEngine, decksFile, outDir, gamesArg, concurrencyArg, seedArg, botArg] = process.argv.slice(2)
const games = Number(gamesArg ?? 10)
const concurrency = Number(concurrencyArg ?? 4)
const seedBase = Number(seedArg ?? 1_000_003)
const bot = botArg ?? 'e2'
mkdirSync(outDir, { recursive: true })
const decks = readFileSync(decksFile, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
const sideA = decks.filter((deck) => deck.side === 'a')
const sideB = decks.filter((deck) => deck.side === 'b')

/**
 * A line of a deck in deckgym's text: `<count> <name> <set> <number>`. Without `printings`, every printing of `name`;
 * with them («A4 5», without zeros as the app writes them; a text with «A4 005» matches too), only those.
 */
const card = (name, ...printings) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const numbered = printings.map((printing) => printing.replace(/ (\d+)$/, ' 0*$1'))
  const where = printings.length > 0 ? `(${numbered.join('|')})` : '[A-Za-z0-9-]+ \\d+'
  return new RegExp(`^\\d+ ${escaped} ${where}\\r?$`, 'm')
}

// The cards the change touches. For upstream 97b8787 on top of 77e0617 (12/11/2026, D-031), by upstream commit, from
// the diff of `src` (database.json does not change). A change that needs two cards to meet lists the one every changed
// game has. Before: 7aa4ef0 on c87bad0 (29/10, #160: #421–#428), 0b510d1/adfe505 on 018b419 (18/10, #133), and the
// first fork on 33ff2a5 (15/10, #115). Edit it for another change.
const AFFECTED = [
  // #440: «Discard a random Energy from among the Energy attached to all Pokémon» leaves out the opponent's Pokémon
  // shielded by Clear Veil or Crystal Body (Regice A2 34): only the attackers, every printing with that text.
  card('Gyarados ex'),
  card('Swampert', 'B2 35', 'B4 207'),
  card('Mega Swampert ex'),
  card('Ceruledge ex', 'P-B 66'),
  // #441: Misty and Sweet Honey choose the Pokémon before flipping (FlipUntilTailsThenAttach / …Heal); Darkrai ex's
  // Nightmare Aura also on an effect's attachment of [D] from the Energy Zone (every Darkrai ex has it).
  card('Misty'),
  card('Sweet Honey'),
  card('Darkrai ex'),
  // #442: no Ability offered for a Pokémon knocked out while evolving. Only a Basic kept alive by Starting Plains' +20
  // HP is knocked out by evolving, so every changed game has it.
  card('Starting Plains'),
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
    const job = { deckA: a.text, deckB: b.text, players: [bot, bot], games, seed, threads: 2, perGame: true }
    tasks.push({ index, a, b, job })
    index++
  }
}
/** Pairings without any touched card on either side: the ones that must come out the same byte for byte. */
const tasksWithout = tasks.filter(
  (task) => affected(task.a.text).length === 0 && affected(task.b.text).length === 0,
).length

const differing = []
const failed = []
/** Failed in the old engine only, with a touched card: what the change fixes (#442 on 97b8787: a panic of e2 and g2). */
const fixed = []
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
      const failure = {
        index: task.index,
        a: task.a.label,
        b: task.b.label,
        affectedA: affected(task.a.text),
        affectedB: affected(task.b.text),
        old: before.stderr ?? null,
        new: after.stderr ?? null,
      }
      const touched = failure.affectedA.length > 0 || failure.affectedB.length > 0
      if (!before.result && after.result && touched) fixed.push(failure)
      else failed.push(failure)
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
  bot,
  seedBase,
  mustMatch: tasksWithout,
  differing: differing.length,
  unexplained: unexplained.length,
  fixed: fixed.length,
  failed: failed.length,
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summary, differing, fixed, failed }, null, 1))
console.log(JSON.stringify(summary))
for (const d of unexplained) console.log('UNEXPLAINED', JSON.stringify(d))
for (const f of fixed) console.log('FIXED', JSON.stringify(f))
for (const f of failed) console.log('FAILED', JSON.stringify(f))
// A pairing left unexplained or failed fails the run, so a script that calls it stops there. One that only the old
// engine failed, with a touched card, is the change fixing it: listed as FIXED, to read its error, and not a failure.
if (unexplained.length > 0 || failed.length > 0) process.exitCode = 1
