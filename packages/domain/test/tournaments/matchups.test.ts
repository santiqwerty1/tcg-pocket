import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/mutate.js'
import { recordGames, Z_95 } from '../../src/stats/rates.js'
import {
  bestOfFromMode,
  buildDataset,
  buildMatchups,
  DEFAULT_SET_RELEASES,
  expectedVsMeta,
  fieldPerGame,
  gameRateFromMatchRate,
  matchupPerGame,
  matchupRecord,
  matchupRows,
  matchWinProbability,
  metaShares,
  parsePairings,
  parseStandings,
  perGameRecord,
  phaseBestOf,
  recentMeta,
  type StoredEntry,
  type StoredPairing,
  type StoredTournament,
} from '../../src/tournaments/index.js'
import { BIG_ID, NOEX_ID, readLimitless } from '../helpers/limitless.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()

describe('pairings (Fase 9): the rounds of PMPT #45 and the NOEX tournament as Limitless sent them', () => {
  it('normalizes winners, ties, double losses and byes', () => {
    const big = parsePairings(readLimitless('big_pairings.json'))
    expect(big).toHaveLength(1143)
    const count = (result: string) => big.filter((pairing) => pairing.result === result).length
    expect({
      p1: count('p1'),
      p2: count('p2'),
      tie: count('tie'),
      double: count('double_loss'),
      bye: count('bye'),
    }).toEqual({ p1: 492, p2: 504, tie: 10, double: 41, bye: 96 })
    expect(big.every((pairing) => (pairing.result === 'bye') === (pairing.player2 === null))).toBe(true)
    expect(new Set(big.map((pairing) => pairing.phase))).toEqual(new Set([1, 2]))
    expect(parsePairings(readLimitless('noex_pairings.json'))).toHaveLength(228)
    expect(() => parsePairings([{ round: 1 }])).toThrow()
  })
})

describe('H-009: matches at BO1, BO3 or BO5 read per game', () => {
  it('the phases of a tournament give the games of a match', () => {
    expect(bestOfFromMode('BO3')).toBe(3)
    expect(bestOfFromMode('bo1')).toBe(1)
    expect(bestOfFromMode('BO5')).toBe(5)
    expect(bestOfFromMode('BO2')).toBeNull()
    expect(bestOfFromMode('SWISS')).toBeNull()
    expect(bestOfFromMode(undefined)).toBeNull()
    const details = readLimitless('big_details.json')
    expect([...phaseBestOf(details)]).toEqual([
      [1, 3],
      [2, 3],
    ])
    expect(phaseBestOf(null).size).toBe(0)
    expect(phaseBestOf({ phases: 'x' }).size).toBe(0)
  })

  it('match chance from the game chance, and back', () => {
    expect(matchWinProbability(0.6, 1)).toBeCloseTo(0.6, 12)
    expect(matchWinProbability(0.6, 3)).toBeCloseTo(0.36 * (3 - 1.2), 12)
    // BO5: p³(10 − 15p + 6p²).
    expect(matchWinProbability(0.6, 5)).toBeCloseTo(0.216 * (10 - 9 + 2.16), 12)
    expect(matchWinProbability(0.5, 3)).toBeCloseTo(0.5, 12)
    // The example of the review: 30 % of the matches at BO3 is about 36,3 % of the games.
    expect(gameRateFromMatchRate(0.3, 3)).toBeCloseTo(0.363, 3)
    expect(gameRateFromMatchRate(0.3, 1)).toBe(0.3)
    expect(gameRateFromMatchRate(0, 3)).toBe(0)
    for (const p of [0.1, 0.42, 0.77]) expect(gameRateFromMatchRate(matchWinProbability(p, 5), 5)).toBeCloseTo(p, 9)
  })

  it('converts length by length before adding up; ties out; each match weighs one game', () => {
    const byBestOf = new Map([
      [3, { wins: 3, losses: 7, ties: 1 }],
      [1, { wins: 5, losses: 5, ties: 2 }],
    ])
    const record = perGameRecord(byBestOf)
    const p3 = gameRateFromMatchRate(0.3, 3)
    expect(record?.wins).toBeCloseTo(10 * p3 + 5, 9)
    expect(record?.losses).toBeCloseTo(10 * (1 - p3) + 5, 9)
    expect(perGameRecord(new Map([[3, { wins: 0, losses: 0, ties: 4 }]]))).toBeNull()
    expect(perGameRecord(undefined)).toBeNull()
  })
})

