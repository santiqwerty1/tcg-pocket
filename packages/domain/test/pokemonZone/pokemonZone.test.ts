import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromoEvent } from '../../src/packs/promo.js'
import {
  battlesBetween,
  formatGameCounterEs,
  gameBattles,
  gameCounterView,
  handEditedAfter,
  hourglassesUpdate,
  loggedComparison,
  normalizePokemonZone,
  POKEMON_ZONE_RARITY,
  type PokemonZoneSnapshot,
  packPointsUpdate,
  parseHandEdits,
  parsePokemonZone,
  pokemonZoneLuck,
  pokemonZonePack,
  pokemonZonePayloadSchema,
  pokemonZoneRarity,
  pokemonZoneSnapshotSchema,
  promoCoupons,
  recordHourglassesEdit,
  recordPointsEdit,
  samePackPoints,
} from '../../src/pokemonZone/index.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'pokemon-zone', 'payload.json')
interface Item {
  key: string
  value: unknown
  name?: string
}
/** What the tests change of the fixture; the rest goes through as read. */
interface Fixture {
  v: unknown
  mine: {
    player: { accountHash?: unknown; lastUpdatedAt?: unknown; level?: unknown }
    resourceData: { packCeilPoints?: Item[]; packPowerChargers: Item[]; tickets?: Item[]; tradePowerChargers?: Item[] }
    config?: unknown
    [key: string]: unknown
  }
  stats: {
    syncedAt?: unknown
    battles?: { id: string; value: unknown }[]
    packs: { packId: unknown; opened: unknown }[]
    cardsByRarity: { rarity: string; obtained: unknown }[]
  }
}
/** The fixture as the bookmarklet sends it (made up on pokemon-zone's real shape, see its `_nota`). */
const raw = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture
const first = <T>(items: T[] | undefined): T => items?.[0] as T
const snapshot = (): PokemonZoneSnapshot => normalizePokemonZone(pokemonZonePayloadSchema.parse(raw()))

/** A snapshot with only what the luck reads. */
function luckSnapshot(input: {
  expansions?: [string, number, number][]
  packs?: [string, string | null, string, number][]
  rarities?: Record<string, number>
  wonderPicks?: number | null
  trades?: number | null
}): Pick<PokemonZoneSnapshot, 'expansions' | 'packs' | 'rarities' | 'totals'> {
  return {
    expansions: (input.expansions ?? []).map(([expansionId, packsOpened, cardsObtained]) => ({
      expansionId,
      nameEn: expansionId,
      packsOpened,
      cardsObtained,
    })),
    packs: (input.packs ?? []).map(([packId, expansionId, nameEn, opened]) => ({
      packId,
      expansionId,
      nameEn,
      opened,
    })),
    rarities: Object.entries(input.rarities ?? {}).map(([code, obtained]) => ({ code, obtained })),
    totals: {
      packsOpened: null,
      cardsObtained: null,
      uniqueCards: null,
      wonderPicks: input.wonderPicks ?? null,
      trades: input.trades ?? null,
    },
  }
}

/** Published per-card shares, by hand (docs/fase0/sobres.md): a standard 5-card pack and a 4-card Deluxe. */
const STANDARD_RARE = (2.572 + 0.5 + 0.222 + 0.04 + 10.288 + 2 + 0.888 + 0.16) / 5 // 3,334 %
const STANDARD_EX = (1.666 + 6.664) / 5 // 1,666 %
const DELUXE_RARE = (12.858 + 2.5 + 1.111 + 1.667 + 0.198) / 4 // 4,5835 %
const DELUXE_EX = 100 / 4

