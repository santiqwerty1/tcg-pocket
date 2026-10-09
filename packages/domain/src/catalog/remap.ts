/**
 * Remapeo del catálogo (PLAN §4.1 I12, Fase 21): when a tracker commit moves editions between stock units or functional
 * groups, or drops cards, the owner's data that points at them follows in the same transaction as the catalog. This
 * module only plans it (pure): the API applies the plan and keeps the sync in `needs_review` when something had to be
 * guessed. Stock units and groups are keyed by a card id (their earliest edition), so an old key is followed through
 * the cards it held:
 *
 * - **Stock** (per unit): each old unit's value goes to the new unit of each of its editions. Two old units landing in
 *   one (a merge) keep the value if they agree; otherwise the larger amount (review). One old unit landing in two (a
 *   split) gives its value to both: the tracker counted those copies once (review). A unit whose editions all left
 *   the catalog is dropped (review).
 * - **Adjustments** (per group): an old group goes to the new group of its own id card (else of its editions); a split
 *   is flagged; two active adjustments landing in one group keep the newest (the rest resolved, review); a group that
 *   vanished resolves its active adjustment (review) and drops the old rows.
 * - **Deck cards**: an edition that left the catalog becomes the shown edition of its group's new group (notice), or
 *   leaves the deck (review). Key cards and event bans follow the groups.
 */
import type { CardId, Catalog } from './types.js'

export interface RemapStockRow {
  /** Old stock unit id. */
  cardId: CardId
  amountOwned: number
  collected: boolean
  source: string
  importId: number | null
}

export interface RemapAdjustment {
  id: number
  groupId: CardId
  active: boolean
  createdAt: Date
}

export interface RemapDeckCard {
  deckId: number
  cardId: CardId
  count: number
  position: number
}

export interface OwnerRefs {
  stock: readonly RemapStockRow[]
  adjustments: readonly RemapAdjustment[]
  deckCards: readonly RemapDeckCard[]
  keyCards: readonly { deckId: number; items: readonly { functionalGroupId: CardId; role: string }[] }[]
  eventBans: readonly { eventId: number; banned: readonly CardId[] }[]
}

export type RemapNoteKind =
  | 'stock_merge'
  | 'stock_split'
  | 'stock_removed'
  | 'adjustment_split'
  | 'adjustment_merge'
  | 'adjustment_removed'
  | 'deck_card_replaced'
  | 'deck_card_removed'
  | 'key_card_removed'
  | 'event_ban_removed'

export interface RemapNote {
  kind: RemapNoteKind
  /** True when the owner should look (the remap had to guess or drop something). */
  review: boolean
  text: string
}

export interface CatalogRemap {
  stock: { delete: CardId[]; upsert: RemapStockRow[] }
  adjustments: { move: { id: number; groupId: CardId }[]; resolve: number[]; delete: number[] }
  deckCards: { deckId: number; from: CardId; to: CardId | null; count: number; position: number }[]
  keyCards: { deckId: number; items: { functionalGroupId: CardId; role: string }[] }[]
  eventBans: { eventId: number; banned: CardId[] }[]
  notes: RemapNote[]
  /** Some note asks the owner to look: the sync stays in `needs_review`. */
  needsReview: boolean
  /** Anything to write at all. */
  empty: boolean
}

