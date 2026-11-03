/**
 * pokemon-zone answers of the API for the screen tests, as apps/api's PokemonZoneService gives them (numbers of the
 * domain's made-up fixture: see packages/domain/test/fixtures/pokemon-zone).
 */

const counter = (battles: number, wins: number, ci95: [number, number], orientative = false) => ({
  battles,
  wins,
  rate: (wins / battles) * 100,
  ci95,
  orientative,
})

export const BATTLES = {
  versus: counter(500, 240, [43.6, 52.4]),
  ranked: counter(340, 160, [41.8, 52.4]),
  solo: counter(1380, 930, [64.9, 69.8]),
  rental: counter(10, 7, [39.7, 89.2], true),
  rankedPoints: 430,
}

export const COUPONS = [
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
    count: 1,
    eventId: null,
    nameEs: null,
    active: false,
  },
]

export const TOTALS = { packsOpened: 1226, cardsObtained: 6883, uniqueCards: 2419, wonderPicks: 387, trades: 49 }

export const PREVIEW = {
  syncedAt: '2026-11-02T02:43:29.379Z',
  level: 40,
  account: 'same',
  duplicate: false,
  older: false,
  packPoints: {
    changes: [
      { expansionId: 'B4b', before: 40, after: 0, nameEs: 'Sobre Deluxe Mega' },
      { expansionId: 'C1', before: 0, after: 310, nameEs: null },
    ],
    unchanged: 20,
    kept: [] as { expansionId: string; value: number; game: number; editedAt: string; nameEs: string | null }[],
  },
  hourglasses: { before: 3, after: 18, game: 18, kept: false, editedAt: null as string | null },
  coupons: COUPONS,
  battles: BATTLES,
  totals: TOTALS,
  since: {
    from: { id: '1', importedAt: '2026-11-01T03:00:00.000Z', syncedAt: '2026-11-01T02:40:00.000Z' },
    packs: 5,
    cards: 1,
  },
}

const check = (verdict: string, lowerTail = 0.5, upperTail = 0.5) => ({
  games: 0,
  wins: 0,
  verdict,
  lowerTail,
  upperTail,
})

const tier = (
  observed: number,
  expected: number,
  expectedShare: number,
  games: number,
  min: number,
  max: number,
  low: ReturnType<typeof check>,
  high: ReturnType<typeof check>,
  verdict: string,
  tail: number | null,
  unknown = 0,
  normalIf: { min: number; max: number } | null = null,
) => ({
  observed,
  expected,
  expectedShare,
  games,
  unknown,
  fromPacks: { min, max },
  low,
  high,
  verdict,
  tail,
  normalIf,
})

const EVENT_WINDOW = {
  from: '2026-10-30T06:00:00Z',
  until: '2026-11-13T07:00:00Z',
  why: 'Evento bis PROMO 2026: promos y más elecciones Chansey en Wonder Pick',
}

const noSources = {
  wonderPicks: 0,
  pickCards: 0,
  unknownPicks: 0,
  pickWindows: [] as (typeof EVENT_WINDOW)[],
  trades: 0,
  guaranteedPacks: 0,
  guaranteedSeen: true,
  restCards: 0,
}

/**
 * pz/luck: lifetime as Santi's real import of 3/11 gives it (production's catalog): 1.309 packs and 7.376 cards, read
 * inside «Evento bis PROMO 2026»; since the previous import: 5 Deluxe packs.
 */
