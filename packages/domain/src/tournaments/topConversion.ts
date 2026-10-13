/**
 * Fase 44: conversión al top (T-014). Of an archetype's lists, how many reached the top 8 of their tournament,
 * against how many it should have placed there: a popular archetype fills the top because it is popular; one that
 * converts well gets there more often than its lists say.
 *
 * The expectation is per tournament (revisión del PR #17): the chance of a top 8 goes from 25 % in a tournament of 32
 * to under 2 % in one of 484, so each list expects the rate of the rest of the field in its own tournament. Observed
 * and expected count the same population, the published lists (second review of #17): measured against every player,
 * a tournament that publishes its top and only some of the rest makes any archetype look better than it is.
 * Tournaments whose lists say little about the field are left out and counted: fewer than 90 % of their players
 * published, not all of their top, or only lists of the archetype (no rest of the field to expect from).
 *
 * The ratio is the Mantel–Haenszel risk ratio over the tournaments, with the Greenland–Robins variance of its log
 * (the archetype has few lists in each tournament: sparse strata). It weighs each tournament by the rest's share of
 * it, so it equals top lists / expected only when the archetype's share is the same everywhere; the text calls it
 * «razón ajustada por torneo», never observed over expected (Codex on #17: 0,4× against 0,7 with shares of 90 and 10 %).
 * With no list in the top, the ratio is 0 and its upper bound is the exact Poisson one, −ln 0,025 / expected.
 *
 * The top is the first 8 places (the cut Limitless shows and `recentLists` uses): the real bracket is not in the
 * dataset, and Limitless's `phases` do not say its size reliably. Only tournaments of 32 players or more count.
 * Lists without a placing (drops) did not reach it.
 */
import { PERCENT_ES, wilsonInterval, Z_95 } from '../stats/rates.js'
import type { TournamentDataset } from './dataset.js'

export const TOP_CUT_PLACES = 8
export const TOP_CUT_MIN_PLAYERS = 32
/** Share of a tournament's players with a published list below which it is left out. */
export const TOP_CUT_MIN_COVERAGE = 0.9
/** Lists of the archetype below which the conversion is «orientativa». */
export const TOP_CUT_ORIENTATIVE_BELOW = 30
/** Upper 95 % bound (two-sided, exact Poisson) of a count observed as 0. */
const ZERO_COUNT_UPPER = -Math.log(0.025)

export interface TopConversion {
  top: number
  minPlayers: number
  minCoverage: number
  /** Tournaments of `minPlayers` or more, with enough published, where the archetype has a list. */
  tournaments: number
  /** The archetype's lists in those tournaments, and how many reached the top. */
  lists: number
  topLists: number
  /** Share (0–100) of its lists that reached the top, with its Wilson interval; null when no list counts. */
  rate: number | null
  ci95: [number, number] | null
  /** Top lists it should have had: Σ over its lists of the rest of the field's top rate in that tournament. */
  expected: number
  /** expected / lists × 100: the share its lists should have reached, given where they played. */
  baseline: number | null
  /** Mantel–Haenszel ratio (1 = as expected), with its interval; null when the rest never reached the top. */
  ratio: number | null
  ratioCi95: [number, number] | null
  /** Tournaments with a list of the archetype left out (too little published, or no rest of the field), and its lists. */
  excluded: { tournaments: number; lists: number }
  orientative: boolean
  text: string
}

interface Stratum {
  /** Players, published lists, published lists in the top, the archetype's lists and those in the top. */
  players: number
  lists: number
  top: number
  mine: number
  mineTop: number
}

