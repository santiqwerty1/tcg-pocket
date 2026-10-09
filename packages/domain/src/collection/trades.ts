/**
 * Lista de intercambio (Fase 31): what the owner could give and what the decks need, for trading in the game. Trades
 * are one card for one card of the same rarity, only for tradeable rarities (◊–◊◊◊◊, ☆, ☆☆, ✵, ✵✵) and expansions.
 *
 * - To give: copies beyond what the collection keeps — one of every print owned, and at least 2 of every functional
 *   card (a deck takes at most 2), whichever is more. A card with an active adjustment is left out (its stock is not
 *   trusted).
 * - To ask for: the copies the owner's decks lack (each deck against the whole collection, so the most any deck
 *   lacks), with the tradeable prints of that card (the most common rarity first: cheaper to trade).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { type CardEdition, type CardId, RARITIES, type Rarity } from '../catalog/types.js'
import type { CollectionAdjustment } from './adjustments.js'
import { playableCopies } from './playable.js'
import { type StockQuantities, stockValueOf } from './stock.js'

/** A deck takes at most 2 copies of a card. */
export const TRADE_KEEP_PER_CARD = 2

export interface TradeDeck {
  name: string
  /** Copies of each functional group in the deck. */
  groups: ReadonlyMap<CardId, number>
}

export interface TradeGive {
  /** The print to give (its earliest tradeable edition). */
  cardId: CardId
  groupId: CardId
  nameEs: string
  nameEn: string
  rarity: Rarity
  owned: number
  spare: number
}

export interface TradeWant {
  groupId: CardId
  nameEs: string
  nameEn: string
  missing: number
  /** Decks that lack it (the most it is missing in one of them). */
  decks: string[]
  /** Tradeable prints of the card, most common rarity first. */
  options: { cardId: CardId; rarity: Rarity }[]
}

export interface TradeRarityRow {
  rarity: Rarity
  wants: TradeWant[]
  gives: TradeGive[]
}

export interface TradeList {
  gives: TradeGive[]
  /** Cards the decks lack that can be traded. */
  wants: TradeWant[]
  /** Cards the decks lack that no trade gives (packs, shop or events). */
  untradeable: { groupId: CardId; nameEs: string; missing: number; decks: string[] }[]
  /** By rarity (a want counts under the rarity of its first option). */
  byRarity: TradeRarityRow[]
}

const rarityRank = (rarity: Rarity) => RARITIES.indexOf(rarity)

