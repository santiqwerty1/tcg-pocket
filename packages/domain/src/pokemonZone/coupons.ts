/**
 * Promo card exchange coupons (Sobres de promoción): each event's missions give coupons that its shop exchanges for a
 * promo card. An import says how many of each event's the owner has; an event the app knows (PROMO_EVENTS, and the
 * events with coupons and no battles, PROMO_COUPON_EVENTS; by its English name) gets its Spanish name and says whether
 * it is on now.
 */
import { PROMO_COUPON_EVENTS, PROMO_EVENTS, type PromoCouponEvent } from '../packs/promo.js'
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
  /** The event is on at `now` (false for an event the app does not know). */
  active: boolean
  /** Its last instant (ISO, exclusive), when the app knows the event. */
  until: string | null
}

const fold = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** The coupons of an import, the active event's first, then by count. Coupons at 0 are left out. */
export function promoCoupons(
  snapshot: Pick<PokemonZoneSnapshot, 'coupons'>,
  now: Date,
  events: readonly PromoCouponEvent[] = [...PROMO_EVENTS, ...PROMO_COUPON_EVENTS],
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
        until: event?.until ?? null,
      }
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count || a.event.localeCompare(b.event))
}
