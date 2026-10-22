#!/usr/bin/env node
/**
 * Smoke test of the browser's engine (T-015) as built: loads `engine.js` + `engine_bg.wasm` (wasm-bindgen's output)
 * the way the PWA's Web Worker does, plays whole games against several bots, rebuilds one from its seed and choices,
 * scores a decision with the coach and checks the replay. Usage: `node engine/wasm/smoke.mjs <folder with engine.js>`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = resolve(process.argv[2] ?? 'apps/web/public/engine')
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const engine = await import(pathToFileURL(join(dir, manifest.js)).href)
let panic = null
globalThis.__tcgEnginePanic = (message) => {
  panic = message
}
engine.initSync({ module: readFileSync(join(dir, manifest.wasm)) })

const info = JSON.parse(engine.engineInfo())
if (info.engineRev !== manifest.engineRev) throw new Error(`manifest ${manifest.engineRev} ≠ engine ${info.engineRev}`)
if (info.gamesRev !== manifest.gamesRev)
  throw new Error(`manifest gamesRev ${manifest.gamesRev} ≠ engine ${info.gamesRev}`)

const ALTARIA = `Energy: Psychic
2 Swablu A4a 64
2 Mega Altaria ex B1 102
1 Jirachi B1 106
2 Chingling B1 109
1 Indeedee ex B1 121
1 Altaria B1 197
1 Sabrina A1 225
2 Rocky Helmet A2 148
1 Cyrus A2 150
1 Mars A2 155
1 Poké Ball A2b 111
2 Professor's Research A4b 373
1 Copycat B1 225
2 Lisia B1 226`
const VENUSAUR = `Energy: Grass
1 Bulbasaur A1 1
2 Ivysaur B1a 2
2 Mega Venusaur ex B1a 4
2 Professor's Research P-A 7
2 Copycat B1 225
2 Quick-Grow Extract B1a 67
2 Lucky Ice Pop B2 145
2 Heavy Helmet B1 219
1 Lillie A3 155
1 Pokémon Center Lady A2b 70
1 Cyrus A2 150
1 Field Blower B3 147
1 Repel A3a 64`

function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** A whole game; the first choices from `given`, the rest a fixed pick per decision. */
function play(job, given = []) {
  const game = new engine.LiveGame(JSON.stringify(job))
  const choices = []
  const log = []
  let coach = null
  const started = performance.now()
  let step = JSON.parse(game.advance())
  for (;;) {
    log.push(...step.log)
    if (step.type === 'end') break
    check(step.ply === choices.length + 1, `ply ${step.ply} after ${choices.length} choices`)
    if (job.coach && coach === null) coach = JSON.parse(game.coach())
    const choice = given[choices.length] ?? (step.ply * 7 + 3) % step.actions.length
    choices.push(choice)
    step = JSON.parse(game.advance(choice))
  }
  const ms = performance.now() - started
  const replay = JSON.parse(game.replay())
  game.free()
  return { choices, log, end: step, replay, coach, ms }
}

const base = { deckHuman: VENUSAUR, deckBot: ALTARIA, coach: false }
for (const bot of ['r', 'e2', 'f2', 'e3', 'g2']) {
  const game = play({ ...base, bot, seed: '20261011' })
  check(['you', 'bot', 'tie'].includes(game.end.winner), `${bot}: winner ${game.end.winner}`)
  check(game.replay.steps.length === game.log.length, `${bot}: one replay step per action`)
  console.log(
    `${bot}: ${game.end.winner} en ${game.end.turns} turnos, ${game.choices.length} decisiones, ${game.ms.toFixed(0)} ms`,
  )
}

const first = play({ ...base, bot: 'e2', seed: '77' })
const again = play({ ...base, bot: 'e2', seed: '77' }, first.choices)
check(JSON.stringify(again.log) === JSON.stringify(first.log), 'the same seed and choices rebuild the same game')
check(JSON.stringify(again.replay) === JSON.stringify(first.replay), 'and the same replay')

const coached = play({ ...base, bot: 'e2', seed: '3', coach: true })
check(Array.isArray(coached.coach?.scores) && coached.coach.scores.length > 1, 'the coach scores every option')
console.log(`entrenador: ${coached.coach.scores.length} opciones, la mejor ${coached.coach.best}`)

// The browser's own golden games (review of #86): engine-cli's live cases (engine/games-rev.json) played by this .wasm.
// They are not a PC's games (R-003), but they must not change unnoticed: when they do, this fails until
// games-wasm.json is made again (`--regenerate`), and the games in course end as `engine_changed` (a browser game keeps
// its engine's build).
const goldenFile = fileURLToPath(new URL('./games-wasm.json', import.meta.url))
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../games-rev.json', import.meta.url)), 'utf8'))
/** engine-cli's games_rev_tests hash (FNV-1a, 64 bits) over UTF-8. */
function fnv(text) {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
function goldenGame(job, coach) {
  const game = new engine.LiveGame(JSON.stringify({ ...job, seed: String(job.seed), coach }))
  const choices = job.choices ?? []
  const moves = []
  let next = 0
  let step = JSON.parse(game.advance())
  if (coach) {
    const view = JSON.parse(game.coach())
    game.free()
    return { scores: view.scores, best: view.best }
  }
  for (;;) {
    for (const line of step.log) moves.push(`${line.actor}:${line.text}`)
    if (step.type === 'end') break
    // As engine-cli's golden: the k-th choice (cycling) modulo the options, answered with the option's label.
    const pick = choices[next % choices.length] % step.actions.length
    next++
    const shown = step.actions[pick]
    step = JSON.parse(game.advance(shown.i))
    check(step.log[0]?.actor === 0 && step.log[0].text === shown.text, 'the move played is the one shown')
  }
  game.free()
  return { winner: step.winner, turns: step.turns, moves: fnv(moves.join('\n')) }
}
const browserGolden = golden.cases
  .filter((item) => item.command === 'play' || item.command === 'coach')
  .map((item) => ({
    command: item.command,
    bot: item.job.bot,
    seed: item.job.seed,
    ...goldenGame(item.job, item.command === 'coach'),
  }))
const goldenNow = { engineRev: info.engineRev, gamesRev: info.gamesRev, cases: browserGolden }
if (process.argv.includes('--regenerate')) {
  writeFileSync(goldenFile, `${JSON.stringify(goldenNow, null, 2)}\n`)
  console.log(`games-wasm.json: ${browserGolden.length} casos escritos`)
} else {
  // The content, not the text: the formatter (biome) lays the file out its way.
  const kept = existsSync(goldenFile) ? JSON.stringify(JSON.parse(readFileSync(goldenFile, 'utf8'))) : ''
  check(
    kept === JSON.stringify(goldenNow),
    'las partidas del navegador cambiaron (games-wasm.json): si es a propósito, hacé el archivo de nuevo con ' +
      '`node engine/wasm/smoke.mjs <carpeta> --regenerate`; las partidas en curso del navegador terminan como «cambió el motor»',
  )
  console.log(`dorado del navegador: ${browserGolden.length} casos iguales`)
}

let refused = false
try {
  new engine.LiveGame(JSON.stringify({ ...base, bot: 'h', seed: '1' }))
} catch (error) {
  refused = /no sirve como rival/.test(String(error?.message ?? error))
}
check(refused, 'a bad job is a JavaScript error, not a crash')
check(panic === null, `no panic: ${panic}`)
console.log(`OK: motor ${info.engineRev.slice(0, 7)} (engine-wasm ${info.version})`)
