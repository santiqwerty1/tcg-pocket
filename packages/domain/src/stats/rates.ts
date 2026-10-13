/**
 * Win rates with their sample (BRIEF §2, PLAN I9, DECISIONES 0.10): `WR = W / (W + L + T)`, 95 % Wilson score
 * interval over games, «orientativo» below 30 samples. Tournament data, own matches and simulations are distinct
 * sources: every rate carries its `source`, and nothing in this module combines two rates into one number.
 */

/** Two-sided 95 % normal quantile (Φ⁻¹(0.975)). */
export const Z_95 = 1.959963984540054

/** A rate with fewer samples than this is shown as «orientativo». */
export const ORIENTATIVE_BELOW = 30

export const RATE_SOURCES = ['matches', 'tournament', 'simulation'] as const
export type RateSource = (typeof RATE_SOURCES)[number]

/** What `samples` counts: own matches, tournament decklists or simulated games. */
export type SampleKind = 'matches' | 'lists' | 'simulations'

export interface GameRecord {
  wins: number
  losses: number
  ties: number
}

/** PLAN I9. `value` and `ci95` are percentages (0–100) at full precision; rounding happens when formatting. */
export interface WinRate<S extends RateSource = RateSource> {
  source: S
  value: number
  /** W + L + T: what Wilson is computed over. */
  games: number
  /** Matches (own, simulated) or decklists (tournament): what «orientativo» is decided on. */
  samples: number
  sampleKind: SampleKind
  ci95: [number, number]
  orientative: boolean
  /** H-011: how much the clusters (lists) widened the interval, as a variance ratio; absent: games independent. */
  designEffect?: number
}

export const EMPTY_RECORD: Readonly<GameRecord> = Object.freeze({ wins: 0, losses: 0, ties: 0 })

export function recordGames(record: GameRecord): number {
  return record.wins + record.losses + record.ties
}

export function addRecords(a: GameRecord, b: GameRecord): GameRecord {
  return { wins: a.wins + b.wins, losses: a.losses + b.losses, ties: a.ties + b.ties }
}

/**
 * Wilson score interval for `successes` out of `trials`, as fractions in [0, 1]. Unlike the normal approximation it
 * stays inside [0, 1] and is not degenerate at 0 % or 100 %, which matters with the small samples of own matches.
 */
export function wilsonInterval(successes: number, trials: number, z: number = Z_95): [number, number] {
  if (!Number.isInteger(trials) || trials <= 0) throw new RangeError(`trials must be a positive integer (${trials})`)
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) {
    throw new RangeError(`successes must be an integer in [0, ${trials}] (${successes})`)
  }
  const p = successes / trials
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (p + z2 / (2 * trials)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator
  // At p = 0 (p = 1) the lower (upper) bound is exactly 0 (1); the arithmetic leaves ~1e-16 of noise there.
  const lo = successes === 0 ? 0 : Math.max(0, center - half)
  const hi = successes === trials ? 1 : Math.min(1, center + half)
  return [lo, hi]
}

function assertRecord(record: GameRecord): void {
  for (const [field, value] of Object.entries(record)) {
    if (!Number.isInteger(value) || value < 0)
      throw new RangeError(`${field} must be a non-negative integer (${value})`)
  }
}

/** A rate from a W/L/T record, or null when there are no games (the UI says «sin datos», never «0 %»). */
export function winRate<S extends RateSource>(
  source: S,
  record: GameRecord,
  samples: number,
  sampleKind: SampleKind,
): WinRate<S> | null {
  assertRecord(record)
  const games = recordGames(record)
  if (games === 0) return null
  const [lo, hi] = wilsonInterval(record.wins, games)
  return {
    source,
    value: (record.wins / games) * 100,
    games,
    samples,
    sampleKind,
    ci95: [lo * 100, hi * 100],
    orientative: samples < ORIENTATIVE_BELOW,
  }
}

/** A cluster: what was counted (wins, lists of an archetype…) out of how many (games, lists of the tournament…). */
export interface Cluster {
  successes: number
  trials: number
}

/**
 * Variance of the ratio Σs/Σn when the observations come in clusters (cluster-robust, «sandwich»): k/(k−1) ·
 * Σ(sᵢ − p·nᵢ)² / (Σn)². Null with fewer than two clusters (no way to tell clusters apart).
 */
