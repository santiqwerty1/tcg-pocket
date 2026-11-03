import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../src/lab/index.js'
import {
  checkTier,
  countedSpans,
  guaranteedAllowance,
  INCLUSION_SD,
  type LuckChainPoint,
  type LuckSnapshot,
  lifetimeSources,
  normalizePokemonZone,
  parsePokemonZone,
  pokemonZoneLuck,
  pokemonZoneLuckSinceFirst,
  pokemonZonePayloadSchema,
  SPECIAL_PICK_WINDOWS,
  spanSources,
  starStarTickets,
  type TierParts,
} from '../../src/pokemonZone/index.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

/**
 * pz/luck (3/11/2026): two consecutive reads made up on pokemon-zone's real shape (2/11 with the version 2 bookmarklet,
 * 3/11 with version 1; no real number of an account, review of #172), and made-up days after «Evento bis PROMO 2026»
 * for what the rules do when the cards of unknown origin are few.
 */
const index = catalogIndex()
const DIR = join(import.meta.dirname, '..', 'fixtures', 'pokemon-zone')
const rawFixture = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Record<string, unknown>
const read = (name: string) => parsePokemonZone(pokemonZonePayloadSchema.parse(rawFixture(name)))
const NOV_02 = read('made-up-2026-11-02.json')
const NOV_03 = read('made-up-2026-11-03.json')

type Day = LuckSnapshot & LuckChainPoint
type Tickets = NonNullable<LuckChainPoint['guaranteedTickets']>
const ANNIVERSARY = (count: number): Tickets => [
  { key: 'TICKET_2610000_EV_02', name: '1 ★★ Card Guaranteed Booster Pack Exchange Tickets', count },
]

