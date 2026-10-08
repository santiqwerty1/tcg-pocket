/**
 * ¿Mala racha o mal matchup? (Fase 13): how unusual an own record is if the true win rate were the expected one
 * (from tournaments). Exact binomial tails over the games, ties counting as non-wins like every rate of the app; and
 * how often a run of k losses in a row happens at that rate. Words, not p-values: «dentro de lo normal», «raro».
 */
import { type GameRecord, recordGames } from './rates.js'

/** Below this many games nothing is said: any record is possible. */
export const LUCK_MIN_GAMES = 5
/** A tail below this is «raro» (one time in twenty). */
export const LUCK_RARE = 0.05

export type LuckVerdict = 'too_few' | 'normal' | 'unlucky' | 'lucky'

export interface LuckCheck {
  games: number
  wins: number
  /** Own rate (0–100). */
  actual: number
  /** Expected rate (0–100). */
  expected: number
  /** P(this many wins or fewer) and P(this many or more) at the expected rate. */
  lowerTail: number
  upperTail: number
  verdict: LuckVerdict
}

/** P(X = k) for X ~ Binomial(n, p), in log space so it holds for a few thousand games. */
function binomialPmf(n: number, k: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0
  if (p >= 1) return k === n ? 1 : 0
  let logChoose = 0
  for (let i = 1; i <= k; i++) logChoose += Math.log(n - k + i) - Math.log(i)
  return Math.exp(logChoose + k * Math.log(p) + (n - k) * Math.log(1 - p))
}

export function binomialTails(n: number, k: number, p: number): { lower: number; upper: number } {
  let lower = 0
  for (let i = 0; i <= k; i++) lower += binomialPmf(n, i, p)
  let upper = 0
  for (let i = k; i <= n; i++) upper += binomialPmf(n, i, p)
  return { lower: Math.min(1, lower), upper: Math.min(1, upper) }
}

/** The own record against an expected rate (0–100). */
export function luckCheck(record: GameRecord, expected: number): LuckCheck {
  const games = recordGames(record)
  const p = Math.min(1, Math.max(0, expected / 100))
  const { lower, upper } = games === 0 ? { lower: 1, upper: 1 } : binomialTails(games, record.wins, p)
  let verdict: LuckVerdict = 'normal'
  if (games < LUCK_MIN_GAMES) verdict = 'too_few'
  else if (lower < LUCK_RARE) verdict = 'unlucky'
  else if (upper < LUCK_RARE) verdict = 'lucky'
  return {
    games,
    wins: record.wins,
    actual: games === 0 ? 0 : (record.wins / games) * 100,
    expected,
    lowerTail: lower,
    upperTail: upper,
    verdict,
  }
}

/** How often «one in N»: 0,08 → 12 («1 de cada 12»). */
export function oneIn(probability: number): number {
  return probability <= 0 ? Number.POSITIVE_INFINITY : Math.max(1, Math.round(1 / probability))
}

export interface StreakCheck {
  /** Losses in a row, counting back from the latest match. */
  losses: number
  /** P(the next `losses` games are all losses) at the expected rate. */
  probability: number
  /** P(at least one run that long somewhere in `games` games) at the expected rate. */
  somewhere: number
}

/** P(at least one run of `run` losses in `games` games), losing with probability q (exact recursion). */
export function runProbability(games: number, run: number, q: number): number {
  if (run <= 0) return 1
  if (run > games) return 0
  // state[j] = P(no run yet and the current tail has j losses), j < run.
  let state = new Array<number>(run).fill(0)
  state[0] = 1
  let hit = 0
  for (let g = 0; g < games; g++) {
    const next = new Array<number>(run).fill(0)
    for (let j = 0; j < run; j++) {
      const p = state[j] ?? 0
      if (p === 0) continue
      next[0] = (next[0] ?? 0) + p * (1 - q)
      if (j + 1 === run) hit += p * q
      else next[j + 1] = (next[j + 1] ?? 0) + p * q
    }
    state = next
  }
  return Math.min(1, hit)
}

/**
 * The current losing run of a sequence of results (oldest first) at an expected rate (0–100); null under 3 losses in
 * a row (two losses in a row are everyday).
 */
export function losingStreak(results: readonly ('win' | 'loss' | 'tie')[], expected: number): StreakCheck | null {
  let losses = 0
  for (let i = results.length - 1; i >= 0 && results[i] === 'loss'; i--) losses += 1
  if (losses < 3) return null
  const q = 1 - Math.min(1, Math.max(0, expected / 100))
  return { losses, probability: q ** losses, somewhere: runProbability(results.length, losses, q) }
}