describe('matchups between archetypes', () => {
  const tournaments: StoredTournament[] = [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
    { id: NOEX_ID, name: 'NOEX', date: new Date('2026-09-09T18:00:00Z'), format: 'NOEX', players: 79 },
  ]
  const entries: StoredEntry[] = [
    ...parseStandings(readLimitless('big_standings.json')).map((entry) => ({ ...entry, tournamentId: BIG_ID })),
    ...parseStandings(readLimitless('noex_standings.json')).map((entry) => ({ ...entry, tournamentId: NOEX_ID })),
  ]
  const pairings: StoredPairing[] = [
    ...parsePairings(readLimitless('big_pairings.json')).map((pairing) => ({ ...pairing, tournamentId: BIG_ID })),
    ...parsePairings(readLimitless('noex_pairings.json')).map((pairing) => ({ ...pairing, tournamentId: NOEX_ID })),
  ]
  const dataset = buildDataset({
    tournaments,
    entries,
    index,
    sets: DEFAULT_SET_RELEASES,
    era: 'B4a',
    format: 'STANDARD',
    minPlayers: 12,
  })
  const matchups = buildMatchups(dataset, pairings)

  it('counts every match of the era once, and nothing of the other format', () => {
    expect(matchups.tournaments).toBe(1)
    expect(matchups.tournamentsWithPairings).toBe(1)
    expect(matchups.skipped).toMatchObject({ byes: 96, doubleLosses: 41 })
    expect(
      matchups.matches + matchups.skipped.byes + matchups.skipped.doubleLosses + matchups.skipped.noArchetype,
    ).toBe(1143)
    expect(matchups.matches).toBeGreaterThan(950)
  })

  it('is symmetric: a win of A against B is a loss of B against A', () => {
    let wins = 0
    let losses = 0
    for (const [key, record] of matchups.cells) {
      const [a, b] = key.split('|') as [string, string]
      const back = matchupRecord(matchups, b, a)
      expect(back).toEqual({ wins: record.losses, losses: record.wins, ties: record.ties })
      wins += record.wins
      losses += record.losses
    }
    expect(wins).toBe(losses)
    const fieldGames = [...matchups.field.values()].reduce((sum, record) => sum + recordGames(record), 0)
    expect(fieldGames).toBe(2 * matchups.matches)
  })

  it('H-009: per game, with the BO3 of the PMPT phases, the rates move toward 50 %', () => {
    const top = metaShares(dataset)[0]?.archetypeId ?? ''
    // Without a mode, a match is one game: the per-game record is the match record without ties.
    const plain = fieldPerGame(matchups, top)
    const field = matchups.field.get(top) ?? { wins: 0, losses: 0, ties: 0 }
    expect(plain?.wins).toBeCloseTo(field.wins, 9)
    expect(plain?.losses).toBeCloseTo(field.losses, 9)
    const phases = phaseBestOf(readLimitless('big_details.json'))
    const bo3 = buildMatchups(
      dataset,
      pairings.map((pairing) => ({ ...pairing, bestOf: phases.get(pairing.phase) ?? null })),
    )
    expect(bo3.cells).toEqual(matchups.cells)
    const perGame = fieldPerGame(bo3, top)
    const matchRate = field.wins / (field.wins + field.losses)
    const gameRate = (perGame?.wins ?? 0) / ((perGame?.wins ?? 0) + (perGame?.losses ?? 0))
    expect(Math.abs(gameRate - 0.5)).toBeLessThan(Math.abs(matchRate - 0.5))
    expect(gameRate).toBeCloseTo(gameRateFromMatchRate(matchRate, 3), 9)
    expect((perGame?.wins ?? 0) + (perGame?.losses ?? 0)).toBeCloseTo(field.wins + field.losses, 9)
    const rival = metaShares(dataset)[1]?.archetypeId ?? ''
    expect(matchupRows(bo3, dataset, top).find((row) => row.rival === rival)?.perGame).toEqual(
      matchupPerGame(bo3, top, rival),
    )
  })

  it('a player never has more matches in the pairings than in the standings', () => {
    const standings = new Map(dataset.entries.map((entry) => [entry.playerId, recordGames(entry.record)]))
    const counted = new Map<string, number>()
    for (const pairing of pairings) {
      if (pairing.tournamentId !== BIG_ID || pairing.player2 === null || pairing.result === 'double_loss') continue
      for (const player of [pairing.player1, pairing.player2]) counted.set(player, (counted.get(player) ?? 0) + 1)
    }
    for (const [player, matches] of counted) expect(matches).toBeLessThanOrEqual((standings.get(player) ?? 0) + 1)
  })

  it('rows of the most played archetype: rivals by share, with Wilson; the expected rate against the field', () => {
    const shares = metaShares(dataset)
    const top = shares[0]?.archetypeId as string
    expect(shares.reduce((sum, row) => sum + row.share, 0)).toBeLessThanOrEqual(100.0001)
    const rows = matchupRows(matchups, dataset, top)
    expect(rows.length).toBeGreaterThan(5)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]?.share).toBeGreaterThanOrEqual(rows[i]?.share ?? 0)
    for (const row of rows) {
      expect(row.rate?.games).toBe(recordGames(row.record))
      expect(row.rate?.sampleKind).toBe('matches')
    }
    const mirror = matchupRecord(matchups, top, top)
    expect(mirror.wins).toBe(mirror.losses)
    const expected = expectedVsMeta(matchups, dataset, top)
    expect(expected).not.toBeNull()
    expect(expected?.value).toBeGreaterThan(20)
    expect(expected?.value).toBeLessThan(80)
    expect(expected?.coverage).toBeGreaterThanOrEqual(0)
    expect(expected?.coverage).toBeLessThanOrEqual(100)
    expect(expected?.rivals).toBe(rows.length)
    // H-011: with an interval around it.
    expect(expected?.ci95[0]).toBeLessThan(expected?.value ?? 0)
    expect(expected?.ci95[1]).toBeGreaterThan(expected?.value ?? 100)
    expect((expected?.ci95[1] ?? 0) - (expected?.ci95[0] ?? 0)).toBeLessThan(30)
    // With a huge prior every matchup is the archetype's record against everyone, itself pulled toward the era mean
    // (H-011: 48,0 % here, not 50 %).
    const field = matchups.field.get(top) as { wins: number; losses: number; ties: number }
    const mean = dataset.total.wins / recordGames(dataset.total)
    const flat = expectedVsMeta(matchups, dataset, top, { prior: 1e9 })
    expect(flat?.value).toBeCloseTo(((field.wins + 20 * mean) / (recordGames(field) + 20)) * 100, 4)
    // No shrinkage at all and only solid rivals counted would be the plain weighted mean; every archetype of the
    // table stays between its worst and its best matchup.
    for (const { archetypeId } of shares.slice(0, 6)) {
      const value = expectedVsMeta(matchups, dataset, archetypeId)?.value ?? 50
      const rates = matchupRows(matchups, dataset, archetypeId).map((row) => row.rate?.value ?? 50)
      expect(value).toBeGreaterThanOrEqual(Math.min(...rates) - 1e-9)
      expect(value).toBeLessThanOrEqual(Math.max(...rates) + 1e-9)
    }
    expect(expectedVsMeta(matchups, dataset, 'nobody')).toBeNull()
    // Other weights (this week's meta): all the weight on one rival gives that (shrunk) matchup.
    const rival = rows[1]?.rival as string
    const only = expectedVsMeta(matchups, dataset, top, { shares: [{ archetypeId: rival, share: 100 }] })
    const record = matchupRecord(matchups, top, rival)
    const games = recordGames(record)
    const base = (field.wins + 20 * mean) / (recordGames(field) + 20)
    expect(only?.value).toBeCloseTo(((record.wins + 10 * base) / (games + 10)) * 100, 8)
  })

  it('«mi meta» weights (Fase 44): shares read from a dozen matches add their own sampling error to the interval', () => {
    const top = metaShares(dataset)[0]?.archetypeId as string
    // The truth: the owner meets the six most played archetypes as often as the field plays them.
    const truthShares = metaShares(dataset).slice(0, 6)
    const n = 12
    const exact = expectedVsMeta(matchups, dataset, top, { shares: truthShares })
    const sampledAtTruth = expectedVsMeta(matchups, dataset, top, { shares: truthShares, sharesSample: n })
    const halfWidth = (ci?: [number, number]) => ((ci?.[1] ?? 0) - (ci?.[0] ?? 0)) / 2
    // What the weights add to the interval, as a standard deviation (points of the 0–100 value).
    const added = Math.sqrt(halfWidth(sampledAtTruth?.ci95) ** 2 - halfWidth(exact?.ci95) ** 2) / Z_95
    expect(sampledAtTruth?.value).toBe(exact?.value)
    // The value is linear in the weights, so the delta method is exact: the spread of the value over shares drawn
    // from n matches is what the interval adds.
    const total = truthShares.reduce((sum, row) => sum + row.share, 0)
    const random = seededRandom(44)
    const values: number[] = []
    for (let run = 0; run < 4000; run++) {
      const counts = new Map<string, number>()
      for (let i = 0; i < n; i++) {
        let left = random() * total
        const pick = truthShares.find((row) => {
          left -= row.share
          return left < 0
        })
        const id = (pick ?? truthShares.at(-1))?.archetypeId as string
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      const sampled = [...counts].map(([archetypeId, count]) => ({ archetypeId, share: (count / n) * 100 }))
      values.push(expectedVsMeta(matchups, dataset, top, { shares: sampled })?.value ?? 0)
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
    expect(added).toBeGreaterThan(0.5)
    expect(Math.abs(added / spread - 1)).toBeLessThan(0.08)
    // Known shares (the meta's) add nothing.
    expect(expectedVsMeta(matchups, dataset, top, { shares: truthShares, sharesSample: 0 })?.ci95).toEqual(exact?.ci95)
  })

  it('recent meta: one tournament is too few lists for the last two weeks, so the era', () => {
    expect(recentMeta(dataset).kind).toBe('recent')
    expect(recentMeta(dataset, 14, 1000)).toMatchObject({ kind: 'era', lists: 393 })
  })
})
