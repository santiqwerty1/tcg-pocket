/**
 * Promo card exchange coupons (Sobres de promoción): each event's missions give coupons that its shop exchanges for a
 * promo card. An import says how many of each event's the owner has; an event the app knows (PROMO_EVENTS, by its
 * English name) gets its Spanish name and says whether it is on now. Since 3/11/2026, also the ★★-guaranteed pack
 * coupons (Sobres → Cupón ★★).
 */
import { PROMO_EVENTS, type PromoEvent } from '../packs/promo.js'
import type { PokemonZoneSnapshot } from './payload.js'

export interface PromoCouponStatus {
  /** pokemon-zone's ticket key. */
  key: string
  /** The event as the game names it, in English. */
  event: string
  count: number
  /** The app's event, when it knows it. */
  eventId: string | null
  nameEs: string | null
  /** Its battles are on at `now` (false for an event the app does not know). */
  active: boolean
}

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** The coupons of an import, the active event's first, then by count. Coupons at 0 are left out. */
export function promoCoupons(
  snapshot: Pick<PokemonZoneSnapshot, 'coupons'>,
  now: Date,
  events: readonly PromoEvent[] = PROMO_EVENTS,
): PromoCouponStatus[] {
  const time = now.getTime()
  return snapshot.coupons
    .filter((coupon) => coupon.count > 0)
    .map((coupon): PromoCouponStatus => {
      const event = events.find((item) => item.nameEn !== undefined && fold(item.nameEn) === fold(coupon.event))
      return {
        key: coupon.key,
        event: coupon.event,
        count: coupon.count,
        eventId: event?.id ?? null,
        nameEs: event?.nameEs ?? null,
        active: event ? Date.parse(event.from) <= time && time < Date.parse(event.until) : false,
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count || a.event.localeCompare(b.event))
}

/** A ★★-guaranteed pack coupon the app knows by its ticket key. */
export interface StarCouponTicket {
  key: string
  nameEs: string
  /** The first instant it can no longer be used (UTC, exclusive: the game says the minute before); null = unknown. */
  until: string | null
}

/**
 * Cupón ★★ (3/11/2026): the 2nd anniversary's coupon, usable until 15/12/2026 06:59 UTC (03:59 in Buenos Aires). The
 * one of the «★★ garantizada» missions comes with another key: it counts too, without a known name or deadline.
 */
export const STAR_COUPON_TICKETS: readonly StarCouponTicket[] = [
  { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
]

export interface StarCouponStatus {
  key: string
  /** The game's name, in English. */
  name: string
  count: number
  /** The app's name and deadline when it knows the key. */
  nameEs: string | null
  until: string | null
  /** Its deadline passed at `now`: the import's count no longer opens anything. */
  expired: boolean
}

/**
 * The ★★ coupons of an import, the soonest to expire first; coupons at 0 are left out. Null when the import does not
 * know them (its bookmarklet is older than 3/11/2026): not «none».
 */
export function starCoupons(
  snapshot: Pick<PokemonZoneSnapshot, 'starTickets'>,
  now: Date,
  known: readonly StarCouponTicket[] = STAR_COUPON_TICKETS,
): StarCouponStatus[] | null {
  if (!snapshot.starTickets) return null
  const time = now.getTime()
  return snapshot.starTickets
    .filter((ticket) => ticket.count > 0)
    .map((ticket): StarCouponStatus => {
      const kind = known.find((item) => item.key === ticket.key)
      const until = kind?.until ?? null
      return {
        key: ticket.key,
        name: ticket.name,
        count: ticket.count,
        nameEs: kind?.nameEs ?? null,
        until,
        expired: until !== null && Date.parse(until) <= time,
      }
    })
    .sort(
      (a, b) =>
        Number(a.expired) - Number(b.expired) ||
        (a.until === null ? 1 : 0) - (b.until === null ? 1 : 0) ||
        (a.until && b.until ? Date.parse(a.until) - Date.parse(b.until) : 0) ||
        a.key.localeCompare(b.key),
    )
}
