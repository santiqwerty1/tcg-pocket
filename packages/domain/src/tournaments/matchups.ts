/**
 * Matchups between archetypes from real tournaments (Fase 9): Limitless publishes who played whom in each round
 * (`/tournaments/{id}/pairings`), and the standings say which archetype each player brought. A matchup cell is the
 * record of archetype A against archetype B over the era's matches; a match is a whole BO1 or BO3, as Limitless
 * reports it. Byes, no-shows (no second player) and double losses are left out, and so is any match where one of the
 * players has no list (no archetype to put it under).
 *
 * H-009 (Fase 37): a match can be a BO1, a BO3 or a BO5 (the `mode` of its tournament phase). Next to the match
 * records, each cell keeps them by match length, so a matchup can also be read per game (`perGameRecord`): the match
 * rate of each length turned into a game rate before adding them up, because the conversion is not linear.
 */
import { z } from 'zod'
import { addRecords, EMPTY_RECORD, type GameRecord, recordGames, type WinRate, winRate, Z_95 } from '../stats/rates.js'
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
  /** Games of a match in its phase (1, 3, 5); null or absent: unknown, taken as 1. */
  bestOf?: number | null
}

/** `BO3` → 3; anything else → null. */
export function bestOfFromMode(mode: string | null | undefined): number | null {
  const hit = /^BO(\d{1,2})$/i.exec(mode?.trim() ?? '')
  const games = hit ? Number(hit[1]) : Number.NaN
  return Number.isInteger(games) && games >= 1 && games % 2 === 1 ? games : null
}

const detailsPhasesSchema = z.looseObject({
  phases: z.array(z.looseObject({ phase: z.number().optional(), mode: z.string().optional() })).optional(),
})

/** Phase → games of a match, from a tournament's stored `/details` (phases without a known mode left out). */
export function phaseBestOf(details: unknown): Map<number, number> {
  const out = new Map<number, number>()
  const parsed = detailsPhasesSchema.safeParse(details ?? {})
  if (!parsed.success) return out
  for (const phase of parsed.data.phases ?? []) {
    const bestOf = bestOfFromMode(phase.mode)
    if (phase.phase !== undefined && bestOf !== null) out.set(phase.phase, bestOf)
  }
  return out
}

/** Chance of winning a match to `bestOf` games (first to ⌈bestOf/2⌉) when each game is won with chance p. */
export function matchWinProbability(p: number, bestOf: number): number {
  const need = Math.ceil(bestOf / 2)
  let sum = 0
  let ways = 1
  for (let lost = 0; lost < need; lost++) {
    sum += ways * p ** need * (1 - p) ** lost
    ways = (ways * (need + lost)) / (lost + 1)
  }
  return sum
}