const percent = (value: number) => `${Math.round(value).toLocaleString('es-AR')}${PERCENT_ES}`
const decimal = (value: number) => value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`

/**
 * Mantel–Haenszel risk ratio of reaching the top (the archetype against the rest), with the Greenland–Robins variance
 * of its log. Tournaments where the archetype is the whole field say nothing and weigh 0.
 */
function mantelHaenszel(strata: readonly Stratum[]): { ratio: number; logVariance: number } | null {
  let r = 0
  let s = 0
  let p = 0
  for (const { lists: n, top, mine: n1, mineTop: a } of strata) {
    const n0 = n - n1
    const c = top - a
    r += (a * n0) / n
    s += (c * n1) / n
    p += (n1 * n0 * top - a * c * n) / (n * n)
  }
  if (s === 0) return null
  return { ratio: r / s, logVariance: r > 0 ? p / (r * s) : Number.POSITIVE_INFINITY }
}

/**
 * Null when the archetype has no list in a tournament big enough. `archetypeId` null = lists without archetype.
 * `minCoverage` 0 counts every tournament, however little it published.
 */
export function topConversion(
  dataset: TournamentDataset,
  archetypeId: string | null,
  options: { top?: number; minPlayers?: number; minCoverage?: number } = {},
): TopConversion | null {
  const top = options.top ?? TOP_CUT_PLACES
  const minPlayers = options.minPlayers ?? TOP_CUT_MIN_PLAYERS
  const minCoverage = options.minCoverage ?? TOP_CUT_MIN_COVERAGE
  const byTournament = new Map<string, Stratum>()
  for (const tournament of dataset.tournaments) {
    if (tournament.players >= minPlayers) {
      byTournament.set(tournament.id, { players: tournament.players, lists: 0, top: 0, mine: 0, mineTop: 0 })
    }
  }
  for (const entry of dataset.entries) {
    const row = byTournament.get(entry.tournamentId)
    if (!row) continue
    const inTop = entry.placing !== null && entry.placing <= top
    row.lists += 1
    if (inTop) row.top += 1
    if (entry.archetypeId !== archetypeId) continue
    row.mine += 1
    if (inTop) row.mineTop += 1
  }
  const strata: Stratum[] = []
  const excluded = { tournaments: 0, lists: 0 }
  for (const row of byTournament.values()) {
    if (row.mine === 0) continue
    const players = Math.max(row.players, row.lists)
    const covered = minCoverage === 0 || (row.lists >= minCoverage * players && row.top >= Math.min(top, players))
    // Every published list the archetype's: no rest of the field to expect from (Codex on #17).
    if (covered && row.lists > row.mine) {
      strata.push(row)
    } else {
      excluded.tournaments += 1
      excluded.lists += row.mine
    }
  }
  if (strata.length === 0 && excluded.tournaments === 0) return null

  let lists = 0
  let topLists = 0
  let expected = 0
  for (const row of strata) {
    lists += row.mine
    topLists += row.mineTop
    // The rest of the field's published lists in this tournament (never empty: those tournaments are left out).
    expected += (row.mine * (row.top - row.mineTop)) / (row.lists - row.mine)
  }
  const orientative = lists < TOP_CUT_ORIENTATIVE_BELOW
  const leftOut =
    excluded.tournaments === 0
      ? ''
      : ` Quedan afuera ${plural(excluded.tournaments, 'torneo', 'torneos')} con ${plural(excluded.lists, 'lista', 'listas')} ` +
        `del arquetipo: publicaron menos del ${percent(minCoverage * 100)} de las listas, no todo el top ${top} o solo listas del arquetipo.`
  if (lists === 0) {
    return {
      top,
      minPlayers,
      minCoverage,
      tournaments: 0,
      lists: 0,
      topLists: 0,
      rate: null,
      ci95: null,
      expected: 0,
      baseline: null,
      ratio: null,
      ratioCi95: null,
      excluded,
      orientative: true,
      text: `Ninguna lista cuenta para la llegada al top ${top}.${leftOut}`,
    }
  }

  const [low, high] = wilsonInterval(topLists, lists)
  const rate = (topLists / lists) * 100
  const mh = mantelHaenszel(strata)
  let ratio: number | null = null
  let ratioCi95: [number, number] | null = null
  if (mh && mh.ratio === 0) {
    ratio = 0
    ratioCi95 = [0, ZERO_COUNT_UPPER / expected]
  } else if (mh) {
    const spread = Math.exp(Z_95 * Math.sqrt(mh.logVariance))
    ratio = mh.ratio
    ratioCi95 = [mh.ratio / spread, mh.ratio * spread]
  }
  const ci = `IC\u00a0${Math.round(low * 100).toLocaleString('es-AR')}–${percent(high * 100)}`
  const verdict =
    ratioCi95 === null
      ? ''
      : ratioCi95[0] > 1
        ? ' Llega más de lo esperado.'
        : ratioCi95[1] < 1
          ? ' Llega menos de lo esperado.'
          : ' No se distingue de lo esperado.'
  return {
    top,
    minPlayers,
    minCoverage,
    tournaments: strata.length,
    lists,
    topLists,
    rate,
    ci95: [low * 100, high * 100],
    expected,
    baseline: (expected / lists) * 100,
    ratio,
    ratioCi95,
    excluded,
    orientative,
    text:
      `${topLists} de ${lists} listas llegaron al top ${top} (${percent(rate)}, ${ci}${orientative ? ', orientativo' : ''}); ` +
      `en sus torneos, al ritmo del resto del campo, se esperaban ${decimal(expected)}` +
      (ratio === null || ratioCi95 === null
        ? '.'
        : `; razón ajustada por torneo: ${decimal(ratio)}× (IC\u00a0${decimal(ratioCi95[0])}–${decimal(ratioCi95[1])}).`) +
      verdict +
      leftOut,
  }
}
