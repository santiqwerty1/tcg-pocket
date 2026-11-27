/**
 * The test data of «Piezas de la interfaz» (pages/mas/PiecesPage.tsx) and of the tests of the pieces.
 *
 * EVERY NUMBER HERE IS INVENTED. They start from the public data of the mock-ups
 * (docs/prototipos/renovacion-ui/datos.js): none is a match, a rank, a tournament or a simulation of anybody, and
 * none comes from a database. No screen but the gallery may read this file (app/pieces.test.ts).
 *
 * What the API gives as a rate or as a deck's comparison is written in the API's shape and turned into a figure by
 * the real adapters of lib/figure.ts, so a change in either fails here first (pieces/fixtures.test.ts also runs each
 * one through the web's schemas). The shapes that are not a rate (a number against the meta, a score of the
 * Laboratorio) have no adapter yet and are written as the figure itself.
 */
import type { ComparisonColumn, GameRecord, WinRate } from '@/api/schemas'
import { type Figure, figureFromRate } from '@/lib/figure'
import { formatRateValue } from '@/lib/matches'

/** The rates, as the API sends them. */
export const RATES = {
  /** Own matches: 24 of 47, «51,1 %». */
  mine: {
    source: 'matches',
    value: (24 / 47) * 100,
    games: 47,
    samples: 47,
    sampleKind: 'matches',
    ci95: [37.2, 64.7],
    orientative: false,
  },
  /** Own matches, 16 of 24: fewer than 30 matches, «orientativo» by its matches. */
  few: {
    source: 'matches',
    value: (16 / 24) * 100,
    games: 24,
    samples: 24,
    sampleKind: 'matches',
    ci95: [46.7, 82],
    orientative: true,
  },
  /** A tournament list: 8 games in 2 lists, «orientativo» by its lists. */
  exactList: {
    source: 'tournament',
    value: 12.5,
    games: 8,
    samples: 2,
    sampleKind: 'lists',
    ci95: [2.2, 47.1],
    orientative: true,
  },
  /** A tournament archetype: 70 games, more than 30, and still «orientativo»: they are in 14 lists. */
  archetype: {
    source: 'tournament',
    value: (25 / 70) * 100,
    games: 70,
    samples: 14,
    sampleKind: 'lists',
    ci95: [25.5, 47.4],
    orientative: true,
  },
  /** A tournament archetype everybody plays: thousands of games in more than a thousand lists, the longest n. */
  popular: {
    source: 'tournament',
    value: (5943 / 12406) * 100,
    games: 12406,
    samples: 1203,
    sampleKind: 'lists',
    ci95: [46.1, 49.7],
    orientative: false,
  },
  /** Bots: 7.095 of 14.179, «50 %» with one decimal at most and «50,0 %» in a column. */
  bots: {
    source: 'simulation',
    value: (7095 / 14179) * 100,
    games: 14179,
    samples: 14179,
    sampleKind: 'simulations',
    ci95: [49.2, 50.9],
    orientative: false,
  },
  /** One match, lost: a real zero, which is a figure and not «sin datos». */
  lostOnce: {
    source: 'matches',
    value: 0,
    games: 1,
    samples: 1,
    sampleKind: 'matches',
    ci95: [0, 79.3],
    orientative: true,
  },
  /** Two matches, both won: the point at the right end of the scale. */
  wonTwice: {
    source: 'matches',
    value: 100,
    games: 2,
    samples: 2,
    sampleKind: 'matches',
    ci95: [34.2, 100],
    orientative: true,
  },
} satisfies Record<string, WinRate>

/** The record behind each rate. */
export const RECORDS = {
  mine: { wins: 24, losses: 22, ties: 1 },
  few: { wins: 16, losses: 8, ties: 0 },
  exactList: { wins: 1, losses: 7, ties: 0 },
  archetype: { wins: 25, losses: 45, ties: 0 },
  popular: { wins: 5943, losses: 6341, ties: 122 },
  bots: { wins: 7095, losses: 7004, ties: 80 },
  lostOnce: { wins: 0, losses: 1, ties: 0 },
  wonTwice: { wins: 2, losses: 0, ties: 0 },
} satisfies Record<keyof typeof RATES, GameRecord>

function figure(name: keyof typeof RATES): Figure {
  const made = figureFromRate(RATES[name], RECORDS[name])
  if (!made) throw new Error(`a rate with games is a figure: ${name}`)
  return made
}