/** A read of the game: lifetime counts (made up on the 3/11 fixture), with what `more` adds. */
function day(
  base: Day,
  syncedAt: string,
  more: {
    packs?: [string, number][]
    rarities?: Record<string, number>
    wonderPicks?: number
    trades?: number
    tickets?: Tickets | null
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
  if (more.tickets !== undefined) next.guaranteedTickets = more.tickets
  return next
}

describe('pz/luck: where the cards came from', () => {
  it('version 2 lists the guaranteed-pack tickets, version 1 does not say; the ★★ ones by key or by name', () => {
    expect(NOV_02.guaranteedTickets).toEqual(ANNIVERSARY(1))
    expect(starStarTickets(NOV_02.guaranteedTickets)).toBe(1)
    // Not seen: null, never 0.
    expect(NOV_03.guaranteedTickets).toBeNull()
    expect(starStarTickets(NOV_03.guaranteedTickets)).toBeNull()
    // Version 2 without the ticket: seen, none held.
    const without = rawFixture('made-up-2026-11-02.json') as { mine: { resourceData: { tickets: { name: string }[] } } }
    without.mine.resourceData.tickets = without.mine.resourceData.tickets.filter(
      (ticket) => !/guaranteed/i.test(ticket.name),
    )
    const none = normalizePokemonZone(pokemonZonePayloadSchema.parse(without)).guaranteedTickets
    expect(none).toEqual([])
    expect(starStarTickets(none)).toBe(0)
    // Review of #172: other guaranteed packs are listed but are not ★★ (one star, three stars), unless the key is the
    // anniversary's.
    expect(
      starStarTickets([
        { key: 'TICKET_X_1', name: '1 ★ Card Guaranteed Booster Pack Exchange Tickets', count: 4 },
        { key: 'TICKET_X_3', name: '1 ★★★ Card Guaranteed Booster Pack Exchange Tickets', count: 2 },
        { key: 'TICKET_X_2', name: '1 ★★ Card Guaranteed Booster Pack Exchange Tickets', count: 1 },
        { key: 'TICKET_2610000_EV_02', name: 'Anniversary Booster Pack Exchange Tickets', count: 1 },
      ]),
    ).toBe(2)
    // A ticket of that kind that is not a count is refused, like a coupon.
    const bad = rawFixture('made-up-2026-11-02.json') as { mine: { resourceData: { tickets: { value: unknown }[] } } }
    const ticket = bad.mine.resourceData.tickets[0]
    if (ticket) ticket.value = 'uno'
    expect(pokemonZonePayloadSchema.safeParse(bad).success).toBe(false)
  })

  it('Wonder Picks inside «Evento bis PROMO 2026» are of unknown origin; outside, regular', () => {
    const [window] = SPECIAL_PICK_WINDOWS
    expect(window).toMatchObject({ from: '2026-10-30T06:00:00Z', until: '2026-11-13T07:00:00Z' })
    const at = (syncedAt: string, wonderPicks: number): LuckChainPoint => ({
      syncedAt,
      totals: { wonderPicks, packsOpened: 100 },
      guaranteedTickets: [],
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
    const at = (syncedAt: string, tickets: Tickets | null, packsOpened = 100): LuckChainPoint => ({
      syncedAt,
      totals: { wonderPicks: 0, packsOpened },
      guaranteedTickets: tickets,
    })
    const nov = (dayOfMonth: number) => `2026-11-${String(dayOfMonth).padStart(2, '0')}T12:00:00Z`
    expect(spanSources(at(nov(14), ANNIVERSARY(1)), at(nov(15), [], 110))).toMatchObject({
      guaranteedPacks: 1,
      unseenGuaranteed: 0,
    })
    expect(spanSources(at(nov(14), []), at(nov(15), [], 110))).toMatchObject({
      guaranteedPacks: 0,
      unseenGuaranteed: 0,
    })
    // Not seen at the end (version 1): at most the ticket held before.
    expect(spanSources(at(nov(2), ANNIVERSARY(1)), at(nov(3), null, 183))).toMatchObject({
      guaranteedPacks: 0,
      unseenGuaranteed: 1,
    })
    // Not seen at all: at most the campaign's one ticket, and never more than the packs opened.
    expect(spanSources(at(nov(2), null), at(nov(3), null, 183)).unseenGuaranteed).toBe(1)
    expect(spanSources(at(nov(2), null), at(nov(3), null, 100)).unseenGuaranteed).toBe(0)
    // Before the first import, less the ones it still holds.
    expect(spanSources(null, at(nov(2), ANNIVERSARY(1))).unseenGuaranteed).toBe(0)
    expect(spanSources(null, at(nov(2), null)).unseenGuaranteed).toBe(1)
    // Out of the campaign, nothing.
    expect(spanSources(at('2026-12-16T00:00:00Z', null), at('2026-12-17T00:00:00Z', null, 150)).unseenGuaranteed).toBe(
      0,
    )
  })

  it('Codex on #172: the campaign’s one ticket is shared by every span, however many imports there are', () => {
    // Three November imports with the version 1 bookmarklet: no ticket count seen anywhere.
    const v1 = (dayOfMonth: number, packsOpened: number): LuckChainPoint => ({
      syncedAt: `2026-11-${String(dayOfMonth).padStart(2, '0')}T12:00:00Z`,
      totals: { wonderPicks: 0, packsOpened },
      guaranteedTickets: null,
    })
    const three = [v1(3, 100), v1(4, 110), v1(5, 120)]
    // Each span on its own could have had it…
    expect(
      three.map((point, i) => spanSources(i === 0 ? null : (three[i - 1] ?? null), point).unseenGuaranteed),
    ).toEqual([1, 1, 1])
    // …but all together, at most the one ticket.
    expect(guaranteedAllowance(three)).toBe(1)
    expect(lifetimeSources(three)).toMatchObject({ guaranteedPacks: 0, unseenGuaranteed: 1 })
    expect(lifetimeSources([v1(5, 120)]).unseenGuaranteed).toBe(1)
    // A ticket seen spent uses it up: nothing else unseen.
    const seen = [
      { ...v1(3, 100), guaranteedTickets: ANNIVERSARY(1) },
      { ...v1(4, 110), guaranteedTickets: ANNIVERSARY(0) },
      v1(5, 120),
    ]
    expect(guaranteedAllowance(seen)).toBe(0)
    expect(lifetimeSources(seen)).toMatchObject({ guaranteedPacks: 1, unseenGuaranteed: 0 })
  })

  it('review of #172: production’s chain — an import saved before pz/luck and a version 1 one — gives one card', () => {
    // A row of #170 has no `guaranteedTickets` at all (the schema reads it as null), and the version 1 one neither.
    const stored = pokemonZonePayloadSchema.parse({ ...rawFixture('made-up-2026-11-03.json'), v: 1 })
    const before = { ...normalizePokemonZone(stored), syncedAt: '2026-11-03T17:30:00.000Z' }
    const { guaranteedTickets: _absent, ...withoutField } = before
    const older = withoutField as unknown as Day
    const newer = day({ ...before, guaranteedTickets: null }, '2026-11-04T17:30:00.000Z', {
      packs: [['B4a', 10]],
      rarities: { C: 30, U: 15, R: 3, RR: 1, AR: 1 },
    })
    const luck = pokemonZoneLuck(newer, null, index, lifetimeSources([older, newer]))
    expect(luck?.sources).toMatchObject({ guaranteedPacks: 1, guaranteedSeen: false })
  })
})

describe('pz/luck: two made-up reads', () => {
  it('3/11 lifetime: real, estimated and unknown said apart; the verdict cannot be told, with when it would be normal', () => {
    const luck = pokemonZoneLuck(NOV_03, null, index, lifetimeSources([NOV_03]))
    expect(luck).not.toBeNull()
    if (!luck) return
    expect(luck).toMatchObject({ packs: 1246, cards: 7138, wonderPicks: 388, trades: 48 })
    // This catalog has no C1 (90 packs here): its cards are of unknown origin.
    expect(luck.unknownPacks).toBe(90)
    expect(luck.packCards).toBe(5459)
    // Read inside «Evento bis PROMO 2026», and the anniversary ticket not seen: every Wonder Pick and one card are
    // of unknown origin, with the trades and the rest.
    expect(luck.sources).toMatchObject({
      wonderPicks: 388,
      pickCards: 0,
      unknownPicks: 388,
      trades: 48,
      guaranteedPacks: 1,
      guaranteedSeen: false,
      restCards: 7138 - 5459 - 388 - 48,
    })
    expect(luck.otherCards).toBe(7138 - 5459 + 1)
    const rare = luck.rare
    // No Wonder Pick counts here: both ends over the packs' cards.
    expect(rare).toMatchObject({ observed: 297, games: 5458, packGames: 5458, unknown: 1680, verdict: 'unknown' })
    expect(rare?.fromPacks).toEqual({ min: 0, max: 297 })
    expect(rare?.expected).toBeCloseTo(232.2, 1)
    // Normal if 35 to 94 of the 1.680 cards of unknown origin were ☆ or more; fewer is luckier, more unluckier.
    expect(rare?.normalIf).toEqual({ min: 35, max: 94 })
    expect(luck.ex?.normalIf).toEqual({ min: 117, max: 191 })
  })

  it('2/11 → 3/11: one span, with the event and the ticket not seen; it does not count yet', () => {
    const since = pokemonZoneLuck(NOV_03, NOV_02, index)
    expect(since).toMatchObject({ packs: 79, cards: 476 })
    expect(since?.sources).toMatchObject({ wonderPicks: 14, unknownPicks: 14, trades: 3, guaranteedPacks: 1 })
    expect(since?.rare?.verdict).toBe('unknown')
    const first = pokemonZoneLuckSinceFirst([NOV_02, NOV_03], index)
    expect(first).toMatchObject({ from: NOV_02.syncedAt, to: NOV_03.syncedAt, spans: 1, rare: null, ex: null })
    // One import is not a span.
    expect(pokemonZoneLuckSinceFirst([NOV_03], index)).toBeNull()
  })
})

describe('pz/luck: Wonder Pick leans rare (review of #172)', () => {
  // After the event, with the ticket seen (none held).
  const start = day({ ...NOV_03, guaranteedTickets: [] }, '2026-11-14T12:00:00Z', {})

  it('a day of packs that is normal with Wonder Picks full of ☆ is not «mejor de lo normal»', () => {
    // 20 packs of B4a (100 cards, ~4,4 ☆ expected) with 4 ☆; 20 Wonder Picks, chosen, with 10 ☆.
    const picks = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 20]],
      wonderPicks: 20,
      rarities: { C: 66, U: 34, R: 4, RR: 2, AR: 14 },
    })
    const luck = pokemonZoneLuck(picks, start, index)
    expect(luck?.sources).toMatchObject({ wonderPicks: 20, pickCards: 20, unknownPicks: 0 })
    // Low end: the packs alone, the Wonder Picks of unknown origin; high end: with them at the packs' odds.
    expect(luck?.rare).toMatchObject({ observed: 14, packGames: 100, games: 120, unknown: 20 })
    expect(luck?.rare?.verdict).not.toBe('lucky')
    expect(luck?.rare?.high.verdict).toBe('lucky')
  })

  it('«peor de lo normal» counts the Wonder Picks at the packs’ odds', () => {
    // 60 packs (300 cards) with 1 ☆ and 20 Wonder Picks with 1: worse than normal, with the Wonder Picks too.
    const bad = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 60]],
      wonderPicks: 20,
      rarities: { C: 200, U: 100, R: 15, RR: 3, AR: 2 },
    })
    const luck = pokemonZoneLuck(bad, start, index)
    expect(luck?.rare).toMatchObject({ observed: 2, packGames: 300, games: 320, verdict: 'unlucky' })
    expect(luck?.rare?.fromPacks).toEqual({ min: 0, max: 2 })
    expect(luck?.rare?.tail).toBe(luck?.rare?.high.lowerTail)
  })

  it('with Wonder Picks at 30 % ☆ and packs at their odds, «mejor de lo normal» stays at most as rare as it should', () => {
    const random = seededRandom(172)
    const binomial = (n: number, p: number) => {
      let hits = 0
      for (let i = 0; i < n; i++) if (random() < p) hits += 1
      return hits
    }
    const p = 0.044
    let lucky = 0
    const trials = 1500
    for (let trial = 0; trial < trials; trial++) {
      const packHits = binomial(300, p)
      const pickHits = binomial(40, 0.3)
      const tier = checkTier([
        {
          observed: packHits + pickHits,
          capacity: 340,
          expected: 340 * p,
          packCapacity: 300,
          packExpected: 300 * p,
          unknown: 0,
          unseenGuaranteed: 0,
        },
      ])
      if (tier.verdict === 'lucky') lucky += 1
    }
    // The packs alone are lucky one time in forty at most; the chosen Wonder Picks do not add to it.
    expect(lucky / trials).toBeLessThan(0.03)
  })
})