export function planCatalogRemap(prev: Catalog, next: Catalog, refs: OwnerRefs): CatalogRemap {
  const nextCards = new Map(next.cards.map((card) => [card.id, card]))
  const nextGroups = new Map(next.groups.map((group) => [group.id, group]))
  const prevGroups = new Map(prev.groups.map((group) => [group.id, group]))
  const prevByStock = new Map<CardId, CardId[]>()
  for (const card of prev.cards) {
    const list = prevByStock.get(card.stockCardId) ?? []
    list.push(card.id)
    prevByStock.set(card.stockCardId, list)
  }
  const prevCards = new Map(prev.cards.map((card) => [card.id, card]))
  const notes: RemapNote[] = []
  const name = (cardId: CardId) => {
    const card = nextCards.get(cardId) ?? prevCards.get(cardId)
    return card ? `${card.nameEs} (${cardId})` : cardId
  }

  // ---------- stock ----------
  const candidates = new Map<CardId, RemapStockRow[]>()
  for (const row of refs.stock) {
    const editions = prevByStock.get(row.cardId) ?? [row.cardId]
    const targets = [
      ...new Set(editions.map((cardId) => nextCards.get(cardId)?.stockCardId).filter((id): id is CardId => !!id)),
    ]
    if (targets.length === 0) {
      if (row.amountOwned > 0 || row.collected) {
        notes.push({
          kind: 'stock_removed',
          review: true,
          text: `${name(row.cardId)} ya no está en el catálogo: se quitaron sus ${row.amountOwned} copias de la colección.`,
        })
      }
      continue
    }
    if (targets.length > 1 && row.amountOwned > 0) {
      notes.push({
        kind: 'stock_split',
        review: true,
        text: `${name(row.cardId)} se separó en ${targets.map(name).join(' y ')}: cada una queda con ${row.amountOwned} copias (revisá cuáles tenés).`,
      })
    }
    for (const target of targets) {
      const list = candidates.get(target) ?? []
      list.push({ ...row, cardId: target })
      candidates.set(target, list)
    }
  }
  const newStock = new Map<CardId, RemapStockRow>()
  for (const [unit, rows] of candidates) {
    const first = rows[0] as RemapStockRow
    if (rows.length === 1) {
      newStock.set(unit, first)
      continue
    }
    const differ = rows.some((row) => row.amountOwned !== first.amountOwned || row.collected !== first.collected)
    const best = rows.reduce((a, b) => (b.amountOwned > a.amountOwned ? b : a))
    newStock.set(unit, { ...best, collected: rows.some((row) => row.collected) })
    if (differ) {
      notes.push({
        kind: 'stock_merge',
        review: true,
        text: `${name(unit)} junta ahora ediciones que tenían cantidades distintas (${rows.map((row) => row.amountOwned).join(', ')}): quedó con ${best.amountOwned}.`,
      })
    }
  }
  const oldStock = new Map(refs.stock.map((row) => [row.cardId, row]))
  const stock = {
    delete: [...oldStock.keys()].filter((unit) => !newStock.has(unit)),
    upsert: [...newStock.values()].filter((row) => {
      const before = oldStock.get(row.cardId)
      return !before || before.amountOwned !== row.amountOwned || before.collected !== row.collected
    }),
  }

  // ---------- groups (adjustments, key cards, event bans) ----------
  /** The new groups an old group's editions went to; its own id card's group first. */
  const groupTargets = (groupId: CardId): CardId[] => {
    const own = nextCards.get(groupId)?.functionalGroupId
    const editions = prevGroups.get(groupId)?.cardIds ?? [groupId]
    const all = editions.map((cardId) => nextCards.get(cardId)?.functionalGroupId).filter((id): id is CardId => !!id)
    return [...new Set([...(own ? [own] : []), ...all])]
  }
  const groupName = (groupId: CardId) => {
    const group = nextGroups.get(groupId) ?? prevGroups.get(groupId)
    return group ? `${group.nameEs} (${groupId})` : groupId
  }

  const adjustments: CatalogRemap['adjustments'] = { move: [], resolve: [], delete: [] }
  const activeByTarget = new Map<CardId, RemapAdjustment[]>()
  for (const adjustment of refs.adjustments) {
    const targets = groupTargets(adjustment.groupId)
    const target = targets[0]
    if (!target) {
      adjustments.delete.push(adjustment.id)
      if (adjustment.active) {
        notes.push({
          kind: 'adjustment_removed',
          review: true,
          text: `El ajuste de ${groupName(adjustment.groupId)} se quitó: la carta ya no está en el catálogo.`,
        })
      }
      continue
    }
    if (target !== adjustment.groupId) adjustments.move.push({ id: adjustment.id, groupId: target })
    if (!adjustment.active) continue
    if (targets.length > 1) {
      notes.push({
        kind: 'adjustment_split',
        review: true,
        text: `${groupName(adjustment.groupId)} se separó en ${targets.map(groupName).join(' y ')}: el ajuste quedó en ${groupName(target)}.`,
      })
    }
    const list = activeByTarget.get(target) ?? []
    list.push(adjustment)
    activeByTarget.set(target, list)
  }
  for (const [target, list] of activeByTarget) {
    if (list.length < 2) continue
    const newest = list.reduce((a, b) =>
      b.createdAt > a.createdAt || (+b.createdAt === +a.createdAt && b.id > a.id) ? b : a,
    )
    for (const adjustment of list) if (adjustment !== newest) adjustments.resolve.push(adjustment.id)
    notes.push({
      kind: 'adjustment_merge',
      review: true,
      text: `${groupName(target)} junta ahora cartas que tenían ajustes distintos: quedó el más reciente.`,
    })
  }

  // ---------- deck cards ----------
  const deckCards: CatalogRemap['deckCards'] = []
  for (const row of refs.deckCards) {
    if (nextCards.has(row.cardId)) continue
    const oldGroup = prevCards.get(row.cardId)?.functionalGroupId ?? row.cardId
    const target = groupTargets(oldGroup)[0]
    const to = target ? (nextGroups.get(target)?.displayCardId ?? null) : null
    deckCards.push({ deckId: row.deckId, from: row.cardId, to, count: row.count, position: row.position })
    notes.push(
      to
        ? {
            kind: 'deck_card_replaced',
            review: false,
            text: `Mazo ${row.deckId}: ${name(row.cardId)} dejó el catálogo; ahora juega ${name(to)}.`,
          }
        : {
            kind: 'deck_card_removed',
            review: true,
            text: `Mazo ${row.deckId}: ${name(row.cardId)} dejó el catálogo y salió del mazo (${row.count} ${row.count === 1 ? 'copia' : 'copias'}).`,
          },
    )
  }

  const keyCards: CatalogRemap['keyCards'] = []
  for (const deck of refs.keyCards) {
    const items: { functionalGroupId: CardId; role: string }[] = []
    let changed = false
    for (const item of deck.items) {
      const target = groupTargets(item.functionalGroupId)[0]
      if (target !== item.functionalGroupId) changed = true
      if (!target) {
        notes.push({
          kind: 'key_card_removed',
          review: false,
          text: `Mazo ${deck.deckId}: la carta clave ${groupName(item.functionalGroupId)} ya no está en el catálogo.`,
        })
        continue
      }
      if (!items.some((other) => other.functionalGroupId === target)) items.push({ ...item, functionalGroupId: target })
      else changed = true
    }
    if (changed) keyCards.push({ deckId: deck.deckId, items })
  }

  const eventBans: CatalogRemap['eventBans'] = []
  for (const event of refs.eventBans) {
    const banned: CardId[] = []
    let changed = false
    for (const groupId of event.banned) {
      const targets = groupTargets(groupId)
      if (targets.length !== 1 || targets[0] !== groupId) changed = true
      if (targets.length === 0) {
        notes.push({
          kind: 'event_ban_removed',
          review: false,
          text: `Evento ${event.eventId}: la carta prohibida ${groupName(groupId)} ya no está en el catálogo.`,
        })
      }
      for (const target of targets) if (!banned.includes(target)) banned.push(target)
    }
    if (changed) eventBans.push({ eventId: event.eventId, banned })
  }

  const empty =
    stock.delete.length === 0 &&
    stock.upsert.length === 0 &&
    adjustments.move.length === 0 &&
    adjustments.resolve.length === 0 &&
    adjustments.delete.length === 0 &&
    deckCards.length === 0 &&
    keyCards.length === 0 &&
    eventBans.length === 0
  return {
    stock,
    adjustments,
    deckCards,
    keyCards,
    eventBans,
    notes,
    needsReview: notes.some((note) => note.review),
    empty,
  }
}
