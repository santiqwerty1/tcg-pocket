/**
 * Sobres de promoción (30/10/2026): the promo packs of the game's events, one per volume of each promo series. A
 * promo pack brings ONE card of its volume, and each volume has its own event battle that can be won again and again
 * (every win gives that volume's pack). So the question is which battle to win next: the volume where a win most
 * likely brings a print the collection lacks (or a card a deck lacks), and how many wins finishing each one takes.
 *
 * - Contents: the tracker data does not say which volume a promo comes from (every promo is `everypack`). Serebii's
 *   Promo-A and Promo-B lists mark the cards «obtained from a promo pack»: runs of consecutive numbers, 5 per volume
 *   (7 in A vol. 9), the volumes in order. Checked against Dittobase for A 7, A 9, A 13, B 1, B 7 and B 8.
 * - Rates: the game does not publish them; every card of a volume is taken as equally likely.
 * - Wins to finish a volume with m of its n prints missing: the coupon collector, n · (1 + 1/2 + … + 1/m).
 * - Coupons (event missions give coupons for a promo card of the shop): one spent now on a volume with m missing
 *   saves n/m wins; kept for the volume's last missing print it saves n (k coupons kept for the last k: n · H(k)).
 *   So the advice is to win until one print is missing and take that one with a coupon.
 * - Which battle (Santi, 30/10/2026): by the chance of a card a deck lacks, then of a card not owned in any print,
 *   then of any missing print, each compared exactly as a fraction; one of the volumes still tied in all three is
 *   picked at random on every call. Without an event there is no battle: no pick, only the ranking.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { CollectionAdjustment } from '../collection/adjustments.js'
import { playableCopies } from '../collection/playable.js'
import { type StockQuantities, stockValueOf } from '../collection/stock.js'
import type { TradeDeck } from '../collection/trades.js'

export type PromoSeries = 'A' | 'B'

export interface PromoVolume {
  /** «A7», «B1»… */
  id: string
  series: PromoSeries
  volume: number
  cardIds: CardId[]
}

function volume(series: PromoSeries, number: number, first: number, last: number): PromoVolume {
  const cardIds: CardId[] = []
  for (let n = first; n <= last; n++) cardIds.push(`P-${series}-${n}`)
  return { id: `${series}${number}`, series, volume: number, cardIds }
}

/** Promo packs A Series Vol. 1–13 and B Series Vol. 1–13, in release order. */
export const PROMO_VOLUMES: readonly PromoVolume[] = [
  volume('A', 1, 13, 17),
  volume('A', 2, 18, 22),
  volume('A', 3, 27, 31),
  volume('A', 4, 35, 39),
  volume('A', 5, 43, 47),
  volume('A', 6, 53, 57),
  volume('A', 7, 60, 64),
  volume('A', 8, 69, 73),
  volume('A', 9, 75, 81),
  volume('A', 10, 85, 89),
  volume('A', 11, 94, 98),
  volume('A', 12, 102, 106),
  volume('A', 13, 111, 115),
  volume('B', 1, 2, 6),
  volume('B', 2, 13, 17),
  volume('B', 3, 20, 24),
  volume('B', 4, 26, 30),
  volume('B', 5, 34, 38),
  volume('B', 6, 42, 46),
  volume('B', 7, 50, 54),
  volume('B', 8, 56, 60),
  volume('B', 9, 64, 68),
  volume('B', 10, 72, 76),
  volume('B', 11, 80, 84),
  volume('B', 12, 88, 92),
  volume('B', 13, 96, 100),
]

export interface PromoEvent {
  id: string
  nameEs: string
  /** First instant of its battles and the first instant after them (UTC; `until` is exclusive). */
  from: string
  until: string
  /** Volumes with a battle during the event. */
  volumes: string[]
}

