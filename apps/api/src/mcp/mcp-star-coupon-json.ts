/**
 * packs_star_coupon (3/11/2026): Cupón ★★ for the model — the packs on sale ranked for a ★★-guaranteed coupon, each
 * share as «k de n (p %)», the cards that count, and the coupons the latest pokemon-zone import counts. Dates in
 * Buenos Aires.
 */
import { formatPercentEs } from '@tcg/domain'
import type { StarCouponPackView, StarCouponView } from '../packs/pack-views.js'
import { ownerDateTime } from './mcp-pokemon-zone-json.js'

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
  if (coupons.count === null) {
    return {
      status: 'unknown',
      gameReadAt,
      note: 'La última importación de pokemon-zone no cuenta estos cupones (es de un marcador anterior): hay que copiar el marcador nuevo (Colección → pokemon-zone) e importar de nuevo.',
    }
  }
  // The game's count at its read: a coupon spent since then still counts until the next import; a known coupon past
  // its deadline goes apart, as expired, never in `count`.
  return {
    status: 'known',
    gameReadAt,
    count: coupons.count,
    ...(coupons.expired.length > 0
      ? {
          expired: coupons.expired.map((ticket) => ({
            coupon: ticket.nameEs,
            count: ticket.count,
            expiredAt: lastMinute(ticket.until),
          })),
        }
      : {}),
  }
}

const TIE_BREAKS: Record<NonNullable<StarCouponView['tieBreak']>, string> = {
  limited: 'el primero es un sobre por tiempo limitado que termina antes',
  newest: 'el primero es de la expansión más nueva',
  id: 'misma expansión: por el id del sobre',
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
    knownCoupons: view.known.map((ticket) => ({ coupon: ticket.nameEs, usableUntil: lastMinute(ticket.until) })),
    best: view.best.map((packId) => names.get(packId) ?? packId),
    ...(view.tieBreak ? { tieBreak: TIE_BREAKS[view.tieBreak] } : {}),
    packs: view.packs.slice(0, limit).map(packJson),
    morePacks: Math.max(0, view.packs.length - limit),
    notes: [
      'Cada sobre se mira por su carta ☆☆ garantizada, con todas sus ☆☆ con la misma chance.',
      'forDecks: cartas ☆☆ cuya carta funcional les falta a los mazos objetivo de Sobres (cualquier versión sirve). newEditions: ediciones sin ninguna copia. belowGoal: ediciones con menos copias que goalCopiesPerEdition.',
      'Orden: forDecks, después newEditions, después belowGoal, cada uno como fracción exacta; best son los empatados arriba. Entre empatados: primero un sobre por tiempo limitado a la venta (el que termina antes), después la expansión más nueva, después el id del sobre (tieBreak dice cuál decidió el primero).',
      'coupons.count: los cupones ★★ que se pueden usar; coupons.expired: los conocidos que la importación todavía tenía pero ya vencieron (no se pueden usar).',
      'Fechas en hora de Buenos Aires. Solo los sobres a la venta (los apagados en Sobres → Ajustes o vencidos no aparecen).',
    ],
  }
}
