/**
 * Response shapes of the catalog endpoints (docs/API.md): light summaries for lists and a `GroupDetail` that joins
 * the functional group with the owner's stock, active adjustment and deck usage.
 */
import type { CardEdition, Expansion, FunctionalGroup, Pack, SearchMatch } from '@tcg/domain'

export interface CardSummary {
  id: string
  nameEs: string
  nameEn: string
  expansionId: string
  number: number
  rarity: string
  cardType: string
  evolutionType: string
  ex: boolean
  prizePoints: number
  imageUrl: string
  functionalGroupId: string
  stockCardId: string
  isDisplayEdition: boolean
  /** Tracker pack name inside its expansion («mewtwopack», «everypack»): where the edition comes from (Fase 41). */
  pack: string
}

export interface GroupSummary {
  id: string
  nameEs: string
  nameEn: string
  cardType: string
  displayCardId: string
  editionCount: number
}

export interface GroupAdjustmentView {
  /** Numeric ids are exposed as strings (docs/API.md). */
  id: string
  playableCopies: number
  reason: string
  createdAt: Date
}

export interface GroupEditionView {
  card: CardSummary
  owned: number
  collected: boolean
  /** Other editions sharing the stock unit (same tracker internal id). */
  twinCardIds: string[]
}

export interface GroupDeckUsage {
  id: string
  name: string
  count: number
  builtInGame: boolean
}

export interface GroupDetail extends GroupSummary {
  /** Invariant I4: the active adjustment, or the sum of the group's stock units. */
  playable: number
  fromStock: number
  adjustment: GroupAdjustmentView | null
  editions: GroupEditionView[]
  decks: GroupDeckUsage[]
}

export interface CardSearchHit {
  card: CardSummary
  group: GroupSummary
  score: number
  matchedOn: SearchMatch
}

export type PackView = Omit<Pack, 'cardIds'>

export interface ExpansionView extends Expansion {
  packs: PackView[]
}

export function toCardSummary(card: CardEdition): CardSummary {
  return {
    id: card.id,
    nameEs: card.nameEs,
    nameEn: card.nameEn,
    expansionId: card.expansionId,
    number: card.number,
    rarity: card.rarity,
    cardType: card.cardType,
    evolutionType: card.evolutionType,
    ex: card.ex,
    prizePoints: card.prizePoints,
    imageUrl: card.imageUrl,
    functionalGroupId: card.functionalGroupId,
    stockCardId: card.stockCardId,
    isDisplayEdition: card.isDisplayEdition,
    pack: card.pack,
  }
}

export function toGroupSummary(group: FunctionalGroup): GroupSummary {
  return {
    id: group.id,
    nameEs: group.nameEs,
    nameEn: group.nameEn,
    cardType: group.cardType,
    displayCardId: group.displayCardId,
    editionCount: group.cardIds.length,
  }
}

export function toPackView(pack: Pack): PackView {
  const { cardIds: _cardIds, ...view } = pack
  return view
}
