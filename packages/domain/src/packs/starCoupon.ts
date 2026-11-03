/**
 * Cupón ★★ (3/11/2026): the game sometimes gives a coupon that opens one pack of the shop with a guaranteed ★★ card
 * (the app's rarity ☆☆; pokemon-zone's SR and SAR are both ☆☆): the 2nd anniversary's and the one of the «★★
 * garantizada» missions. Which pack to open it on, with the collection and the decks of that day.
 *
 * - Pool: the pack's ☆☆ cards (`packProfile(...).cards` with that rarity). Every one of them is taken as equally
 *   likely, as the pack model treats the cards of one rarity at one position.
 * - For the decks: the deck goals of Sobres (decks with pack priority, the saved list or its tournament version) and the
 *   functional cards they still lack, exactly as the recommendation counts them (`deckDeficits` over the playable copies
 *   of every edition). A pool card counts when its functional card is one of those: any edition does for a deck.
 * - New: an edition (version, by the tracker's internal id) with no copy. Below the goal: fewer copies of it than
 *   Sobres' «Copias por edición» (`collectionWanted`, the collection goal's own rule).
 * - Order: the share for the decks, then the share of new editions, then the share below the goal, each compared
 *   exactly as k/n; then the pack id. Packs not on sale are left out (`packOnSale`, the recommendation's rule), and a
 *   pack without ☆☆ cards has no row.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId, Rarity } from '../catalog/types.js'
import { collectionWanted, type DeckGoal, deckDeficits } from './goals.js'
import { packProfile } from './pullRate.js'
import { daysBetween, type LimitedPack, packOnSale } from './recommend.js'

/** The rarity the coupon guarantees. */
export const STAR_COUPON_RARITY: Rarity = '☆☆'

export interface StarCouponCard {
  cardId: CardId
  groupId: CardId
  nameEs: string
  /** Copies of this edition (reprints with the same internal id share them). */
  owned: number
  /** Deck goals that lack copies of its functional card (their names, as Sobres shows them). */
  decks: string[]
  /** No copy of this edition. */
  newEdition: boolean
  /** Fewer copies of this edition than the collection goal asks for. */
  belowGoal: boolean
}

export interface StarCouponPack {
  packId: string
  expansionId: string
  /** ☆☆ cards of the pack, each one equally likely. */
  size: number
  /** Pool cards whose functional card a deck goal lacks. */
  forDecks: number
  /** Pool cards whose edition has no copy. */
  newEditions: number
  /** Pool cards whose edition has fewer copies than the goal. */
  belowGoal: number
  /** forDecks / size, newEditions / size and belowGoal / size (0–1). */
  chanceDecks: number
  chanceNew: number
  chanceBelowGoal: number
  cards: StarCouponCard[]
  /** A limited-time pack on sale: its last day and the days left (0 = the last one). */
  limited: { until: string | null; daysLeft: number | null } | null
}

export interface StarCouponPlan {
  rarity: Rarity
  /** «Copias por edición» of the collection goal. */
  goalCopies: number
  /** Packs on sale with ☆☆ cards, best first. */
  packs: StarCouponPack[]
  /** The packs tied with the first in the three shares; [] when no pack gives anything useful. */
  best: string[]
}

export interface StarCouponInput {
  index: CatalogIndex
  /** The deck goals of Sobres (decks with priority 0 are not goals). */
  decks: readonly DeckGoal[]
  playable: (groupId: CardId) => number
  owned: (stockCardId: CardId) => number
  /** «Copias por edición» (≥ 1). */
  copies: number
  available: (packId: string) => boolean
  limited?: (packId: string) => LimitedPack | null
  /** Today in the owner's time zone (YYYY-MM-DD): a limited pack past its last day is not on sale. */
  today?: string
}

/** The three counts, in order of importance; each is a share k / size. */
const tiers = (pack: StarCouponPack) => [pack.forDecks, pack.newEditions, pack.belowGoal]

/** Higher share first, tier by tier, comparing k/n exactly (cross-multiplied, so 4/15 and 8/30 tie). */
export function compareStarCouponPacks(a: StarCouponPack, b: StarCouponPack): number {
  const ka = tiers(a)
  const kb = tiers(b)
  for (let i = 0; i < ka.length; i++) {
    const diff = (kb[i] ?? 0) * a.size - (ka[i] ?? 0) * b.size
    if (diff !== 0) return diff
  }
  return 0
}

export function starCouponPlan(input: StarCouponInput): StarCouponPlan {
  const { index } = input
  const copies = Math.max(1, Math.floor(input.copies))
  // What the decks lack: the recommendation's deficits (max over decks, priority > 0 only).
  const lacking = new Map<CardId, string[]>()
  for (const deficit of deckDeficits(input.decks, index, input.playable)) {
    lacking.set(
      deficit.groupId,
      deficit.decks.map((deck) => deck.name),
    )
  }
  // The collection goal's rule, restricted to the coupon's rarity: versions with no copy, and with fewer than `copies`.
  const rarities = [STAR_COUPON_RARITY]
  const unowned = new Set(collectionWanted(index, input.owned, { rarities, copies: 1 }).map((card) => card.internalId))
  const below = new Set(collectionWanted(index, input.owned, { rarities, copies }).map((card) => card.internalId))

  const packs: StarCouponPack[] = []
  for (const pack of index.catalog.packs) {
    if (!packOnSale(pack.id, input.available, input.limited, input.today)) continue
    const profile = packProfile(pack.id, index)
    if (!profile) continue
    const pool = profile.cards.filter((card) => card.rarity === STAR_COUPON_RARITY)
    if (pool.length === 0) continue
    const cards = pool.map(
      (card): StarCouponCard => ({
        cardId: card.id,
        groupId: card.functionalGroupId,
        nameEs: card.nameEs,
        owned: input.owned(card.stockCardId),
        decks: lacking.get(card.functionalGroupId) ?? [],
        newEdition: unowned.has(card.internalId),
        belowGoal: below.has(card.internalId),
      }),
    )
    const forDecks = cards.filter((card) => card.decks.length > 0).length
    const newEditions = cards.filter((card) => card.newEdition).length
    const belowGoal = cards.filter((card) => card.belowGoal).length
    const limited = input.limited?.(pack.id) ?? null
    packs.push({
      packId: pack.id,
      expansionId: profile.expansionId,
      size: cards.length,
      forDecks,
      newEditions,
      belowGoal,
      chanceDecks: forDecks / cards.length,
      chanceNew: newEditions / cards.length,
      chanceBelowGoal: belowGoal / cards.length,
      cards,
      limited: limited
        ? {
            until: limited.until,
            daysLeft: limited.until && input.today ? daysBetween(input.today, limited.until) : null,
          }
        : null,
    })
  }
  packs.sort((a, b) => compareStarCouponPacks(a, b) || a.packId.localeCompare(b.packId, 'en', { numeric: true }))
  const top = packs[0]
  const best =
    top && tiers(top).some((count) => count > 0)
      ? packs.filter((pack) => compareStarCouponPacks(pack, top) === 0).map((pack) => pack.packId)
      : []
  return { rarity: STAR_COUPON_RARITY, goalCopies: copies, packs, best }
}
