/**
 * packs_star_coupon (3/11/2026): Cupón ★★ for the model — the packs on sale ranked for a ★★-guaranteed coupon, each
 * share as «k de n (p %)», the cards that count, and the coupons of the latest pokemon-zone import. Dates in Buenos
 * Aires; names that come from the payload only as safe plain text.
 */
import { formatPercentEs } from '@tcg/domain'
import type { StarCouponPackView, StarCouponView } from '../packs/pack-views.js'
import { ownerDateTime, safeName } from './mcp-pokemon-zone-json.js'

type Json = Record<string, unknown>

/** Packs listed by default. */
export const STAR_COUPON_DEFAULT_LIMIT = 5

/** «4 de 15 (26,7 %)». */
function share(count: number, size: number): string {
  return `${count} de ${size} (${formatPercentEs((count / size) * 100)})`
}

/** `until` is exclusive: the game says the minute before («hasta el 15/12/2026, 03:59»). */
const lastMinute = (until: string) => ownerDateTime(new Date(Date.parse(until) - 60_000).toISOString())

function packJson(pack: StarCouponPackView): Json {
  return {
    pack: `${pack.nameEs} (${pack.expansionId})`,
    packId: pack.packId,
    starCards: pack.size,
    forDecks: share(pack.forDecks, pack.size),
    newEditions: share(pack.newEditions, pack.size),
    belowGoal: share(pack.belowGoal, pack.size),
    cardsForDecks: pack.cards
      .filter((card) => card.decks.length > 0)
      .map((card) => ({ card: card.nameEs, cardId: card.cardId, decks: card.decks })),
    newCards: pack.cards.filter((card) => card.newEdition).map((card) => `${card.nameEs} ${card.cardId}`),
    ...(pack.limited ? { limitedUntil: pack.limited.until } : {}),
  }
}

function couponsJson(view: StarCouponView): Json | null {
  const { coupons } = view
  if (!coupons) return null
  const gameReadAt = ownerDateTime(coupons.syncedAt)
  if (coupons.items === null) {
    return {
      status: 'unknown',
      gameReadAt,
      note: 'La última importación de pokemon-zone es de un marcador anterior al 3/11/2026, que no lee estos cupones: hay que copiar el marcador nuevo (Colección → pokemon-zone) e importar de nuevo.',
    }
  }
  const usable = coupons.items.filter((item) => !item.expired)
  return {
    status: 'known',
    gameReadAt,
    total: usable.reduce((sum, item) => sum + item.count, 0),
    items: coupons.items.map((item) => ({
      coupon: item.nameEs ?? `otro cupón ★★ («${safeName(item.name)}»)`,
      count: item.count,
      usableUntil: item.until ? lastMinute(item.until) : null,
      ...(item.expired ? { expired: true } : {}),
    })),
  }
}

export function starCouponJson(view: StarCouponView, limit = STAR_COUPON_DEFAULT_LIMIT): Json {
  const names = new Map(view.packs.map((pack) => [pack.packId, `${pack.nameEs} (${pack.expansionId})`]))
  return {
    rarity: '☆☆ (★★ en el juego)',
    deckTarget: view.deckTarget,
    goalCopiesPerEdition: view.goalCopies,
    deckGoals: view.goals.map((goal) => goal.name),
    collectionUpdatedAt: view.lastImportAt ? ownerDateTime(view.lastImportAt) : null,
    coupons: couponsJson(view),
    knownCoupons: view.known.map((ticket) => ({
      coupon: ticket.nameEs,
      usableUntil: ticket.until ? lastMinute(ticket.until) : null,
    })),
    best: view.best.map((packId) => names.get(packId) ?? packId),
    packs: view.packs.slice(0, limit).map(packJson),
    morePacks: Math.max(0, view.packs.length - limit),
    notes: [
      'Cada sobre se mira por su carta ☆☆ garantizada, con todas sus ☆☆ con la misma chance.',
      'forDecks: cartas ☆☆ cuya carta funcional les falta a los mazos objetivo de Sobres (cualquier versión sirve). newEditions: ediciones sin ninguna copia. belowGoal: ediciones con menos copias que goalCopiesPerEdition.',
      'Orden: forDecks, después newEditions, después belowGoal, cada uno como fracción exacta; best son los empatados arriba.',
      'Fechas en hora de Buenos Aires. Solo los sobres a la venta (los apagados en Sobres → Ajustes o vencidos no aparecen).',
    ],
  }
}
