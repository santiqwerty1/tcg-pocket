/**
 * Calibration of the simulations against tournaments (R-012, A4 of the optimization review): the lists of the meta
 * bank played against each other by a bot, pairing by pairing next to what the same archetypes did against each
 * other in tournaments. The two are never combined into one number: each keeps its own rate, n and interval, and the
 * report says how often the simulated rate falls inside the tournament's interval and how well the two orders agree
 * (Spearman). The bot is a parameter: the same report with e2 and with another bot says which one is closer.
 *
 * Both sides are rates per game without ties: tournaments are read per game (H-009, `matchupPerGame`: each match
 * length's match rate turned into a game rate, ties out), and the simulation's ties — the engine's 30-turn limit,
 * not something people play to — are left out too and counted apart.
 */
import { type GameRecord, ORIENTATIVE_BELOW, type WinRate, wilsonFromRate, Z_95 } from '../stats/rates.js'

/** Per game, as `matchupPerGame` gives it (wins and losses may be fractional: a BO3 read as games). */
export interface PerGameTally {
  wins: number
  losses: number
}

/** One pairing of the bank, from A's side: what the bots did, and what the archetypes did in tournaments. */
export interface CalibrationPairing {
  /** Archetype ids, as the tournaments name them. */
  a: string
  b: string
  labelA: string
  labelB: string
  simulated: GameRecord
  /** Null when the two archetypes never met in the era. */
  tournament: PerGameTally | null
}

export interface CalibrationRow {
  a: string
  b: string
  labelA: string
  labelB: string
  /** A's rate per game without ties; `ties` apart. */
  simulated: WinRate<'simulation'> | null
  ties: number
  tournament: WinRate<'tournament'> | null
  /** Simulated − tournament, in points; null without both. */
  difference: number | null
  /** Whether the simulated rate is inside the tournament's 95 % interval; null without both or with too few games. */
  inside: boolean | null
}

/** One archetype of the bank against the rest of it, weighted by the bank's shares. */
export interface CalibrationArchetype {
  id: string
  label: string
  /** Weighted mean of its simulated rates against the others (0–100). */
  simulated: number | null
  /** Weighted mean of its tournament rates against the others it met with enough games (0–100). */
  tournament: number | null
  /** Rivals with a tournament rate, of those in the bank. */
  rivalsWithData: number
}

export interface RankCorrelation {
  rho: number
  n: number
  /** Fisher z with the Fieller–Hartley–Pearson standard error 1.06/√(n − 3); null below 5 pairs. */
  ci95: [number, number] | null
}

export interface CalibrationReport {
  rows: CalibrationRow[]
  /** Pairings with both rates and at least `minTournamentGames` tournament games: what the summary is computed on. */
  compared: number
  inside: number
  /** Mean absolute difference (points) over the compared pairings. */
  meanAbsDifference: number | null
  /** Rank correlation of the simulated and tournament rates over the compared pairings. */
  rankCorrelation: RankCorrelation | null
  archetypes: CalibrationArchetype[]
  /** Rank correlation of the archetypes' weighted simulated and tournament rates. */
  archetypeCorrelation: RankCorrelation | null
  minTournamentGames: number
}

/** Below this many tournament games a pairing is shown but left out of the summary. */
export const CALIBRATION_MIN_TOURNAMENT_GAMES = 20

/** Ranks from 1, ties sharing the mean of the ranks they span. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value)
  const ranks = new Array<number>(values.length)
  let start = 0
  while (start < order.length) {
    let end = start
    while (end + 1 < order.length && order[end + 1]?.value === order[start]?.value) end++
    const rank = (start + end) / 2 + 1
    for (let k = start; k <= end; k++) ranks[order[k]?.index as number] = rank
    start = end + 1
  }
  return ranks
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / n
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx
    const dy = (ys[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

/** Spearman's rank correlation (Pearson's on average ranks, so ties are handled); null below 3 pairs or no spread. */
export function spearman(xs: readonly number[], ys: readonly number[]): RankCorrelation | null {
  if (xs.length !== ys.length) throw new RangeError('spearman: the two lists differ in length')
  const n = xs.length
  if (n < 3) return null
  const rho = pearson(averageRanks(xs), averageRanks(ys))
  if (rho === null) return null
  let ci95: [number, number] | null = null
  if (n >= 5) {
    const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, rho)))
    const se = 1.06 / Math.sqrt(n - 3)
    ci95 = [Math.tanh(z - Z_95 * se), Math.tanh(z + Z_95 * se)]
  }
  return { rho, n, ci95 }
}

