// Differential test of two engine-cli builds (D-031: before updating deckgym, our fork): every deck A against every
// deck B, the same job and seed, the same bot on both sides (e2 by default), with perGame. A pairing without any of the
// cards the change touches must give byte for byte the same result; the ones that differ are listed with the touched
// cards of each side, and the ones without any are «UNEXPLAINED» (docs/OPERACION.md, «El motor: nuestra copia de
// deckgym»).
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
 * with them («A4 5», numbers without zeros as in the text), only those.
 */
const card = (name, ...printings) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const where = printings.length > 0 ? `(${printings.join('|')})` : '[A-Za-z0-9-]+ \\d+'
  return new RegExp(`^\\d+ ${escaped} ${where}\\r?$`, 'm')
}

// The cards the change touches. For upstream 7aa4ef0 on top of c87bad0 (29/10/2026, D-031), by upstream commit; C1, P-C
// and SP1 (#430–#439) only add cards, our #420 was already in c87bad0, and the MCTS of #275 plays only «m». A change
// that needs two cards to meet lists the one every changed game has. Before: 0b510d1/adfe505 on 018b419 (18/10, #133),
// and the first fork on 33ff2a5 (15/10, #115). Edit it for another change.
const AFFECTED = [
  // #421: Heavy Helmet reads the holder's current Retreat Cost; Grass Knot and Shadow Seeker, the defender's side.
  card('Heavy Helmet'),
  card('Tangrowth', 'A4 5'),
  card('Whimsicott ex'),
  card("Team Rocket's Arbok"),
  // #422: Lum Berry, Sitrus Berry and Bad Dreams in turn-owner order, after Deceptive Needle: only with one of these.
  card('Darkrai', 'B2b 40', 'B4b 144', 'B4b 328', 'P-B 95'),
  card('Deceptive Needle'),
  // #423: Clemont's Backpack also for damage to the Bench.
  card("Clemont's Backpack"),
  // #425: coin-flip damage Abilities against damage queued after an attack.
  card('Bastiodon'),
  card('Togekiss', 'A4 80'),
  card('Meowth', 'B2 124', 'B2 204', 'B4b 180', 'B4b 352'),
  card('Hisuian Goodra'),
  // #424: Weakness on the hit back an attack leaves.
  card('Alolan Sandslash'),
  card('Togedemaru', 'A3b 48', 'P-A 90'),
  card('Turtonator', 'B1 47'),
  card('Chesnaught'),
  card('Mega Sableye ex'),
  // #426: Growl-type cuts stay on the Pokémon hit and come off before Weakness.
  card('Cubone', 'A1 151', 'A1 239', 'A3 226', 'A4b 194', 'A4b 195'),
  card('Suicune'),
  card('Togepi', 'A4 78', 'A4 173'),
  card('Slowpoke', 'B3b 26'),
  card('Teddiursa', 'B3b 56'),
  card('Pikachu', 'B4 49', 'B4b 82', 'B4b 291', 'P-B 82'),
  card('Skitty', 'B4 134'),
  card('Eevee', 'P-A 30'),
  card('Clefable', 'A2a 30'),
  card('Bonsly'),
  // #428: Dragon's Blessing only onto an Active [N] Pokémon.
  card('Dragonair', 'B4 117', 'B4 175', 'B4 233', 'B4b 170', 'B4b 344'),
  // #427: Clear Veil and Crystal Body keep the Energy an attack discards; Crunch-type attacks send it to the discard
  // pile.
  card('Clear Veil'),
  card('Regice', 'A2 34'),
  card('Mawile', 'A1 178'),
  card('Fearow', 'A1 192'),
  card('Drednaw', 'A1a 23'),
  card('Mow Rotom'),
  card('Lycanroc', 'A3 100', 'P-A 68'),
  card('Sharpedo'),
  card('Garbodor', 'B1a 50'),
  card('Alolan Meowth', 'B2 94'),
  card('Houndoom', 'B4 28'),
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
  bot,
  seedBase,
  mustMatch: tasksWithout,
  differing: differing.length,
  unexplained: unexplained.length,
  failed: failed.length,
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ summary, differing, failed }, null, 1))
console.log(JSON.stringify(summary))
for (const d of unexplained) console.log('UNEXPLAINED', JSON.stringify(d))
for (const f of failed) console.log('FAILED', JSON.stringify(f))