export function tradeList(input: {
  index: CatalogIndex
  stock: StockQuantities
  adjustments: readonly CollectionAdjustment[]
  decks: readonly TradeDeck[]
  tradeableRarity: (rarity: Rarity) => boolean
}): TradeList {
  const { index, stock } = input
  const tradeable = (card: CardEdition) =>
    input.tradeableRarity(card.rarity) && (index.expansionById(card.expansionId)?.tradeable ?? false)
  const playable = playableCopies(index, stock, input.adjustments)

  const gives: TradeGive[] = []
  for (const group of index.catalog.groups) {
    const copies = playable.get(group.id)
    if (!copies || copies.adjustment) continue
    // One row per stock unit owned (twins share it), with its earliest tradeable edition.
    const units = new Map<CardId, { card: CardEdition; owned: number }>()
    for (const card of index.cardsOfGroup(group.id)) {
      const owned = stockValueOf(stock, card.stockCardId).amountOwned
      if (owned <= 0 || !tradeable(card)) continue
      const current = units.get(card.stockCardId)
      if (!current || card.id === card.stockCardId) units.set(card.stockCardId, { card, owned })
    }
    if (units.size === 0) continue
    const printsOwned = group.stockCardIds.filter((id) => stockValueOf(stock, id).amountOwned > 0).length
    let allowed = Math.max(0, copies.fromStock - Math.max(TRADE_KEEP_PER_CARD, printsOwned))
    // The most repeated prints give first.
    for (const { card, owned } of [...units.values()].sort((a, b) => b.owned - a.owned)) {
      const spare = Math.min(owned - 1, allowed)
      if (spare <= 0) continue
      allowed -= spare
      gives.push({
        cardId: card.id,
        groupId: group.id,
        nameEs: card.nameEs,
        nameEn: card.nameEn,
        rarity: card.rarity,
        owned,
        spare,
      })
    }
  }

  const needs = new Map<CardId, { missing: number; decks: string[] }>()
  for (const deck of input.decks) {
    for (const [groupId, count] of deck.groups) {
      const missing = Math.max(0, count - (playable.get(groupId)?.playable ?? 0))
      if (missing === 0) continue
      const need = needs.get(groupId) ?? { missing: 0, decks: [] }
      need.missing = Math.max(need.missing, missing)
      need.decks.push(deck.name)
      needs.set(groupId, need)
    }
  }
  const wants: TradeWant[] = []
  const untradeable: TradeList['untradeable'] = []
  for (const [groupId, need] of needs) {
    const group = index.groupById(groupId)
    if (!group) continue
    const options = index
      .cardsOfGroup(groupId)
      .filter(tradeable)
      .sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.id.localeCompare(b.id))
      .map((card) => ({ cardId: card.id, rarity: card.rarity }))
    const row = { groupId, nameEs: group.nameEs, missing: need.missing, decks: need.decks }
    if (options.length === 0) untradeable.push(row)
    else wants.push({ ...row, nameEn: group.nameEn, options })
  }

  const byName = (a: { nameEs: string }, b: { nameEs: string }) => a.nameEs.localeCompare(b.nameEs, 'es')
  gives.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || byName(a, b))
  wants.sort(
    (a, b) =>
      rarityRank(a.options[0]?.rarity ?? 'P') - rarityRank(b.options[0]?.rarity ?? 'P') ||
      b.decks.length - a.decks.length ||
      byName(a, b),
  )
  untradeable.sort(byName)
  const byRarity = RARITIES.flatMap((rarity): TradeRarityRow[] => {
    const rowWants = wants.filter((want) => want.options[0]?.rarity === rarity)
    const rowGives = gives.filter((give) => give.rarity === rarity)
    return rowWants.length > 0 || rowGives.length > 0 ? [{ rarity, wants: rowWants, gives: rowGives }] : []
  })
  return { gives, wants, untradeable, byRarity }
}

/** The list as text to paste in a chat («Busco» and «Doy», by rarity), with Spanish and English names. */
export function tradeText(list: TradeList, options: { rarities?: readonly Rarity[]; max?: number } = {}): string {
  const max = options.max ?? 25
  const rows = list.byRarity.filter((row) => !options.rarities || options.rarities.includes(row.rarity))
  // «Mega-Absol ex» and «Mega Absol ex» are the same name: only the Spanish one.
  const bare = (text: string) => text.replace(/[\s-]/g, '').toLowerCase()
  const name = (es: string, en: string) => (bare(es) === bare(en) ? es : `${es} / ${en}`)
  const wants = rows.flatMap((row) =>
    row.wants.map(
      (want) =>
        `· ${row.rarity} ${name(want.nameEs, want.nameEn)} (${want.options
          .filter((option) => option.rarity === row.rarity)
          .map((option) => option.cardId)
          .join(', ')})${want.missing > 1 ? ` ×${want.missing}` : ''}`,
    ),
  )
  const gives = rows.flatMap((row) =>
    row.gives.map(
      (give) =>
        `· ${row.rarity} ${name(give.nameEs, give.nameEn)} (${give.cardId})${give.spare > 1 ? ` ×${give.spare}` : ''}`,
    ),
  )
  const cut = (lines: string[]) =>
    lines.length > max ? [...lines.slice(0, max), `· y ${lines.length - max} más`] : lines
  return [
    'Intercambio en TCG Pocket (misma rareza)',
    '',
    'Busco:',
    ...(wants.length > 0 ? cut(wants) : ['· nada por ahora']),
    '',
    'Doy:',
    ...(gives.length > 0 ? cut(gives) : ['· nada por ahora']),
  ].join('\n')
}