/** Events with promo battles, as the game's news gives them. */
export const PROMO_EVENTS: readonly PromoEvent[] = [
  {
    id: 'botin-bis-promo-2026',
    nameEs: 'Evento botín bis PROMO 2026',
    // 30/10/2026 03:00 – 13/11/2026 02:59 in Buenos Aires (UTC−3): over at 03:00.
    from: '2026-10-30T06:00:00Z',
    until: '2026-11-13T06:00:00Z',
    volumes: ['A7', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13'],
  },
]

/** The event whose battles are on at `now`, if any. */
export function activePromoEvent(now: Date, events: readonly PromoEvent[] = PROMO_EVENTS): PromoEvent | null {
  const time = now.getTime()
  return events.find((event) => Date.parse(event.from) <= time && time < Date.parse(event.until)) ?? null
}

/** Expected wins to get every one of `missing` prints of a volume of `size` equally likely cards. */
export function winsToComplete(size: number, missing: number): number {
  let harmonic = 0
  for (let k = 1; k <= missing; k++) harmonic += 1 / k
  return size * harmonic
}

export interface PromoCardStatus {
  cardId: CardId
  groupId: CardId
  nameEs: string
  /** False for a promo the catalog does not have yet (its id stands for the name). */
  inCatalog: boolean
  /** Copies of this print (its stock unit). */
  owned: number
  /** No copy of this print: a win that brings it adds it to the collection. */
  missing: boolean
  /** No copy of the card in any print: a card to play that the collection does not have. */
  newCard: boolean
  /** Decks (not archived) that lack copies of this card. */
  decks: string[]
}

/** Why a volume ranks where it does: the first tier where it has something (decks, then new cards, then prints). */
export type PromoReason = 'decks' | 'new' | 'missing'

export interface PromoVolumeStatus {
  id: string
  series: PromoSeries
  volume: number
  cards: PromoCardStatus[]
  /** Prints of the volume the collection lacks. */
  missing: number
  /** Probability (0–1) that a win brings a print the collection lacks. */
  chanceMissing: number
  /** Probability (0–1) that a win brings a card not owned in any print. */
  chanceNew: number
  /** Probability (0–1) that a win brings a card some deck lacks. */
  chanceDecks: number
  /** Probability (0–1) that a win brings a print the collection lacks or a card a deck lacks. */
  chanceUseful: number
  /** Cards of the volume the collection has in no print. */
  newCards: number
  /** Cards of the volume some deck lacks. */
  deckCards: number
  /** The first tier where it has something; null when a win brings nothing useful. */
  reason: PromoReason | null
  /** Expected wins to have every print of the volume (0 when complete). */
  winsToComplete: number
  /**
   * Wins one coupon spent now on one of its missing prints saves when the goal is the whole volume (n/m); null when
   * complete. For one card wanted on its own (a deck's), or the volume's last missing print, a coupon saves n.
   */
  couponSavesNow: number | null
  /** It has a battle in the active event. */
  inEvent: boolean
}

export interface PromoPlan {
  event: PromoEvent | null
  /** The event's volumes first, then by chance of a deck's card, of a new card and of a missing print. */
  volumes: PromoVolumeStatus[]
  /** The event's volumes tied at the top in the three chances; [] without an event or when no battle brings anything. */
  best: string[]
  /** One of `best`, at random on every call (they are equally good); null when `best` is empty. */
  pick: string | null
  /** Over the event's volumes, or every volume when no event is on. */
  totals: { volumes: number; cards: number; missing: number; winsToComplete: number }
}

function cardStatus(
  index: CatalogIndex,
  stock: StockQuantities,
  playable: ReturnType<typeof playableCopies>,
  lacking: ReadonlyMap<CardId, string[]>,
  cardId: CardId,
): PromoCardStatus {
  const card = index.cardById(cardId)
  // A promo the catalog does not have yet: still one of the volume's cards, and none owned.
  if (!card) {
    return {
      cardId,
      groupId: cardId,
      nameEs: cardId,
      inCatalog: false,
      owned: 0,
      missing: true,
      newCard: true,
      decks: [],
    }
  }
  const owned = stockValueOf(stock, card.stockCardId).amountOwned
  return {
    cardId,
    groupId: card.functionalGroupId,
    nameEs: card.nameEs,
    inCatalog: true,
    owned,
    missing: owned === 0,
    newCard: (playable.get(card.functionalGroupId)?.playable ?? 0) === 0,
    decks: lacking.get(card.functionalGroupId) ?? [],
  }
}

/** The counts of the three tiers, in order; each is a chance k / (cards in the volume). */
const tiers = (status: PromoVolumeStatus) => [status.deckCards, status.newCards, status.missing]

/** Higher chance first, tier by tier, comparing k/n exactly (cross-multiplied: volumes have 5 or 7 cards). */
function compareTiers(a: PromoVolumeStatus, b: PromoVolumeStatus): number {
  const ka = tiers(a)
  const kb = tiers(b)
  for (let i = 0; i < ka.length; i++) {
    const diff = (kb[i] ?? 0) * a.cards.length - (ka[i] ?? 0) * b.cards.length
    if (diff !== 0) return diff
  }
  return 0
}

export function promoPlan(input: {
  index: CatalogIndex
  stock: StockQuantities
  adjustments?: readonly CollectionAdjustment[]
  decks?: readonly TradeDeck[]
  now: Date
  volumes?: readonly PromoVolume[]
  events?: readonly PromoEvent[]
  /** For the pick among ties; Math.random by default. */
  random?: () => number
}): PromoPlan {
  const { index, stock } = input
  const volumes = input.volumes ?? PROMO_VOLUMES
  const event = activePromoEvent(input.now, input.events)
  const playable = playableCopies(index, stock, input.adjustments)

  const lacking = new Map<CardId, string[]>()
  for (const deck of input.decks ?? []) {
    for (const [groupId, count] of deck.groups) {
      if (count <= (playable.get(groupId)?.playable ?? 0)) continue
      lacking.set(groupId, [...(lacking.get(groupId) ?? []), deck.name])
    }
  }

  const statuses = volumes.map((promo): PromoVolumeStatus => {
    const cards = promo.cardIds.map((cardId) => cardStatus(index, stock, playable, lacking, cardId))
    const size = cards.length
    const missing = cards.filter((card) => card.missing).length
    const newCards = cards.filter((card) => card.newCard).length
    const deckCards = cards.filter((card) => card.decks.length > 0).length
    const useful = cards.filter((card) => card.missing || card.decks.length > 0).length
    return {
      id: promo.id,
      series: promo.series,
      volume: promo.volume,
      cards,
      missing,
      chanceMissing: missing / size,
      chanceNew: newCards / size,
      chanceDecks: deckCards / size,
      chanceUseful: useful / size,
      newCards,
      deckCards,
      reason: deckCards > 0 ? 'decks' : newCards > 0 ? 'new' : missing > 0 ? 'missing' : null,
      winsToComplete: winsToComplete(size, missing),
      couponSavesNow: missing > 0 ? size / missing : null,
      inEvent: event?.volumes.includes(promo.id) ?? false,
    }
  })

  const order = new Map(volumes.map((promo, i) => [promo.id, i]))
  const ranked = [...statuses].sort(
    (a, b) =>
      Number(b.inEvent) - Number(a.inEvent) || compareTiers(a, b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  )
  // Only an event's volumes have a battle: without one there is nothing to win, only the ranking.
  const inEvent = ranked.filter((status) => status.inEvent)
  const top = inEvent[0]
  const best =
    top && top.reason !== null
      ? inEvent.filter((status) => compareTiers(status, top) === 0).map((status) => status.id)
      : []
  const random = input.random ?? Math.random
  const pick = best.length > 0 ? (best[Math.min(best.length - 1, Math.floor(random() * best.length))] ?? null) : null
  const counted = event ? inEvent : ranked

  return {
    event,
    volumes: ranked,
    best,
    pick,
    totals: {
      volumes: counted.length,
      cards: counted.reduce((sum, status) => sum + status.cards.length, 0),
      missing: counted.reduce((sum, status) => sum + status.missing, 0),
      winsToComplete: counted.reduce((sum, status) => sum + status.winsToComplete, 0),
    },
  }
}
