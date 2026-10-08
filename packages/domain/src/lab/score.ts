/**
 * The meta score of a deck (T-008): its simulated win rate against each rival of the meta bank, weighted by the
 * rival's share of the era (what the ladder would look like if it were those archetypes and people played like the
 * bots). One source only (simulation): the tournament shares weigh, they are not rates. `WR = W / (W + L + T)` per
 * rival, as everywhere. The interval is a normal approximation over the per-rival rates, each smoothed with +2/+4
 * for its variance so a rival beaten 100 % of the time still adds uncertainty.
 */
import { formatIntervalEs, formatPercentEs, type GameRecord, recordGames, Z_95 } from '../stats/rates.js'

export interface WeightedRecord {
  weight: number
  record: GameRecord
}

export interface MetaScore {
  /** Weighted win rate (0–100). */
  value: number
  /** Approximate 95 % interval (0–100). */
  ci95: [number, number]
  /** Standard error (0–100). */
  se: number
  games: number
  /** Rivals with games. */
  rivals: number
  /** Share of the bank's weight that has games (0–1): the score renormalizes over it. */
  coverage: number
}

/** Null when no rival has games. */
export function metaScore(rows: readonly WeightedRecord[]): MetaScore | null {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0)
  const played = rows.filter((row) => row.weight > 0 && recordGames(row.record) > 0)
  const weightSum = played.reduce((sum, row) => sum + row.weight, 0)
  if (played.length === 0 || weightSum === 0) return null
  let value = 0
  let variance = 0
  let games = 0
  for (const row of played) {
    const n = recordGames(row.record)
    const weight = row.weight / weightSum
    value += (weight * row.record.wins) / n
    const smoothed = (row.record.wins + 2) / (n + 4)
    variance += (weight * weight * smoothed * (1 - smoothed)) / n
    games += n
  }
  const se = Math.sqrt(variance)
  return {
    value: value * 100,
    ci95: [Math.max(0, value - Z_95 * se) * 100, Math.min(1, value + Z_95 * se) * 100],
    se: se * 100,
    games,
    rivals: played.length,
    coverage: total === 0 ? 0 : weightSum / total,
  }
}

/** True when `challenger` is ahead of `incumbent` by more than `z` standard errors of the difference. */
export function scoreBeats(challenger: MetaScore, incumbent: MetaScore, z: number): boolean {
  return challenger.value - incumbent.value > z * Math.hypot(challenger.se, incumbent.se)
}

/** «52,3 % contra el meta (n = 1.000, IC 48,1–56,5 %)», like a win rate (DECISIONES 0.10). */
export function formatMetaScoreEs(score: MetaScore | null): string {
  if (!score) return 'sin datos'
  const games = new Intl.NumberFormat('es-AR').format(score.games)
  return `${formatPercentEs(score.value)} contra el meta (n = ${games}, IC ${formatIntervalEs(score.ci95)})`
}
