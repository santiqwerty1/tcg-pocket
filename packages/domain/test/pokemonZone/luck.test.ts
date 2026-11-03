import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkTier,
  countedSpans,
  INCLUSION_SD,
  type LuckChainPoint,
  type LuckSnapshot,
  lifetimeSources,
  normalizePokemonZone,
  parsePokemonZone,
  pokemonZoneLuck,
  pokemonZoneLuckSinceFirst,
  pokemonZonePayloadSchema,
  SPECIAL_PICK_SHARE,
  SPECIAL_PICK_WINDOWS,
  spanSources,
  type TierParts,
} from '../../src/pokemonZone/index.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

/**
 * pz/luck (3/11/2026): Santi's two real reads of the game (2/11 and 3/11; the identity is made up), and made-up days
 * after «Evento bis PROMO 2026» for what the rules do when the cards of unknown origin are few.
 */
const index = catalogIndex()
const DIR = join(import.meta.dirname, '..', 'fixtures', 'pokemon-zone')
const rawFixture = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>
const real = (name: string) => parsePokemonZone(pokemonZonePayloadSchema.parse(rawFixture(name)))
const NOV_02 = real('real-2026-11-02.json')
const NOV_03 = real('real-2026-11-03.json')

type Day = LuckSnapshot & LuckChainPoint

/** A read of the game: lifetime counts (made up on the real 3/11 one), with what `more` adds. */
function day(
  base: Day,
  syncedAt: string,
  more: {
    packs?: [string, number][]
    rarities?: Record<string, number>
    wonderPicks?: number
    trades?: number
    tickets?: number | null
  },
): Day {
  const next = structuredClone(base)
  next.syncedAt = syncedAt
  let cards = 0
  for (const [code, added] of Object.entries(more.rarities ?? {})) {
    const row = next.rarities.find((item) => item.code === code)
    if (row) row.obtained += added
    else next.rarities.push({ code, obtained: added })
    cards += added
  }
  let packs = 0
  for (const [expansionId, added] of more.packs ?? []) {
    const row = next.expansions.find((item) => item.expansionId === expansionId)
    if (!row) throw new Error(expansionId)
    row.packsOpened += added
    packs += added
  }
  // Each expansion's cards are not what the luck reads; the totals are.
  next.totals.packsOpened = (next.totals.packsOpened ?? 0) + packs
  next.totals.cardsObtained = (next.totals.cardsObtained ?? 0) + cards
  next.totals.wonderPicks = (next.totals.wonderPicks ?? 0) + (more.wonderPicks ?? 0)
  next.totals.trades = (next.totals.trades ?? 0) + (more.trades ?? 0)
  if (more.tickets !== undefined) next.guaranteedPackTickets = more.tickets
  return next
}