export const LUCK = {
  lifetime: {
    packs: 1309,
    cards: 7376,
    packCards: 6163,
    otherCards: 1214,
    wonderPicks: 402,
    trades: 51,
    sources: {
      wonderPicks: 402,
      pickCards: 0,
      unknownPicks: 402,
      pickWindows: [EVENT_WINDOW],
      trades: 51,
      guaranteedPacks: 1,
      guaranteedSeen: false,
      restCards: 760,
    },
    byRarity: { '◊': 3947, '☆': 236 },
    unknownRarity: 0,
    expansions: [],
    byPack: [
      {
        packId: 'BN011_0010_00_000',
        nameEn: 'Deluxe Pack: Mega',
        expansionId: 'B4b',
        appPackId: 'B4b/deluxepackmega',
        nameEs: 'Sobre Deluxe Mega',
        opened: 372,
      },
      {
        packId: 'CN001_0010_00_000',
        nameEn: 'Dual Fusion: Mega Mewtwo X',
        expansionId: 'C1',
        appPackId: 'C1/megamewtwoxpack',
        nameEs: 'Mega-Mewtwo X',
        opened: 52,
      },
    ],
    unknownPacks: 2,
    // Two ends of what the 1.214 cards of unknown origin could hold: neither tier can tell.
    rare: tier(
      348,
      262.8,
      4.27,
      6162,
      0,
      348,
      check('unlucky', 0, 1),
      check('lucky', 1, 0.0001),
      'unknown',
      null,
      1214,
      { min: 54, max: 116 },
    ),
    ex: tier(548, 449.8, 7.3, 6162, 0, 548, check('unlucky', 0, 1), check('lucky', 1, 0.0001), 'unknown', null, 1214, {
      min: 58,
      max: 138,
    }),
  },
  since: {
    packs: 5,
    cards: 20,
    packCards: 20,
    otherCards: 0,
    wonderPicks: 0,
    trades: 0,
    sources: noSources,
    byRarity: { '◊': 20 },
    unknownRarity: 0,
    expansions: [],
    byPack: [],
    unknownPacks: 0,
    rare: tier(0, 0.9, 4.58, 20, 0, 0, check('normal'), check('normal'), 'normal', null),
    ex: null,
  },
  sinceFirst: null as unknown,
}

/** pz/luck: «desde la primera importación» after a few days of packs only (made up). */
export const SINCE_FIRST = {
  from: '2026-11-14T12:00:00.000Z',
  to: '2026-11-17T12:00:00.000Z',
  spans: 3,
  rare: {
    ...tier(14, 8.8, 4.38, 201, 13, 14, check('lucky', 0.99, 0.02), check('lucky', 1, 0.008), 'lucky', 0.02, 1),
    counted: 2,
  },
  ex: null,
}

export const SUMMARY = {
  imports: 2,
  latest: {
    id: '2',
    importedAt: '2026-11-02T03:00:00.000Z',
    syncedAt: '2026-11-02T02:43:29.379Z',
    level: 40,
    packPoints: { A1: 5, C1: 310 },
    hourglasses: { pack: 18, wonder: 100, trade: 1000, event: 0, rewind: 20 },
    currencies: { shopTickets: 3000, shinedust: 400000, premiumTickets: 20 },
    coupons: COUPONS,
    totals: TOTALS,
  },
  previous: { id: '1', importedAt: '2026-11-01T03:00:00.000Z', syncedAt: '2026-11-01T02:40:00.000Z' },
  settings: {
    packPoints: 'imported' as 'imported' | 'edited' | null,
    hourglasses: 'edited' as 'imported' | 'edited' | null,
  },
  battles: {
    game: BATTLES,
    logged: { all: 1, competitive: 1, firstAt: '2026-10-07T12:00:00.000Z' },
    lifetime: [
      { kind: 'ranked', game: 340, logged: 1, notLogged: 339 },
      { kind: 'versus', game: 500, logged: 1, notLogged: 499 },
    ],
    window: {
      from: '2026-11-01T02:40:00.000Z',
      to: '2026-11-02T02:43:29.379Z',
      game: {
        versus: { battles: 4, wins: 2 },
        ranked: { battles: 3, wins: 2 },
        solo: null,
        rental: null,
        rankedPoints: 10,
      },
      logged: { all: 4, competitive: 1 },
      comparison: [
        { kind: 'ranked', game: 3, logged: 1, notLogged: 2 },
        { kind: 'versus', game: 4, logged: 4, notLogged: 0 },
      ],
    },
  },
  luck: LUCK as typeof LUCK | null,
}

/** Before the first import. */
export const EMPTY_SUMMARY = {
  imports: 0,
  latest: null,
  previous: null,
  settings: { packPoints: null, hourglasses: null },
  battles: null,
  luck: null,
}
