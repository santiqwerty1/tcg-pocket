/**
 * «Para armar los mazos, recomendar siempre la mejor versión de la carta» (pedido del 7/10/2026): for every
 * functional card of a deck, which of the editions the user owns to put in the game deck. Only editions of the
 * same functional card are considered (same name and same text, I2), so the deck plays exactly the same.
 *
 * «Mejor» = higher rarity first (◊ … ◊◊◊◊ < promo < ☆ < ☆☆ < ☆☆☆ < ✵ < ✵✵ < Corona), then the holographic print
 * of the Deluxe packs over the plain one of the same rarity. Twins that share a tracker row (A1-1 and A4b-1) are
 * one owned print. On ties the edition already in the list stays, so nothing changes without a reason.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, Rarity } from '../catalog/types.js'
import type { DeckCardEntry } from './types.js'

/** Display order of rarities; promos («P») sit between ◊◊◊◊ and ☆ (special art, no diamonds). */
export const RARITY_PRESTIGE: Readonly<Record<Rarity, number>> = {
  '◊': 1,
  '◊◊': 2,
  '◊◊◊': 3,
  '◊◊◊◊': 4,
  P: 4.5,
  '☆': 5,
  '☆☆': 6,
  '☆☆☆': 7,
  '✵': 8,
  '✵✵': 9,
  'Crown Rare': 10,
}

/**
 * Holographic print of a Deluxe pack: an edition with its own tracker row whose expansion also carries the plain
 * reprint of the same functional card and rarity (a twin of an earlier card). A4b-211 (plain: A4b-210 = A2b-42),
 * B4b-391 (plain: B4b-225 = B1-225), B4b-372 (Globito).
 */
export function isHoloEdition(card: CardEdition, index: CatalogIndex): boolean {
  if (card.stockCardId !== card.id) return false
  return index
    .cardsOfGroup(card.functionalGroupId)
    .some(
      (other) =>
        other.id !== card.id &&
        other.expansionId === card.expansionId &&
        other.rarity === card.rarity &&
        other.stockCardId !== other.id,
    )
}

/** Sort key: rarity, then holographic. */
export function editionPrestige(card: CardEdition, index: CatalogIndex): number {
  return (RARITY_PRESTIGE[card.rarity] ?? 0) * 10 + (isHoloEdition(card, index) ? 1 : 0)
}

export interface VersionPick {
  cardId: CardId
  rarity: Rarity
  holo: boolean
  count: number
}

export interface BestVersionGroup {
  groupId: CardId
  nameEs: string
  /** Copies the deck needs of this functional card. */
  need: number
  /** Copies owned over all its prints (stock; adjustments are per functional card and say nothing of prints). */
  owned: number
  current: DeckCardEntry[]
  recommended: VersionPick[]
  /** The recommendation puts at least one copy of a better print than the list has. */
  improves: boolean
}

export interface BestVersionsResult {
  groups: BestVersionGroup[]
  /** The deck list rewritten with the recommended prints, in the original order; equal to the input when nothing improves. */
  cards: DeckCardEntry[]
  changed: boolean
}

interface Unit {
  cardId: CardId
  card: CardEdition
  prestige: number
  holo: boolean
  owned: number
  inList: boolean
  order: number
}

/**
 * Recommends prints for every functional card of `cards`. `owned(stockCardId)` gives the copies of a tracker row.
 * Copies the user does not own keep the listed edition (the deck is incomplete there, see completeness).
 */
export function recommendBestVersions(
  cards: readonly DeckCardEntry[],
  index: CatalogIndex,
  owned: (stockCardId: CardId) => number,
): BestVersionsResult {
  const groupOrder: CardId[] = []
  const entriesByGroup = new Map<CardId, DeckCardEntry[]>()
  for (const entry of cards) {
    const groupId = index.cardById(entry.cardId)?.functionalGroupId ?? entry.cardId
    const list = entriesByGroup.get(groupId)
    if (list) list.push({ ...entry })
    else {
      entriesByGroup.set(groupId, [{ ...entry }])
      groupOrder.push(groupId)
    }
  }

  const groups: BestVersionGroup[] = []
  const rewritten: DeckCardEntry[] = []
  for (const groupId of groupOrder) {
    const current = entriesByGroup.get(groupId) ?? []
    const need = current.reduce((sum, entry) => sum + entry.count, 0)
    const group = index.groupById(groupId)
    if (!group) {
      rewritten.push(...current)
      continue
    }
    const listed = new Set(current.map((entry) => entry.cardId))
    // One unit per tracker row; the listed edition represents its row when it is a twin.
    const units = new Map<CardId, Unit>()
    index.cardsOfGroup(groupId).forEach((card, order) => {
      const existing = units.get(card.stockCardId)
      if (existing && !(listed.has(card.id) && !existing.inList)) return
      units.set(card.stockCardId, {
        cardId: card.id,
        card,
        prestige: editionPrestige(card, index),
        holo: isHoloEdition(card, index),
        owned: owned(card.stockCardId),
        inList: listed.has(card.id) || (existing?.inList ?? false),
        order: existing?.order ?? order,
      })
    })
    const ranked = [...units.values()]
      .filter((unit) => unit.owned > 0)
      .sort((a, b) => b.prestige - a.prestige || Number(b.inList) - Number(a.inList) || a.order - b.order)
    let left = need
    const recommended: VersionPick[] = []
    for (const unit of ranked) {
      if (left === 0) break
      const take = Math.min(unit.owned, left)
      recommended.push({ cardId: unit.cardId, rarity: unit.card.rarity, holo: unit.holo, count: take })
      left -= take
    }
    // Copies not owned keep the listed editions (worst first, so the owned ones replace them).
    if (left > 0) {
      for (const entry of current) {
        if (left === 0) break
        const take = Math.min(entry.count, left)
        const card = index.cardById(entry.cardId)
        const same = recommended.find((pick) => pick.cardId === entry.cardId)
        if (same) same.count += take
        else if (card) {
          recommended.push({ cardId: card.id, rarity: card.rarity, holo: isHoloEdition(card, index), count: take })
        }
        left -= take
      }
    }
    const prestigeOf = (cardId: CardId) => {
      const card = index.cardById(cardId)
      return card ? editionPrestige(card, index) : 0
    }
    const copiesBy = (entries: readonly { cardId: CardId; count: number }[]) =>
      entries
        .flatMap((entry) => Array.from({ length: entry.count }, () => prestigeOf(entry.cardId)))
        .sort((a, b) => b - a)
    const before = copiesBy(current)
    const after = copiesBy(recommended)
    const improves = after.some((value, at) => value > (before[at] ?? 0))
    groups.push({
      groupId,
      nameEs: group.nameEs,
      need,
      owned: [...units.values()].reduce((sum, unit) => sum + unit.owned, 0),
      current,
      recommended,
      improves,
    })
    rewritten.push(...(improves ? recommended.map((pick) => ({ cardId: pick.cardId, count: pick.count })) : current))
  }
  return { groups, cards: rewritten, changed: groups.some((group) => group.improves) }
}
