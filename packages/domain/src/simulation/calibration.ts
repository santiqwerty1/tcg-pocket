/**
 * Calibration of the simulations against tournaments (R-012, A4 of the optimization review): the lists of the meta
 * bank played against each other by a bot, pairing by pairing next to what the same archetypes did against each
 * other in tournaments. The two are never combined into one number: each keeps its own rate, n and interval, and the
 * report says how often the two are compatible, by how much they differ and how well the two orders agree
 * (Spearman). The bot is a parameter: the same report with e2 and with another bot says which one is closer.
 *
 * Both sides are rates per game without ties: tournaments are read per game (H-009, `matchupPerGame`: each match
 * length's match rate turned into a game rate, ties out), and the simulation's ties — the engine's 30-turn limit,
 * not something people play to — are left out too and counted apart. Tournament games are taken as independent,
 * as `matchupPerGame` gives them; a player's rounds with one list are not, so the tournament intervals are, if
 * anything, a little narrow.
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
  /** 95 % interval of the difference, with the error of both sides. */
  differenceCi95: [number, number] | null
  /**
   * Whether the two are compatible: the difference's interval holds 0 (|sim − tour| ≤ 1,96 · √(se_sim² + se_tour²)).
   * Null without both, or with fewer tournament games than the report's minimum.
   */
  compatible: boolean | null
}

/** A weighted mean of rates (0–100) with its interval (delta method over the rates it averages). */
export interface WeightedRate {
  value: number
  ci95: [number, number]
  /** Games behind it (per game, the tournament side may be fractional: rounded). */
  games: number
  orientative: boolean
}

/** One archetype of the bank against the rest of it, both sides over the same rivals, weighted by their shares. */
export interface CalibrationArchetype {
  id: string
  label: string
  /** Over the rivals it met in tournaments with enough games, and only those (the same set on both sides). */
  simulated: WeightedRate | null
  tournament: WeightedRate | null
  /** Rivals of the bank in both means. */
  rivals: number
}

export interface RankCorrelation {
  rho: number
  /** Points the correlation is computed on. */
  n: number
  ci95: [number, number] | null
  /** How the interval was made: Fisher z (independent points) or a bootstrap over archetypes (pairings share them). */
  method: 'fisher' | 'bootstrap'
}

export interface CalibrationReport {
  rows: CalibrationRow[]
  /** Pairings with both rates and at least `minTournamentGames` tournament games: what the summary is computed on. */
  compared: number
  compatible: number
  /** Mean absolute difference (points) over the compared pairings. */
  meanAbsDifference: number | null
  /** Rank correlation of the simulated and tournament rates over the compared pairings, both ways of each. */
  rankCorrelation: RankCorrelation | null
  archetypes: CalibrationArchetype[]
  /** Rank correlation of the archetypes' simulated and tournament means. */
  archetypeCorrelation: RankCorrelation | null
  minTournamentGames: number
}

/** Below this many tournament games a pairing is shown but left out of the summary. */
export const CALIBRATION_MIN_TOURNAMENT_GAMES = 20

/** Resamples of the bootstrap over archetypes. */
const BOOTSTRAP_SAMPLES = 1000

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

/**
 * Spearman's rank correlation (Pearson's on average ranks, so ties are handled); null below 3 pairs or no spread.
 * The interval is Fisher's z with the Fieller–Hartley–Pearson standard error 1,06/√(n − 3), for independent points.
 */
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
  return { rho, n, ci95, method: 'fisher' }
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

/**
 * Standard error of a rate per game, in points. With p shrunk to (W + 1)/(n + 2) so that 0 % or 100 % over a few
 * games does not claim no error at all.
 */
function standardError(tally: PerGameTally): number {
  const games = tally.wins + tally.losses
  const p = (tally.wins + 1) / (games + 2)
  return Math.sqrt((p * (1 - p)) / games) * 100
}

