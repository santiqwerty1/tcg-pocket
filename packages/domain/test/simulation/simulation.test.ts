import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineIdToTrackerId } from '../../src/catalog/index.js'
import {
  botCostVsE2,
  botLabel,
  buildSnapshot,
  COMPARE_SEED_STRIDE,
  chunkSeed,
  comparePairings,
  comparisonSeed,
  DEFAULT_BOT,
  DEFAULT_PLAYERS,
  DEPTH_COST_VS_E2,
  deckRecord,
  defaultReplaySample,
  type EngineStatus,
  engineEdition,
  estimateSeconds,
  gameSeed,
  isBotCode,
  LEGACY_DEFAULT_BOT,
  MAX_BASE_SEED,
  matrixPairings,
  matrixRows,
  planChunks,
  randomBaseSeed,
  SLOW_BOT_CODES,
  simulationRate,
  splitmix64,
  suggestEnergies,
} from '../../src/simulation/index.js'
import { deckDraft, parsedDecks } from '../helpers/loadDecks.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
/** The engine's own list of unimplemented cards at fb792ebf (docs/fase0): 46 B4b trainer reprints. */
const missing = new Set(
  (
    JSON.parse(readFileSync(join(repoRoot, 'docs/fase0/deckgym-no-implementadas-fb792ebf.json'), 'utf8')) as {
      id: string
    }[]
  ).map((card) => card.id),
)
const engine: EngineStatus = (engineId) => !missing.has(engineId)

describe('seeds: the same values as engine-cli', () => {
  it('splitmix64 matches the reference output and engine/src/main.rs', () => {
    expect(splitmix64(0n)).toBe(0xe220a8397b1dcdafn)
    expect(gameSeed(42, 0)).toBe(gameSeed(42, 0))
    expect(gameSeed(42, 0)).not.toBe(gameSeed(42, 1))
    expect(gameSeed(42, 0)).not.toBe(gameSeed(43, 0))
    expect(BigInt(gameSeed(1, 2))).toBeLessThan(2n ** 64n)
  })

  it('replays kept per pairing by default: one in a matrix, two in a comparison', () => {
    expect(defaultReplaySample('matrix')).toBe(1)
    expect(defaultReplaySample('compare')).toBe(2)
    expect(defaultReplaySample('explore')).toBe(2)
  })

  it('chunk seeds are base + idx, and random base seeds stay exact JavaScript integers', () => {
    expect(chunkSeed(1000, 7)).toBe(1007)
    const seed = randomBaseSeed(() => 0xffffffff)
    expect(Number.isSafeInteger(seed + 100_000)).toBe(true)
  })

  it('in a comparison the seed is the rival’s (and the part’s, for a split pairing), not the chunk’s (H-020)', () => {
    expect(comparisonSeed(1000, 0)).toBe(1000)
    expect(comparisonSeed(1000, 4)).toBe(1004)
    expect(comparisonSeed(1000, 4, 2)).toBe(1000 + 2 * COMPARE_SEED_STRIDE + 4)
    expect(Number.isSafeInteger(comparisonSeed(MAX_BASE_SEED, 149, 20))).toBe(true)
  })
})

describe('snapshots of the 40 real decks', () => {
  it('the 46 unimplemented B4b reprints all have an implemented edition of the same card', () => {
    expect(missing.size).toBe(46)
    for (const engineId of missing) {
      const card = index.cardById(engineIdToTrackerId(engineId))
      if (!card) throw new Error(engineId)
      const played = engineEdition(card, index, engine)
      expect(played, engineId).not.toBeNull()
      expect(played?.id).not.toBe(card.id)
      expect(played?.functionalGroupId).toBe(card.functionalGroupId)
    }
  })

  it('all 40 decks are simulable', () => {
    for (const deck of parsedDecks()) {
      const draft = deck.draft
      if (!draft) continue
      const snapshot = buildSnapshot({
        label: deck.title,
        cards: draft.cards,
        energies: draft.energies.length > 0 ? draft.energies : ['psychic'],
        index,
        engine,
      })
      expect(snapshot.problems, `${deck.number}. ${deck.title}`).toEqual([])
      expect(snapshot.deckgymText.startsWith('Energy: ')).toBe(true)
    }
  })

  it('a deck with B4b-198 and no remapping is not simulable, naming the card', () => {
    const base = deckDraft(2)
    const lucky = index.cardById('B4b-198')
    expect(lucky).toBeDefined()
    const cards = [...base.cards.slice(0, -1), { cardId: 'B4b-198', count: 1 }]
    const strict = buildSnapshot({ label: 'prueba', cards, energies: base.energies, index, engine, remap: false })
    expect(strict.simulable).toBe(false)
    expect(strict.problems).toContainEqual(
      expect.objectContaining({ kind: 'not_implemented', cardId: 'B4b-198', nameEs: lucky?.nameEs }),
    )
    const mapped = buildSnapshot({ label: 'prueba', cards, energies: base.energies, index, engine })
    const line = mapped.cards.find((card) => card.cardId === 'B4b-198')
    if (mapped.simulable) {
      expect(line?.playedAs).not.toBe('B4b-198')
      expect(index.cardById(line?.playedAs ?? '')?.functionalGroupId).toBe(lucky?.functionalGroupId)
    }
  })

  it('a list without energy (NOEX) is not simulable until the energy is chosen, with a suggestion', () => {
    const base = deckDraft(2)
    const snapshot = buildSnapshot({ label: 'NOEX', cards: base.cards, energies: [], index, engine })
    expect(snapshot.simulable).toBe(false)
    expect(snapshot.problems).toEqual([expect.objectContaining({ kind: 'energy_required', suggested: ['fire'] })])
    expect(suggestEnergies(base.cards, index)).toEqual(['fire'])
  })

  it('the same list gives the same key; a different energy, another key', () => {
    const base = deckDraft(2)
    const one = buildSnapshot({ label: 'x', cards: base.cards, energies: base.energies, index, engine })
    const two = buildSnapshot({ label: 'y', cards: base.cards, energies: base.energies, index, engine })
    const other = buildSnapshot({ label: 'z', cards: base.cards, energies: ['water'], index, engine })
    expect(one.key).toBe(two.key)
    expect(one.key).not.toBe(other.key)
  })

  it('size, basics and copies are checked as the engine does', () => {
    const base = deckDraft(2)
    const short = buildSnapshot({ label: 's', cards: base.cards.slice(1), energies: base.energies, index, engine })
    expect(short.problems.map((problem) => problem.kind)).toContain('size')
  })
})

