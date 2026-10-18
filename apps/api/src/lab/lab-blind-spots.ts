/**
 * H-055: what «posible punto ciego del bot» compares in a Laboratorio job, apart so the choices are tested on their own.
 */
import type { MetaScore } from '@tcg/domain'

/**
 * The bank's weights by archetype, in percent like the era's meta shares (review of #119): a bank of 10 or more brings
 * two lists for its most played archetypes, and the tournament number has one matchup record per archetype, so two rows
 * of the same record would count its matches twice and narrow the interval. In percent because `expectedVsMeta` gives
 * its coverage in the unit of the shares (0–100 for the meta's), which is what `FAR_MIN_COVERAGE` reads.
 */
export function bankShares(
  rivals: readonly { archetypeId: string; weight: number }[],
): { archetypeId: string; share: number }[] {
  const shares = new Map<string, number>()
  for (const rival of rivals) shares.set(rival.archetypeId, (shares.get(rival.archetypeId) ?? 0) + rival.weight * 100)
  return [...shares].map(([archetypeId, share]) => ({ archetypeId, share }))
}

/**
 * The score the general rule compares: the confirmation's once there is one, even while it has no games yet (review of
 * #119: falling back to the search's then made the warning come and go), else the search's; and only when that round
 * is played whole (`whole`: every chunk done, not one per rival, since a pairing of more than 1.000 games is split) and
 * the score is of every rival (a list that is itself in the bank plays no pairing against itself), because a score of
 * part of the bank is reweighted over the rivals it has.
 */
export function comparableScore(
  deck: { search: { score: MetaScore | null }; confirm: { score: MetaScore | null } | null },
  whole: boolean,
): MetaScore | null {
  if (!whole) return null
  const score = deck.confirm ? deck.confirm.score : deck.search.score
  return score && score.coverage >= 0.999 ? score : null
}
