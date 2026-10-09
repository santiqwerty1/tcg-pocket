/**
 * What the pack recommendation looks for (BRIEF M4, PLAN §3.4): two goals weighed with α.
 * - Decks: for each functional card, `max over target decks of priority × max(0, copies in the deck − playable)`.
 *   The maximum, not the sum, because copies are not split between decks (I6).
 * - Collection: editions not owned (fewer than `copies`) whose rarity passes the filter, one point each.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { MissionProgress } from '../catalog/missions.js'
import type { CardEdition, CardId, Rarity } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'

export interface DeckGoal {
  deckId: string
  name: string
  /** 1 (low) … 3 (high); decks with 0 are not goals. */
  priority: number
  cards: readonly DeckCardEntry[]
}

export interface CollectionGoal {
  /** Rarities that count; empty = all. */
  rarities: readonly Rarity[]
  /** An edition is wanted while owned < copies (the tracker's «number»). */
  copies: number
}

export interface GroupDeficit {
  groupId: CardId
  nameEs: string
  /** Copies missing for the most demanding target deck. */
  missing: number
  /** max over decks of priority × missing copies for that deck. */
  weight: number
  decks: { deckId: string; name: string; priority: number; need: number }[]
  /** Editions the decks list for this card (what the tracker model looks for). */
  listedCardIds: CardId[]
}

/** Missing functional cards of the target decks, heaviest first. */
export function deckDeficits(
  goals: readonly DeckGoal[],
  index: CatalogIndex,
  playable: (groupId: CardId) => number,
): GroupDeficit[] {
  const deficits = new Map<CardId, GroupDeficit>()
  for (const goal of goals) {
    if (goal.priority <= 0) continue
    const needByGroup = new Map<CardId, { need: number; cardIds: Set<CardId> }>()
    for (const entry of goal.cards) {
      const groupId = index.cardById(entry.cardId)?.functionalGroupId
      if (!groupId) continue
      const current = needByGroup.get(groupId) ?? { need: 0, cardIds: new Set<CardId>() }
      current.need += entry.count
      current.cardIds.add(entry.cardId)
      needByGroup.set(groupId, current)
    }
    for (const [groupId, { need, cardIds }] of needByGroup) {
      const missing = Math.max(0, need - playable(groupId))
      if (missing === 0) continue
      const existing = deficits.get(groupId)
      const deck = { deckId: goal.deckId, name: goal.name, priority: goal.priority, need }
      if (existing) {
        existing.missing = Math.max(existing.missing, missing)
        existing.weight = Math.max(existing.weight, goal.priority * missing)
        existing.decks.push(deck)
        for (const cardId of cardIds) if (!existing.listedCardIds.includes(cardId)) existing.listedCardIds.push(cardId)
      } else {
        deficits.set(groupId, {
          groupId,
          nameEs: index.groupById(groupId)?.nameEs ?? groupId,
          missing,
          weight: goal.priority * missing,
          decks: [deck],
          listedCardIds: [...cardIds],
        })
      }
    }
  }
  return [...deficits.values()].sort((a, b) => b.weight - a.weight || a.nameEs.localeCompare(b.nameEs, 'es'))
}

/**
 * Editions wanted for the collection goal, as the tracker's Overview builds them (`getFilteredCards` with
 * `maxNumber = copies − 1`). `byGroup` is its deckbuilding mode: one base edition per functional card, owned
 * counted over all its prints. `owned(stockCardId)` gives the copies of a tracker row.
 */
export function collectionWanted(
  index: CatalogIndex,
  owned: (stockCardId: CardId) => number,
  goal: CollectionGoal,
  options: { byGroup?: boolean } = {},
): CardEdition[] {
  const rarities = new Set(goal.rarities)
  const ownedByInternalId = (internalId: number): number => {
    const card = index.cardsByInternalId(internalId)[0]
    return card ? owned(card.stockCardId) : 0
  }
  return index.catalog.cards.filter((card) => {
    if (options.byGroup && card.internalId !== card.alternateVersionsRaw[0]) return false
    if (rarities.size > 0 && !rarities.has(card.rarity)) return false
    const amount = options.byGroup
      ? [...new Set(card.alternateVersionsRaw)].reduce((sum, internalId) => sum + ownedByInternalId(internalId), 0)
      : ownedByInternalId(card.internalId)
    return amount <= goal.copies - 1
  })
}

/** Fase 44: a mission slot still missing copies — the third goal of the recommendation. */
export interface MissionWant {
  mission: string
  expansionId: string
  /** Editions that count for the slot (any of them). */
  options: CardId[]
  /** Copies still missing for the slot. */
  missing: number
}

/** The slots of the missions not complete yet, from `missionProgress`. */
export function missionWants(progress: readonly MissionProgress[]): MissionWant[] {
  return progress.flatMap((item) =>
    item.slots
      .filter((slot) => slot.have < slot.amount)
      .map((slot) => ({
        mission: item.mission.name,
        expansionId: item.mission.expansionId,
        options: [...slot.options],
        missing: slot.amount - slot.have,
      })),
  )
}
