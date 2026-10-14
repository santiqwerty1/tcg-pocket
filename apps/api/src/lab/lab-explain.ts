/**
 * T-017 E1/E2: what the Laboratorio says of a search's variants beyond their scores — why each card that came in was
 * proposed, the copies the collection lacks, and what the archetype plays that the search could not try. Pure
 * functions over what the search froze when it started (H-021), so they can be tested without a database.
 */
import type { CardId, CatalogIndex, DeckCardEntry, VariantChange } from '@tcg/domain'
import type { LabDeckView, LabExploreView } from './lab-views.js'

/** H-021: the pool (card, copies, weight, in draw order) and the archetype usage (group, share) a search started with. */
export interface FrozenInputs {
  pool: [string, number, number][]
  affinity: [string, number][]
}

/**
 * For each card that came in, the share of the era's lists and of the archetype's lists that play it (the draw
 * weight is ×2 for trainers, ×(1 + era / 10) and ×(1 + archetype / 10), with the shares in %), and the copies the
 * collection lacks. Without frozen inputs (a search from before H-021) the shares are unknown, and so is the era's
 * share of a card to try (`asked`: its weight is the most played card's) or of the pre-evolution it brought along
 * (weight 0): the weight says nothing of the era there.
 */
export function whyCards(
  added: readonly VariantChange[],
  cards: readonly DeckCardEntry[],
  frozen: FrozenInputs | undefined,
  index: CatalogIndex,
  playable: (groupId: CardId) => number,
  asked: ReadonlySet<CardId> = new Set(),
): LabDeckView['why'] {
  const affinity = new Map(frozen?.affinity ?? [])
  const weights = new Map((frozen?.pool ?? []).map(([cardId, , weight]) => [cardId, weight]))
  return added.map((change) => {
    const card = index.cardById(change.cardId)
    const groupId = card?.functionalGroupId ?? change.cardId
    const archetypeShare = frozen ? (affinity.get(groupId) ?? 0) : null
    const poolCard = frozen?.pool.find(([cardId]) => index.cardById(cardId)?.functionalGroupId === groupId)
    const weight = poolCard ? weights.get(poolCard[0]) : undefined
    const eraShare =
      weight !== undefined && weight > 0 && archetypeShare !== null && !asked.has(groupId)
        ? Math.max(0, ((weight / ((card?.cardType === 'trainer' ? 2 : 1) * (1 + archetypeShare / 10)) - 1) / 10) * 100)
        : null
    const copies = cards.reduce(
      (sum, entry) => sum + (index.cardById(entry.cardId)?.functionalGroupId === groupId ? entry.count : 0),
      0,
    )
    return {
      cardId: change.cardId,
      nameEs: card?.nameEs ?? change.cardId,
      eraShare: eraShare === null ? null : Math.round(eraShare * 10) / 10,
      archetypeShare,
      asked: asked.has(groupId),
      missing: Math.max(0, copies - playable(groupId)),
    }
  })
}

/**
 * What 30 % or more of the archetype's lists play and the search could not try because the collection has none of
 * it, most played first. Only with the pool «colección»: with «todas las cartas» nothing is left out for that reason
 * (review of #20).
 */
export function leftOutCards(
  frozen: FrozenInputs | undefined,
  pool: 'collection' | 'all',
  index: CatalogIndex,
  playable: (groupId: CardId) => number,
): LabExploreView['leftOut'] {
  if (!frozen || pool === 'all') return []
  const inPool = new Set(frozen.pool.map(([cardId]) => index.cardById(cardId)?.functionalGroupId ?? cardId))
  return frozen.affinity
    .filter(([groupId, share]) => share >= 30 && !inPool.has(groupId) && playable(groupId) === 0)
    .sort((a, b) => b[1] - a[1])
    .map(([groupId, share]) => ({
      cardId: groupId,
      nameEs: index.groupById(groupId)?.nameEs ?? groupId,
      archetypeShare: Math.round(share * 10) / 10,
    }))
}
