// node --test scripts/bots-bank.test.mjs — decks against the meta bank (docs/BOTS.md, H-055).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { bankScore, checkRun, DEFAULT_BANK, DEFAULT_DECKS, playBank, subjectDeck } from './bots-bank.mjs'

const SCRIPT = fileURLToPath(new URL('./bots-bank.mjs', import.meta.url))

/**
 * A stand-in for `engine-cli simulate`: deck A wins every game against a Fire deck and loses every game against a
 * Water deck; against anything else game i goes to A when i is even and to B when it is odd, and is a tie every
 * fifth. It writes the job it got to FAKE_BANK_LOG, one line each.
 */
const FAKE = `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const [command, jobFile, resultFile] = process.argv.slice(2)
if (command !== 'simulate') process.exit(2)
const job = JSON.parse(readFileSync(jobFile, 'utf8'))
if (process.env.FAKE_BANK_LOG) appendFileSync(process.env.FAKE_BANK_LOG, JSON.stringify(job) + '\\n')
let winsA = 0, winsB = 0, ties = 0
for (let i = 0; i < job.games; i++) {
  if (job.deckB.includes('Fire')) winsA++
  else if (job.deckB.includes('Water')) winsB++
  else if (i % 5 === 4) ties++
  else if (i % 2 === 0) winsA++
  else winsB++
}
writeFileSync(resultFile, JSON.stringify({ winsA, winsB, ties, games: job.games }))
`

function fakeEngine() {
  const dir = mkdtempSync(join(tmpdir(), 'bots-bank-test-'))
  const engine = join(dir, 'fake-engine.mjs')
  writeFileSync(engine, FAKE)
  return { dir, engine, log: join(dir, 'jobs.log') }
}

const BANK = [
  { archetype: 'Fuego', listKey: 'aaa', weight: 0.5, deck: 'Energy: Fire\n' },
  { archetype: 'Agua', listKey: 'bbb', weight: 0.25, deck: 'Energy: Water\n' },
  { archetype: 'Planta', listKey: 'ccc', weight: 0.25, deck: 'Energy: Grass\n' },
]

