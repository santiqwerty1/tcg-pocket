import { describe, expect, it } from 'vitest'
import {
  filterMatches,
  type MatchFacts,
  type MatchMode,
  type MatchResult,
  matchStats,
  NO_OPPONENT_LABEL,
  tallyMatches,
} from '../../src/matches/index.js'
import { formatWinRateEs } from '../../src/stats/index.js'

let clock = Date.parse('2026-10-01T10:00:00Z')

function match(
  deckId: string,
  result: MatchResult,
  extra: Partial<Omit<MatchFacts, 'deckId' | 'result'>> = {},
): MatchFacts {
  clock += 10 * 60 * 1000
  return {
    deckId,
    result,
    deckRevision: 1,
    opponent: null,
    wentFirst: null,
    mode: 'casual' as MatchMode,
    playedAt: new Date(clock),
    ...extra,
  }
}

function repeat(times: number, make: () => MatchFacts): MatchFacts[] {
  return Array.from({ length: times }, make)
}

// Deck 7: 7-3 against Mega-Blaziken (the acceptance example) plus 2-1-1 against Gardevoir; deck 2: 1 loss.
const MATCHES: MatchFacts[] = [
  ...repeat(4, () => match('7', 'win', { opponent: 'Mega-Blaziken ex', wentFirst: true })),
  ...repeat(3, () => match('7', 'win', { opponent: 'mega blaziken ex', wentFirst: false, deckRevision: 2 })),
  ...repeat(3, () => match('7', 'loss', { opponent: 'Mega Blaziken ex', wentFirst: false, deckRevision: 2 })),
  match('7', 'win', { opponent: 'Gardevoir ex', mode: 'competitive', deckRevision: 2 }),
  match('7', 'win', { opponent: 'Gardevoir ex', mode: 'competitive', deckRevision: 2 }),
  match('7', 'loss', { opponent: 'Gardevoir ex', mode: 'competitive', deckRevision: 2 }),
  match('7', 'tie', { mode: 'event', deckRevision: 2 }),
  match('2', 'loss', { opponent: 'Darkrai ex', wentFirst: true }),
]

describe('tallyMatches', () => {
  it('counts wins, losses and ties', () => {
    expect(tallyMatches(MATCHES)).toEqual({ wins: 9, losses: 5, ties: 1 })
    expect(tallyMatches([])).toEqual({ wins: 0, losses: 0, ties: 0 })
  })
})

describe('matchStats', () => {
  const report = matchStats(MATCHES)

  it('overall uses every match, ties included in n', () => {
    expect(report.overall.record).toEqual({ wins: 9, losses: 5, ties: 1 })
    expect(report.overall.rate).toMatchObject({ source: 'matches', value: 60, games: 15, orientative: true })
  })

  it('by deck, most played first', () => {
    expect(report.byDeck.map((row) => [row.deckId, row.rate?.games])).toEqual([
      ['7', 14],
      ['2', 1],
    ])
    expect(report.byDeck[1]?.rate?.value).toBe(0)
  })

  it('by opponent merges spellings, labels with the most used one and leaves «sin rival» last', () => {
    expect(report.byOpponent.map((row) => [row.label, row.record])).toEqual([
      ['Mega-Blaziken ex', { wins: 7, losses: 3, ties: 0 }],
      ['Gardevoir ex', { wins: 2, losses: 1, ties: 0 }],
      ['Darkrai ex', { wins: 0, losses: 1, ties: 0 }],
      [NO_OPPONENT_LABEL, { wins: 0, losses: 0, ties: 1 }],
    ])
    expect(report.byOpponent[0]?.key).toBe('mega blaziken ex')
    expect(report.byOpponent[3]?.key).toBeNull()
    expect(formatWinRateEs(report.byOpponent[0]?.rate ?? null)).toBe('70 % (n = 10, IC 39,7–89,2 %, orientativo)')
  })

  it('by who went first: always three rows; empty ones have no rate', () => {
    expect(report.byWentFirst.map((row) => [row.key, row.label, row.record.wins, row.rate?.games ?? 0])).toEqual([
      ['first', 'Empecé yo', 4, 5],
      ['second', 'Empezó el rival', 3, 6],
      ['unknown', 'Sin dato', 2, 4],
    ])
    const empty = matchStats([match('1', 'win', { wentFirst: true })]).byWentFirst
    expect(empty[1]?.rate).toBeNull()
    expect(empty[1]?.record).toEqual({ wins: 0, losses: 0, ties: 0 })
  })

  it('by mode lists only played modes in a fixed order, by revision newest first', () => {
    expect(report.byMode.map((row) => [row.mode, row.label, row.rate?.games])).toEqual([
      ['competitive', 'Competitiva', 3],
      ['casual', 'Distendida', 11],
      ['event', 'Evento', 1],
    ])
    const deck7 = matchStats(filterMatches(MATCHES, { deckId: '7' }))
    expect(deck7.byRevision.map((row) => [row.revision, row.rate?.games])).toEqual([
      [2, 10],
      [1, 4],
    ])
  })

  it('an empty list gives an empty report with a null overall rate', () => {
    const empty = matchStats([])
    expect(empty.overall).toEqual({ record: { wins: 0, losses: 0, ties: 0 }, rate: null })
    expect(empty.byDeck).toEqual([])
    expect(empty.byOpponent).toEqual([])
    expect(empty.byMode).toEqual([])
    expect(empty.byWentFirst).toHaveLength(3)
  })
})

describe('filterMatches', () => {
  it('filters by deck, mode, date range and opponent key', () => {
    expect(filterMatches(MATCHES, { deckId: '2' })).toHaveLength(1)
    expect(filterMatches(MATCHES, { mode: 'competitive' })).toHaveLength(3)
    expect(filterMatches(MATCHES, { opponentKey: 'mega blaziken ex' })).toHaveLength(10)
    const first = MATCHES[0]?.playedAt as Date
    const fifth = MATCHES[4]?.playedAt as Date
    expect(filterMatches(MATCHES, { from: first, to: fifth })).toHaveLength(4)
    expect(filterMatches(MATCHES, { from: fifth })).toHaveLength(MATCHES.length - 4)
    expect(filterMatches(MATCHES, {})).toHaveLength(MATCHES.length)
  })
})
