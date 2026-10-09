/**
 * H-010 with per-game results (`perGame`, T-017 A2): two lists of a round play the same games against each rival (the
 * same chunk seed, the same game index), so their difference is measured game by game instead of as two independent
 * scores. With the cards in their places (H-020) most games come out the same for both lists, and only the ones the
 * swap changed move the difference: the error shrinks and smaller real gains stand out (análisis del 09/10: a third
 * to a half of the games for the same precision).
 *
 * Also what a list's games say beyond the rate: wins going first and second, how its losses ended, how far it evolved.
 */

import type { PerGameEntry } from '../simulation/perGame.js'
import { Z_95 } from '../stats/rates.js'
import type { ScoreDifference } from './score.js'

/** One rival: its weight in the bank and both lists' results game by game (1 a win, 0 a loss or a tie). */
export interface PairedRival {
  weight: number
  a: readonly number[]
  b: readonly number[]
}

/**
 * The weighted difference a − b (0–100) over the rivals both lists played, game by game; null when no rival has games
 * on both sides. Each rival's variance carries one pseudo-game won by each side (like the +2/+4 of `metaScore`), so
 * two lists that agree on every game still keep some uncertainty.
 */
export function pairedDifference(rows: readonly PairedRival[]): ScoreDifference | null {
  const played = rows
    .map((row) => ({ weight: row.weight, n: Math.min(row.a.length, row.b.length), row }))
    .filter((item) => item.weight > 0 && item.n > 0)
  const weightSum = played.reduce((sum, item) => sum + item.weight, 0)
  if (played.length === 0 || weightSum === 0) return null
  let value = 0
  let variance = 0
  for (const { weight, n, row } of played) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += (row.a[i] ?? 0) - (row.b[i] ?? 0)
    const mean = sum / n
    let squares = (1 - mean) ** 2 + (-1 - mean) ** 2
    for (let i = 0; i < n; i++) squares += ((row.a[i] ?? 0) - (row.b[i] ?? 0) - mean) ** 2
    const w = weight / weightSum
    value += w * mean
    variance += (w * w * (squares / (n + 1))) / n
  }
  const se = Math.sqrt(variance) * 100
  return { value: value * 100, se, ci95: [value * 100 - Z_95 * se, value * 100 + Z_95 * se] }
}

/** Whether a difference is past `z` standard errors: «better», «worse» or «unclear». */
export function differenceVerdict(difference: ScoreDifference, z: number): 'better' | 'unclear' | 'worse' {
  if (difference.value > z * difference.se) return 'better'
  if (difference.value < -z * difference.se) return 'worse'
  return 'unclear'
}

/** The round's best candidate by paired difference against the incumbent, when it is past `z` errors (the screen). */
export function pairedWinner(
  candidates: readonly { id: number; difference: ScoreDifference | null; complete: boolean }[],
  z: number,
): number | null {
  const best = candidates
    .filter(
      (candidate): candidate is { id: number; difference: ScoreDifference; complete: boolean } =>
        candidate.complete && !!candidate.difference,
    )
    .sort((a, b) => b.difference.value - a.difference.value || a.id - b.id)[0]
  return best && differenceVerdict(best.difference, z) === 'better' ? best.id : null
}

export interface GameSplit {
  wins: number
  games: number
}

/** What a list's games say beyond its rate (side A of every game: lab lists always play as A). */
export interface PerGameSummary {
  games: number
  /** Going first and going second. */
  first: GameSplit
  second: GameSplit
  /** How its losses ended: the rival took 3 points, or it had no Pokémon left in play. */
  losses: { points: number; noPokemon: number }
  /** Ties: at the 30-turn limit, or otherwise. */
  ties: { turnLimit: number; other: number }
  /** Games by the highest stage it had in play: [only Basics, Stage 1, Stage 2]. */
  stages: [number, number, number]
}

export function perGameSummary(entries: readonly PerGameEntry[]): PerGameSummary {
  const summary: PerGameSummary = {
    games: 0,
    first: { wins: 0, games: 0 },
    second: { wins: 0, games: 0 },
    losses: { points: 0, noPokemon: 0 },
    ties: { turnLimit: 0, other: 0 },
    stages: [0, 0, 0],
  }
  for (const entry of entries) {
    summary.games += 1
    const split = entry.starter === 'a' ? summary.first : summary.second
    split.games += 1
    if (entry.winner === 'a') split.wins += 1
    if (entry.winner === 'b') {
      if (entry.ending === 'no_pokemon') summary.losses.noPokemon += 1
      else summary.losses.points += 1
    }
    if (entry.winner === 'tie') {
      if (entry.ending === 'turn_limit') summary.ties.turnLimit += 1
      else summary.ties.other += 1
    }
    const stage = Math.max(0, Math.min(2, entry.stageA)) as 0 | 1 | 2
    summary.stages[stage] += 1
  }
  return summary
}
