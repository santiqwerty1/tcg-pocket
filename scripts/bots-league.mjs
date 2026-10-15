#!/usr/bin/env node
/**
 * A league between the engine's bots (docs/BOTS.md, «Cómo se mide»: the bots' grade is their strength).
 *
 *   node scripts/bots-league.mjs --engine <engine-cli> --bots g2,e2[,f2…] [--decks <file.json>] [--games 40]
 *                                [--threads 4] [--seed 20261015] [--json <out.json>]
 *
 * Every two bots X and Y play every unordered pair of decks {a, b} twice with the same seed: X with a against Y with
 * b, then Y with a against X with b. Game `i` of both runs deals the same cards and flips the same coins (engine-cli
 * seeds each game by its index), so each index is one paired game: X's score is the mean of its two results (a win
 * 1, a tie ½). The interval is a bootstrap over the deck pairs, the unit the games share. With three bots or more, a
 * Bradley–Terry fit over every paired result gives an Elo per bot, the first bot at 0.
 *
 * `--decks` is a JSON object, name → deck in engine-cli's text format; by default the bank of
 * `scripts/fixtures/league-b4a.json` (8 lists of the B4a meta bank and decks 16, 23 and 40). `--engine` may be a
 * `.mjs` file, run with node (the tests' fake engine). Nothing here touches the app or its database.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_DECKS = join(ROOT, 'scripts', 'fixtures', 'league-b4a.json')

/** Each unordered pair of deck names, in the order of the file. */
export function deckPairs(names) {
  const pairs = []
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j]])
  return pairs
}

/** Each unordered pair of bots, in the order given. */
export function botPairs(bots) {
  return deckPairs(bots)
}

/** The seed of a deck pair: the same for every pair of bots, so two leagues with the same decks share their games. */
export function pairSeed(seed, a, b) {
  let hash = 0xcbf29ce484222325n
  for (const byte of Buffer.from(`${seed}\u0000${a}\u0000${b}`, 'utf8')) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return Number(hash % 2n ** 53n)
}

/** X's result in one game of a run: `winner` is engine-cli's letter (A, B, T) and `seat` X's side (A or B). */
export function score(winner, seat) {
  if (winner === 'T') return 0.5
  return winner === seat ? 1 : 0
}

/**
 * X's paired scores for one deck pair, from the two runs' `perGame.winners`: in `first` X was A, in `second` X was B.
 * Both must have the same number of games.
 */
export function pairedScores(first, second) {
  if (first.length !== second.length) throw new Error(`runs of ${first.length} and ${second.length} games`)
  return [...first].map((winner, i) => (score(winner, 'A') + score(second[i], 'B')) / 2)
}

/** Mulberry32: a small seeded generator, so the bootstrap gives the same interval every time. */
function generator(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The mean of every score, and its 95 % interval by resampling the clusters (the deck pairs) with replacement. */
export function clusterInterval(clusters, { resamples = 2000, seed = 20261015 } = {}) {
  const all = clusters.flat()
  if (all.length === 0) return { mean: null, n: 0, ci95: null }
  const mean = all.reduce((sum, x) => sum + x, 0) / all.length
  const random = generator(seed)
  const means = []
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    let n = 0
    for (let k = 0; k < clusters.length; k++) {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      for (const x of cluster) sum += x
      n += cluster.length
    }
    means.push(n > 0 ? sum / n : mean)
  }
  means.sort((x, y) => x - y)
  const at = (q) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))]
  return { mean, n: all.length, ci95: [at(0.025), at(0.975)] }
}

/**
 * Bradley–Terry strengths from paired results (`results[i][j]`: i's total score against j, ties counted half), by
 * the MM iteration (Hunter, 2004), as Elo points: 400·log10 of the strength, the first bot at 0. A bot that won or
 * lost everything has no finite Elo: each pair gets half a game won by each side first.
 */
