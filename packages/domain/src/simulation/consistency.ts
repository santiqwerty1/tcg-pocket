/**
 * Consistency of a deck (PLAN §3.7, Fase 8): in goldfish games (engine-cli `consistency`), the first own turn in which
 * its key attacker is in play with energy for an attack. Here: which cards are the key attacker by default, and the
 * curve P(ready by own turn N) with its Wilson interval, apart for going first and second and together. Bots play
 * the deck: it measures the list as the bot plays it.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { wilsonInterval, Z_95 } from '../stats/rates.js'

export interface TurnHistogram {
  games: number
  /** Games in which it happened first on own turn 1, 2… */
  firstOnTurn: number[]
  never: number
}

export interface ConsistencySplit {
  first: TurnHistogram
  second: TurnHistogram
}

export interface CurvePoint {
  turn: number
  /** Games ready by this own turn. */
  ready: number
  games: number
  /** 0–100 */
  value: number
  ci95: [number, number]
}

export const DEFAULT_CONSISTENCY_GAMES = 1000
export const DEFAULT_CONSISTENCY_TURNS = 8

/**
 * Splits `total` games by weight (largest remainder, ties to the earlier weight): the games against each rival of the
 * meta bank in a consistency «contra el meta» (D-019). Rivals with no weight get none.
 */
export function splitGames(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + Math.max(0, weight), 0)
  if (sum <= 0 || total <= 0) return weights.map(() => 0)
  const exact = weights.map((weight) => (Math.max(0, weight) / sum) * total)
  const games = exact.map((value) => Math.floor(value))
  let left = total - games.reduce((acc, value) => acc + value, 0)
  const order = exact
    .map((value, at) => ({ at, rest: value - Math.floor(value) }))
    .filter((entry) => (weights[entry.at] ?? 0) > 0)
    .sort((x, y) => y.rest - x.rest || x.at - y.at)
  for (const entry of order) {
    if (left <= 0) break
    games[entry.at] = (games[entry.at] ?? 0) + 1
    left -= 1
  }
  return games
}

/** Both seats together. */
export function mergeHistograms(a: TurnHistogram, b: TurnHistogram): TurnHistogram {
  const length = Math.max(a.firstOnTurn.length, b.firstOnTurn.length)
  return {
    games: a.games + b.games,
    firstOnTurn: Array.from({ length }, (_, i) => (a.firstOnTurn[i] ?? 0) + (b.firstOnTurn[i] ?? 0)),
    never: a.never + b.never,
  }
}

/** P(ready by own turn N) for N = 1…, cumulative, with Wilson 95 % over the games. */
export function readinessCurve(histogram: TurnHistogram): CurvePoint[] {
  let ready = 0
  return histogram.firstOnTurn.map((count, at) => {
    ready += count
    const games = histogram.games
    const [lo, hi] = games > 0 ? wilsonInterval(ready, games, Z_95) : [0, 0]
    return {
      turn: at + 1,
      ready,
      games,
      value: games > 0 ? (ready / games) * 100 : 0,
      ci95: [lo * 100, hi * 100],
    }
  })
}

function maxDamage(card: CardEdition): number {
  return Math.max(0, ...card.attacks.map((attack) => Number.parseInt(attack.damage ?? '0', 10) || 0))
}

/**
 * The deck's main attacker when the owner did not pick one: the Pokémon worth the most prize points, then the one that
 * hits hardest, then the most copies. Every edition of that functional card in the deck counts.
 */
export function defaultKeyCards(cards: readonly DeckCardEntry[], index: CatalogIndex): CardId[] {
  const pokemon = cards
    .map((entry) => ({ entry, card: index.cardById(entry.cardId) }))
    .filter((item): item is { entry: DeckCardEntry; card: CardEdition } => item.card?.cardType === 'pokemon')
  const copies = new Map<CardId, number>()
  for (const { entry, card } of pokemon) {
    copies.set(card.functionalGroupId, (copies.get(card.functionalGroupId) ?? 0) + entry.count)
  }
  const best = [...pokemon].sort(
    (a, b) =>
      b.card.prizePoints - a.card.prizePoints ||
      maxDamage(b.card) - maxDamage(a.card) ||
      (copies.get(b.card.functionalGroupId) ?? 0) - (copies.get(a.card.functionalGroupId) ?? 0) ||
      a.card.id.localeCompare(b.card.id),
  )[0]
  if (!best) return []
  return pokemon.filter(({ card }) => card.functionalGroupId === best.card.functionalGroupId).map(({ card }) => card.id)
}