export function clusteredVariance(clusters: readonly Cluster[]): number | null {
  const used = clusters.filter((cluster) => cluster.trials > 0)
  const k = used.length
  if (k < 2) return null
  const total = used.reduce((sum, cluster) => sum + cluster.trials, 0)
  const p = used.reduce((sum, cluster) => sum + cluster.successes, 0) / total
  const spread = used.reduce((sum, cluster) => sum + (cluster.successes - p * cluster.trials) ** 2, 0)
  return ((k / (k - 1)) * spread) / (total * total)
}

/**
 * How much wider than independent games the clusters make the interval, as a variance ratio (≥ 1: never narrower,
 * the prudent side when by chance the clusters look more alike than independent games would).
 */
export function designEffect(clusters: readonly Cluster[]): number {
  const clustered = clusteredVariance(clusters)
  if (clustered === null) return 1
  const total = clusters.reduce((sum, cluster) => sum + Math.max(0, cluster.trials), 0)
  const p = clusters.reduce((sum, cluster) => sum + (cluster.trials > 0 ? cluster.successes : 0), 0) / total
  const binomial = (p * (1 - p)) / total
  if (binomial <= 0) return 1
  return Math.max(1, clustered / binomial)
}

/** Wilson score interval for a proportion p over n samples, n not necessarily whole (an effective sample size). */
export function wilsonFromRate(p: number, n: number, z: number = Z_95): [number, number] {
  if (!(n > 0)) return [0, 1]
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return [p <= 0 ? 0 : Math.max(0, center - half), p >= 1 ? 1 : Math.min(1, center + half)]
}

/**
 * H-011 (Fase 37): a tournament rate whose games come in clusters (a player plays 5 to 8 rounds with the same list):
 * the same value, but Wilson over the effective number of games (games ÷ design effect), so the interval — and the
 * lower bound that picks a deck's tournament version or the meta bank — is not narrower than the data allows.
 */
export function clusteredWinRate<S extends RateSource>(
  source: S,
  clusters: readonly GameRecord[],
  samples: number,
  sampleKind: SampleKind,
): WinRate<S> | null {
  let record: GameRecord = { ...EMPTY_RECORD }
  for (const cluster of clusters) record = addRecords(record, cluster)
  const rate = winRate(source, record, samples, sampleKind)
  if (!rate) return null
  const deff = designEffect(clusters.map((cluster) => ({ successes: cluster.wins, trials: recordGames(cluster) })))
  if (deff <= 1) return { ...rate, designEffect: 1 }
  const [lo, hi] = wilsonFromRate(record.wins / rate.games, rate.games / deff)
  return { ...rate, ci95: [lo * 100, hi * 100], designEffect: deff }
}

/** Own matches: one sample per match, so `samples = games`. */
export function matchWinRate(record: GameRecord): WinRate<'matches'> | null {
  return winRate('matches', record, recordGames(record), 'matches')
}

const percentFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const intervalFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('es-AR')

/** «70 %», «66,7 %»: at most one decimal. */
/**
 * The space before «%» does not break (phone review, 13/10/2026: «48⏎%» on a narrow line). The same one as
 * `Intl.NumberFormat('es-AR', { style: 'percent' })`.
 */
export const PERCENT_ES = '\u00a0%'

export function formatPercentEs(value: number): string {
  return `${percentFormat.format(value)}${PERCENT_ES}`
}

/** «39,7–89,2 %»: always one decimal (DECISIONES 0.10). */
export function formatIntervalEs([lo, hi]: readonly [number, number]): string {
  return `${intervalFormat.format(lo)}–${intervalFormat.format(hi)}${PERCENT_ES}`
}

/**
 * The canonical Spanish rendering, shared by the API, the MCP tools and the tests:
 * «70 % (n = 10, IC 39,7–89,2 %, orientativo)»; «sin datos» when there is no rate.
 */
export function formatWinRateEs(rate: WinRate | null): string {
  if (!rate) return 'sin datos'
  const parts = [`n = ${countFormat.format(rate.games)}`]
  if (rate.sampleKind === 'lists') parts[0] = `${parts[0]} en ${countFormat.format(rate.samples)} listas`
  parts.push(`IC\u00a0${formatIntervalEs(rate.ci95)}`)
  if (rate.orientative) parts.push('orientativo')
  return `${formatPercentEs(rate.value)} (${parts.join(', ')})`
}
