/**
 * Ranked by season and rank (pedido de Santi del 14/10): the game's ranked seasons (B4b SP, 14–28/10/2026: not an era,
 * B4b is the Deluxe Pack Mega) and the owner's rank as noted when it changes. A competitive match belongs to the season
 * whose days (in the owner's time zone) contain it, and was played at the last rank noted in that season strictly
 * before it: a rank noted at the very instant of a match is the one it led to.
 * From there: the rank curve of a season, the record by season and by rank, and the decks played between two changes
 * (with what it went up or down).
 */
import type { GameRecord } from '../stats/rates.js'
import type { MatchMode, MatchResult } from './types.js'

/** The game's ranks, lowest first: Principiante, Poké Ball, Super Ball and Ultra Ball with four tiers, Master Ball. */
export const RANKS = [
  'beginner-1',
  'beginner-2',
  'beginner-3',
  'beginner-4',
  'poke-1',
  'poke-2',
  'poke-3',
  'poke-4',
  'great-1',
  'great-2',
  'great-3',
  'great-4',
  'ultra-1',
  'ultra-2',
  'ultra-3',
  'ultra-4',
  'master',
] as const
export type Rank = (typeof RANKS)[number]

const BALL_ES: Record<string, string> = {
  beginner: 'Principiante',
  poke: 'Poké Ball',
  great: 'Super Ball',
  ultra: 'Ultra Ball',
}

/** «Ultra Ball 2», «Master Ball» (with its points when noted: «Master Ball, 1.250 puntos»). */
export function rankLabelEs(rank: Rank, points?: number | null): string {
  if (rank === 'master') {
    return points === null || points === undefined
      ? 'Master Ball'
      : `Master Ball, ${new Intl.NumberFormat('es-AR').format(points)} puntos`
  }
  const [ball, tier] = rank.split('-') as [string, string]
  return `${BALL_ES[ball] ?? ball} ${tier}`
}

export function isRank(value: string): value is Rank {
  return (RANKS as readonly string[]).includes(value)
}

/**
 * −1, 0 or 1: lower, the same or higher (Master Ball with more points is higher; self-review: without points on either
 * side it is the same, not «bajó»).
 */
export function compareRanks(
  a: { rank: Rank; points?: number | null },
  b: { rank: Rank; points?: number | null },
): number {
  const order = RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)
  if (order !== 0) return Math.sign(order)
  if (a.points === null || a.points === undefined || b.points === null || b.points === undefined) return 0
  return Math.sign(a.points - b.points)
}

export interface RankedSeason {
  code: string
  name: string
  /** First and last day, YYYY-MM-DD in the owner's time zone. */
  startsOn: string
  endsOn: string
}

export interface RankChange {
  id: string
  at: Date
  rank: Rank
  /** Master Ball points, when noted. */
  points: number | null
}

/** The seasons known when the feature started (Game8 and Bulbapedia, 14/10/2026); the owner can correct them. */
export const KNOWN_SEASONS: readonly RankedSeason[] = [
  { code: 'B4a', name: 'Temporada B4a', startsOn: '2026-09-15', endsOn: '2026-09-29' },
  { code: 'B4bSP', name: 'Temporada B4b SP', startsOn: '2026-10-14', endsOn: '2026-10-28' },
]

const DAY_FORMATS = new Map<string, Intl.DateTimeFormat>()

/** YYYY-MM-DD of an instant in a time zone (self-review: one formatter per zone; building it was most of the time). */
export function dayIn(date: Date, timeZone: string): string {
  let format = DAY_FORMATS.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    DAY_FORMATS.set(timeZone, format)
  }
  return format.format(date)
}

/** Two changes noted at the same instant: the one noted last (ids are numbers; «10» after «9»). */
function idOrder(a: string, b: string): number {
  const [x, y] = [Number(a), Number(b)]
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b)
}

/** `a` was noted after `b`. */
function later(a: RankChange, b: RankChange): boolean {
  return a.at.getTime() > b.at.getTime() || (a.at.getTime() === b.at.getTime() && idOrder(a.id, b.id) > 0)
}

/** The season whose days contain the instant (in the owner's time zone), or null between seasons. */
export function seasonOf(date: Date, seasons: readonly RankedSeason[], timeZone: string): RankedSeason | null {
  const day = dayIn(date, timeZone)
  return seasons.find((season) => season.startsOn <= day && day <= season.endsOn) ?? null
}

/**
 * The last rank noted in the season strictly before the instant (a new season starts without one). A rank noted at
 * the instant of a match is the one the match led to (self-review: the record by rank and the curve agree on it).
 */