const simTally = (record: GameRecord): PerGameTally => ({ wins: record.wins, losses: record.losses })
const flip = (tally: PerGameTally): PerGameTally => ({ wins: tally.losses, losses: tally.wins })
const games = (tally: PerGameTally) => tally.wins + tally.losses

/** The pairings the summary is computed on: both rates, and enough tournament games. */
function isCompared(
  pairing: CalibrationPairing,
  minimum: number,
): pairing is CalibrationPairing & {
  tournament: PerGameTally
} {
  return pairing.tournament !== null && games(pairing.tournament) >= minimum && games(simTally(pairing.simulated)) > 0
}

/**
 * The report for one simulation of the bank. `shares` weighs each rival in the per-archetype means (the bank's
 * shares of the meta). Each pairing goes from A's side, once per unordered pair (as a matrix of the bank plays them);
 * the correlation and the per-archetype means read every one from both sides.
 */
export function calibrationReport(
  pairings: readonly CalibrationPairing[],
  options: { shares?: ReadonlyMap<string, number>; minTournamentGames?: number } = {},
): CalibrationReport {
  const minTournamentGames = options.minTournamentGames ?? CALIBRATION_MIN_TOURNAMENT_GAMES
  const rows: CalibrationRow[] = pairings.map((pairing) => {
    const sim = simTally(pairing.simulated)
    const simulated = perGameRate('simulation', sim)
    const tournament = pairing.tournament ? perGameRate('tournament', pairing.tournament) : null
    const both = simulated !== null && tournament !== null && pairing.tournament !== null
    const difference = both ? simulated.value - tournament.value : null
    const se = both ? Math.hypot(standardError(sim), standardError(pairing.tournament as PerGameTally)) : null
    // A difference of two rates lies in ±100 points; with few games the normal approximation would step out of it.
    const differenceCi95: [number, number] | null =
      difference !== null && se !== null
        ? [Math.max(-100, difference - Z_95 * se), Math.min(100, difference + Z_95 * se)]
        : null
    return {
      a: pairing.a,
      b: pairing.b,
      labelA: pairing.labelA,
      labelB: pairing.labelB,
      simulated,
      ties: pairing.simulated.ties,
      tournament,
      difference,
      differenceCi95,
      compatible:
        differenceCi95 && isCompared(pairing, minTournamentGames)
          ? differenceCi95[0] <= 0 && differenceCi95[1] >= 0
          : null,
    }
  })
  const compared = pairings.filter((pairing) => isCompared(pairing, minTournamentGames))
  const comparedRows = rows.filter((row) => row.compatible !== null)
  const shares = options.shares ?? new Map<string, number>()
  const archetypes = archetypeContrast(compared, pairings, shares)
  return {
    rows,
    compared: comparedRows.length,
    compatible: comparedRows.filter((row) => row.compatible).length,
    meanAbsDifference:
      comparedRows.length > 0
        ? comparedRows.reduce((sum, row) => sum + Math.abs(row.difference as number), 0) / comparedRows.length
        : null,
    rankCorrelation: pairingCorrelation(compared),
    archetypes,
    archetypeCorrelation: archetypeCorrelation(compared, archetypes, shares),
    minTournamentGames,
  }
}

/** Every compared pairing as two points, A's side and B's (per game without ties, B's rate is 100 − A's). */
function bothWays(pairings: readonly (CalibrationPairing & { tournament: PerGameTally })[]): [number, number][] {
  return pairings.flatMap((pairing) => {
    const sim = simTally(pairing.simulated)
    const rate = (tally: PerGameTally) => (tally.wins / games(tally)) * 100
    return [
      [rate(sim), rate(pairing.tournament)],
      [rate(flip(sim)), rate(flip(pairing.tournament))],
    ] as [number, number][]
  })
}

