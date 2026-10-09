/**
 * ¿Importa empezar? (Fase 25): own matches going first against going second — the win share of each side, the gap
 * and a two-proportion z test (the one of «meta semanal») to tell a real difference from chance; and the same split
 * against each rival. Ties count as games that were not won. Only matches with who went first noted enter.
 */
import { EMPTY_RECORD, type GameRecord, recordGames } from '../stats/rates.js'
import { opponentKey } from './opponents.js'
import type { MatchFacts } from './types.js'

/** Matches per side below which nothing is said. */
export const TURN_ORDER_MIN = 5
/** |z| from which the gap is «more than chance» (95 %). */
export const TURN_ORDER_CLEAR_Z = 1.96

export type TurnOrderVerdict = 'few' | 'clear' | 'maybe'

export interface TurnOrderImpact {
  first: GameRecord
  second: GameRecord
  /** Matches without who went first. */
  unknown: number
  /** Share (0–100) of the matches with who went first noted. */
  coverage: number
  /** Win share (0–100) of each side; null without games. */
  firstShare: number | null
  secondShare: number | null
  /** firstShare − secondShare, in points. */
  gap: number | null
  z: number | null
  verdict: TurnOrderVerdict
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

function split(matches: readonly Fact[]): { first: GameRecord; second: GameRecord; unknown: number } {
  let first = EMPTY_RECORD
  let second = EMPTY_RECORD
  let unknown = 0
  for (const match of matches) {
    if (match.wentFirst === null) unknown += 1
    else if (match.wentFirst) first = add(first, match.result)
    else second = add(second, match.result)
  }
  return { first, second, unknown }
}

const share = (record: GameRecord) => {
  const games = recordGames(record)
  return games === 0 ? null : (record.wins / games) * 100
}
const pct = (value: number) => `${Math.round(value)} %`

export function turnOrderImpact(matches: readonly Fact[]): TurnOrderImpact {
  const { first, second, unknown } = split(matches)
  const n1 = recordGames(first)
  const n2 = recordGames(second)
  const total = matches.length
  const coverage = total === 0 ? 0 : ((n1 + n2) / total) * 100
  const firstShare = share(first)
  const secondShare = share(second)
  if (n1 < TURN_ORDER_MIN || n2 < TURN_ORDER_MIN || firstShare === null || secondShare === null) {
    return {
      first,
      second,
      unknown,
      coverage,
      firstShare,
      secondShare,
      gap: firstShare !== null && secondShare !== null ? firstShare - secondShare : null,
      z: null,
      verdict: 'few',
      text: `Todavía no alcanza: hacen falta ${TURN_ORDER_MIN} partidas empezando y ${TURN_ORDER_MIN} yendo segundo con el dato anotado (tenés ${n1} y ${n2}).`,
    }
  }
  const p1 = first.wins / n1
  const p2 = second.wins / n2
  const pooled = (first.wins + second.wins) / (n1 + n2)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
  const z = se === 0 ? 0 : (p1 - p2) / se
  const gap = (p1 - p2) * 100
  const clear = Math.abs(z) >= TURN_ORDER_CLEAR_Z
  const better = gap >= 0 ? 'empezando' : 'yendo segundo'
  const points = Math.round(Math.abs(gap))
  return {
    first,
    second,
    unknown,
    coverage,
    firstShare,
    secondShare,
    gap,
    z,
    verdict: clear ? 'clear' : 'maybe',
    text:
      `Empezando ganás el ${pct(firstShare)} (n = ${n1}) y yendo segundo el ${pct(secondShare)} (n = ${n2}): ` +
      (points === 0
        ? 'lo mismo.'
        : clear
          ? `${points} puntos más ${better}, más de lo que explica el azar.`
          : `${points} puntos más ${better}, pero puede ser azar.`),
  }
}

export interface OpponentTurn {
  first: GameRecord
  second: GameRecord
}

/** Against each rival (by `opponentKey`; null = no rival noted): the record going first and going second. */
export function opponentTurns(matches: readonly Pick<MatchFacts, 'result' | 'wentFirst' | 'opponent'>[]) {
  const groups = new Map<string | null, Fact[]>()
  for (const match of matches) {
    const key = opponentKey(match.opponent)
    const list = groups.get(key) ?? []
    list.push(match)
    groups.set(key, list)
  }
  const out = new Map<string | null, OpponentTurn>()
  for (const [key, list] of groups) {
    const { first, second } = split(list)
    if (recordGames(first) + recordGames(second) > 0) out.set(key, { first, second })
  }
  return out
}