describe('jobs', () => {
  it('a 40-deck matrix is 780 unordered pairings (1.560 with both orders)', () => {
    const decks = Array.from({ length: 40 }, (_, i) => i + 1)
    expect(matrixPairings(decks, decks)).toHaveLength(780)
    expect(matrixPairings(decks, decks, true)).toHaveLength(1560)
    // «Contra» left empty: the same as the list against itself.
    expect(matrixPairings(decks, [])).toEqual(matrixPairings(decks, decks))
    expect(matrixPairings([1, 2], [3, 4, 5])).toHaveLength(6)
    expect(comparePairings([2, 22], [1, 2, 3])).toEqual([
      { a: 2, b: 1 },
      { a: 2, b: 3 },
      { a: 22, b: 1 },
      { a: 22, b: 2 },
      { a: 22, b: 3 },
    ])
  })

  it('chunks split long pairings and number every chunk', () => {
    const chunks = planChunks(
      [
        { a: 1, b: 2 },
        { a: 1, b: 3 },
      ],
      2500,
      1000,
    )
    expect(chunks.map((chunk) => [chunk.idx, chunk.games, chunk.firstGame])).toEqual([
      [0, 1000, 0],
      [1, 1000, 1000],
      [2, 500, 2000],
      [3, 1000, 0],
      [4, 1000, 1000],
      [5, 500, 2000],
    ])
  })

  it('bot codes and a rough time estimate (780 × 200 e2 games ≈ 1,5 h on two threads)', () => {
    expect(isBotCode('e2')).toBe(true)
    expect(isBotCode('h')).toBe(false)
    expect(isBotCode('x')).toBe(false)
    // H-018: engine-cli's own expectiminimax that sees evolutions; about 1,3 times e2.
    expect(isBotCode('f2')).toBe(true)
    expect(isBotCode('f0')).toBe(false)
    expect(botLabel('f2')).toBe('expectiminimax corregido, profundidad 2')
    expect(estimateSeconds(1000, ['f2', 'f2'], 1)).toBeCloseTo(estimateSeconds(1000, ['e2', 'e2'], 1) * 1.3, 6)
    // T-021: the one that does not see the rival's hand or deck; about 3 times e2.
    expect(isBotCode('g1')).toBe(true)
    expect(isBotCode('g9')).toBe(true)
    expect(isBotCode('g0')).toBe(false)
    expect(isBotCode('g10')).toBe(false)
    expect(botLabel('g2')).toBe('expectiminimax sin trampa, profundidad 2')
    expect(estimateSeconds(1000, ['g2', 'e2'], 1)).toBeCloseTo(estimateSeconds(1000, ['e2', 'e2'], 1) * 3, 6)
    // D-025: what a worker with allowSlowBots false never takes, for the queue and the worker_idle alert.
    for (const slow of ['m', 'e3', 'e9', 'f3', 'f9', 'g1', 'g2', 'g9']) expect(SLOW_BOT_CODES).toContain(slow)
    for (const fast of ['r', 'w', 'aa', 'et', 'v', 'er', 'e1', 'e2', 'f1', 'f2'])
      expect(SLOW_BOT_CODES).not.toContain(fast)
    // The 40-deck matrix: ~52 min of engine time on 8 threads at fb792eb, ~35 min expected at 33ff2a5 (DECISIONES 9.1).
    const minutes = estimateSeconds(780 * 200, ['e2', 'e2'], 8) / 60
    expect(minutes).toBeGreaterThan(25)
    expect(minutes).toBeLessThan(50)
    expect(estimateSeconds(10_000, ['r', 'r'], 2)).toBeCloseTo(15, -1)
  })

  it('D-029: g2 is the bot by default since 23/10/2026, e2 before; estimates take its cost (about 3 times e2)', () => {
    expect(DEFAULT_BOT).toBe('g2')
    expect(DEFAULT_PLAYERS).toEqual(['g2', 'g2'])
    expect(isBotCode(DEFAULT_BOT)).toBe(true)
    // A slow bot (D-025): a worker that turns them down takes nothing by default; the PC does.
    expect(SLOW_BOT_CODES).toContain(DEFAULT_BOT)
    // Only for what was stored before without its bot.
    expect(LEGACY_DEFAULT_BOT).toBe('e2')
    expect(estimateSeconds(1000, DEFAULT_PLAYERS, 8)).toBeCloseTo(estimateSeconds(1000, ['e2', 'e2'], 8) * 3, 6)
  })
})