describe('pz/luck: desde la primera importación', () => {
  const start = day({ ...NOV_03, guaranteedTickets: [] }, '2026-11-14T12:00:00Z', {})

  it('a day of packs only gives a sharp verdict, and days with Wonder Picks count too', () => {
    // 20 packs of B4a (100 cards) with 12 ☆ or more where ~4,4 were expected.
    const lucky = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 20]],
      rarities: { C: 60, U: 22, R: 4, RR: 2, AR: 10, SR: 2 },
    })
    const first = pokemonZoneLuckSinceFirst([start, lucky], index)
    expect(first?.rare).toMatchObject({ counted: 1, games: 100, unknown: 0, observed: 12, verdict: 'lucky' })
    expect(first?.rare?.fromPacks).toEqual({ min: 12, max: 12 })
    // A day with 2 Wonder Picks: they do not keep it out (at the packs' odds for «peor»), and are unknown for «mejor».
    const picks = day(lucky, '2026-11-16T12:00:00Z', {
      packs: [['B4a', 20]],
      wonderPicks: 2,
      rarities: { C: 61, U: 31, R: 5, RR: 3, AR: 2 },
    })
    const two = pokemonZoneLuckSinceFirst([start, lucky, picks], index)
    expect(two?.rare).toMatchObject({ counted: 2, observed: 14, packGames: 200, games: 202, unknown: 2 })
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
    expect(luck?.sources).toMatchObject({ wonderPicks: 3, pickCards: 3, unknownPicks: 0, restCards: 0 })
    const lifetime = pokemonZoneLuck(start, null, index, lifetimeSources([start]))
    // The share is the account's: its packs' odds per card (its lifetime has no regular Wonder Pick).
    expect(lifetime?.sources.pickCards).toBe(0)
    expect(luck?.rare).toMatchObject({ games: 3, packGames: 0 })
    expect(luck?.rare?.expectedShare).toBeGreaterThan(4)
    expect(luck?.rare?.expectedShare).toBeCloseTo(lifetime?.rare?.expectedShare ?? -1, 9)
  })

  it('Codex on #172: version 1 imports every day share the campaign’s one ticket in the sum', () => {
    const unseen = day({ ...NOV_03, guaranteedTickets: null }, '2026-11-14T12:00:00Z', {})
    const first = day(unseen, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 20]],
      rarities: { C: 60, U: 30, R: 5, RR: 2, AR: 3 },
    })
    const second = day(first, '2026-11-16T12:00:00Z', {
      packs: [['B4a', 20]],
      rarities: { C: 60, U: 30, R: 5, RR: 2, AR: 3 },
    })
    // Each span could have had the anniversary pack, but not both: one card of unknown origin in the sum, not two.
    expect(pokemonZoneLuck(first, unseen, index)?.sources).toMatchObject({ guaranteedPacks: 1, guaranteedSeen: false })
    const since = pokemonZoneLuckSinceFirst([unseen, first, second], index)
    expect(since?.rare).toMatchObject({ counted: 2, unknown: 1, games: 199, observed: 6 })
  })

  it('a span with a guaranteed ★★ pack: its card is of unknown origin, not luck', () => {
    const opened = day(start, '2026-11-15T12:00:00Z', {
      packs: [['B4a', 1]],
      rarities: { C: 3, U: 1, SR: 1 },
      tickets: ANNIVERSARY(0),
    })
    const held = { ...start, guaranteedTickets: ANNIVERSARY(1) }
    const luck = pokemonZoneLuck(opened, held, index)
    expect(luck?.sources).toMatchObject({ guaranteedPacks: 1, guaranteedSeen: true })
    expect(luck?.rare).toMatchObject({ observed: 1, games: 4, unknown: 1, fromPacks: { min: 0, max: 1 } })
  })

  it('the rule: fewest unknown cards per expected hit first, while Σ unknown ≤ ½·√(Σ expected)', () => {
    const span = (unknown: number, expected: number, observed = 0, capacity = 100): TierParts => ({
      observed,
      capacity,
      expected,
      packCapacity: capacity,
      packExpected: expected,
      unknown,
      unseenGuaranteed: 0,
    })
    const spans = [span(0, 4), span(5, 4), span(1, 10), span(0, 0)]
    // 0/4 first (0 ≤ 1), then 1/10 (1 ≤ ½·√14 = 1,87), not 5/4 (6 > ½·√18 = 2,12); no expected hits, nothing to say.
    expect(countedSpans(spans)).toEqual([spans[0], spans[2]])
    expect(INCLUSION_SD).toBe(0.5)
    // What they got does not decide.
    const got = [span(0, 4, 40), span(5, 4, 0), span(1, 10, 1), span(0, 0, 3)]
    expect(countedSpans(got)).toEqual([got[0], got[2]])
    // The order is what makes the set: C (0/1) and A (2/16) fit, then B (1/4) does not (3 > ½·√21); in another order
    // (B first, say by what it got) B and C would fit and A would not.
    const a = span(2, 16, 1)
    const b = span(1, 4, 9)
    const c = span(0, 1, 5)
    expect(countedSpans([a, b, c])).toEqual([a, c])
    // Admitted as `checkTier` counts it at the high end: whole cards (Codex on #172).
    const one = span(1, 1)
    expect(checkTier([one]).unknown).toBe(1)
    expect(countedSpans([one])).toEqual([])
    // Unseen guaranteed packs count too, capped by the campaign's tickets: with one, the second span still fits (1 ≤
    // ½·√8); with three, it does not (2 > ½·√8).
    const unseen = { ...span(0, 4), unseenGuaranteed: 1 }
    expect(countedSpans([unseen, { ...unseen }], 0.5, 1)).toHaveLength(2)
    expect(countedSpans([unseen, { ...unseen }], 0.5, 3)).toHaveLength(1)
    expect(checkTier([unseen, { ...unseen }], 1).unknown).toBe(1)
    // Review of #172: a tie goes to the newest span, so the verdict does not freeze on the oldest days.
    // (Same unknown cards and expected hits; what they got only tells them apart here.)
    const old = span(1, 4, 0)
    const recent = span(1, 4, 9)
    expect(countedSpans([old, recent])).toEqual([recent])
  })

  it('review of #172: steady days — the ones without cards of unknown origin all count', () => {
    const random = seededRandom(1172)
    const span = (unknown: number): TierParts => ({
      observed: 4,
      capacity: 102,
      expected: 4.5,
      packCapacity: 100,
      packExpected: 4.4,
      unknown,
      unseenGuaranteed: 0,
    })
    // 120 days of 20 packs and 2 Wonder Picks; on about half of them some promos or trades (1 to 4 cards).
    const days = Array.from({ length: 120 }, () => span(random() < 0.5 ? 0 : 1 + Math.floor(random() * 4)))
    const clean = days.filter((item) => item.unknown === 0).length
    const counted = countedSpans(days)
    expect(counted.length).toBeGreaterThanOrEqual(clean)
    expect(clean).toBeGreaterThan(40)
  })

  it('the bounds of several spans: each span’s unknown cards hold at most what that span got', () => {
    // Two spans: 5 hits with 2 unknown, 0 hits with 10 unknown. Summed: at least 3 from the known cards (not 0).
    const part = (observed: number, unknown: number): TierParts => ({
      observed,
      capacity: 50,
      expected: 2,
      packCapacity: 50,
      packExpected: 2,
      unknown,
      unseenGuaranteed: 0,
    })
    const tier = checkTier([part(5, 2), part(0, 10)])
    expect(tier.fromPacks).toEqual({ min: 3, max: 5 })
    expect(tier).toMatchObject({ games: 100, unknown: 12, observed: 5 })
    expect(tier.expectedShare).toBeCloseTo(4, 9)
  })
})
