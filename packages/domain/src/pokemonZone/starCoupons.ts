/**
 * Cupón ★★ (3/11/2026): how many coupons for a pack with a guaranteed ★★ card a pokemon-zone import says there are,
 * and the deadlines the app knows.
 *
 * The count is not read from the payload here: #172 (pz/luck) adds it to the import (the tickets one by one and a
 * derived ★★ count, null when the import did not see them, 0 when it saw none). `starCouponCount` is the only place
 * Sobres → Cupón ★★ reads it; until #172 is merged and wired here, every import is unknown, never 0.
 */

/** A count of the game (an integer ≥ 0), or null when it is not one: «not seen» stays apart from 0. */
export function couponCountOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The coupons for a guaranteed ★★ pack an import's snapshot counts; null when it does not know them. Adapter: it
 * reads #172's ★★ count once that is merged (with `couponCountOf`); before, no import keeps it.
 */
export function starCouponCount(_snapshot: object): number | null {
  return null
}

/** A ★★ coupon whose deadline the app knows. */
export interface StarCouponTicket {
  /** pokemon-zone's ticket key. */
  key: string
  nameEs: string
  /** The first instant it can no longer be used (UTC, exclusive: the game says the minute before). */
  until: string
}

/**
 * The 2nd anniversary's coupon, usable until 15/12/2026 06:59 UTC (03:59 in Buenos Aires). The one of the «★★
 * garantizada» missions has no known deadline yet.
 */
export const STAR_COUPON_TICKETS: readonly StarCouponTicket[] = [
  { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
]