describe('what each bot costs (estimates)', () => {
  const e2 = estimateSeconds(1000, ['e2', 'e2'], 8)

  it('e1–e4 as measured in the calibration report of 12/10: e3 4,6 times e2 (D-029), not 1,6', () => {
    // Calibracion-2026-10-12.md, «Velocidad»: games per second on the PC, the same bank and engine for every bot.
    const measured = { e1: 373.2, e2: 70.1, e3: 15.4, e4: 6.3 }
    for (const [code, perSecond] of Object.entries(measured)) {
      const ratio = measured.e2 / perSecond
      expect(estimateSeconds(1000, [code, code], 8) / e2).toBeCloseTo(ratio, 0)
    }
    expect(estimateSeconds(1000, ['e3', 'e3'], 8)).toBeCloseTo(e2 * 4.6, 6)
    expect(botCostVsE2('e3')).toBe(4.6)
    expect(DEPTH_COST_VS_E2).toEqual({ 1: 0.19, 2: 1, 3: 4.6, 4: 11 })
    // The bot of either side that costs more sets the pace: e2 against e3 is e3's.
    expect(estimateSeconds(1000, ['e2', 'e3'], 8)).toBeCloseTo(e2 * 4.6, 6)
  })

  it('MCTS about 150 times e2 (0,46 games per second against 70,1), not 4', () => {
    expect(botCostVsE2('m')).toBe(150)
    expect(estimateSeconds(1000, ['m', 'm'], 8)).toBeCloseTo(e2 * 150, 6)
  })

  it('f and g keep their factor against e at the same depth, now on the measured depths', () => {
    expect(estimateSeconds(1000, ['f3', 'f3'], 8)).toBeCloseTo(e2 * 4.6 * 1.3, 6)
    expect(estimateSeconds(1000, ['g3', 'g3'], 8)).toBeCloseTo(e2 * 4.6 * 3, 6)
    expect(botCostVsE2('g2')).toBe(3)
    expect(botCostVsE2('f2')).toBeCloseTo(1.3, 9)
  })

  it('the depths never measured keep growing past e4, and an unknown code costs e2', () => {
    let previous = 0
    for (const kind of ['e', 'f', 'g']) {
      previous = 0
      for (let depth = 1; depth <= 9; depth++) {
        const cost = botCostVsE2(`${kind}${depth}`)
        expect(cost).toBeGreaterThan(previous)
        previous = cost
      }
    }
    expect(botCostVsE2('e5')).toBeCloseTo(11 * 2.5, 9)
    expect(botCostVsE2('h')).toBe(1)
    // The fast bots, as before.
    expect(estimateSeconds(10_000, ['r', 'r'], 2)).toBeCloseTo(15, -1)
    expect(botCostVsE2('v')).toBeCloseTo(0.08, 9)
  })
})

describe('results', () => {
  const chunks = [
    { a: 1, b: 2, winsA: 120, winsB: 70, ties: 10 },
    { a: 1, b: 3, winsA: 90, winsB: 100, ties: 10 },
    { a: 2, b: 3, winsA: 100, winsB: 100, ties: 0 },
  ]

  it('wins, losses and ties apart, from each side; Wilson over games, «orientativo» under 30', () => {
    expect(deckRecord(chunks, 1)).toEqual({ wins: 210, losses: 170, ties: 20 })
    expect(deckRecord(chunks, 3)).toEqual({ wins: 200, losses: 190, ties: 10 })
    const rate = simulationRate({ wins: 120, losses: 70, ties: 10 })
    expect(rate).toMatchObject({
      source: 'simulation',
      sampleKind: 'simulations',
      games: 200,
      value: 60,
      orientative: false,
    })
    expect(simulationRate({ wins: 5, losses: 4, ties: 1 })?.orientative).toBe(true)
    expect(simulationRate({ wins: 0, losses: 0, ties: 0 })).toBeNull()
  })

  it('matrix rows: each deck against each rival, best total first', () => {
    const rows = matrixRows(chunks, [1, 2, 3], [1, 2, 3])
    expect(rows.map((row) => row.deck)).toEqual([1, 3, 2])
    expect(rows[0]?.cells).toEqual([
      { rival: 2, record: { wins: 120, losses: 70, ties: 10 } },
      { rival: 3, record: { wins: 90, losses: 100, ties: 10 } },
    ])
  })
})
