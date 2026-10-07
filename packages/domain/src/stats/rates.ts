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

/** Own matches: one sample per match, so `samples = games`. */
export function matchWinRate(record: GameRecord): WinRate<'matches'> | null {
  return winRate('matches', record, recordGames(record), 'matches')
}

const percentFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const intervalFormat = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const countFormat = new Intl.NumberFormat('es-AR')

/** «70 %», «66,7 %»: at most one decimal. */
export function formatPercentEs(value: number): string {
  return `${percentFormat.format(value)} %`
}

/** «39,7–89,2 %»: always one decimal (DECISIONES 0.10). */
export function formatIntervalEs([lo, hi]: readonly [number, number]): string {
  return `${intervalFormat.format(lo)}–${intervalFormat.format(hi)} %`
}

/**
 * The canonical Spanish rendering, shared by the API, the MCP tools and the tests:
 * «70 % (n = 10, IC 39,7–89,2 %, orientativo)»; «sin datos» when there is no rate.
 */
export function formatWinRateEs(rate: WinRate | null): string {
  if (!rate) return 'sin datos'
  const parts = [`n = ${countFormat.format(rate.games)}`]
  if (rate.sampleKind === 'lists') parts[0] = `${parts[0]} en ${countFormat.format(rate.samples)} listas`
  parts.push(`IC ${formatIntervalEs(rate.ci95)}`)
  if (rate.orientative) parts.push('orientativo')
  return `${formatPercentEs(rate.value)} (${parts.join(', ')})`
}