describe('pokemon-zone: the payload', () => {
  it('reads the bookmarklet’s payload and keeps only what phase 1 uses', () => {
    const data = snapshot()
    expect(data.syncedAt).toBe('2026-11-02T02:43:29.379Z')
    expect(data.level).toBe(40)
    expect(data.packPoints).toMatchObject({ A1: 5, A3: 70, B4b: 0, C1: 310 })
    expect(Object.keys(data.packPoints)).toHaveLength(22)
    expect(data.hourglasses).toEqual({ pack: 18, wonder: 100, trade: 1000, event: 0, rewind: 20 })
    expect(data.currencies).toEqual({ shopTickets: 3000, shinedust: 400000, premiumTickets: 20 })
    // Only the promo coupons: not the emblem tickets nor the pack exchange ticket.
    expect(data.coupons).toEqual([
      { key: 'TICKET_2610000_EV_03', event: 'PROMO Reissue Drop Event 2026', count: 2 },
      { key: 'TICKET_2610000_EV_04', event: 'PROMO Reissue Wonder Pick Event 2026', count: 2 },
    ])
    expect(data.battles).toEqual({
      versus: { battles: 500, wins: 240 },
      ranked: { battles: 340, wins: 160 },
      rankedPoints: 430,
      solo: { battles: 1380, wins: 930 },
      rental: { battles: 10, wins: 7 },
    })
    expect(data.totals).toEqual({
      packsOpened: 1226,
      cardsObtained: 6883,
      uniqueCards: 2419,
      wonderPicks: 387,
      trades: 49,
    })
    expect(data.expansions).toHaveLength(24)
    expect(data.packs).toHaveLength(31)
    expect(data.rarities.reduce((sum, row) => sum + row.obtained, 0)).toBe(6883)
    // The stored form reads back with its own schema (the backup and the summary parse it).
    expect(pokemonZoneSnapshotSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })

  it('never keeps the name, the account, the cards nor the decks', () => {
    const payload = raw()
    payload.mine.cards = [{ cardId: 'PK_10_000010_00', amount: 2 }]
    payload.mine.decks = [{ name: 'Mazo' }]
    const text = JSON.stringify(normalizePokemonZone(pokemonZonePayloadSchema.parse(payload)))
    expect(text).not.toContain(String(payload.mine.player.accountHash))
    expect(text).not.toContain('jugador')
    expect(text).not.toContain('PK_10_000010_00')
    expect(text).not.toContain('Mazo')
  })

  it('refuses anything that is not that shape', () => {
    const fails = (change: (payload: Fixture) => void) => {
      const payload = raw()
      change(payload)
      return !pokemonZonePayloadSchema.safeParse(payload).success
    }
    expect(fails(() => undefined)).toBe(false)
    expect(fails((p) => (p.v = 2))).toBe(true)
    expect(fails((p) => delete p.stats.battles)).toBe(true)
    expect(fails((p) => delete p.mine.resourceData.packCeilPoints)).toBe(true)
    expect(fails((p) => delete p.mine.player.accountHash)).toBe(true)
    // The friend id itself is not what goes: only its SHA-256.
    expect(fails((p) => (p.mine.player.accountHash = '1111222233334444'))).toBe(true)
    expect(fails((p) => (first(p.stats.packs).opened = '3'))).toBe(true)
    expect(fails((p) => (first(p.stats.cardsByRarity).obtained = -1))).toBe(true)
    expect(fails((p) => (first(p.stats.packs).packId = 'a b'))).toBe(true)
    // More points than the setting takes would be dropped by Sobres: refused here.
    expect(fails((p) => (first(p.mine.resourceData.packCeilPoints).value = 1_000_001))).toBe(true)
    // Without any date of pokemon-zone's last read of the game.
    expect(
      fails((p) => {
        p.stats.syncedAt = null
        p.mine.player.lastUpdatedAt = null
      }),
    ).toBe(true)
    // …but either one is enough.
    expect(fails((p) => (p.stats.syncedAt = null))).toBe(false)
    // Dates are ISO 8601 with their offset, not anything Date.parse takes.
    expect(fails((p) => (p.stats.syncedAt = '2026'))).toBe(true)
    expect(fails((p) => (p.stats.syncedAt = 'Mon, 02 Nov 2026 02:43:29 GMT'))).toBe(true)
    expect(fails((p) => (p.stats.syncedAt = '2026-11-02T02:43:29'))).toBe(true)
    // Review of pz/import: ids that become keys of an object never name one of Object.prototype.
    expect(fails((p) => (first(p.mine.resourceData.packCeilPoints).key = 'constructor'))).toBe(true)
    expect(fails((p) => (first(p.mine.resourceData.packCeilPoints).key = '__proto__'))).toBe(true)
    expect(fails((p) => (first(p.stats.cardsByRarity).rarity = 'toString'))).toBe(true)
    // More items than a list takes: refused.
    expect(
      fails((p) => {
        p.mine.resourceData.tickets = Array.from({ length: 1001 }, (_, i) => ({ key: `T${i}`, value: 1, name: 'X' }))
      }),
    ).toBe(true)
    // What the app reads is strict: a coupon or a battle counter that is not a count.
    expect(
      fails((p) => {
        p.mine.resourceData.tickets = [{ key: 'T', value: 1.5, name: 'Promo Card Exchange Ticket (X)' }]
      }),
    ).toBe(true)
    expect(fails((p) => (p.stats.battles = [{ id: 'ranked_wins', value: '3' }]))).toBe(true)
  })

  it('review of pz/import: what the app does not read can be anything', () => {
    const lenient = (change: (payload: Fixture) => void) => {
      const payload = raw()
      change(payload)
      return pokemonZonePayloadSchema.safeParse(payload).success
    }
    // A decimal stat, a key with odd characters, a ticket that is not a coupon, a new rarity code, a config.
    expect(lenient((p) => p.stats.battles?.push({ id: 'max_combo', value: 1.5 }))).toBe(true)
    expect(lenient((p) => p.mine.resourceData.packPowerChargers.push({ key: 'SMALL:charger', value: 'x' }))).toBe(true)
    expect(
      lenient((p) => {
        p.mine.resourceData.tickets = [{ key: 'a b', value: -1, name: 'Emblem Ticket (X)' }]
      }),
    ).toBe(true)
    expect(lenient((p) => p.stats.cardsByRarity.push({ rarity: 'SR2', obtained: 1 }))).toBe(true)
    expect(lenient((p) => (p.mine.config = { isPublic: { nested: true } }))).toBe(true)
    // …and it is not kept.
    const payload = raw()
    payload.mine.resourceData.packPowerChargers.push({ key: 'SMALL:charger', value: 7 })
    payload.mine.config = { isPublic: true }
    const data = parsePokemonZone(pokemonZonePayloadSchema.parse(payload))
    expect(data.hourglasses.pack).toBe(18)
    expect(JSON.stringify(data)).not.toContain('SMALL:charger')
    expect(JSON.stringify(data)).not.toContain('isPublic')
  })

  it('what is saved always reads back with the stored form (parsePokemonZone)', () => {
    const payload = raw()
    payload.mine.resourceData.tradePowerChargers = Array.from({ length: 100 }, (_, i) => ({
      key: `T${i}`,
      value: 1_000_000_000,
    }))
    const data = parsePokemonZone(pokemonZonePayloadSchema.parse(payload))
    expect(data.hourglasses.trade).toBe(1_000_000_000)
    expect(pokemonZoneSnapshotSchema.safeParse(data).success).toBe(true)
    expect(pokemonZoneRarity('toString')).toBeNull()
    expect(pokemonZoneRarity('constructor')).toBeNull()
  })

  it('a counter with more wins than battles is left out', () => {
    const payload = raw()
    payload.stats.battles = [
      { id: 'pvp_battles', value: 3 },
      { id: 'pvp_wins', value: 4 },
    ]
    const data = normalizePokemonZone(pokemonZonePayloadSchema.parse(payload))
    expect(data.battles.versus).toBeNull()
    expect(data.battles.ranked).toBeNull()
  })
})

describe('pokemon-zone: codes', () => {
  it('maps its rarity codes to the app’s', () => {
    expect(
      ['C', 'U', 'R', 'RR', 'AR', 'SR', 'SAR', 'IM', 'S', 'SSR', 'UR'].map((code) => pokemonZoneRarity(code)),
    ).toEqual(['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '☆☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare'])
    expect(pokemonZoneRarity('AN')).toBeNull()
    expect(Object.keys(POKEMON_ZONE_RARITY)).toHaveLength(11)
  })

  it('finds the app’s pack of each pokemon-zone pack', () => {
    const pack = (expansionId: string | null, nameEn: string) => pokemonZonePack(index, { expansionId, nameEn })
    expect(pack('A1', 'Genetic Apex: Mewtwo').packId).toBe('A1/mewtwopack')
    expect(pack('A1', 'Genetic Apex: Charizard').packId).toBe('A1/charizardpack')
    expect(pack('A1', 'Genetic Apex: Pikachu')).toEqual({ packId: 'A1/pikachupack', nameEs: 'Pikachu' })
    expect(pack('A4', 'Wisdom of Sea and Sky: Ho-Oh').packId).toBe('A4/ho-ohpack')
    expect(pack('B1', 'Mega Rising: Mega Gyarados').packId).toBe('B1/megagyaradospack')
    // A single pack is that pack whatever its name says.
    expect(pack('B4b', 'Deluxe Pack: Mega').packId).toBe('B4b/deluxepackmega')
    expect(pack('A2b', 'Shining Revelry').packId).toBe('A2b/shiningrevelrypack')
    // Unknown to this catalog (C1 came later; SP1 is not there yet), or no match among several packs.
    expect(pack('C1', 'Dual Fusion: Pikachu').packId).toBeNull()
    expect(pack('SP1', 'Special Pack: First Partners').packId).toBeNull()
    expect(pack('A1', 'Genetic Apex: Mew').packId).toBeNull()
    expect(pack(null, 'Genetic Apex: Mewtwo').packId).toBeNull()
  })

  it('every pack of the fixture of an expansion the catalog has finds its pack', () => {
    const known = snapshot().packs.filter((row) => row.expansionId && index.expansionById(row.expansionId))
    expect(known.length).toBe(28)
    for (const row of known) expect(pokemonZonePack(index, row).packId, row.nameEn).not.toBeNull()
  })
})

describe('pokemon-zone: the settings of Sobres', () => {
  it('the game’s pack points replace the saved ones; 0 removes; what the game does not list stays', () => {
    const update = packPointsUpdate({ A1: 100, A3: 70, B4b: 40, 'P-A': 5 }, snapshot())
    expect(update.next).toMatchObject({ A1: 5, A3: 70, C1: 310, 'P-A': 5 })
    expect(update.next).not.toHaveProperty('B4b')
    expect(update.next).not.toHaveProperty('A2a')
    expect(update.changes).toContainEqual({ expansionId: 'A1', before: 100, after: 5 })
    expect(update.changes).toContainEqual({ expansionId: 'B4b', before: 40, after: 0 })
    expect(update.changes).toContainEqual({ expansionId: 'C1', before: 0, after: 310 })
    expect(update.changes.find((change) => change.expansionId === 'A3')).toBeUndefined()
    // A3 equal, and the four at 0 that were not saved (A2a, A2b, B3a; B4b changed).
    expect(update.unchanged).toBe(4)
    expect(update.changes.length + update.unchanged).toBe(22)
  })

  it('pack hourglasses are the setting’s hourglasses; null when the game did not give them', () => {
    expect(hourglassesUpdate(5, snapshot())).toEqual({ before: 5, after: 18, game: 18, kept: false })
    const none = { hourglasses: { ...snapshot().hourglasses, pack: null } }
    expect(hourglassesUpdate(5, none)).toBeNull()
    expect(hourglassesUpdate(0, { hourglasses: { ...none.hourglasses, pack: 250_000 } })?.after).toBe(100_000)
  })

  it('review of pz/import: what was changed by hand after the read stays', () => {
    const at = '2026-11-02T09:00:00.000Z'
    const points = packPointsUpdate({ A1: 100, A3: 70, B4b: 40 }, snapshot(), { A1: at, A3: at })
    // A1 stays (100, the game says 5); A3 is equal anyway; B4b, not changed by hand, goes to the game's 0.
    expect(points.kept).toEqual([{ expansionId: 'A1', value: 100, game: 5, editedAt: at }])
    expect(points.next).toMatchObject({ A1: 100, A3: 70, C1: 310 })
    expect(points.next).not.toHaveProperty('B4b')
    expect(points.changes.find((change) => change.expansionId === 'A1')).toBeUndefined()
    // What the import records as applied is the game's: A1 reads as changed by hand afterwards.
    expect(points.game).toMatchObject({ A1: 5, A3: 70, C1: 310 })
    expect(samePackPoints(points.next, points.game)).toBe(false)
    expect(hourglassesUpdate(6, snapshot(), true)).toEqual({ before: 6, after: 6, game: 18, kept: true })
    // Equal to the game's: nothing to keep.
    expect(hourglassesUpdate(18, snapshot(), true)).toEqual({ before: 18, after: 18, game: 18, kept: false })
  })

  it('Codex on #170: each expansion keeps the time of its own hand edit', () => {
    const none = parseHandEdits(undefined)
    expect(none).toEqual({ packPoints: {}, hourglasses: null })
    // A save gives its time only to the expansions whose points it changed (absent and 0 are the same).
    const monday = new Date('2026-11-02T03:00:00Z')
    const one = recordPointsEdit(none, { A1: 100, A2: 100, B4b: 0 }, { A1: 200, A2: 100 }, monday)
    expect(one.packPoints).toEqual({ A1: monday.toISOString() })
    const tuesday = new Date('2026-11-03T12:00:00Z')
    const two = recordPointsEdit(one, { A1: 200, A2: 100 }, { A1: 200, A2: 150, A3: 0 }, tuesday)
    expect(two.packPoints).toEqual({ A1: monday.toISOString(), A2: tuesday.toISOString() })
    // Removing an expansion is an edit of it; saving the same points is no edit at all.
    expect(recordPointsEdit(two, { A1: 200 }, {}, tuesday).packPoints.A1).toBe(tuesday.toISOString())
    expect(recordPointsEdit(two, { A1: 200 }, { A1: 200, A3: 0 }, tuesday)).toBe(two)
    expect(recordHourglassesEdit(two, 6, 6, tuesday)).toBe(two)
    const hourglasses = recordHourglassesEdit(two, 6, 7, tuesday)
    expect(hourglasses).toEqual({ ...two, hourglasses: tuesday.toISOString() })

    // Codex's example: A1 changed by hand on Monday, the game read on Tuesday at 09:00, A2 changed by hand at noon. A1
    // is older than the read (the game's value wins); A2 and the hourglasses are newer (they stay).
    const read = Date.parse('2026-11-03T09:00:00Z')
    expect(handEditedAfter(hourglasses, read)).toEqual({
      packPoints: { A2: tuesday.toISOString() },
      hourglasses: tuesday.toISOString(),
    })
    const update = packPointsUpdate(
      { A1: 200, A2: 150 },
      { packPoints: { A1: 250, A2: 100 } },
      handEditedAfter(hourglasses, read).packPoints,
    )
    expect(update.changes).toEqual([{ expansionId: 'A1', before: 200, after: 250 }])
    expect(update.kept).toEqual([{ expansionId: 'A2', value: 150, game: 100, editedAt: tuesday.toISOString() }])
    // An edit exactly at the read is not after it.
    expect(handEditedAfter(hourglasses, tuesday.getTime())).toEqual({ packPoints: {}, hourglasses: null })

    // What is stored is read leniently: what is not a time is left out; an own `__proto__` key stays a key.
    expect(
      parseHandEdits({
        packPoints: JSON.parse(
          '{"A1":"2026-11-02T03:00:00.000Z","A2":"ayer","A3":5,"__proto__":"2026-11-01T00:00:00Z"}',
        ),
        hourglasses: 'nunca',
      }),
    ).toEqual({
      packPoints: { A1: '2026-11-02T03:00:00.000Z', ['__proto__']: '2026-11-01T00:00:00Z' },
      hourglasses: null,
    })
    expect(parseHandEdits([1, 2])).toEqual(none)
    expect(parseHandEdits({ packPoints: ['2026-11-02T03:00:00Z'], hourglasses: '2026-11-02T03:00:00Z' })).toEqual({
      packPoints: {},
      hourglasses: '2026-11-02T03:00:00Z',
    })
  })

  it('two point settings are the same when 0 and absent are', () => {
    expect(samePackPoints({ A1: 5, B4b: 0 }, { A1: 5 })).toBe(true)
    expect(samePackPoints({ A1: 5 }, { A1: 6 })).toBe(false)
    expect(samePackPoints({}, { C1: 1 })).toBe(false)
  })
})

describe('pokemon-zone: promo coupons', () => {
  const NOW = new Date('2026-11-02T12:00:00Z')
  it('ties the coupons to the event the app knows, the active one first', () => {
    const coupons = promoCoupons(snapshot(), NOW)
    expect(coupons).toEqual([
      {
        key: 'TICKET_2610000_EV_03',
        event: 'PROMO Reissue Drop Event 2026',
        count: 2,
        eventId: 'botin-bis-promo-2026',
        nameEs: 'Evento botín bis PROMO 2026',
        active: true,
      },
      {
        key: 'TICKET_2610000_EV_04',
        event: 'PROMO Reissue Wonder Pick Event 2026',
        count: 2,
        eventId: null,
        nameEs: null,
        active: false,
      },
    ])
    // After the event: still its coupons, not active.
    expect(promoCoupons(snapshot(), new Date('2026-11-20T12:00:00Z'))[0]?.active).toBe(false)
  })

  it('leaves out coupons at 0 and matches the event name without minding case or spaces', () => {
    const events: PromoEvent[] = [
      { id: 'x', nameEs: 'Equis', nameEn: 'promo  reissue wonder pick event 2026', from: '', until: '', volumes: [] },
    ]
    const coupons = promoCoupons(
      {
        coupons: [
          { key: 'A', event: 'PROMO Reissue Wonder Pick Event 2026', count: 3 },
          { key: 'B', event: 'Other', count: 0 },
        ],
      },
      NOW,
      events,
    )
    expect(coupons.map((coupon) => [coupon.key, coupon.eventId])).toEqual([['A', 'x']])
  })
})

describe('pokemon-zone: battles', () => {
  it('a counter’s rate is wins over battles, with Wilson and «orientativo» under 30', () => {
    const view = gameCounterView({ battles: 340, wins: 160 })
    expect(view?.rate).toBeCloseTo((160 / 340) * 100, 10)
    expect(view?.ci95?.[0]).toBeCloseTo(41.8, 1)
    expect(view?.ci95?.[1]).toBeCloseTo(52.4, 1)
    expect(view?.orientative).toBe(false)
    expect(gameCounterView({ battles: 10, wins: 7 })?.orientative).toBe(true)
    expect(gameCounterView({ battles: 0, wins: 0 })).toEqual({
      battles: 0,
      wins: 0,
      rate: null,
      ci95: null,
      orientative: true,
    })
    expect(gameCounterView(null)).toBeNull()
    expect(gameBattles(snapshot()).rankedPoints).toBe(430)
  })

  it('says a counter as the rates are said, with its n and interval', () => {
    expect(formatGameCounterEs(gameCounterView({ battles: 340, wins: 160 }))).toBe(
      '47,1 % (160 V en 340 partidas, IC 41,8–52,4 %)',
    )
    expect(formatGameCounterEs(gameCounterView({ battles: 1, wins: 1 }))).toBe(
      '100 % (1 V en 1 partida, IC 20,7–100,0 %, orientativo)',
    )
    expect(formatGameCounterEs(gameCounterView({ battles: 1380, wins: 930 }))).toContain('930 V en 1.380 partidas')
    expect(formatGameCounterEs(gameCounterView({ battles: 0, wins: 0 }))).toBe('sin partidas')
    expect(formatGameCounterEs(null)).toBe('sin datos')
  })

  it('between two imports: what the game counted in that span; null when a counter went down', () => {
    const after = snapshot()
    const before = structuredClone(after)
    before.battles.ranked = { battles: 330, wins: 155 }
    before.battles.versus = { battles: 488, wins: 233 }
    before.battles.rankedPoints = 400
    expect(battlesBetween(before, after)).toEqual({
      versus: { battles: 12, wins: 7 },
      ranked: { battles: 10, wins: 5 },
      solo: { battles: 0, wins: 0 },
      rental: { battles: 0, wins: 0 },
      rankedPoints: 30,
    })
    const other = structuredClone(after)
    other.battles.ranked = { battles: 400, wins: 200 }
    expect(battlesBetween(other, after)).toBeNull()
    const points = structuredClone(after)
    points.battles.rankedPoints = 500
    // Ranked points can go down (losses at the top ranks, a new season): a signed difference, the window stays.
    expect(battlesBetween(points, after)).toMatchObject({ rankedPoints: -70, versus: { battles: 0, wins: 0 } })
  })

  it('the game against the matches logged: ranked with competitive, versus with every match', () => {
    expect(
      loggedComparison(
        { ranked: { battles: 10, wins: 5 }, versus: { battles: 12, wins: 7 } },
        { competitive: 7, all: 15 },
      ),
    ).toEqual([
      { kind: 'ranked', game: 10, logged: 7, notLogged: 3 },
      { kind: 'versus', game: 12, logged: 15, notLogged: 0 },
    ])
    expect(loggedComparison({ ranked: null, versus: null }, { competitive: 1, all: 1 })).toEqual([])
  })
})

describe('pokemon-zone: suerte de los sobres', () => {
  it('weighs the expected share by the packs really opened in each expansion', () => {
    const luck = pokemonZoneLuck(
      luckSnapshot({
        expansions: [
          ['A1', 10, 50],
          ['B4b', 10, 40],
        ],
        rarities: { C: 50, U: 26, R: 6, RR: 4, AR: 3, SR: 1 },
      }),
      null,
      index,
    )
    expect(luck).not.toBeNull()
    if (!luck) return
    expect(luck.packs).toBe(20)
    expect(luck.packCards).toBe(90)
    expect(luck.cards).toBe(90)
    expect(luck.otherCards).toBe(0)
    expect(luck.rare?.observed).toBe(4)
    expect(luck.rare?.expectedShare).toBeCloseTo((50 * STANDARD_RARE + 40 * DELUXE_RARE) / 90, 6)
    expect(luck.rare?.expected).toBeCloseTo((90 * ((50 * STANDARD_RARE + 40 * DELUXE_RARE) / 90)) / 100, 6)
    expect(luck.ex?.observed).toBe(4)
    expect(luck.ex?.expectedShare).toBeCloseTo((50 * STANDARD_EX + 40 * DELUXE_EX) / 90, 6)
    // 4 ex where ~10,9 were expected out of 90 cards: worse than normal. No other cards: both ends are the same.
    expect(luck.ex).toMatchObject({ games: 90, fromPacks: { min: 4, max: 4 }, verdict: 'unlucky' })
    expect(luck.ex?.tail).toBe(luck.ex?.high.lowerTail)
    expect(luck.byRarity).toEqual({ '◊': 50, '◊◊': 26, '◊◊◊': 6, '◊◊◊◊': 4, '☆': 3, '☆☆': 1 })
  })

  it('cards from elsewhere are said apart and left out of the n', () => {
    const luck = pokemonZoneLuck(
      luckSnapshot({
        expansions: [
          ['A1', 10, 60],
          ['A4b', 0, 5],
        ],
        rarities: { C: 40, U: 20, RR: 3, AR: 2 },
        wonderPicks: 8,
        trades: 2,
      }),
      null,
      index,
    )
    expect(luck?.cards).toBe(65)
    expect(luck?.packCards).toBe(50)
    expect(luck?.otherCards).toBe(15)
    expect(luck?.wonderPicks).toBe(8)
    expect(luck?.trades).toBe(2)
    expect(luck?.rare?.expectedShare).toBeCloseTo(STANDARD_RARE, 6)
    // n is the 50 cards the packs gave; the 2 ☆ could all be from the 15 other cards, or none.
    expect(luck?.rare?.games).toBe(50)
    expect(luck?.rare?.expected).toBeCloseTo((50 * STANDARD_RARE) / 100, 6)
    expect(luck?.rare?.fromPacks).toEqual({ min: 0, max: 2 })
    expect(luck?.rare?.verdict).toBe('normal')
    // The Deluxe ex with cards but no packs is listed; its 0 packs do not move the expected share.
    expect(luck?.expansions.map((row) => [row.expansionId, row.packs, row.cards, row.packCards])).toEqual([
      ['A1', 10, 60, 50],
      ['A4b', 0, 5, 0],
    ])
  })

  it('packs of an expansion the catalog does not know are left out of the expected, and counted', () => {
    const luck = pokemonZoneLuck(
      luckSnapshot({
        expansions: [
          ['A1', 4, 20],
          ['SP1', 2, 2],
        ],
        rarities: { C: 15, U: 7 },
      }),
      null,
      index,
    )
    expect(luck?.packs).toBe(6)
    expect(luck?.packCards).toBe(20)
    expect(luck?.unknownPacks).toBe(2)
    expect(luck?.expansions.find((row) => row.expansionId === 'SP1')).toMatchObject({ nameEs: null, packCards: null })
  })

  it('without any pack of a known expansion there is nothing to compare', () => {
    const luck = pokemonZoneLuck(luckSnapshot({ rarities: { C: 3, AR: 1 }, wonderPicks: 4 }), null, index)
    expect(luck?.cards).toBe(4)
    expect(luck?.rare).toBeNull()
    expect(luck?.ex).toBeNull()
  })

  it('a rarity code the app does not have is counted apart, out of the check', () => {
    const luck = pokemonZoneLuck(
      luckSnapshot({ expansions: [['A1', 2, 10]], rarities: { C: 6, U: 2, AN: 3 } }),
      null,
      index,
    )
    expect(luck?.cards).toBe(8)
    expect(luck?.unknownRarity).toBe(3)
    expect(luck?.rare?.games).toBe(8)
  })

  it('review of pz/import: a verdict only when the other cards could not change it', () => {
    // 100 packs of A1 (500 cards), 200 cards from elsewhere, 40 ☆: from 0 (all elsewhere) to 40 from the packs, where
    // ~16,7 were expected — unlucky at one end, lucky at the other.
    const split = pokemonZoneLuck(
      luckSnapshot({ expansions: [['A1', 100, 700]], rarities: { C: 600, U: 60, AR: 40 } }),
      null,
      index,
    )
    expect(split?.rare).toMatchObject({ games: 500, fromPacks: { min: 0, max: 40 }, verdict: 'unknown', tail: null })
    expect(split?.rare?.low.verdict).toBe('unlucky')
    expect(split?.rare?.high.verdict).toBe('lucky')
    // No ☆ at all in 700 cards: at both ends none came from the packs — unlucky whatever the others were.
    const none = pokemonZoneLuck(
      luckSnapshot({ expansions: [['A1', 100, 700]], rarities: { C: 640, U: 60 } }),
      null,
      index,
    )
    expect(none?.rare).toMatchObject({ fromPacks: { min: 0, max: 0 }, verdict: 'unlucky' })
    expect(none?.rare?.tail).toBeLessThan(0.001)
  })

  it('review of #170: when both ends agree, the tail shown is the less extreme one («1 de cada N» never overstates)', () => {
    // 100 packs of A1 (500 cards) and 20 cards from elsewhere: 80 ☆ is lucky whether 60 or 80 came from the packs
    // (~16,7 expected). The tail is the 60's, the larger one.
    const lucky = pokemonZoneLuck(
      luckSnapshot({ expansions: [['A1', 100, 520]], rarities: { C: 400, U: 40, AR: 80 } }),
      null,
      index,
    )?.rare
    expect(lucky).toMatchObject({ games: 500, fromPacks: { min: 60, max: 80 }, verdict: 'lucky' })
    expect(lucky?.low.verdict).toBe('lucky')
    expect(lucky?.tail).toBe(lucky?.low.upperTail)
    expect(lucky?.tail).toBeGreaterThan(lucky?.high.upperTail ?? 1)
    // 2 ☆ is unlucky whether 0 or 2 came from the packs: the tail is the 2's, the larger one.
    const unlucky = pokemonZoneLuck(
      luckSnapshot({ expansions: [['A1', 100, 520]], rarities: { C: 458, U: 60, AR: 2 } }),
      null,
      index,
    )?.rare
    expect(unlucky).toMatchObject({ games: 500, fromPacks: { min: 0, max: 2 }, verdict: 'unlucky' })
    expect(unlucky?.high.verdict).toBe('unlucky')
    expect(unlucky?.tail).toBe(unlucky?.high.lowerTail)
    expect(unlucky?.tail).toBeGreaterThan(unlucky?.low.lowerTail ?? 1)
  })

  it('since the previous import: the differences, per expansion, pack and rarity', () => {
    const after = snapshot()
    const before = structuredClone(after)
    const b4b = before.expansions.find((row) => row.expansionId === 'B4b')
    const a1 = before.expansions.find((row) => row.expansionId === 'A1')
    if (!b4b || !a1) throw new Error('fixture')
    b4b.packsOpened -= 10
    b4b.cardsObtained -= 40
    a1.packsOpened -= 2
    a1.cardsObtained -= 11
    for (const row of before.packs) {
      if (row.packId === 'BN011_0010_00_000') row.opened -= 10
      if (row.packId === 'AN001_0010_00_000') row.opened -= 2
    }
    const rarity = (code: string, less: number) => {
      const row = before.rarities.find((item) => item.code === code)
      if (row) row.obtained -= less
    }
    rarity('C', 22)
    rarity('U', 18)
    rarity('R', 5)
    rarity('RR', 3)
    rarity('AR', 2)
    before.totals.wonderPicks = (after.totals.wonderPicks ?? 0) - 1
    before.totals.trades = after.totals.trades
    const luck = pokemonZoneLuck(after, before, index)
    expect(luck).not.toBeNull()
    expect(luck?.packs).toBe(12)
    expect(luck?.packCards).toBe(10 * 4 + 2 * 5)
    expect(luck?.cards).toBe(50)
    expect(luck?.otherCards).toBe(0)
    expect(luck?.wonderPicks).toBe(1)
    expect(luck?.trades).toBe(0)
    expect(luck?.expansions.map((row) => [row.expansionId, row.packs, row.cards])).toEqual([
      ['B4b', 10, 40],
      ['A1', 2, 11],
    ])
    expect(luck?.byPack.map((row) => [row.appPackId, row.opened])).toEqual([
      ['B4b/deluxepackmega', 10],
      ['A1/mewtwopack', 2],
    ])
    expect(luck?.rare?.observed).toBe(2)
    expect(luck?.rare?.expectedShare).toBeCloseTo((40 * DELUXE_RARE + 10 * STANDARD_RARE) / 50, 6)
    expect(luck?.ex?.observed).toBe(3)
  })

  it('a count that went down (another account, or pokemon-zone started over) gives no difference', () => {
    const after = snapshot()
    const before = structuredClone(after)
    const row = before.rarities.find((item) => item.code === 'UR')
    if (row) row.obtained += 1
    expect(pokemonZoneLuck(after, before, index)).toBeNull()
    const packs = structuredClone(after)
    const pack = packs.packs[0]
    if (pack) pack.opened += 1
    expect(pokemonZoneLuck(after, packs, index)).toBeNull()
  })

  it('lifetime on the fixture: every pack and card of the game, C1 and SP1 outside this catalog', () => {
    const luck = pokemonZoneLuck(snapshot(), null, index)
    expect(luck?.packs).toBe(1226)
    expect(luck?.cards).toBe(6883)
    expect(luck?.unknownPacks).toBe(62 + 2)
    expect(luck?.rare?.observed).toBe(211 + 28 + 22 + 7 + 21 + 19 + 6)
    expect(luck?.ex?.observed).toBe(534)
    // About a fifth of the cards are not from the packs the app models: the ☆ check cannot tell.
    expect(luck?.rare).toMatchObject({ games: 5438, fromPacks: { min: 0, max: 314 }, verdict: 'unknown' })
    // B4b's 372 Deluxe packs give 4 cards each; the other known packs 5.
    expect(luck?.packCards).toBe(372 * 4 + (1226 - 372 - 64) * 5)
    expect(luck?.byPack[0]).toMatchObject({ appPackId: 'B4b/deluxepackmega', opened: 372 })
  })
})