/** A seeded generator (mulberry32): the same report gives the same interval every time. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Compared = CalibrationPairing & { tournament: PerGameTally }

/** Spearman of the simulated against the tournament rate over the compared pairings, both ways of each. */
const pairingRho = (pairings: readonly Compared[]) => {
  const points = bothWays(pairings)
  return spearman(
    points.map(([sim]) => sim),
    points.map(([, tour]) => tour),
  )
}

/** Spearman of the archetypes' two means, each archetype counted as many times as it was drawn. */
function archetypeRho(rows: readonly CalibrationArchetype[], draws: ReadonlyMap<string, number> | null) {
  const points = rows.flatMap((row) =>
    row.simulated && row.tournament
      ? Array.from({ length: draws?.get(row.id) ?? 1 }, () => [row.simulated?.value, row.tournament?.value])
      : [],
  ) as [number, number][]
  return spearman(
    points.map(([sim]) => sim),
    points.map(([, tour]) => tour),
  )
}

/**
 * A 95 % interval by a bootstrap over archetypes: each sample draws the archetypes with replacement and keeps the
 * compared pairings among the drawn ones (one per pair of draws), so the pairings that share an archetype move
 * together. Fisher's interval would treat them as independent and come out too narrow. Seeded: the same report, the
 * same interval.
 */
function bootstrapOverArchetypes(
  compared: readonly Compared[],
  statistic: (pairings: Compared[], draws: Map<string, number>) => number | undefined,
): [number, number] | null {
  const ids = [...new Set(compared.flatMap((pairing) => [pairing.a, pairing.b]))]
  const byPair = new Map(compared.map((pairing) => [[pairing.a, pairing.b].sort().join('|'), pairing]))
  const next = random(20261009)
  const values: number[] = []
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample++) {
    const picked = ids.map(() => ids[Math.floor(next() * ids.length)] as string)
    const draws = new Map<string, number>()
    for (const id of picked) draws.set(id, (draws.get(id) ?? 0) + 1)
    const chosen: Compared[] = []
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) {
        const pairing = byPair.get([picked[i], picked[j]].sort().join('|'))
        if (pairing && picked[i] !== picked[j]) chosen.push(pairing)
      }
    }
    const value = statistic(chosen, draws)
    if (value !== undefined) values.push(value)
  }
  values.sort((x, y) => x - y)
  return values.length >= BOOTSTRAP_SAMPLES / 2
    ? [values[Math.floor(values.length * 0.025)] as number, values[Math.ceil(values.length * 0.975) - 1] as number]
    : null
}

/**
 * Spearman over the compared pairings both ways (so it does not depend on which side each pairing was played from),
 * with the bootstrap over archetypes for its interval.
 */
function pairingCorrelation(compared: readonly Compared[]): RankCorrelation | null {
  const point = pairingRho(compared)
  if (!point) return null
  const ci95 = bootstrapOverArchetypes(compared, (chosen) => pairingRho(chosen)?.rho)
  return { rho: point.rho, n: point.n, ci95, method: 'bootstrap' }
}

/**
 * Spearman of the archetypes' simulated and tournament means. Its points share pairings too (each pairing is in two
 * archetypes' means), so the interval is the same bootstrap, with the means made again from the drawn pairings.
 */
function archetypeCorrelation(
  compared: readonly Compared[],
  archetypes: readonly CalibrationArchetype[],
  shares: ReadonlyMap<string, number>,
): RankCorrelation | null {
  const point = archetypeRho(archetypes, null)
  if (!point) return null
  const ci95 =
    point.n >= 5
      ? bootstrapOverArchetypes(
          compared,
          (chosen, draws) => archetypeRho(archetypeContrast(chosen, chosen, shares), draws)?.rho,
        )
      : null
  return { rho: point.rho, n: point.n, ci95, method: 'bootstrap' }
}

