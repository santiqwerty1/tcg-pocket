/**
 * A random saved deck (pedido del 7/10/2026). With `leastPlayed`, only the decks with the fewest own matches take
 * part, which spreads the plan of «10 partidas con cada mazo» evenly.
 */

export interface RandomDeckCandidate {
  id: string
  /** Own matches logged with the deck. */
  games: number
}

/** `random` returns [0, 1) like Math.random; the API passes a crypto-backed one, tests a fixed one. */
export function pickRandomDeck<T extends RandomDeckCandidate>(
  decks: readonly T[],
  options: { leastPlayed?: boolean; excludeId?: string | null; random?: () => number } = {},
): { deck: T; candidates: number } | null {
  let pool = decks.filter((deck) => deck.id !== options.excludeId)
  // Re-rolling with a single candidate gives it back instead of nothing.
  if (pool.length === 0) pool = [...decks]
  if (options.leastPlayed && pool.length > 0) {
    const fewest = Math.min(...pool.map((deck) => deck.games))
    pool = pool.filter((deck) => deck.games === fewest)
  }
  if (pool.length === 0) return null
  const random = options.random ?? Math.random
  const at = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return { deck: pool[at] as T, candidates: pool.length }
}
