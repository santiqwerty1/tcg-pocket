/**
 * ¿Mala racha o mal matchup? (Fase 13): how unusual an own record is if the true win rate were the expected one
 * (from tournaments); and how often a run of k losses in a row happens at that rate. Words, not p-values: «dentro de
 * lo normal», «raro».
 *
 * H-009 (Fase 37): ties are out on both sides (W/(W+L)); when the tournament record behind the expected rate is
 * known, its own uncertainty is part of the check (beta-binomial predictive with a Jeffreys prior, instead of taking
 * the rate as exact); «raro» is two-sided (each tail under 2,5 %); and several checks at once (one per rival) go
 * through Holm's correction.
 */
import type { GameRecord } from './rates.js'

/** Below this many games nothing is said: any record is possible. */
export const LUCK_MIN_GAMES = 5
/** «Raro»: one time in twenty, both tails together (each tail under half of it). */
export const LUCK_RARE = 0.05

export type LuckVerdict = 'too_few' | 'normal' | 'unlucky' | 'lucky'

export interface LuckCheck {
  /** Wins and losses (ties left out). */
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

/** log Γ(x), Lanczos (g = 7, 9 terms): enough for the beta-binomial of a few thousand games. */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
  const z = x - 1
  let sum = c[0] ?? 0
  for (let i = 1; i < 9; i++) sum += (c[i] ?? 0) / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum)
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b)
}

/** Tails of a beta-binomial (n games, a win rate itself Beta(a, b)): the predictive with an uncertain rate. */
export function betaBinomialTails(n: number, k: number, a: number, b: number): { lower: number; upper: number } {
  const pmf = (i: number) => {
    let logChoose = 0
    for (let j = 1; j <= i; j++) logChoose += Math.log(n - i + j) - Math.log(j)
    return Math.exp(logChoose + logBeta(i + a, n - i + b) - logBeta(a, b))
  }
  let lower = 0
  for (let i = 0; i <= k; i++) lower += pmf(i)
  let upper = 0
  for (let i = k; i <= n; i++) upper += pmf(i)
  return { lower: Math.min(1, lower), upper: Math.min(1, upper) }
}

export interface LuckOptions {
  /** The tournament record behind the expected rate (wins and losses, per game; fractions allowed). */
  expectedRecord?: { wins: number; losses: number } | null
}

/** The own record against an expected rate (0–100); with `expectedRecord`, its uncertainty counts too. */
export function luckCheck(record: GameRecord, expected: number, options: LuckOptions = {}): LuckCheck {
  const games = record.wins + record.losses
  const prior = options.expectedRecord
  const known = prior && prior.wins + prior.losses > 0 ? prior : null
  const p = known ? known.wins / (known.wins + known.losses) : Math.min(1, Math.max(0, expected / 100))
  const { lower, upper } =
    games === 0
      ? { lower: 1, upper: 1 }
      : known
        ? betaBinomialTails(games, record.wins, known.wins + 0.5, known.losses + 0.5)
        : binomialTails(games, record.wins, p)
  let verdict: LuckVerdict = 'normal'
  if (games < LUCK_MIN_GAMES) verdict = 'too_few'
  else if (lower < LUCK_RARE / 2) verdict = 'unlucky'
  else if (upper < LUCK_RARE / 2) verdict = 'lucky'
  return {
    games,
    wins: record.wins,
    actual: games === 0 ? 0 : (record.wins / games) * 100,
    expected: p * 100,
    lowerTail: lower,
    upperTail: upper,
    verdict,
  }
}

/**
 * Several checks at once (one per rival): Holm's correction, so that among them «raro» is still one time in twenty
 * in all. A check keeps its verdict only if its two-sided p passes Holm's step; otherwise it is «normal».
 */
export function holmVerdicts(checks: readonly LuckCheck[]): LuckVerdict[] {
  const tested = checks
    .map((check, at) => ({ at, check, p: Math.min(1, 2 * Math.min(check.lowerTail, check.upperTail)) }))
    .filter((item) => item.check.verdict !== 'too_few')
    .sort((a, b) => a.p - b.p)
  const verdicts = checks.map((check) => (check.verdict === 'too_few' ? 'too_few' : 'normal')) as LuckVerdict[]
  for (const [rank, item] of tested.entries()) {
    if (item.p > LUCK_RARE / (tested.length - rank)) break
    verdicts[item.at] = item.check.lowerTail <= item.check.upperTail ? 'unlucky' : 'lucky'
  }
  return verdicts
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