export const MINE = figure('mine')
export const FEW = figure('few')
export const EXACT_LIST = figure('exactList')
export const ARCHETYPE = figure('archetype')
export const POPULAR = figure('popular')
export const BOTS = figure('bots')
export const LOST_ONCE = figure('lostOnce')
export const WON_TWICE = figure('wonTwice')

/** What a deck should score against the meta, with no pairing behind it: no interval, and no coverage at all. */
export const EXPECTED: Figure = {
  value: 59.3,
  n: 41,
  ci95: null,
  orientative: false,
  sampleKind: 'matches',
  coverage: 0,
}

/** The same kind of number with matchups behind 73,2 % of the meta. */
export const COVERED: Figure = {
  value: 47.9,
  n: 942,
  ci95: [44.7, 51.1],
  orientative: false,
  sampleKind: 'matches',
  coverage: 73.2,
}

/** A score of the Laboratorio played in another era. */
export const STALE: Figure = {
  value: 50.3,
  n: 3600,
  ci95: [48.7, 51.9],
  orientative: false,
  sampleKind: 'simulations',
  stale: { era: 'B4b' },
  bot: 'g2',
}

/** What a column of a deck's comparison says of its number, in the API's words. */
export const NOTES = {
  mine: 'Partidas registradas en la app, todas las modalidades.',
  tournament: `Era C1 (Fusión Dual), 13 torneos, media ${formatRateValue(49)}. Datos de torneo: Limitless.`,
  bots: 'Bots g2 vs g2, 5 simulaciones, motor 0a1b2c3. El porcentaje depende del bot.',
  noMatches: 'Todavía no registraste partidas con este mazo.',
  noTournaments: 'Todavía no hay datos de torneo sincronizados.',
  noSimulation: 'Todavía no se simuló la lista actual de este mazo (Pruebas → Simulación).',
  blindSpot:
    'Posible punto ciego del bot: g2 casi nunca juega Caramelo Raro en el turno 2, así que el mazo llega tarde a su Fase 2. Probalo con otro bot.',
} as const

/** `GET /api/decks/:id/comparison` of a deck with a number in each source: its three columns. */
export const DECK: ComparisonColumn[] = [
  {
    source: 'matches',
    label: 'Mis partidas',
    available: true,
    record: RECORDS.mine,
    rate: RATES.mine,
    note: NOTES.mine,
    blindSpot: null,
  },
  {
    source: 'tournament',
    label: 'Torneo',
    available: true,
    record: RECORDS.exactList,
    rate: RATES.exactList,
    note: NOTES.tournament,
    rows: [
      { label: 'Lista exacta', record: RECORDS.exactList, rate: RATES.exactList },
      {
        label: 'Arquetipo: Butterfree Mega Sceptile ex',
        record: RECORDS.archetype,
        rate: RATES.archetype,
        note: 'Sugerido por las listas más parecidas (2 cambios).',
      },
    ],
    blindSpot: null,
  },
  {
    source: 'simulation',
    label: 'Simulación',
    available: true,
    record: RECORDS.bots,
    rate: RATES.bots,
    note: NOTES.bots,
    blindSpot: { text: NOTES.blindSpot },
  },
]

/** The same answer for a deck nobody played yet: own matches with nothing to count, the other two with no source. */
export const DECK_EMPTY: ComparisonColumn[] = [
  {
    source: 'matches',
    label: 'Mis partidas',
    available: true,
    record: { wins: 0, losses: 0, ties: 0 },
    rate: null,
    note: NOTES.noMatches,
    blindSpot: null,
  },
  {
    source: 'tournament',
    label: 'Torneo',
    available: false,
    record: null,
    rate: null,
    note: NOTES.noTournaments,
    blindSpot: null,
  },
  {
    source: 'simulation',
    label: 'Simulación',
    available: false,
    record: null,
    rate: null,
    note: NOTES.noSimulation,
    blindSpot: null,
  },
]

/** A name that does not fit on one line of a phone: it wraps, it is never cut. */
export const LONG_NAME = 'Torneo · Arquetipo: Mega-Gardevoir ex / Gallade con Dedenne ex y Caramelo Raro'

/** Shares of a meta, for a bar against the largest of its column. */
export const SHARES = [14.3, 7.9, 1.2] as const

/** A count in three parts that is not a record: cards of a set, whole, started and missing. */
export const COLLECTION = { complete: 212, started: 61, missing: 27 } as const
