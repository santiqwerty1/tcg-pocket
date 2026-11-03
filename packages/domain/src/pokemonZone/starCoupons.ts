/**
 * Cupón ★★ (3/11/2026): how many coupons for a pack with a guaranteed ★★ card a pokemon-zone import says there are,
 * and the deadlines the app knows.
 *
 * The count comes from the import's `guaranteedTickets` (pz/luck, #172) through `starStarTickets`: the anniversary's
 * key or a name with exactly two stars. `null` (not seen: the bookmarklet's version 1, or an import saved before
 * pz/luck) stays «unknown», never 0; `[]` (seen, none held) is 0.
 *
 * An import read before a known coupon's deadline still holds it after the deadline (follow-up of #173): those copies
 * are counted apart as expired, never as usable. The other ★★ tickets (the missions') count as they are.
 */
import { type PokemonZoneSnapshot, STAR_STAR_TICKET_KEY, starStarTickets } from './payload.js'

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
  { key: STAR_STAR_TICKET_KEY, nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
]

export interface StarCouponCount {
  /** ★★ coupons that can still be used at `now`. */
  usable: number
  /** Known coupons the import holds that are past their deadline at `now`, with how many. */
  expired: (StarCouponTicket & { count: number })[]
}

/** The ★★ coupons an import counts at `now`; null when it did not see them. */
export function starCouponCount(
  snapshot: Pick<PokemonZoneSnapshot, 'guaranteedTickets'>,
  now: Date,
  known: readonly StarCouponTicket[] = STAR_COUPON_TICKETS,
): StarCouponCount | null {
  const tickets = snapshot.guaranteedTickets
  const total = starStarTickets(tickets)
  if (tickets === null || total === null) return null
  const time = now.getTime()
  const expired = known
    .filter((ticket) => Date.parse(ticket.until) <= time)
    .map((ticket) => ({
      ...ticket,
      count: tickets.filter((item) => item.key === ticket.key).reduce((sum, item) => sum + item.count, 0),
    }))
    .filter((ticket) => ticket.count > 0)
  return { usable: Math.max(0, total - expired.reduce((sum, ticket) => sum + ticket.count, 0)), expired }
}
