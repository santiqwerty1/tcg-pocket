/**
 * Matchups between archetypes from real tournaments (Fase 9): Limitless publishes who played whom in each round
 * (`/tournaments/{id}/pairings`), and the standings say which archetype each player brought. A matchup cell is the
 * record of archetype A against archetype B over the era's matches; a match is a whole BO1 or BO3, as Limitless
 * reports it. Byes, no-shows (no second player) and double losses are left out, and so is any match where one of the
 * players has no list (no archetype to put it under).
 */
import { z } from 'zod'
import { addRecords, EMPTY_RECORD, type GameRecord, recordGames, type WinRate, winRate } from '../stats/rates.js'
import type { TournamentDataset } from './dataset.js'

/** One item of `GET /tournaments/{id}/pairings` (docs/fase0/limitless/big_pairings.json). */
export const limitlessPairingSchema = z.object({
  round: z.number().int(),
  phase: z.number().int(),
  player1: z.string().min(1),
  player2: z.string().nullable().optional(),
  /** The winner's player id, 0 for a tie, -1 for a double loss. */
  winner: z.union([z.string(), z.number()]).nullable().optional(),
})

export const limitlessPairingsSchema = z.array(limitlessPairingSchema)

export type PairingResult = 'p1' | 'p2' | 'tie' | 'double_loss' | 'bye'

export interface NormalizedPairing {
  phase: number
  round: number
  player1: string
  /** Null: a bye or a no-show (the round counts for player1 alone). */
  player2: string | null
  result: PairingResult
}

export interface StoredPairing extends NormalizedPairing {
  tournamentId: string
}

/** Pairings as Limitless sends them, normalized; throws (zod) when the shape is not the expected one. */
export function parsePairings(raw: unknown): NormalizedPairing[] {
  return limitlessPairingsSchema.parse(raw).map((item) => {
    const player2 = item.player2 && item.player2.length > 0 ? item.player2 : null
    const winner = item.winner === null || item.winner === undefined ? null : String(item.winner)
    let result: PairingResult
    if (player2 === null) result = 'bye'
    else if (winner === item.player1) result = 'p1'
    else if (winner === player2) result = 'p2'
    else if (winner === '0') result = 'tie'
    else result = 'double_loss'
    return { phase: item.phase, round: item.round, player1: item.player1, player2, result }
  })
}

export interface Matchups {
  era: string
  /** `a|b` → record of archetype a against archetype b (both directions are stored). */
  cells: ReadonlyMap<string, GameRecord>
  /** Archetype → its record against everyone else in the counted matches (mirrors included). */
  field: ReadonlyMap<string, GameRecord>
  /** Matches counted, and why the others were not. */
  matches: number
  skipped: { byes: number; doubleLosses: number; noArchetype: number }
  /** Tournaments of the dataset with pairings downloaded, out of all of them. */
  tournamentsWithPairings: number
  tournaments: number
}

const cellKey = (a: string, b: string) => `${a}|${b}`

function add(map: Map<string, GameRecord>, key: string, record: GameRecord): void {
  map.set(key, addRecords(map.get(key) ?? EMPTY_RECORD, record))
}

const WIN: GameRecord = { wins: 1, losses: 0, ties: 0 }
const LOSS: GameRecord = { wins: 0, losses: 1, ties: 0 }
const TIE: GameRecord = { wins: 0, losses: 0, ties: 1 }

/** The era's matchups: each pairing of the dataset's tournaments under the two players' archetypes. */
export function buildMatchups(dataset: TournamentDataset, pairings: readonly StoredPairing[]): Matchups {
  const inDataset = new Set(dataset.tournaments.map((t) => t.id))
  const archetypeOf = new Map<string, string | null>()
  for (const entry of dataset.entries) archetypeOf.set(`${entry.tournamentId}|${entry.playerId}`, entry.archetypeId)
  const cells = new Map<string, GameRecord>()
  const field = new Map<string, GameRecord>()
  const withPairings = new Set<string>()
  const skipped = { byes: 0, doubleLosses: 0, noArchetype: 0 }
  let matches = 0
  for (const pairing of pairings) {
    if (!inDataset.has(pairing.tournamentId)) continue
    withPairings.add(pairing.tournamentId)
    if (pairing.result === 'bye' || pairing.player2 === null) {
      skipped.byes += 1
      continue
    }
    if (pairing.result === 'double_loss') {
      skipped.doubleLosses += 1
      continue
    }
    const a = archetypeOf.get(`${pairing.tournamentId}|${pairing.player1}`) ?? null
    const b = archetypeOf.get(`${pairing.tournamentId}|${pairing.player2}`) ?? null
    if (a === null || b === null) {
      skipped.noArchetype += 1
      continue
    }
    const [forA, forB] = pairing.result === 'p1' ? [WIN, LOSS] : pairing.result === 'p2' ? [LOSS, WIN] : [TIE, TIE]
    add(cells, cellKey(a, b), forA)
    add(cells, cellKey(b, a), forB)
    add(field, a, forA)
    add(field, b, forB)
    matches += 1
  }
  return {
    era: dataset.era,
    cells,
    field,
    matches,
    skipped,
    tournamentsWithPairings: withPairings.size,
    tournaments: dataset.tournaments.length,
  }
}

/** Record of a against b (empty when they never met). */
export function matchupRecord(matchups: Matchups, a: string, b: string): GameRecord {
  return matchups.cells.get(cellKey(a, b)) ?? { ...EMPTY_RECORD }
}