function weightedRate(
  terms: readonly { rate: number; se: number; weight: number; games: number }[],
): WeightedRate | null {
  const total = terms.reduce((sum, term) => sum + term.weight, 0)
  if (terms.length === 0 || !(total > 0)) return null
  const value = terms.reduce((sum, term) => sum + term.rate * term.weight, 0) / total
  const sd = Math.sqrt(terms.reduce((sum, term) => sum + (term.weight / total) ** 2 * term.se ** 2, 0))
  const gamesBehind = Math.round(terms.reduce((sum, term) => sum + term.games, 0))
  return {
    value,
    ci95: [Math.max(0, value - Z_95 * sd), Math.min(100, value + Z_95 * sd)],
    games: gamesBehind,
    orientative: gamesBehind < ORIENTATIVE_BELOW,
  }
}

/**
 * Each archetype against the rest of the bank: both means over the same rivals — those it met in tournaments with
 * enough games — so the two columns are comparable; an archetype with none of them has neither.
 */
function archetypeContrast(
  compared: readonly (CalibrationPairing & { tournament: PerGameTally })[],
  all: readonly CalibrationPairing[],
  shares: ReadonlyMap<string, number>,
): CalibrationArchetype[] {
  const labels = new Map<string, string>()
  for (const pairing of all) {
    labels.set(pairing.a, pairing.labelA)
    labels.set(pairing.b, pairing.labelB)
  }
  const terms = new Map<string, { sim: PerGameTally; tour: PerGameTally; rival: string }[]>()
  const add = (id: string, rival: string, sim: PerGameTally, tour: PerGameTally) => {
    const list = terms.get(id) ?? []
    list.push({ sim, tour, rival })
    terms.set(id, list)
  }
  for (const pairing of compared) {
    const sim = simTally(pairing.simulated)
    add(pairing.a, pairing.b, sim, pairing.tournament)
    add(pairing.b, pairing.a, flip(sim), flip(pairing.tournament))
  }
  const weight = (id: string) => shares.get(id) ?? 1
  const side = (list: { sim: PerGameTally; tour: PerGameTally; rival: string }[], pick: 'sim' | 'tour') =>
    weightedRate(
      list.map((term) => ({
        rate: (term[pick].wins / games(term[pick])) * 100,
        se: standardError(term[pick]),
        weight: weight(term.rival),
        games: games(term[pick]),
      })),
    )
  return [...labels].map(([id, label]) => {
    const list = terms.get(id) ?? []
    return { id, label, simulated: side(list, 'sim'), tournament: side(list, 'tour'), rivals: list.length }
  })
}

/**
 * One archetype pairing from the pairings of its lists (R-012): the bank may bring two lists of an archetype, and
 * tournaments have one matchup for the two. The rate is the mixture of the lists' rates weighted by each list's part
 * (`weight`); the record is scaled to the games that give the mixture's error (delta method, with each rate shrunk as
 * in the differences), so Wilson and the comparison read it as one pairing. Ties are added up: they are shown, not
 * compared. With one list, its record as it is.
 */
export function mixListRecords(parts: readonly { record: GameRecord; weight: number }[]): GameRecord | null {
  const played = parts.filter((part) => part.record.wins + part.record.losses > 0)
  const ties = parts.reduce((sum, part) => sum + part.record.ties, 0)
  if (played.length === 0) return null
  if (played.length === 1) return { ...(played[0] as { record: GameRecord }).record, ties }
  const total = played.reduce((sum, part) => sum + part.weight, 0)
  const share = (part: { weight: number }) => (total > 0 ? part.weight / total : 1 / played.length)
  let rate = 0
  let shrunk = 0
  let variance = 0
  for (const part of played) {
    const n = part.record.wins + part.record.losses
    const q = (part.record.wins + 1) / (n + 2)
    rate += share(part) * (part.record.wins / n)
    shrunk += share(part) * q
    variance += share(part) ** 2 * ((q * (1 - q)) / n)
  }
  const games =
    variance > 0
      ? (shrunk * (1 - shrunk)) / variance
      : played.reduce((sum, p) => sum + p.record.wins + p.record.losses, 0)
  return { wins: rate * games, losses: (1 - rate) * games, ties }
}
