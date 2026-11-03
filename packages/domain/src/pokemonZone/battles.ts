/**
 * The game's battle counters (Partidas → Estadísticas, «Según el juego»): lifetime battles and wins of versus
 * (against people), ranked, solo (against the CPU) and rental decks, and the ranked points earned. They are a source
 * of their own: they sit next to the matches logged in the app and never add up with them (BRIEF §2). The game does
 * not count ties apart, so the rate is wins over battles.
 *
 * Between two imports the difference says how many the owner played in that window; against the matches logged in
 * the app in the same window it says how many he did not log. Versus is taken to include ranked (505 versus against
 * 347 ranked in the sample of 2/11/2026), so it is compared with every logged match and ranked with the competitive
 * ones.
 */
import { formatCountEs, formatIntervalEs, formatPercentEs, ORIENTATIVE_BELOW, wilsonInterval } from '../stats/rates.js'
import type { GameCounter, PokemonZoneSnapshot } from './payload.js'

export interface GameCounterView extends GameCounter {
  /** Wins over battles (0–100); null without battles. */
  rate: number | null
  ci95: [number, number] | null
  orientative: boolean
}

export function gameCounterView(counter: GameCounter | null): GameCounterView | null {
  if (!counter) return null
  if (counter.battles === 0) return { ...counter, rate: null, ci95: null, orientative: true }
  const [lo, hi] = wilsonInterval(counter.wins, counter.battles)
  return {
    ...counter,
    rate: (counter.wins / counter.battles) * 100,
    ci95: [lo * 100, hi * 100],
    orientative: counter.battles < ORIENTATIVE_BELOW,
  }
}

/**
 * As `formatWinRateEs` says a rate, for a counter of the game: «47,1 % (160 V en 340 partidas, IC 41,8–52,4 %)»;
 * «sin partidas» with none, «sin datos» when the game did not give it.
 */
export function formatGameCounterEs(view: GameCounterView | null): string {
  if (!view) return 'sin datos'
  if (view.rate === null || !view.ci95) return 'sin partidas'
  const games = view.battles === 1 ? '1 partida' : `${formatCountEs(view.battles)} partidas`
  const parts = [`${formatCountEs(view.wins)} V en ${games}`, `IC ${formatIntervalEs(view.ci95)}`]
  if (view.orientative) parts.push('orientativo')
  return `${formatPercentEs(view.rate)} (${parts.join(', ')})`
}

export interface GameBattles {
  versus: GameCounterView | null
  ranked: GameCounterView | null
  solo: GameCounterView | null
  rental: GameCounterView | null
  rankedPoints: number | null
}

export function gameBattles(snapshot: Pick<PokemonZoneSnapshot, 'battles'>): GameBattles {
  const { battles } = snapshot
  return {
    versus: gameCounterView(battles.versus),
    ranked: gameCounterView(battles.ranked),
    solo: gameCounterView(battles.solo),
    rental: gameCounterView(battles.rental),
    rankedPoints: battles.rankedPoints,
  }
}

export interface BattlesBetween {
  versus: GameCounter | null
  ranked: GameCounter | null
  solo: GameCounter | null
  rental: GameCounter | null
  rankedPoints: number | null
}

/**
 * What the game counted between two imports. Null when a counter went down: the imports are not of the same account,
 * or pokemon-zone started over, and the difference means nothing.
 */
export function battlesBetween(
  previous: Pick<PokemonZoneSnapshot, 'battles'>,
  current: Pick<PokemonZoneSnapshot, 'battles'>,
): BattlesBetween | null {
  let broken = false
  const diff = (before: GameCounter | null, after: GameCounter | null): GameCounter | null => {
    if (!before || !after) return null
    const battles = after.battles - before.battles
    const wins = after.wins - before.wins
    if (battles < 0 || wins < 0 || wins > battles) {
      broken = true
      return null
    }
    return { battles, wins }
  }
  const before = previous.battles
  const after = current.battles
  const result: BattlesBetween = {
    versus: diff(before.versus, after.versus),
    ranked: diff(before.ranked, after.ranked),
    solo: diff(before.solo, after.solo),
    rental: diff(before.rental, after.rental),
    rankedPoints:
      before.rankedPoints === null || after.rankedPoints === null ? null : after.rankedPoints - before.rankedPoints,
  }
  if (result.rankedPoints !== null && result.rankedPoints < 0) broken = true
  return broken ? null : result
}

export type LoggedKind = 'ranked' | 'versus'

export interface LoggedComparison {
  kind: LoggedKind
  /** Battles the game counted. */
  game: number
  /** Matches logged in the app: competitive ones for ranked, every one for versus. */
  logged: number
  /** Battles the game counted that are not logged (0 when the app has as many or more). */
  notLogged: number
}

/** The game's battles against the matches logged in the app over the same span. */
export function loggedComparison(
  game: { ranked: GameCounter | null; versus: GameCounter | null },
  logged: { competitive: number; all: number },
): LoggedComparison[] {
  const rows: LoggedComparison[] = []
  const row = (kind: LoggedKind, counter: GameCounter | null, count: number) => {
    if (!counter) return
    rows.push({ kind, game: counter.battles, logged: count, notLogged: Math.max(0, counter.battles - count) })
  }
  row('ranked', game.ranked, logged.competitive)
  row('versus', game.versus, logged.all)
  return rows
}