export function eloFromResults(bots, results, games) {
  const k = bots.length
  const wins = bots.map((_, i) => bots.map((_, j) => (i === j ? 0 : (results[i]?.[j] ?? 0) + 0.5)))
  const played = bots.map((_, i) => bots.map((_, j) => (i === j ? 0 : (games[i]?.[j] ?? 0) + 1)))
  let strength = bots.map(() => 1)
  for (let iteration = 0; iteration < 1000; iteration++) {
    const next = strength.map((_, i) => {
      const won = wins[i].reduce((sum, w) => sum + w, 0)
      let denominator = 0
      for (let j = 0; j < k; j++)
        if (j !== i && played[i][j] > 0) denominator += played[i][j] / (strength[i] + strength[j])
      return denominator > 0 ? won / denominator : strength[i]
    })
    const norm = next[0]
    const scaled = next.map((s) => s / norm)
    const change = Math.max(...scaled.map((s, i) => Math.abs(s - strength[i])))
    strength = scaled
    if (change < 1e-12) break
  }
  return Object.fromEntries(bots.map((bot, i) => [bot, 400 * Math.log10(strength[i])]))
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function runEngine(engine, job) {
  const dir = mkdtempSync(join(tmpdir(), 'bots-league-'))
  try {
    const jobFile = join(dir, 'job.json')
    const resultFile = join(dir, 'result.json')
    writeFileSync(jobFile, JSON.stringify(job))
    const [command, args] = engine.endsWith('.mjs') ? [process.execPath, [engine]] : [engine, []]
    execFileSync(command, [...args, 'simulate', jobFile, resultFile], { stdio: ['ignore', 'ignore', 'pipe'] })
    const result = JSON.parse(readFileSync(resultFile, 'utf8'))
    if (!result.perGame?.winners) throw new Error('the engine did not report perGame')
    return result.perGame.winners
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The whole league: for each pair of bots, X's paired scores by deck pair. */
export function playLeague({ engine, bots, decks, games, threads, seed }) {
  const names = Object.keys(decks)
  const pairs = deckPairs(names)
  const matches = []
  for (const [x, y] of botPairs(bots)) {
    const byPair = []
    for (const [a, b] of pairs) {
      const job = { deckA: decks[a], deckB: decks[b], games, seed: pairSeed(seed, a, b), threads, perGame: true }
      const first = runEngine(engine, { ...job, players: [x, y] })
      const second = runEngine(engine, { ...job, players: [y, x] })
      byPair.push({
        a,
        b,
        scores: pairedScores(first, second),
        // Each seat apart, for the breakdown by deck: X held a in the first run and b in the second.
        xWithA: [...first].map((winner) => score(winner, 'A')),
        xWithB: [...second].map((winner) => score(winner, 'B')),
      })
    }
    matches.push({ x, y, byPair })
  }
  return matches
}

/** What the league says: per pair of bots, X's mean with its interval and by deck; with three bots or more, an Elo. */
export function summarize(bots, matches, options) {
  const rows = matches.map(({ x, y, byPair }) => {
    const overall = clusterInterval(
      byPair.map((pair) => pair.scores),
      options,
    )
    // By deck: how X and Y each did holding it, against the same rival decks and the same games (X held a in the
    // first run while Y held it in the second, and the other way around for b). Each rate carries the deck as much as
    // the bot: it is a breakdown to look at, not a test (the interval above is the one that holds).
    const decks = {}
    const add = (name, x, y) => {
      decks[name] ??= { x: [], y: [] }
      decks[name].x.push(...x)
      decks[name].y.push(...y)
    }
    for (const { a, b, xWithA, xWithB } of byPair) {
      add(
        a,
        xWithA,
        xWithB.map((s) => 1 - s),
      )
      add(
        b,
        xWithB,
        xWithA.map((s) => 1 - s),
      )
    }
    const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length
    const byDeck = Object.fromEntries(
      Object.entries(decks).map(([name, { x, y }]) => [name, { x: mean(x), y: mean(y), n: x.length }]),
    )
    return { x, y, ...overall, byDeck }
  })
  let elo = null
  if (bots.length >= 3) {
    const index = new Map(bots.map((bot, i) => [bot, i]))
    const results = bots.map(() => bots.map(() => 0))
    const games = bots.map(() => bots.map(() => 0))
    for (const row of rows) {
      const i = index.get(row.x)
      const j = index.get(row.y)
      results[i][j] += row.mean * row.n
      results[j][i] += (1 - row.mean) * row.n
      games[i][j] += row.n
      games[j][i] += row.n
    }
    elo = eloFromResults(bots, results, games)
  }
  return { rows, elo }
}

const percent = (x) => `${(100 * x).toFixed(1).replace('.', ',')} %`

function main() {
  const engine = argument('--engine')
  const bots = (argument('--bots') ?? '').split(',').filter(Boolean)
  if (!engine || bots.length < 2) {
    console.error('Uso: node scripts/bots-league.mjs --engine <engine-cli> --bots g2,e2[,f2…] [--decks file.json]')
    process.exit(2)
  }
  const decks = JSON.parse(readFileSync(argument('--decks', DEFAULT_DECKS), 'utf8'))
  const games = Number(argument('--games', '40'))
  const threads = Number(argument('--threads', '4'))
  const seed = Number(argument('--seed', '20261015'))
  const started = Date.now()
  const matches = playLeague({ engine, bots, decks, games, threads, seed })
  const summary = summarize(bots, matches)
  const pairs = deckPairs(Object.keys(decks)).length
  for (const row of summary.rows) {
    const [lo, hi] = row.ci95
    console.log(
      `${row.x} contra ${row.y}: ${percent(row.mean)} para ${row.x} (n = ${row.n} partidas apareadas en ${pairs} pares de mazos, IC 95 % ${percent(lo)}–${percent(hi)})`,
    )
    for (const [name, deck] of Object.entries(row.byDeck)) {
      console.log(`  con ${name}: ${row.x} ${percent(deck.x)}, ${row.y} ${percent(deck.y)} (n = ${deck.n} por bot)`)
    }
  }
  if (summary.elo) {
    console.log('Elo (Bradley–Terry):')
    for (const [bot, points] of Object.entries(summary.elo)) console.log(`  ${bot}: ${points.toFixed(0)}`)
  }
  console.log(`(${Math.round((Date.now() - started) / 1000)} s)`)
  const out = argument('--json')
  if (out)
    writeFileSync(out, `${JSON.stringify({ bots, games, seed, decks: Object.keys(decks), ...summary }, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