/** A matchup rate: Wilson over the matches; «orientativo» under 30 of them. */
export function matchupRate(record: GameRecord): WinRate<'tournament'> | null {
  return winRate('tournament', record, recordGames(record), 'matches')
}

/** Share of the era's lists (0–100) of each archetype, most played first; «Sin arquetipo» left out. */
export function metaShares(dataset: TournamentDataset): { archetypeId: string; share: number; lists: number }[] {
  const counts = new Map<string, number>()
  for (const entry of dataset.entries) {
    if (entry.archetypeId !== null) counts.set(entry.archetypeId, (counts.get(entry.archetypeId) ?? 0) + 1)
  }
  const total = dataset.entries.length
  return [...counts]
    .map(([archetypeId, lists]) => ({ archetypeId, lists, share: total === 0 ? 0 : (lists / total) * 100 }))
    .sort((x, y) => y.lists - x.lists || x.archetypeId.localeCompare(y.archetypeId))
}

export interface MatchupRow {
  rival: string
  /** The rival's share of the era's lists (0–100). */
  share: number
  record: GameRecord
  rate: WinRate<'tournament'> | null
}

/** An archetype against each rival it met, the most played rivals first. */
export function matchupRows(matchups: Matchups, dataset: TournamentDataset, archetypeId: string): MatchupRow[] {
  return metaShares(dataset)
    .map(({ archetypeId: rival, share }) => {
      const record = matchupRecord(matchups, archetypeId, rival)
      return { rival, share, record, rate: matchupRate(record) }
    })
    .filter((row) => recordGames(row.record) > 0)
}

export interface ExpectedVsMeta {
  /** 0–100: Σ share × (shrunk) win rate over every archetype of the meta, the shares renormalized. */
  value: number
  /** Share of the meta (0–100) of the rivals with at least `solidMatches` matches: how much is data, not prior. */
  coverage: number
  matches: number
  /** Rivals it met at least once. */
  rivals: number
}

/** Matches a matchup «weighs» as a prior: with fewer than this, the archetype's own record dominates. */
export const MATCHUP_PRIOR_MATCHES = 10
/** Matches the archetype's own record weighs toward 50 % (an archetype seen 0–3 is not a 0 % deck). */
export const FIELD_PRIOR_MATCHES = 20

/**
 * What an archetype should score against the era's field if it met each rival as often as the rival is played: each
 * matchup's rate weighted by the rival's share. A matchup with few matches is pulled toward the archetype's record
 * against everyone (as if it had `prior` more matches at that rate), so one 0–3 against a rival does not sink the
 * estimate; a rival never met counts at that record, which is itself pulled toward 50 % (20 matches of prior).
 * Null when the archetype has no counted matches at all.
 */
export function expectedVsMeta(
  matchups: Matchups,
  dataset: TournamentDataset,
  archetypeId: string,
  options: {
    prior?: number
    solidMatches?: number
    /** Weights other than the era's shares (Fase 15: this week's meta). */
    shares?: readonly { archetypeId: string; share: number }[]
  } = {},
): ExpectedVsMeta | null {
  const prior = options.prior ?? MATCHUP_PRIOR_MATCHES
  const solid = options.solidMatches ?? MATCHUP_PRIOR_MATCHES
  const field = matchups.field.get(archetypeId)
  const fieldGames = field ? recordGames(field) : 0
  if (!field || fieldGames === 0) return null
  // The archetype's record against everyone, itself pulled toward 50 % when it has few matches.
  const base = (field.wins + FIELD_PRIOR_MATCHES * 0.5) / (fieldGames + FIELD_PRIOR_MATCHES)
  let weighted = 0
  let shares = 0
  let covered = 0
  let matches = 0
  let rivals = 0
  for (const { archetypeId: rival, share } of options.shares ?? metaShares(dataset)) {
    const record = matchupRecord(matchups, archetypeId, rival)
    const games = recordGames(record)
    weighted += share * ((record.wins + prior * base) / (games + prior))
    shares += share
    if (games >= solid) covered += share
    if (games > 0) rivals += 1
    matches += games
  }
  if (shares === 0) return null
  return { value: (weighted / shares) * 100, coverage: covered, matches, rivals }
}

/** Lists from which the last weeks are enough to weigh the meta (Fase 15); fewer, the whole era. */
export const RECENT_META_MIN_LISTS = 150
export const RECENT_META_DAYS = 14

/**
 * The meta to weigh against «today»: the archetypes' shares in the last `days` days up to the newest tournament of
 * the era when they hold enough lists, else the whole era.
 */
export function recentMeta(
  dataset: TournamentDataset,
  days = RECENT_META_DAYS,
  minLists = RECENT_META_MIN_LISTS,
): { kind: 'recent' | 'era'; days: number; lists: number; shares: { archetypeId: string; share: number }[] } {
  const newest = dataset.entries.reduce((max, entry) => Math.max(max, entry.date.getTime()), 0)
  const from = newest - (days - 1) * 24 * 60 * 60 * 1000
  const recent = dataset.entries.filter((entry) => entry.date.getTime() >= from)
  if (recent.length < minLists) {
    return { kind: 'era', days, lists: dataset.entries.length, shares: metaShares(dataset) }
  }
  return { kind: 'recent', days, lists: recent.length, shares: metaShares({ ...dataset, entries: recent }) }
}
