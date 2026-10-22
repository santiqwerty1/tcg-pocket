#!/usr/bin/env node
/**
 * Decks against the meta bank, with the same bot on both sides (docs/BOTS.md, «Cómo se mide»; the measurements of
 * H-055).
 *
 *   node scripts/bots-bank.mjs --engine <engine-cli> --bot g2 --subjects "Mazo 16: Dedenne ex / Indeedee ex"[,…]
 *                              [--decks <file.json>] [--bank <file.json>] [--games 200] [--threads 4]
 *                              [--seed 777000] [--json <out.json>]
 *
 * Each subject plays every list of the bank, `games` games each, as deck A. The list at position k of the bank gets
 * the seed `seed + k`, so two runs with the same bank, games and seed play the same games, whatever the bot or the
 * number of threads (engine-cli seeds each game by its index). The rate is the lab's `metaScore`
 * (packages/domain/src/lab/score.ts): each list's wins over its games (a tie is not a win), weighted by the list's
 * bank weight renormalized over the lists played, with a 95 % interval from the variance smoothed with +2/+4.
 *
 * A subject is a name of `--decks` (name → deck in engine-cli's text format; by default the league's
 * `scripts/fixtures/league-b4a.json`, with decks 16, 23 and 40) or a `listKey` of the bank. `--bank` is a JSON
 * array of { archetype, listKey, weight, deck }; by default `scripts/fixtures/bank-b4a-20261015.json`, the 18 lists
 * of `lab_meta_bank` on 15/10/2026 (era B4a). `--engine` may be a `.mjs` file, run with node (the tests' fake
 * engine). Nothing here touches the app or its database.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_DECKS = join(ROOT, 'scripts', 'fixtures', 'league-b4a.json')
export const DEFAULT_BANK = join(ROOT, 'scripts', 'fixtures', 'bank-b4a-20261015.json')
const Z_95 = 1.959963984540054

/**
 * The lab's `metaScore` over `rows` of { weight, wins, games }, on a 0–1 scale: null when no list with weight was
 * played. Ties count as games, not wins.
 */
export function bankScore(rows) {
  const played = rows.filter((row) => row.weight > 0 && row.games > 0)
  const weightSum = played.reduce((sum, row) => sum + row.weight, 0)
  if (played.length === 0 || weightSum === 0) return null
  let value = 0
  let variance = 0
  let games = 0
  for (const row of played) {
    const weight = row.weight / weightSum
    value += (weight * row.wins) / row.games
    const smoothed = (row.wins + 2) / (row.games + 4)
    variance += (weight * weight * smoothed * (1 - smoothed)) / row.games
    games += row.games
  }
  const se = Math.sqrt(variance)
  return { value, ci95: [Math.max(0, value - Z_95 * se), Math.min(1, value + Z_95 * se)], games, lists: played.length }
}