describe('decks against the meta bank', () => {
  it('weights each list as the lab does, with a tie as a game and not a win', () => {
    const score = bankScore([
      { weight: 3, wins: 5, games: 10 },
      { weight: 1, wins: 10, games: 10 },
    ])
    assert.equal(score.value, 0.75 * 0.5 + 0.25 * 1)
    // The variance of each list with its wins smoothed +2/+4, the weights renormalized to 0.75 and 0.25.
    const variance = (0.75 ** 2 * (7 / 14) * (7 / 14)) / 10 + (0.25 ** 2 * (12 / 14) * (2 / 14)) / 10
    const half = 1.959963984540054 * Math.sqrt(variance)
    assert.ok(Math.abs(score.ci95[0] - (score.value - half)) < 1e-12)
    assert.ok(Math.abs(score.ci95[1] - (score.value + half)) < 1e-12)
    assert.deepEqual([score.games, score.lists], [20, 2])
  })

  it('leaves out lists without weight or games, clamps the interval, and is null with nothing played', () => {
    const score = bankScore([
      { weight: 1, wins: 10, games: 10 },
      { weight: 0, wins: 0, games: 10 },
      { weight: 1, wins: 0, games: 0 },
    ])
    assert.equal(score.value, 1)
    assert.equal(score.ci95[1], 1)
    assert.equal(score.lists, 1)
    assert.equal(bankScore([{ weight: 0, wins: 1, games: 1 }]), null)
    assert.equal(bankScore([]), null)
  })

  it('a subject is a deck of the file or a list of the bank', () => {
    assert.equal(subjectDeck('mío', { mío: 'Energy: Psychic\n' }, BANK), 'Energy: Psychic\n')
    assert.equal(subjectDeck('ccc', {}, BANK), 'Energy: Grass\n')
    assert.throws(() => subjectDeck('nada', {}, BANK), /no es un mazo/)
  })

  it('plays the subject as A against every list, the same bot on both sides, the list at k with seed + k', () => {
    const { dir, engine, log } = fakeEngine()
    process.env.FAKE_BANK_LOG = log
    try {
      const { rows, score } = playBank({
        engine,
        bot: 'g2',
        deck: 'Energy: Psychic\n',
        bank: BANK,
        games: 10,
        threads: 2,
        seed: 777000,
      })
      const jobs = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      assert.deepEqual(
        jobs.map((job) => [job.deckA, job.deckB, job.players, job.seed, job.games, job.threads]),
        BANK.map((list, k) => ['Energy: Psychic\n', list.deck, ['g2', 'g2'], 777000 + k, 10, 2]),
      )
      assert.deepEqual(
        rows.map((row) => [row.listKey, row.wins, row.losses, row.ties, row.games]),
        [
          ['aaa', 10, 0, 0, 10],
          ['bbb', 0, 10, 0, 10],
          ['ccc', 4, 4, 2, 10],
        ],
      )
      assert.equal(score.value, 0.5 * 1 + 0.25 * 0 + 0.25 * 0.4)
    } finally {
      delete process.env.FAKE_BANK_LOG
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not play a list without weight, and the others keep the seed of their position (Codex on #146)', () => {
    const { dir, engine, log } = fakeEngine()
    process.env.FAKE_BANK_LOG = log
    try {
      const bank = [{ ...BANK[0], weight: 0 }, BANK[1], { ...BANK[2], weight: -1 }, BANK[2]]
      const { rows, score } = playBank({
        engine,
        bot: 'e2',
        deck: 'Energy: Psychic\n',
        bank,
        games: 10,
        threads: 1,
        seed: 5,
      })
      const jobs = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      assert.deepEqual(
        jobs.map((job) => [job.deckB, job.seed]),
        [
          ['Energy: Water\n', 6],
          ['Energy: Grass\n', 8],
        ],
      )
      assert.deepEqual(
        rows.map((row) => row.listKey),
        ['bbb', 'ccc'],
      )
      assert.equal(score.lists, 2)
    } finally {
      delete process.env.FAKE_BANK_LOG
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a run that cannot give a score is refused before playing (Codex on #146)', () => {
    const ok = { bank: BANK, games: 200, threads: 4, seed: 777000 }
    assert.equal(checkRun(ok), null)
    assert.match(checkRun({ ...ok, bank: [] }), /no tiene listas con peso/)
    assert.match(checkRun({ ...ok, bank: [{ ...BANK[0], weight: 0 }] }), /no tiene listas con peso/)
    for (const games of [0, -1, 1.5, Number.NaN]) assert.match(checkRun({ ...ok, games }), /--games/)
    assert.match(checkRun({ ...ok, threads: 0 }), /--threads/)
    for (const seed of [-1, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1]) {
      assert.match(checkRun({ ...ok, seed }), /--seed/, String(seed))
    }
    // The last seed that keeps the three list seeds distinct whole numbers.
    assert.equal(checkRun({ ...ok, seed: Number.MAX_SAFE_INTEGER - 2 }), null)
  })

  it('the default bank is the 18 lists of lab_meta_bank on 15/10/2026, and the league has decks 16, 23 and 40', () => {
    const bank = JSON.parse(readFileSync(DEFAULT_BANK, 'utf8'))
    assert.equal(bank.length, 18)
    assert.equal(new Set(bank.map((list) => list.listKey)).size, 18)
    assert.ok(Math.abs(bank.reduce((sum, list) => sum + list.weight, 0) - 1) < 0.01)
    for (const list of bank) assert.match(list.deck, /^Energy: /)
    const decks = JSON.parse(readFileSync(DEFAULT_DECKS, 'utf8'))
    for (const name of [
      'Mazo 16: Dedenne ex / Indeedee ex',
      'Mazo 23: Mismagius / Latias',
      'Mazo 40: Mega-Venusaur ex',
    ])
      assert.ok(Object.hasOwn(decks, name), name)
  })

  it('the command prints the weighted rate with its interval, n and ties, and each list', () => {
    const { dir, engine } = fakeEngine()
    try {
      const bankFile = join(dir, 'bank.json')
      writeFileSync(bankFile, JSON.stringify(BANK))
      const out = execFileSync(
        process.execPath,
        [SCRIPT, '--engine', engine, '--bot', 'e2', '--subjects', 'ccc', '--bank', bankFile, '--games', '10'],
        { encoding: 'utf8' },
      )
      assert.match(
        out,
        /^ccc con e2: 60,0 % ponderado \(IC 95 % \d+,\d %–\d+,\d %, n = 30 partidas contra 3 listas, 2 empates\)/,
      )
      assert.match(out, / {2}Planta \(ccc, peso 0\.25\): 40,0 %/)
      // A run with no games is refused with a message, not a TypeError (Codex on #146).
      const refused = (() => {
        try {
          execFileSync(
            process.execPath,
            [SCRIPT, '--engine', engine, '--bot', 'e2', '--subjects', 'ccc', '--bank', bankFile, '--games', '0'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          )
          return null
        } catch (error) {
          return error
        }
      })()
      assert.equal(refused?.status, 2)
      assert.match(refused.stderr, /--games tiene que ser un entero positivo/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
