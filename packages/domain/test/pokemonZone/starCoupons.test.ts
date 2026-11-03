import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizePokemonZone,
  pokemonZonePayloadSchema,
  pokemonZoneSnapshotSchema,
  STAR_COUPON_TICKETS,
  starCouponCount,
} from '../../src/pokemonZone/index.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'pokemon-zone', 'payload.json')
type Ticket = { key: string; value: number; name: string }
type Raw = { v: number; mine: { resourceData: { tickets: Ticket[] } } }
const raw = (): Raw => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Raw
const snapshotOf = (payload: Raw) => normalizePokemonZone(pokemonZonePayloadSchema.parse(payload))

const ANNIVERSARY = '1 ★★ Card Guaranteed Booster Pack Exchange Tickets'
const NOW = new Date('2026-11-03T12:00:00Z')
const ANNIVERSARY_COUPON = STAR_COUPON_TICKETS[0] as (typeof STAR_COUPON_TICKETS)[number]

/** The fixture as version 2, with the mission's ★★ ticket too. */
function withMission(missions = 2): Raw {
  const payload = { ...raw(), v: 2 }
  payload.mine.resourceData.tickets = [
    ...payload.mine.resourceData.tickets,
    { key: 'TICKET_MISSION', value: missions, name: '★★ Card Guaranteed Booster Pack Exchange Ticket' },
  ]
  return payload
}

describe('Cupón ★★: the count of an import (guaranteedTickets of pz/luck)', () => {
  it('version 2: the ★★ tickets the game holds — the anniversary key, or a name with exactly two stars', () => {
    expect(starCouponCount(snapshotOf({ ...raw(), v: 2 }), NOW)).toEqual({ usable: 1, expired: [] })
    const payload = withMission()
    payload.mine.resourceData.tickets.push(
      // Not ★★: one or three stars, without the anniversary's key.
      { key: 'TICKET_ONE', value: 5, name: '1 ★ Card Guaranteed Booster Pack Exchange Tickets' },
      { key: 'TICKET_THREE', value: 7, name: '1 ★★★ Card Guaranteed Booster Pack Exchange Tickets' },
    )
    expect(starCouponCount(snapshotOf(payload), NOW)).toEqual({ usable: 3, expired: [] })
  })

  it('version 2 holding none is 0; version 1 (not seen) and an import saved before pz/luck are unknown, never 0', () => {
    const none = { ...raw(), v: 2 }
    none.mine.resourceData.tickets = none.mine.resourceData.tickets.map((ticket) =>
      ticket.name === ANNIVERSARY ? { ...ticket, value: 0 } : ticket,
    )
    expect(starCouponCount(snapshotOf(none), NOW)).toEqual({ usable: 0, expired: [] })
    const empty = { ...raw(), v: 2 }
    empty.mine.resourceData.tickets = []
    expect(starCouponCount(snapshotOf(empty), NOW)).toEqual({ usable: 0, expired: [] })
    // The fixture is a version 1 payload: it holds the anniversary's ticket, but version 1 does not count it.
    const v1 = snapshotOf(raw())
    expect(v1.guaranteedTickets).toBeNull()
    expect(starCouponCount(v1, NOW)).toBeNull()
    // A snapshot stored before pz/luck has no field at all.
    const stored = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>
    delete stored.guaranteedTickets
    expect(starCouponCount(pokemonZoneSnapshotSchema.parse(stored), NOW)).toBeNull()
  })

  it('around the anniversary deadline: until 06:59:59 UTC it is usable; from 07:00 apart, as expired; missions stay', () => {
    const snapshot = snapshotOf(withMission())
    expect(starCouponCount(snapshot, new Date('2026-12-15T06:59:59Z'))).toEqual({ usable: 3, expired: [] })
    expect(starCouponCount(snapshot, new Date('2026-12-15T07:00:00Z'))).toEqual({
      usable: 2,
      expired: [{ ...ANNIVERSARY_COUPON, count: 1 }],
    })
    // Only the anniversary's: a read without it has nothing expired, and the missions' still count.
    const missionsOnly = withMission(1)
    missionsOnly.mine.resourceData.tickets = missionsOnly.mine.resourceData.tickets.filter(
      (ticket) => ticket.key !== 'TICKET_2610000_EV_02',
    )
    expect(starCouponCount(snapshotOf(missionsOnly), new Date('2026-12-20T00:00:00Z'))).toEqual({
      usable: 1,
      expired: [],
    })
    // Version 1 stays unknown after the deadline too.
    expect(starCouponCount(snapshotOf(raw()), new Date('2026-12-20T00:00:00Z'))).toBeNull()
  })

  it('the 2nd anniversary coupon: usable until 15/12/2026 06:59 UTC, the first instant after it exclusive', () => {
    expect(STAR_COUPON_TICKETS).toEqual([
      { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
    ])
  })
})