/** The deck of a subject: a name of `decks`, or a `listKey` of the bank. */
export function subjectDeck(subject, decks, bank) {
  if (Object.hasOwn(decks, subject)) return decks[subject]
  const list = bank.find((row) => row.listKey === subject)
  if (!list) throw new Error(`«${subject}» no es un mazo de --decks ni una lista del banco`)
  return list.deck
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function runEngine(engine, job) {
  const dir = mkdtempSync(join(tmpdir(), 'bots-bank-'))
  try {
    const jobFile = join(dir, 'job.json')
    const resultFile = join(dir, 'result.json')
    writeFileSync(jobFile, JSON.stringify(job))
    const [command, args] = engine.endsWith('.mjs') ? [process.execPath, [engine]] : [engine, []]
    execFileSync(command, [...args, 'simulate', jobFile, resultFile], { stdio: ['ignore', 'ignore', 'pipe'] })
    return JSON.parse(readFileSync(resultFile, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Why a run cannot give a score, or null when it can: no list with weight to play, games or threads that are not a
 * positive whole number, or a seed whose list seeds `seed + k` are not all distinct whole numbers (past
 * `Number.MAX_SAFE_INTEGER` two of them round to the same one).
 */
export function checkRun({ bank, games, threads, seed }) {
  if (!Array.isArray(bank) || !bank.some((list) => list.weight > 0)) return 'el banco no tiene listas con peso'
  if (!Number.isSafeInteger(games) || games <= 0) return '--games tiene que ser un entero positivo'
  if (!Number.isSafeInteger(threads) || threads <= 0) return '--threads tiene que ser un entero positivo'
  // Compared before adding: near the limit, `seed + k` itself rounds.
  const highest = Number.MAX_SAFE_INTEGER - (bank.length - 1)
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > highest)
    return `--seed tiene que ser un entero entre 0 y ${highest}`
  return null
}

/**
 * One subject against every list of the bank with weight: its record against each and the weighted score. A list
 * without weight is not played (the score leaves it out); the others keep the seed of their position.
 */
export function playBank({ engine, bot, deck, bank, games, threads, seed }) {
  const rows = bank.flatMap((list, k) => {
    if (!(list.weight > 0)) return []
    const result = runEngine(engine, {
      deckA: deck,
      deckB: list.deck,
      players: [bot, bot],
      games,
      seed: seed + k,
      threads,
    })
    return [
      {
        archetype: list.archetype,
        listKey: list.listKey,
        weight: list.weight,
        wins: result.winsA,
        losses: result.winsB,
        ties: result.ties,
        games: result.games,
      },
    ]
  })
  return { rows, score: bankScore(rows) }
}

const percent = (x) => `${(100 * x).toFixed(1).replace('.', ',')} %`

function main() {
  const engine = argument('--engine')
  const bot = argument('--bot')
  const subjects = (argument('--subjects') ?? '').split(',').filter(Boolean)
  if (!engine || !bot || subjects.length === 0) {
    console.error('Uso: node scripts/bots-bank.mjs --engine <engine-cli> --bot g2 --subjects "Mazo 16: …"[,…]')
    process.exit(2)
  }
  const decks = JSON.parse(readFileSync(argument('--decks', DEFAULT_DECKS), 'utf8'))
  const bank = JSON.parse(readFileSync(argument('--bank', DEFAULT_BANK), 'utf8'))
  const games = Number(argument('--games', '200'))
  const threads = Number(argument('--threads', '4'))
  const seed = Number(argument('--seed', '777000'))
  const invalid = checkRun({ bank, games, threads, seed })
  if (invalid) {
    console.error(invalid)
    process.exit(2)
  }
  // Every subject's deck before the first game: a misspelled last subject must not cost the games of the others
  // (Codex on #146).
  let subjectDecks
  try {
    subjectDecks = subjects.map((subject) => subjectDeck(subject, decks, bank))
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const started = Date.now()
  const results = {}
  for (const [index, subject] of subjects.entries()) {
    const { rows, score } = playBank({
      engine,
      bot,
      deck: subjectDecks[index],
      bank,
      games,
      threads,
      seed,
    })
    results[subject] = { rows, score }
    if (!score) {
      console.log(`${subject} con ${bot}: el motor no jugó ninguna partida`)
      continue
    }
    const ties = rows.reduce((sum, row) => sum + row.ties, 0)
    const [lo, hi] = score.ci95
    console.log(
      `${subject} con ${bot}: ${percent(score.value)} ponderado (IC 95 % ${percent(lo)}–${percent(hi)}, n = ${score.games} partidas contra ${score.lists} listas, ${ties} empates)`,
    )
    for (const row of rows) {
      console.log(`  ${row.archetype} (${row.listKey}, peso ${row.weight}): ${percent(row.wins / row.games)}`)
    }
  }
  console.log(`(${Math.round((Date.now() - started) / 1000)} s)`)
  const out = argument('--json')
  if (out) writeFileSync(out, `${JSON.stringify({ bot, games, seed, results }, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
