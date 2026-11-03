import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  couponCountOf,
  normalizePokemonZone,
  pokemonZonePayloadSchema,
  STAR_COUPON_TICKETS,
  starCouponCount,
} from '../../src/pokemonZone/index.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'pokemon-zone', 'payload.json')

describe('Cupón ★★: the count of an import', () => {
  it('a count is an integer ≥ 0, 0 included; anything else is «not seen», never 0', () => {
    expect(couponCountOf(2)).toBe(2)
    expect(couponCountOf(0)).toBe(0)
    expect(couponCountOf(null)).toBeNull()
    expect(couponCountOf(undefined)).toBeNull()
    expect(couponCountOf(-1)).toBeNull()
    expect(couponCountOf(1.5)).toBeNull()
    expect(couponCountOf(Number.NaN)).toBeNull()
    expect(couponCountOf('2')).toBeNull()
  })

  it('until #172 is wired, an import does not know them: unknown, not 0', () => {
    const snapshot = normalizePokemonZone(pokemonZonePayloadSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8'))))
    expect(starCouponCount(snapshot)).toBeNull()
    // Not the sum of every guaranteed-pack ticket, whatever its rarity.
    expect(starCouponCount({ ...snapshot, guaranteedPackTickets: 3 })).toBeNull()
  })

  it('the 2nd anniversary coupon: usable until 15/12/2026 06:59 UTC, the first instant after it exclusive', () => {
    expect(STAR_COUPON_TICKETS).toEqual([
      { key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' },
    ])
  })
})
