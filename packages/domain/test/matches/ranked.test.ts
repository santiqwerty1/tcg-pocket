import { describe, expect, it } from 'vitest'
import {
  compareRanks,
  KNOWN_SEASONS,
  type RankChange,
  type RankedMatch,
  rankAt,
  rankLabelEs,
  seasonOf,
  seasonOfChange,
  seasonSummary,
} from '../../src/matches/index.js'

const ZONE = 'America/Argentina/Buenos_Aires'
const season = KNOWN_SEASONS.find((item) => item.code === 'B4bSP')
if (!season) throw new Error('no B4bSP')
// 18:10 in Buenos Aires (UTC−3) on 14/10: the first rank Santi noted.
const at = (iso: string) => new Date(iso)
const change = (id: string, iso: string, rank: RankChange['rank'], points: number | null = null): RankChange => ({
  id,
  at: at(iso),
  rank,
  points,
})
const match = (
  id: string,
  iso: string,
  result: RankedMatch['result'],
  deck = '20',
  mode: RankedMatch['mode'] = 'competitive',
): RankedMatch => ({
  id,
  deckId: deck,
  deckName: deck === '20' ? 'Mega-Steelix ex' : 'Butterfree',
  result,
  mode,
  playedAt: at(iso),
})

describe('ranked by season and rank (pedido de Santi del 14/10)', () => {
  it("labels and order of the game's ranks", () => {
    expect(rankLabelEs('ultra-2')).toBe('Ultra Ball 2')
    expect(rankLabelEs('great-1')).toBe('Super Ball 1')
    expect(rankLabelEs('beginner-4')).toBe('Principiante 4')
    expect(rankLabelEs('master', 1250)).toBe('Master Ball, 1.250 puntos')
    expect(compareRanks({ rank: 'ultra-3' }, { rank: 'ultra-2' })).toBe(1)
    expect(compareRanks({ rank: 'master', points: 900 }, { rank: 'master', points: 1100 })).toBe(-1)
  })

  it("a match is in the season whose days contain it, in the owner's time zone", () => {
    // 28/10 23:30 in Buenos Aires is 29/10 02:30 UTC: still the season's last day.
    expect(seasonOf(at('2026-10-29T02:30:00Z'), KNOWN_SEASONS, ZONE)?.code).toBe('B4bSP')
    expect(seasonOf(at('2026-10-29T03:30:00Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    // 14/10 00:30 in Buenos Aires (03:30 UTC): the first day; 13/10 at 23:30 is between seasons.
    expect(seasonOf(at('2026-10-14T03:30:00Z'), KNOWN_SEASONS, ZONE)?.code).toBe('B4bSP')
    expect(seasonOf(at('2026-10-14T02:30:00Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    expect(seasonOf(at('2026-09-20T12:00:00Z'), KNOWN_SEASONS, ZONE)?.code).toBe('B4a')
  })

  it('the C1 season runs from 30/11 to 14/12/2026 (ptcgpocket.gg), in the same zone, without touching the others', () => {
    expect(KNOWN_SEASONS.find((item) => item.code === 'C1')).toEqual({
      code: 'C1',
      name: 'Temporada C1',
      startsOn: '2026-11-30',
      endsOn: '2026-12-14',
    })
    expect(seasonOf(at('2026-11-30T03:30:00Z'), KNOWN_SEASONS, ZONE)?.code).toBe('C1')
    expect(seasonOf(at('2026-11-30T02:30:00Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    expect(seasonOf(at('2026-12-15T02:30:00Z'), KNOWN_SEASONS, ZONE)?.code).toBe('C1')
    expect(seasonOf(at('2026-12-15T03:30:00Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    // Between B4b SP and C1 (the first weeks of Dual Fusion) there is no season.
    expect(seasonOf(at('2026-11-10T12:00:00Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    // The known seasons never overlap (the app refuses it when they are corrected).
    const sorted = [...KNOWN_SEASONS].sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1]?.endsOn.localeCompare(sorted[i]?.startsOn ?? '')).toBeLessThan(0)
    }
  })

  it('the rank of a match is the last noted in its season before it; a new season starts without one', () => {
    const changes = [
      change('1', '2026-09-28T20:00:00Z', 'great-4'),
      change('2', '2026-10-14T21:10:00Z', 'ultra-2'),
      change('3', '2026-10-15T22:00:00Z', 'ultra-3'),
    ]
    expect(rankAt(at('2026-10-14T20:00:00Z'), changes, season, ZONE)).toBeNull()
    expect(rankAt(at('2026-10-15T12:00:00Z'), changes, season, ZONE)?.rank).toBe('ultra-2')
    expect(rankAt(at('2026-10-16T12:00:00Z'), changes, season, ZONE)?.rank).toBe('ultra-3')
  })

  it('the season: record, rank now, the curve with what it went up with, and the record by rank and by deck', () => {
    const changes = [
      change('1', '2026-10-14T21:10:00Z', 'ultra-2'),
      change('2', '2026-10-15T22:00:00Z', 'ultra-3'),
      change('3', '2026-10-16T22:00:00Z', 'ultra-2'),
      // Another season's: left out.
      change('0', '2026-09-28T20:00:00Z', 'great-4'),
    ]
    const summary = seasonSummary(
      season,
      [
        match('a', '2026-10-14T20:00:00Z', 'loss'),
        match('b', '2026-10-15T12:00:00Z', 'win'),
        match('c', '2026-10-15T15:00:00Z', 'win', '1'),
        match('d', '2026-10-16T12:00:00Z', 'loss'),
        // Casual and another season's: left out.
        match('e', '2026-10-15T13:00:00Z', 'win', '20', 'casual'),
        match('f', '2026-09-28T13:00:00Z', 'win'),
      ],
      changes,
      ZONE,
    )
    expect(summary.record).toEqual({ wins: 2, losses: 2, ties: 0 })
    expect(summary.games).toBe(4)
    expect(summary.rankLabel).toBe('Ultra Ball 2')
    expect(summary.steps.map((step) => [step.label, step.move])).toEqual([
      ['Ultra Ball 2', null],
      ['Ultra Ball 3', 'up'],
      ['Ultra Ball 2', 'down'],
    ])
    // It went up to Ultra Ball 3 with one win of each deck, and down with a loss of Mega-Steelix ex.
    expect(summary.steps[1]?.decks).toEqual([
      { deckId: '20', deckName: 'Mega-Steelix ex', record: { wins: 1, losses: 0, ties: 0 } },
      { deckId: '1', deckName: 'Butterfree', record: { wins: 1, losses: 0, ties: 0 } },
    ])
    expect(summary.steps[2]?.decks).toEqual([
      { deckId: '20', deckName: 'Mega-Steelix ex', record: { wins: 0, losses: 1, ties: 0 } },
    ])
    expect(summary.byRank.map((row) => [row.label, row.games])).toEqual([
      ['Sin rango anotado', 1],
      ['Ultra Ball 2', 2],
      ['Ultra Ball 3', 1],
    ])
    expect(summary.byDeck[0]).toMatchObject({ deckId: '20', games: 3 })
  })

  it('self-review: a rank noted at the instant of a match is the one it led to, in the record and in the curve', () => {
    const changes = [change('1', '2026-10-15T12:00:00Z', 'ultra-2'), change('2', '2026-10-15T15:00:00Z', 'ultra-3')]
    // The match at 15:00 was played at Ultra Ball 2 and took it to Ultra Ball 3; the one at 12:00, before any rank.
    expect(rankAt(at('2026-10-15T15:00:00Z'), changes, season, ZONE)?.rank).toBe('ultra-2')
    expect(rankAt(at('2026-10-15T12:00:00Z'), changes, season, ZONE)).toBeNull()
    expect(rankAt(at('2026-10-15T15:00:01Z'), changes, season, ZONE)?.rank).toBe('ultra-3')
    const summary = seasonSummary(
      season,
      [match('a', '2026-10-15T12:00:00Z', 'win'), match('b', '2026-10-15T15:00:00Z', 'win', '1')],
      changes,
      ZONE,
    )
    expect(summary.byRank.map((row) => [row.label, row.games])).toEqual([
      ['Sin rango anotado', 1],
      ['Ultra Ball 2', 1],
    ])
    // Each match is in the step it led to, and only there (the window is after the change before, up to this one).
    expect(summary.steps[0]?.decks).toEqual([
      { deckId: '20', deckName: 'Mega-Steelix ex', record: { wins: 1, losses: 0, ties: 0 } },
    ])
    expect(summary.steps[1]?.decks).toEqual([
      { deckId: '1', deckName: 'Butterfree', record: { wins: 1, losses: 0, ties: 0 } },
    ])
  })

  it('self-review: two ranks noted at the same instant — the one noted last (ids as numbers)', () => {
    const changes = [change('9', '2026-10-15T12:00:00Z', 'ultra-2'), change('10', '2026-10-15T12:00:00Z', 'ultra-3')]
    expect(rankAt(at('2026-10-15T13:00:00Z'), changes, season, ZONE)?.id).toBe('10')
    expect(rankAt(at('2026-10-15T13:00:00Z'), [...changes].reverse(), season, ZONE)?.id).toBe('10')
    expect(seasonSummary(season, [], changes, ZONE).rank?.id).toBe('10')
    expect(seasonSummary(season, [], [...changes].reverse(), ZONE).rank?.id).toBe('10')
  })

  it("deuda de #120: a rank noted a millisecond before midnight of the first day is the season's", () => {
    // 14/10 00:00 in Buenos Aires is 03:00 UTC: the rank a match at that very moment was played at goes 1 ms before.
    const before = [change('1', '2026-10-14T02:59:59.999Z', 'master')]
    expect(rankAt(at('2026-10-14T03:00:00.000Z'), before, season, ZONE)?.rank).toBe('master')
    expect(seasonOfChange(at('2026-10-14T02:59:59.999Z'), KNOWN_SEASONS, ZONE)?.code).toBe('B4bSP')
    expect(seasonOfChange(at('2026-10-14T02:59:59.998Z'), KNOWN_SEASONS, ZONE)).toBeNull()
    expect(seasonSummary(season, [], before, ZONE).rank?.rank).toBe('master')
  })

  it('self-review: Master Ball without points after Master Ball with points is the same, not «bajó»', () => {
    expect(compareRanks({ rank: 'master', points: null }, { rank: 'master', points: 1200 })).toBe(0)
    expect(compareRanks({ rank: 'master', points: 1200 }, { rank: 'master' })).toBe(0)
    const summary = seasonSummary(
      season,
      [],
      [change('1', '2026-10-15T12:00:00Z', 'master', 1200), change('2', '2026-10-16T12:00:00Z', 'master')],
      ZONE,
    )
    expect(summary.steps.map((step) => step.move)).toEqual([null, 'same'])
  })
})
