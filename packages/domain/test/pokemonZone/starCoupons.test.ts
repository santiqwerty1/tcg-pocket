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

describe('Cupón ★★: the count of an import (guaranteedTickets of pz/luck)', () => {
  it('version 2: the ★★ tickets the game holds — the anniversary key, or a name with exactly two stars', () => {
    const payload = { ...raw(), v: 2 }
    expect(starCouponCount(snapshotOf(payload))).toBe(1)
    payload.mine.resourceData.tickets = [
      ...payload.mine.resourceData.tickets,
      { key: 'TICKET_MISSION', value: 2, name: '★★ Card Guaranteed Booster Pack Exchange Ticket' },
      // Not ★★: one or three stars, without the anniversary's key.
      { key: 'TICKET_ONE', value: 5, name: '1 ★ Card Guaranteed Booster Pack Exchange Tickets' },
      { key: 'TICKET_THREE', value: 7, name: '1 ★★★ Card Guaranteed Booster Pack Exchange Tickets' },
    ]
    expect(starCouponCount(snapshotOf(payload))).toBe(3)
  })

  it('version 2 holding none is 0; version 1 (not seen) and an import saved before pz/luck are unknown, never 0', () => {
    const none = { ...raw(), v: 2 }
    none.mine.resourceData.tickets = none.mine.resourceData.tickets.map((ticket) =>
      ticket.name === ANNIVERSARY ? { ...ticket, value: 0 } : ticket,
    )
    expect(starCouponCount(snapshotOf(none))).toBe(0)
    const empty = { ...raw(), v: 2 }
    empty.mine.resourceData.tickets = []
    expect(starCouponCount(snapshotOf(empty))).toBe(0)
    // The fixture is a version 1 payload: it holds the anniversary's ticket, but version 1 does not count it.
    const v1 = snapshotOf(raw())
    expect(v1.guaranteedTickets).toBeNull()
    expect(starCouponCount(v1)).toBeNull()
    // A snapshot stored before pz/luck has no field at all.
    const stored = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>
    delete stored.guaranteedTickets
    expect(starCouponCount(pokemonZoneSnapshotSchema.parse(stored))).toBeNull()
  })

  it('the 2nd anniversary coupon: usable until 15/12/2026 06:59 UTC, the first instant after it exclusive', () => {
    expect(STAR_COUPON_TICKETS).toEqual([
      { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
    ])
  })
})
