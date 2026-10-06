/**
 * Completeness of a deck against the whole collection (I6: copies are not shared between decks). Copies are
 * counted per functional group: two editions of the same card add up, and any owned edition of the group counts.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckDraft } from './types.js'

export interface MissingGroup {
  groupId: CardId
  nameEs: string
  /** Copies the deck needs from this group. */
  need: number
  /** Playable copies owned (adjustment or stock sum). */
  have: number
  /** Editions of the group listed in the deck, in deck order. */
  cardIds: CardId[]
}

export interface DeckCompleteness {
  complete: boolean
  missing: MissingGroup[]
  /** Total copies to obtain (Σ need − have over the missing groups). */
  missingCount: number
}

/**
 * `playableByGroup` maps functional group id → playable copies (I4). Groups absent from the map count as 0.
 * Unknown card ids are reported as missing with the id as name.
 */
export function deckCompleteness(
  draft: Pick<DeckDraft, 'cards'>,
  index: CatalogIndex,
  playableByGroup: ReadonlyMap<CardId, number>,
): DeckCompleteness {
  const needs = new Map<CardId, { nameEs: string; need: number; cardIds: CardId[] }>()
  for (const entry of draft.cards) {
    const card = index.cardById(entry.cardId)
    const groupId = card ? card.functionalGroupId : entry.cardId
    const nameEs = card ? (index.groupById(card.functionalGroupId)?.nameEs ?? card.nameEs) : entry.cardId
    const need = needs.get(groupId)
    if (need) {
      need.need += entry.count
      if (!need.cardIds.includes(entry.cardId)) need.cardIds.push(entry.cardId)
    } else needs.set(groupId, { nameEs, need: entry.count, cardIds: [entry.cardId] })
  }
  const missing: MissingGroup[] = []
  let missingCount = 0
  for (const [groupId, need] of needs) {
    const have = playableByGroup.get(groupId) ?? 0
    if (have >= need.need) continue
    missing.push({ groupId, nameEs: need.nameEs, need: need.need, have, cardIds: need.cardIds })
    missingCount += need.need - have
  }
  return { complete: missing.length === 0, missing, missingCount }
}