describe('pz/luck: where the cards came from', () => {
  it('the real reads parse; version 2 says the guaranteed-pack tickets, version 1 does not', () => {
    expect(NOV_02.guaranteedPackTickets).toBe(1)
    expect(NOV_03.guaranteedPackTickets).toBeNull()
    // Version 2 without the ticket: none left.
    const without = rawFixture('real-2026-11-02.json') as { mine: { resourceData: { tickets: { name: string }[] } } }
    without.mine.resourceData.tickets = without.mine.resourceData.tickets.filter(
      (ticket) => !/guaranteed/i.test(ticket.name),
    )
    expect(normalizePokemonZone(pokemonZonePayloadSchema.parse(without)).guaranteedPackTickets).toBe(0)
    // A ticket of that kind that is not a count is refused, like a coupon.
    const bad = rawFixture('real-2026-11-02.json') as { mine: { resourceData: { tickets: { value: unknown }[] } } }
    const ticket = bad.mine.resourceData.tickets[0]
    if (ticket) ticket.value = 'uno'
    expect(pokemonZonePayloadSchema.safeParse(bad).success).toBe(false)
  })

  it('Wonder Picks inside «Evento bis PROMO 2026» are of unknown origin; outside, pack-like', () => {
    const [window] = SPECIAL_PICK_WINDOWS
    expect(window).toMatchObject({ from: '2026-10-30T06:00:00Z', until: '2026-11-13T07:00:00Z' })
    const at = (syncedAt: string, wonderPicks: number): LuckChainPoint => ({
      syncedAt,
      totals: { wonderPicks, packsOpened: 100 },
      guaranteedPackTickets: 0,
    })
    // Before the event, and after it (the battles run through 06:59 UTC): regular.
    expect(spanSources(at('2026-10-28T00:00:00Z', 10), at('2026-10-30T05:59:00Z', 13)).regularPicks).toBe(3)
    expect(spanSources(at('2026-11-13T07:00:00Z', 10), at('2026-11-14T00:00:00Z', 12)).regularPicks).toBe(2)
    // Touching it on either side: none are, nothing says when each was made.
    expect(spanSources(at('2026-10-29T00:00:00Z', 10), at('2026-10-30T06:00:01Z', 13))).toMatchObject({
      regularPicks: 0,
      pickWindows: [window],
    })
    expect(spanSources(at('2026-11-13T06:59:00Z', 10), at('2026-11-14T00:00:00Z', 12)).regularPicks).toBe(0)
    // Since the account began (the first import), the span holds every window before its read.
    expect(spanSources(null, at('2026-10-29T00:00:00Z', 50)).regularPicks).toBe(50)
    expect(spanSources(null, at('2026-11-03T17:45:00Z', 50)).regularPicks).toBe(0)
  })

  it('a pack with a guaranteed ★★ card: the drop of the tickets, or a bound when a count was not seen', () => {
    const at = (syncedAt: string, tickets: number | null, packsOpened = 100): LuckChainPoint => ({
      syncedAt,
      totals: { wonderPicks: 0, packsOpened },
      guaranteedPackTickets: tickets,
    })
    const nov = (dayOfMonth: number) => `2026-11-${String(dayOfMonth).padStart(2, '0')}T12:00:00Z`
    expect(spanSources(at(nov(14), 1), at(nov(15), 0, 110))).toMatchObject({ guaranteedPacks: 1, guaranteedSeen: true })
    expect(spanSources(at(nov(14), 0), at(nov(15), 0, 110))).toMatchObject({ guaranteedPacks: 0, guaranteedSeen: true })
    // Not seen at the end (version 1): at most the ticket held before.
    expect(spanSources(at(nov(2), 1), at(nov(3), null, 183))).toMatchObject({
      guaranteedPacks: 1,
      guaranteedSeen: false,
    })
    // Not seen at all: at most the campaign's one ticket, and never more than the packs opened.
    expect(spanSources(at(nov(2), null), at(nov(3), null, 183)).guaranteedPacks).toBe(1)
    expect(spanSources(at(nov(2), null), at(nov(3), null, 100)).guaranteedPacks).toBe(0)
    // Before the first import, less the ones it still holds.
    expect(spanSources(null, at(nov(2), 1)).guaranteedPacks).toBe(0)
    expect(spanSources(null, at(nov(2), null)).guaranteedPacks).toBe(1)
    // Out of the campaign, nothing.
    expect(spanSources(at('2026-12-16T00:00:00Z', null), at('2026-12-17T00:00:00Z', null, 150)).guaranteedPacks).toBe(0)
  })
})