export function rankAt(
  date: Date,
  changes: readonly RankChange[],
  season: RankedSeason,
  timeZone: string,
): RankChange | null {
  let found: RankChange | null = null
  for (const change of changes) {
    if (change.at.getTime() >= date.getTime()) continue
    if (seasonOf(change.at, [season], timeZone) === null) continue
    if (!found || later(change, found)) found = change
  }
  return found
}

export interface RankedMatch {
  id: string
  deckId: string
  deckName: string
  result: MatchResult
  mode: MatchMode
  playedAt: Date
}

export interface RankedRecordRow {
  record: GameRecord
  games: number
}

export interface SeasonStep {
  /** The rank noted, and when. */
  change: RankChange
  label: string
  /** Compared with the rank before it (null for the first of the season). */
  move: 'up' | 'down' | 'same' | null
  /**
   * The competitive matches after the rank before it and up to this one (a match at the instant of a change led to
   * it), by deck: what it went up (or down) with.
   */
  decks: { deckId: string; deckName: string; record: GameRecord }[]
}

export interface SeasonSummary {
  season: RankedSeason
  /** Competitive matches of the season. */
  record: GameRecord
  games: number
  /** The rank now (the last noted in the season) and its label. */
  rank: RankChange | null
  rankLabel: string | null
  /** The curve: every rank noted in the season, oldest first. */
  steps: SeasonStep[]
  /** The record at each rank (the rank noted before each match; «sin rango» before the first). */
  byRank: { rank: Rank | null; label: string; record: GameRecord; games: number }[]
  byDeck: { deckId: string; deckName: string; record: GameRecord; games: number }[]
}

function tally(record: GameRecord, result: MatchResult): void {
  if (result === 'win') record.wins += 1
  else if (result === 'loss') record.losses += 1
  else record.ties += 1
}

function empty(): GameRecord {
  return { wins: 0, losses: 0, ties: 0 }
}

/** A season's competitive matches and ranks noted, summed up. */
export function seasonSummary(
  season: RankedSeason,
  matches: readonly RankedMatch[],
  changes: readonly RankChange[],
  timeZone: string,
): SeasonSummary {
  const inSeason = matches
    .filter((match) => match.mode === 'competitive' && seasonOf(match.playedAt, [season], timeZone) !== null)
    .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime())
  const noted = changes
    .filter((change) => seasonOf(change.at, [season], timeZone) !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || idOrder(a.id, b.id))
  const record = empty()
  const byRank = new Map<string, { rank: Rank | null; record: GameRecord }>()
  const byDeck = new Map<string, { deckName: string; record: GameRecord }>()
  for (const match of inSeason) {
    tally(record, match.result)
    const at = rankAt(match.playedAt, noted, season, timeZone)
    const key = at?.rank ?? ''
    const row = byRank.get(key) ?? { rank: at?.rank ?? null, record: empty() }
    tally(row.record, match.result)
    byRank.set(key, row)
    const deck = byDeck.get(match.deckId) ?? { deckName: match.deckName, record: empty() }
    tally(deck.record, match.result)
    byDeck.set(match.deckId, deck)
  }
  const steps: SeasonStep[] = noted.map((change, at) => {
    const before = at > 0 ? (noted[at - 1] as RankChange) : null
    const since = before?.at.getTime() ?? Number.NEGATIVE_INFINITY
    const decks = new Map<string, { deckName: string; record: GameRecord }>()
    for (const match of inSeason) {
      const time = match.playedAt.getTime()
      if (time <= since || time > change.at.getTime()) continue
      const row = decks.get(match.deckId) ?? { deckName: match.deckName, record: empty() }
      tally(row.record, match.result)
      decks.set(match.deckId, row)
    }
    const order = before ? compareRanks(change, before) : null
    return {
      change,
      label: rankLabelEs(change.rank, change.points),
      move: order === null ? null : order > 0 ? 'up' : order < 0 ? 'down' : 'same',
      decks: [...decks].map(([deckId, row]) => ({ deckId, ...row })),
    }
  })
  const games = (row: GameRecord) => row.wins + row.losses + row.ties
  const last = noted.at(-1) ?? null
  return {
    season,
    record,
    games: games(record),
    rank: last,
    rankLabel: last ? rankLabelEs(last.rank, last.points) : null,
    steps,
    byRank: [...byRank.values()]
      .sort((a, b) => (a.rank ? RANKS.indexOf(a.rank) : -1) - (b.rank ? RANKS.indexOf(b.rank) : -1))
      .map((row) => ({
        rank: row.rank,
        label: row.rank ? rankLabelEs(row.rank) : 'Sin rango anotado',
        record: row.record,
        games: games(row.record),
      })),
    byDeck: [...byDeck]
      .map(([deckId, row]) => ({ deckId, ...row, games: games(row.record) }))
      .sort((a, b) => b.games - a.games || a.deckName.localeCompare(b.deckName, 'es')),
  }
}