/** The game rate that gives match rate m at `bestOf` (a 30 % at BO3 is a 36 % per game). */
export function gameRateFromMatchRate(m: number, bestOf: number): number {
  const target = Math.min(1, Math.max(0, m))
  if (bestOf <= 1 || target === 0 || target === 1) return target
  let low = 0
  let high = 1
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2
    if (matchWinProbability(mid, bestOf) < target) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** Wins and losses per game (fractional), ties out. */
export interface PerGameRecord {
  wins: number
  losses: number
}

/**
 * A record kept by match length, read per game: each length's match rate turned into a game rate, every match
 * weighing as one game (prudent: a BO3 says a bit more than one game). Ties and double losses out. Null: no match.
 */
export function perGameRecord(byBestOf: ReadonlyMap<number, GameRecord> | undefined): PerGameRecord | null {
  if (!byBestOf) return null
  let wins = 0
  let losses = 0
  for (const [bestOf, record] of byBestOf) {
    const matches = record.wins + record.losses
    if (matches === 0) continue
    const p = gameRateFromMatchRate(record.wins / matches, bestOf)
    wins += matches * p
    losses += matches * (1 - p)
  }
  return wins + losses > 0 ? { wins, losses } : null
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
  /** The same two, by match length (H-009): `perGameRecord` reads them per game. */
  byBestOf: {
    cells: ReadonlyMap<string, ReadonlyMap<number, GameRecord>>
    field: ReadonlyMap<string, ReadonlyMap<number, GameRecord>>
  }
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

function addByBestOf(map: Map<string, Map<number, GameRecord>>, key: string, bestOf: number, record: GameRecord) {
  const inner = map.get(key) ?? new Map<number, GameRecord>()
  inner.set(bestOf, addRecords(inner.get(bestOf) ?? EMPTY_RECORD, record))
  map.set(key, inner)
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
  const cellsByBestOf = new Map<string, Map<number, GameRecord>>()
  const fieldByBestOf = new Map<string, Map<number, GameRecord>>()
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
    const bestOf = pairing.bestOf ?? 1
    addByBestOf(cellsByBestOf, cellKey(a, b), bestOf, forA)
    addByBestOf(cellsByBestOf, cellKey(b, a), bestOf, forB)
    addByBestOf(fieldByBestOf, a, bestOf, forA)
    addByBestOf(fieldByBestOf, b, bestOf, forB)
    matches += 1
  }
  return {
    era: dataset.era,
    cells,
    field,
    byBestOf: { cells: cellsByBestOf, field: fieldByBestOf },
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

/** Record of a against b per game (H-009); null when they never met (or only tied). */
export function matchupPerGame(matchups: Matchups, a: string, b: string): PerGameRecord | null {
  return perGameRecord(matchups.byBestOf.cells.get(cellKey(a, b)))
}

/** An archetype's record against everyone per game (H-009). */
export function fieldPerGame(matchups: Matchups, archetypeId: string): PerGameRecord | null {
  return perGameRecord(matchups.byBestOf.field.get(archetypeId))
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
  /** The same matches per game (H-009): what one game of Santiago's compares with. */
  perGame: PerGameRecord | null
}

/** An archetype against each rival it met, the most played rivals first. */
export function matchupRows(matchups: Matchups, dataset: TournamentDataset, archetypeId: string): MatchupRow[] {
  return metaShares(dataset)
    .map(({ archetypeId: rival, share }) => {
      const record = matchupRecord(matchups, archetypeId, rival)
      return { rival, share, record, rate: matchupRate(record), perGame: matchupPerGame(matchups, archetypeId, rival) }
    })
    .filter((row) => recordGames(row.record) > 0)
}

export interface ExpectedVsMeta {
  /** 0–100: Σ share × (shrunk) win rate over every archetype of the meta, the shares renormalized. */
  value: number
  /** H-011: approximate 95 % interval (delta method), 0–100. */
  ci95: [number, number]
  /** Share of the meta (0–100) of the rivals with at least `solidMatches` matches: how much is data, not prior. */
  coverage: number
  matches: number
  /** Rivals it met at least once. */
  rivals: number
}

/** Matches a matchup «weighs» as a prior: with fewer than this, the archetype's own record dominates. */
export const MATCHUP_PRIOR_MATCHES = 10
/** Matches the archetype's own record weighs toward the era mean (an archetype seen 0–3 is not a 0 % deck). */
export const FIELD_PRIOR_MATCHES = 20

/**
 * What an archetype should score against the era's field if it met each rival as often as the rival is played: each
 * matchup's rate weighted by the rival's share. A matchup with few matches is pulled toward the archetype's record
 * against everyone (as if it had `prior` more matches at that rate), so one 0–3 against a rival does not sink the
 * estimate; a rival never met counts at that record, which is itself pulled toward the era mean (20 matches of
 * prior; H-011: the era mean, 46,7 % in B4a, not 50 %: ties count as not won on both sides). The interval is the
 * delta method's: each matchup's own matches, plus the archetype's record shared by every shrunk matchup.
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
    /**
     * Fase 44: the shares are an estimate from this many (effective) samples — «mi meta», from the owner's matches —
     * so their sampling error joins the interval (delta method on multinomial shares: Σ wᵢ (rᵢ − r̄)² / n). Omitted,
     * the shares count as known (the meta's, from hundreds of lists).
     */
    sharesSample?: number | undefined
  } = {},
): ExpectedVsMeta | null {
  const prior = options.prior ?? MATCHUP_PRIOR_MATCHES
  const solid = options.solidMatches ?? MATCHUP_PRIOR_MATCHES
  const field = matchups.field.get(archetypeId)
  const fieldGames = field ? recordGames(field) : 0
  if (!field || fieldGames === 0) return null
  // The archetype's record against everyone, itself pulled toward the era mean when it has few matches.
  const totalGames = recordGames(dataset.total)
  const mean = totalGames === 0 ? 0.5 : dataset.total.wins / totalGames
  const base = (field.wins + FIELD_PRIOR_MATCHES * mean) / (fieldGames + FIELD_PRIOR_MATCHES)
  const baseVariance = (base * (1 - base)) / (fieldGames + FIELD_PRIOR_MATCHES)
  const rows = (options.shares ?? metaShares(dataset)).map(({ archetypeId: rival, share }) => {
    const record = matchupRecord(matchups, archetypeId, rival)
    const games = recordGames(record)
    return { share, games, rate: (record.wins + prior * base) / (games + prior) }
  })
  const shares = rows.reduce((sum, row) => sum + row.share, 0)
  if (shares === 0) return null
  let value = 0
  let ownVariance = 0
  let onBase = 0
  for (const row of rows) {
    const weight = row.share / shares
    value += weight * row.rate
    ownVariance += weight ** 2 * ((row.games * row.rate * (1 - row.rate)) / (row.games + prior) ** 2)
    onBase += (weight * prior) / (row.games + prior)
  }
  // Fase 44: weights estimated from n samples add Var(Σ ŵᵢ rᵢ) = Σ wᵢ (rᵢ − r̄)² / n (multinomial covariance).
  const sample = options.sharesSample
  const weightVariance =
    sample !== undefined && sample > 0
      ? rows.reduce((sum, row) => sum + (row.share / shares) * (row.rate - value) ** 2, 0) / sample
      : 0
  const half = Z_95 * Math.sqrt(ownVariance + onBase ** 2 * baseVariance + weightVariance)
  return {
    value: value * 100,
    ci95: [Math.max(0, value - half) * 100, Math.min(1, value + half) * 100],
    coverage: rows.filter((row) => row.games >= solid).reduce((sum, row) => sum + row.share, 0),
    matches: rows.reduce((sum, row) => sum + row.games, 0),
    rivals: rows.filter((row) => row.games > 0).length,
  }
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
