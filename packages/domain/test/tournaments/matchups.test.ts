import { describe, expect, it } from 'vitest'
import { recordGames } from '../../src/stats/rates.js'
import {
  buildDataset,
  buildMatchups,
  DEFAULT_SET_RELEASES,
  expectedVsMeta,
  matchupRecord,
  matchupRows,
  metaShares,
  parsePairings,
  parseStandings,
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
    // With a huge prior every matchup is the archetype's record against everyone (itself pulled toward 50 %).
    const field = matchups.field.get(top) as { wins: number; losses: number; ties: number }
    const flat = expectedVsMeta(matchups, dataset, top, { prior: 1e9 })
    expect(flat?.value).toBeCloseTo(((field.wins + 10) / (recordGames(field) + 20)) * 100, 4)
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
    const base = (field.wins + 10) / (recordGames(field) + 20)
    expect(only?.value).toBeCloseTo(((record.wins + 10 * base) / (games + 10)) * 100, 8)
  })

  it('recent meta: one tournament is too few lists for the last two weeks, so the era', () => {
    expect(recentMeta(dataset).kind).toBe('recent')
    expect(recentMeta(dataset, 14, 1000)).toMatchObject({ kind: 'era', lists: 393 })
  })
})
