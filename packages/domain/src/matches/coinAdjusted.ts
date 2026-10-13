/**
 * Fase 44: the win share adjusted by the coin (T-014). The coin decides who starts, so over many matches half are
 * played going first and half going second; a deck noted more often going first than second looks better (or worse)
 * than it is. The adjusted share weighs each side by half: ½ · (share going first) + ½ · (share going second).
 *
 * The interval is Agresti–Caffo's for a sum of two proportions (one win and one loss added to each side): it behaves
 * with the few matches a side of own matches has. Ties count as games not won, as in `turnOrderImpact`. Only matches
 * with who went first noted enter.
 */
import {
  EMPTY_RECORD,
  formatIntervalEs,
  formatPercentEs,
  type GameRecord,
  ORIENTATIVE_BELOW,
  recordGames,
  Z_95,
} from '../stats/rates.js'
import type { MatchFacts } from './types.js'

export interface CoinAdjustedRate {
  /** ½ · firstShare + ½ · secondShare, 0–100. */
  value: number
  ci95: [number, number]
  first: GameRecord
  second: GameRecord
  firstShare: number
  secondShare: number
  /** Matches with who went first noted, and without. */
  games: number
  unknown: number
  /**
   * The halves weigh the same, so the sides' sizes matter, not their sum: orientative when the equivalent sample
   * 4 / (1/n₁ + 1/n₂) is under 30 or a side has fewer than `COIN_MIN_SIDE` matches.
   */
  orientative: boolean
  /** The plain share of those same matches, to compare. */
  plain: number
  text: string
}

type Fact = Pick<MatchFacts, 'result' | 'wentFirst'>

function add(record: GameRecord, result: Fact['result']): GameRecord {
  return {
    wins: record.wins + (result === 'win' ? 1 : 0),
    losses: record.losses + (result === 'loss' ? 1 : 0),
    ties: record.ties + (result === 'tie' ? 1 : 0),
  }
}

/** Matches on a side below which the adjusted share is orientative whatever the other side has. */
export const COIN_MIN_SIDE = 15

/** Null until there is at least one match going first and one going second. */
export function coinAdjustedRate(matches: readonly Fact[]): CoinAdjustedRate | null {
  let first = EMPTY_RECORD
  let second = EMPTY_RECORD
  let unknown = 0
  for (const match of matches) {
    if (match.wentFirst === null) unknown += 1
    else if (match.wentFirst) first = add(first, match.result)
    else second = add(second, match.result)
  }
  const n1 = recordGames(first)
  const n2 = recordGames(second)
  if (n1 === 0 || n2 === 0) return null
  const p1 = first.wins / n1
  const p2 = second.wins / n2
  const value = ((p1 + p2) / 2) * 100
  // Agresti–Caffo: the center and the spread from the shares with one win and one loss more on each side.
  const a1 = (first.wins + 1) / (n1 + 2)
  const a2 = (second.wins + 1) / (n2 + 2)
  const center = (a1 + a2) / 2
  const se = Math.sqrt((a1 * (1 - a1)) / (n1 + 2) + (a2 * (1 - a2)) / (n2 + 2)) / 2
  const low = Math.max(0, Math.min(center - Z_95 * se, value / 100)) * 100
  const high = Math.min(1, Math.max(center + Z_95 * se, value / 100)) * 100
  const games = n1 + n2
  const orientative = 4 / (1 / n1 + 1 / n2) < ORIENTATIVE_BELOW || Math.min(n1, n2) < COIN_MIN_SIDE
  const plain = ((first.wins + second.wins) / games) * 100
  return {
    value,
    ci95: [low, high],
    first,
    second,
    firstShare: p1 * 100,
    secondShare: p2 * 100,
    games,
    unknown,
    orientative,
    plain,
    text:
      `Ajustado por la moneda: ${formatPercentEs(value)} (n = ${games}, IC\u00a0${formatIntervalEs([low, high])}` +
      `${orientative ? ', orientativo' : ''}): mitad empezando (${formatPercentEs(p1 * 100)} en ${n1}) y mitad ` +
      `yendo segundo (${formatPercentEs(p2 * 100)} en ${n2}). Sin ajustar: ${formatPercentEs(plain)}.`,
  }
}
