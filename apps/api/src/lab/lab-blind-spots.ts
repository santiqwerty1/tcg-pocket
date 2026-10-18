/**
 * H-055: what «posible punto ciego del bot» compares in a Laboratorio job, apart so the choices are tested on their own.
 */
import type { MetaScore } from '@tcg/domain'

/**
 * The bank's weights by archetype (review of #119): a bank of 10 or more brings two lists for its most played
 * archetypes, and the tournament number has one matchup record per archetype. Two rows of the same record would count
 * its matches twice and narrow the interval.
 */
export function bankShares(
  rivals: readonly { archetypeId: string; weight: number }[],
): { archetypeId: string; share: number }[] {
  const shares = new Map<string, number>()
  for (const rival of rivals) shares.set(rival.archetypeId, (shares.get(rival.archetypeId) ?? 0) + rival.weight)
  return [...shares].map(([archetypeId, share]) => ({ archetypeId, share }))
}

/**
 * The score the general rule compares: the confirmation's once there is one, even while it has no games yet (review of
 * #119: falling back to the search's then made the warning come and go), else the search's; and only when it covers
 * the whole bank, since a score of part of it is reweighted over the rivals it has.
 */
export function comparableScore(deck: {
  search: { score: MetaScore | null }
  confirm: { score: MetaScore | null } | null
}): MetaScore | null {
  const score = deck.confirm ? deck.confirm.score : deck.search.score
  return score && score.coverage >= 0.999 ? score : null
}