describe('pz/luck: Santi’s real reads', () => {
  it('3/11 lifetime: real, estimated and unknown said apart; the verdict cannot be told, with when it would be normal', () => {
    const luck = pokemonZoneLuck(NOV_03, null, index, lifetimeSources([NOV_03]))
    expect(luck).not.toBeNull()
    if (!luck) return
    // Real: the game's counts.
    expect(luck).toMatchObject({ packs: 1309, cards: 7376, wonderPicks: 402, trades: 51 })
    // This catalog has no C1 (95 packs): its cards are of unknown origin here (production has it).
    expect(luck.unknownPacks).toBe(95 + 2)
    expect(luck.packCards).toBe(372 * 4 + (1309 - 372 - 97) * 5)
    // Read inside «Evento bis PROMO 2026», and the anniversary ticket not seen: every Wonder Pick and one card are
    // of unknown origin, with the 51 trades and the rest.
    expect(luck.sources).toMatchObject({
      wonderPicks: 402,
      pickCards: 0,
      unknownPicks: 402,
      trades: 51,
      guaranteedPacks: 1,
      guaranteedSeen: false,
      restCards: 7376 - 5688 - 402 - 51,
    })
    expect(luck.otherCards).toBe(7376 - 5688 + 1)
    const rare = luck.rare
    expect(rare).toMatchObject({ observed: 348, games: 5687, unknown: 1689, verdict: 'unknown' })
    expect(rare?.fromPacks).toEqual({ min: 0, max: 348 })
    expect(rare?.expected).toBeCloseTo(242.02, 1)
    // Normal if 76 to 135 of the 1.689 cards of unknown origin were ☆ or more; fewer is luckier, more unluckier.
    expect(rare?.normalIf).toEqual({ min: 76, max: 135 })
    expect(luck.ex?.normalIf).toEqual({ min: 66, max: 145 })
  })

  it('2/11 → 3/11: one span, with the event and the ticket not seen; it does not count yet', () => {
    const since = pokemonZoneLuck(NOV_03, NOV_02, index)
    expect(since).toMatchObject({ packs: 83, cards: 493 })
    expect(since?.sources).toMatchObject({ wonderPicks: 15, unknownPicks: 15, trades: 2, guaranteedPacks: 1 })
    expect(since?.rare?.verdict).toBe('unknown')
    const first = pokemonZoneLuckSinceFirst([NOV_02, NOV_03], index)
    expect(first).toMatchObject({ from: NOV_02.syncedAt, to: NOV_03.syncedAt, spans: 1, rare: null, ex: null })
    // One import is not a span.
    expect(pokemonZoneLuckSinceFirst([NOV_03], index)).toBeNull()
  })
})