/** A rate per game without ties, Wilson over the (possibly fractional) number of games. */
function perGameRate<S extends 'simulation' | 'tournament'>(source: S, tally: PerGameTally): WinRate<S> | null {
  const games = tally.wins + tally.losses
  if (!(games > 0)) return null
  const p = tally.wins / games
  const [lo, hi] = wilsonFromRate(p, games)
  const samples = Math.round(games)
  return {
    source,
    value: p * 100,
    games: samples,
    samples,
    sampleKind: source === 'simulation' ? 'simulations' : 'matches',
    ci95: [lo * 100, hi * 100],
    orientative: samples < ORIENTATIVE_BELOW,
  }
}

const flipTally = (tally: PerGameTally): PerGameTally => ({ wins: tally.losses, losses: tally.wins })

/**
 * The report for one simulation of the bank. `shares` weighs each archetype in the per-archetype contrast (the
 * bank's shares of the meta). Each pairing goes from A's side, once per unordered pair (as a matrix of the bank plays
 * them); the per-archetype contrast reads every one from both sides.
 */
export function calibrationReport(
  pairings: readonly CalibrationPairing[],
  options: { shares?: ReadonlyMap<string, number>; minTournamentGames?: number } = {},
): CalibrationReport {
  const minTournamentGames = options.minTournamentGames ?? CALIBRATION_MIN_TOURNAMENT_GAMES
  const rows: CalibrationRow[] = pairings.map((pairing) => {
    const simulated = perGameRate('simulation', pairing.simulated)
    const tournament = pairing.tournament ? perGameRate('tournament', pairing.tournament) : null
    const both = simulated !== null && tournament !== null
    const enough = both && tournament.games >= minTournamentGames
    return {
      a: pairing.a,
      b: pairing.b,
      labelA: pairing.labelA,
      labelB: pairing.labelB,
      simulated,
      ties: pairing.simulated.ties,
      tournament,
      difference: both ? simulated.value - tournament.value : null,
      inside: enough ? simulated.value >= tournament.ci95[0] && simulated.value <= tournament.ci95[1] : null,
    }
  })
  const compared = rows.filter(
    (row): row is CalibrationRow & { simulated: WinRate<'simulation'>; tournament: WinRate<'tournament'> } =>
      row.inside !== null,
  )
  const archetypes = archetypeContrast(pairings, options.shares ?? new Map(), minTournamentGames)
  const withBoth = archetypes.filter((row) => row.simulated !== null && row.tournament !== null)
  return {
    rows,
    compared: compared.length,
    inside: compared.filter((row) => row.inside).length,
    meanAbsDifference:
      compared.length > 0
        ? compared.reduce((sum, row) => sum + Math.abs(row.simulated.value - row.tournament.value), 0) / compared.length
        : null,
    rankCorrelation: spearman(
      compared.map((row) => row.simulated.value),
      compared.map((row) => row.tournament.value),
    ),
    archetypes,
    archetypeCorrelation: spearman(
      withBoth.map((row) => row.simulated as number),
      withBoth.map((row) => row.tournament as number),
    ),
    minTournamentGames,
  }
}

function archetypeContrast(
  pairings: readonly CalibrationPairing[],
  shares: ReadonlyMap<string, number>,
  minTournamentGames: number,
): CalibrationArchetype[] {
  // Every pairing seen from both sides (B's wins are A's losses), so each archetype has its rate against every other.
  const views = new Map<string, { label: string; against: Map<string, { sim: number | null; tour: number | null }> }>()
  const rate = (tally: PerGameTally | null, minimum: number) =>
    tally && tally.wins + tally.losses >= minimum ? (tally.wins / (tally.wins + tally.losses)) * 100 : null
  const add = (id: string, label: string, rival: string, sim: PerGameTally, tour: PerGameTally | null) => {
    const entry = views.get(id) ?? { label, against: new Map() }
    if (!entry.against.has(rival)) entry.against.set(rival, { sim: rate(sim, 1), tour: rate(tour, minTournamentGames) })
    views.set(id, entry)
  }
  for (const pairing of pairings) {
    const sim = { wins: pairing.simulated.wins, losses: pairing.simulated.losses }
    add(pairing.a, pairing.labelA, pairing.b, sim, pairing.tournament)
    add(pairing.b, pairing.labelB, pairing.a, flipTally(sim), pairing.tournament && flipTally(pairing.tournament))
  }
  const weight = (id: string) => shares.get(id) ?? 1
  const mean = (values: [number, number][]) => {
    const total = values.reduce((sum, [, w]) => sum + w, 0)
    return total > 0 ? values.reduce((sum, [value, w]) => sum + value * w, 0) / total : null
  }
  return [...views].map(([id, entry]) => {
    const rivals = [...entry.against]
    const weighted = (pick: 'sim' | 'tour') =>
      rivals.flatMap(([rival, rates]) => {
        const value = rates[pick]
        return value === null ? [] : [[value, weight(rival)] as [number, number]]
      })
    const tour = weighted('tour')
    return {
      id,
      label: entry.label,
      simulated: mean(weighted('sim')),
      tournament: mean(tour),
      rivalsWithData: tour.length,
    }
  })
}
