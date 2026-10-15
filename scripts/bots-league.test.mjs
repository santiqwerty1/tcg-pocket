// node --test scripts/bots-league.test.mjs — the league between the engine's bots (docs/BOTS.md).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  clusterInterval,
  DEFAULT_DECKS,
  deckPairs,
  eloFromResults,
  pairedScores,
  pairSeed,
  playLeague,
  score,
  summarize,
} from './bots-league.mjs'

const SCRIPT = fileURLToPath(new URL('./bots-league.mjs', import.meta.url))

/**
 * A stand-in for `engine-cli simulate`: «strong» wins every game it plays, «weak» loses every game, and between two
 * other bots game i goes to A when i is even, to B when it is odd, and is a tie every fifth. It writes the job it got
 * to FAKE_LEAGUE_LOG, one line each.
 */
const FAKE = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const [command, jobFile, resultFile] = process.argv.slice(2)
if (command !== 'simulate') process.exit(2)
const job = JSON.parse(readFileSync(jobFile, 'utf8'))
if (process.env.FAKE_LEAGUE_LOG) appendFileSync(process.env.FAKE_LEAGUE_LOG, JSON.stringify(job) + '\\n')
const [a, b] = job.players
let winners = ''
for (let i = 0; i < job.games; i++) {
  if (a === 'strong' || b === 'weak') winners += 'A'
  else if (b === 'strong' || a === 'weak') winners += 'B'
  else winners += i % 5 === 4 ? 'T' : i % 2 === 0 ? 'A' : 'B'
}
writeFileSync(resultFile, JSON.stringify({ perGame: job.perGame ? { winners } : undefined }))
`

function fakeEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'bots-league-test-'))
  const engine = join(dir, 'fake-engine.mjs')
  writeFileSync(engine, FAKE)
  return { dir, engine, log: join(dir, 'jobs.log') }
}

const DECKS = { uno: 'Energy: Grass\n', dos: 'Energy: Fire\n', tres: 'Energy: Water\n' }

describe('the league', () => {
  it('pairs every two decks once, in the order of the file', () => {
    assert.deepEqual(deckPairs(['a', 'b', 'c']), [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
    assert.deepEqual(deckPairs(['a']), [])
  })

  it('gives a deck pair the same seed whatever the bots, and another pair another seed', () => {
    assert.equal(pairSeed(7, 'a', 'b'), pairSeed(7, 'a', 'b'))
    assert.notEqual(pairSeed(7, 'a', 'b'), pairSeed(7, 'b', 'a'))
    assert.notEqual(pairSeed(7, 'a', 'b'), pairSeed(8, 'a', 'b'))
    assert.ok(Number.isSafeInteger(pairSeed(7, 'a', 'b')) && pairSeed(7, 'a', 'b') >= 0)
  })

  it('scores X by its seat: a win 1, a tie ½', () => {
    assert.equal(score('A', 'A'), 1)
    assert.equal(score('B', 'A'), 0)
    assert.equal(score('B', 'B'), 1)
    assert.equal(score('T', 'B'), 0.5)
    // X was A in the first run and B in the second: game 0 X won both, game 1 lost both, game 2 won one and tied one.
    assert.deepEqual(pairedScores('ABA', 'BAT'), [1, 0, 0.75])
    assert.throws(() => pairedScores('AB', 'A'))
  })

  it('takes the interval over the deck pairs, the same every time', () => {
    const clusters = [
      [1, 1, 1],
      [0, 0, 0],
      [1, 0, 1],
    ]
    const once = clusterInterval(clusters)
    assert.equal(once.n, 9)
    assert.ok(Math.abs(once.mean - 5 / 9) < 1e-12)
    assert.deepEqual(clusterInterval(clusters), once)
    assert.ok(once.ci95[0] < once.mean && once.mean < once.ci95[1])
    // All pairs alike: no spread at all.
    assert.deepEqual(clusterInterval([[0.5], [0.5]]).ci95, [0.5, 0.5])
    assert.equal(clusterInterval([]).mean, null)
  })

  it('fits an Elo with the first bot at 0, and finite for a bot that won everything', () => {
    // b beat a 3 to 1 in 4 games; c lost all its 4 against a.
    const elo = eloFromResults(
      ['a', 'b', 'c'],
      [
        [0, 1, 4],
        [3, 0, 0],
        [0, 0, 0],
      ],
      [
        [0, 4, 4],
        [4, 0, 0],
        [4, 0, 0],
      ],
    )
    assert.equal(elo.a, 0)
    assert.ok(elo.b > 0 && Number.isFinite(elo.b), JSON.stringify(elo))
    assert.ok(elo.c < 0 && Number.isFinite(elo.c), JSON.stringify(elo))
    // Two even bots: the same Elo.
    const even = eloFromResults(
      ['a', 'b'],
      [
        [0, 5],
        [5, 0],
      ],
      [
        [0, 10],
        [10, 0],
      ],
    )
    assert.ok(Math.abs(even.b) < 1e-6)
  })

  it('plays both seats of every deck pair with the same seed, and sees who is stronger', () => {
    const { dir, engine, log } = fakeEngine()
    try {
      process.env.FAKE_LEAGUE_LOG = log
      const matches = playLeague({
        engine,
        bots: ['strong', 'even', 'weak'],
        decks: DECKS,
        games: 10,
        threads: 2,
        seed: 3,
      })
      const jobs = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      // 3 pairs of bots × 3 pairs of decks × 2 seats.
      assert.equal(jobs.length, 18)
      for (let k = 0; k < jobs.length; k += 2) {
        assert.deepEqual(jobs[k + 1].players, [...jobs[k].players].reverse())
        assert.equal(jobs[k + 1].seed, jobs[k].seed)
        assert.equal(jobs[k].deckA, jobs[k + 1].deckA)
        assert.equal(jobs[k].perGame, true)
      }
      // The same deck pair has the same seed for every pair of bots.
      assert.equal(new Set(jobs.map((job) => `${job.deckA}|${job.seed}`)).size, 3)
      const summary = summarize(['strong', 'even', 'weak'], matches)
      const row = (x, y) => summary.rows.find((r) => r.x === x && r.y === y)
      assert.equal(row('strong', 'even').mean, 1)
      assert.equal(row('even', 'weak').mean, 1)
      assert.equal(row('strong', 'weak').mean, 1)
      assert.equal(row('strong', 'even').n, 30)
      assert.ok(summary.elo.strong === 0 && summary.elo.even < 0 && summary.elo.weak < summary.elo.even)
    } finally {
      delete process.env.FAKE_LEAGUE_LOG
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('scores two bots that play alike at a half, ties included', () => {
    const { dir, engine } = fakeEngine()
    try {
      const summary = summarize(
        ['x', 'y'],
        playLeague({ engine, bots: ['x', 'y'], decks: DECKS, games: 10, threads: 1, seed: 1 }),
      )
      // Game i goes to A or B in both runs: X wins one of the pair and loses the other, or ties both.
      assert.equal(summary.rows[0].mean, 0.5)
      assert.equal(summary.elo, null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs from the command line and writes its JSON', () => {
    const { dir, engine } = fakeEngine()
    try {
      const out = join(dir, 'league.json')
      const decks = join(dir, 'decks.json')
      writeFileSync(decks, JSON.stringify(DECKS))
      const text = execFileSync(
        process.execPath,
        [SCRIPT, '--engine', engine, '--bots', 'strong,weak', '--decks', decks, '--games', '4', '--json', out],
        { encoding: 'utf8' },
      )
      assert.match(text, /strong contra weak: 100,0 % para strong \(n = 12 partidas apareadas en 3 pares de mazos/)
      const json = JSON.parse(readFileSync(out, 'utf8'))
      assert.deepEqual(json.bots, ['strong', 'weak'])
      assert.equal(json.rows[0].mean, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ships a bank of decks the engine can read', () => {
    const decks = JSON.parse(readFileSync(DEFAULT_DECKS, 'utf8'))
    const names = Object.keys(decks)
    assert.equal(names.length, 11)
    for (const name of names) {
      const lines = decks[name].trim().split('\n')
      assert.match(lines[0], /^Energy: /, name)
      const cards = lines.slice(1).reduce((sum, line) => sum + Number(line.split(' ')[0]), 0)
      assert.equal(cards, 20, name)
    }
  })
})