describe('pz/luck: desde la primera importación', () => {
  // After the event: version 2 reads (the ticket seen, 0) on 14/11 and the days after.
  const start = day({ ...NOV_03, guaranteedPackTickets: 0 }, '2026-11-14T12:00:00Z', {})

  it('a day of packs only gives a sharp verdict, and days add up', () => {
    // 20 packs of B4a (100 cards: 60 ◊, 30 ◊◊…) with 12 ☆ or more where ~3,3 were expected.
    const lucky = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 20]],
      rarities: { C: 60, U: 22, R: 4, RR: 2, AR: 10, SR: 2 },
    })
    const first = pokemonZoneLuckSinceFirst([start, lucky], index)
    expect(first?.rare).toMatchObject({ counted: 1, games: 100, unknown: 0, observed: 12, verdict: 'lucky' })
    expect(first?.rare?.fromPacks).toEqual({ min: 12, max: 12 })
    // A day with 2 Wonder Picks: they count with the packs' odds, but for the special share.
    const picks = day(lucky, '2026-11-16T12:00:00Z', {
      packs: [['B4a', 20]],
      wonderPicks: 2,
      rarities: { C: 61, U: 31, R: 5, RR: 3, AR: 2 },
    })
    const two = pokemonZoneLuckSinceFirst([start, lucky, picks], index)
    expect(two?.rare).toMatchObject({ counted: 2, observed: 14, unknown: Math.ceil(SPECIAL_PICK_SHARE * 2) })
    expect(two?.rare?.games).toBe(100 + 102 - 1)
    // A day of promos from the event shop (8 cards of unknown origin) does not count: too many for its ~2 hits.
    const promos = day(picks, '2026-11-17T12:00:00Z', {
      packs: [['B4a', 10]],
      rarities: { C: 38, U: 15, R: 3, RR: 1, AR: 1 },
    })
    const three = pokemonZoneLuckSinceFirst([start, lucky, picks, promos], index)
    expect(three).toMatchObject({ spans: 3 })
    expect(three?.rare?.counted).toBe(2)
    expect(three?.rare?.observed).toBe(14)
  })

  it('a span of Wonder Picks only: they count with the mix of the whole account', () => {
    const picks = day(start, '2026-11-15T12:00:00Z', { wonderPicks: 3, rarities: { C: 2, U: 1 } })
    const luck = pokemonZoneLuck(picks, start, index)
    // 3 Wonder Picks: 2 with known odds, 1 (a tenth, rounded up) of unknown origin.
    expect(luck?.sources).toMatchObject({ wonderPicks: 3, pickCards: 2, unknownPicks: 1, restCards: 0 })
    const lifetime = pokemonZoneLuck(start, null, index, lifetimeSources([start]))
    // The share is the account's: its packs' odds per card (its lifetime has no Wonder Pick with known odds).
    expect(lifetime?.sources.pickCards).toBe(0)
    expect(luck?.rare?.games).toBe(2)
    expect(luck?.rare?.expectedShare).toBeGreaterThan(4)
    expect(luck?.rare?.expectedShare).toBeCloseTo(lifetime?.rare?.expectedShare ?? -1, 9)
  })

  it('a span with a guaranteed ★★ pack: its card is of unknown origin, not luck', () => {
    const opened = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 1]],
      rarities: { C: 3, U: 1, SR: 1 },
      tickets: 0,
    })
    const held = { ...start, guaranteedPackTickets: 1 }
    const luck = pokemonZoneLuck(opened, held, index)
    expect(luck?.sources).toMatchObject({ guaranteedPacks: 1, guaranteedSeen: true })
    expect(luck?.rare).toMatchObject({ observed: 1, games: 4, unknown: 1, fromPacks: { min: 0, max: 1 } })
  })

  it('the rule: fewest unknown cards per expected hit first, while Σ unknown ≤ ½·√(Σ expected)', () => {
    const span = (unknown: number, expected: number, observed = 0, regularPicks = 0): TierParts => ({
      observed,
      capacity: 100,
      expected,
      unknown,
      regularPicks,
    })
    const spans = [span(0, 4), span(5, 4), span(1, 10), span(0, 0)]
    // 0/4 first (0 ≤ 1), then 1/10 (1 ≤ ½·√14 = 1,87), not 5/4 (6 > ½·√18 = 2,12); no expected hits, nothing to say.
    expect(countedSpans(spans)).toEqual([spans[0], spans[2]])
    expect(INCLUSION_SD).toBe(0.5)
    // What they got does not decide.
    const got = [span(0, 4, 40), span(5, 4, 0), span(1, 10, 1), span(0, 0, 3)]
    expect(countedSpans(got)).toEqual([got[0], got[2]])
    // The special share of the Wonder Picks counts as unknown.
    expect(countedSpans([span(0, 1, 0, 30)])).toEqual([])
    expect(countedSpans([span(0, 16, 0, 20)])).toHaveLength(1)
    // The order is what makes the set: C (0/1) and A (2/16) fit, then B (1/4) does not (3 > ½·√21); in another order
    // (B first, say by what it got) B and C would fit and A would not.
    const a = span(2, 16, 1)
    const b = span(1, 4, 9)
    const c = span(0, 1, 5)
    expect(countedSpans([a, b, c])).toEqual([a, c])
  })

  it('the bounds of several spans: each span’s unknown cards hold at most what that span got', () => {
    // Two spans: 5 hits with 2 unknown, 0 hits with 10 unknown. Summed: at least 3 from the known cards (not 0).
    const tier = checkTier([
      { observed: 5, capacity: 50, expected: 2, unknown: 2, regularPicks: 0 },
      { observed: 0, capacity: 50, expected: 2, unknown: 10, regularPicks: 0 },
    ])
    expect(tier.fromPacks).toEqual({ min: 3, max: 5 })
    expect(tier).toMatchObject({ games: 100, unknown: 12, observed: 5 })
    expect(tier.expectedShare).toBeCloseTo(4, 9)
  })
})
