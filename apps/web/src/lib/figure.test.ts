// The fixtures are answers of the API as the web reads them: each one goes through its schema of api/schemas.ts, so a
// change in the shape of a rate or of a comparison column fails here first. The numbers are invented (they start from
// the mock-up's public docs/prototipos/renovacion-ui/datos.js); none is a real result.
import { describe, expect, it } from 'vitest'
import { deckComparisonSchema, type GameRecord, type WinRate, winRateSchema } from '@/api/schemas'
import {
  type Figure,
  figureFromColumn,
  figureFromRate,
  figureSample,
  figureText,
  INTERVAL_KEY,
  intervalText,
  NO_COVERAGE,
  NO_DATA,
  orientativeKey,
  orientativeText,
  SAMPLE_NOUN,
  SOURCE_LETTER,
  SOURCE_NAME,
} from './figure'
import { formatRate, formatSample, ORIENTATIVE_BELOW } from './matches'

const NBSP = '\u00a0'
/** The dash of a range, with the word joiner `formatInterval` writes after it. */
const DASH = '–\u2060'

const mineRecord: GameRecord = { wins: 24, losses: 22, ties: 1 }
const mine = winRateSchema.parse({
  source: 'matches',
  value: (24 / 47) * 100,
  games: 47,
  samples: 47,
  sampleKind: 'matches',
  ci95: [37.2, 64.7],
  orientative: false,
})
/** A tournament rate is «orientativo» by its lists: 70 games, but in 14 lists. */
const archetype = winRateSchema.parse({
  source: 'tournament',
  value: (25 / 70) * 100,
  games: 70,
  samples: 14,
  sampleKind: 'lists',
  ci95: [25.5, 47.4],
  orientative: true,
})
const exactList = winRateSchema.parse({
  source: 'tournament',
  value: 12.5,
  games: 8,
  samples: 2,
  sampleKind: 'lists',
  ci95: [2.2, 47.1],
  orientative: true,
})
const bots = winRateSchema.parse({
  source: 'simulation',
  value: (7095 / 14179) * 100,
  games: 14179,
  samples: 14179,
  sampleKind: 'simulations',
  ci95: [49.2, 50.9],
  orientative: false,
})
/** One match, lost: a real zero. */
const lostOnce = winRateSchema.parse({
  source: 'matches',
  value: 0,
  games: 1,
  samples: 1,
  sampleKind: 'matches',
  ci95: [0, 79.3],
  orientative: true,
})
const RATES: WinRate[] = [mine, archetype, exactList, bots, lostOnce]

/** `GET /api/decks/:id/comparison`: the three columns of a deck, with the tournament column in detail. */
const comparison = deckComparisonSchema.parse({
  deck: { id: '12', name: 'Butterfree / Mega-Sceptile ex', archived: false },
  columns: [
    {
      source: 'matches',
      label: 'Mis partidas',
      available: true,
      record: mineRecord,
      rate: mine,
      note: 'Partidas registradas en la app, todas las modalidades.',
    },
    {
      source: 'tournament',
      label: 'Torneo',
      available: true,
      record: { wins: 1, losses: 7, ties: 0 },
      rate: exactList,
      note: 'Era C1 (Fusión Dual), 13 torneos, media 49\u00a0%. Datos de torneo: Limitless (play.limitlesstcg.com).',
      rows: [
        { label: 'Lista exacta', record: { wins: 1, losses: 7, ties: 0 }, rate: exactList },
        {
          label: 'Arquetipo: Butterfree Mega Sceptile ex',
          record: { wins: 25, losses: 45, ties: 0 },
          rate: archetype,
          note: 'Arquetipo elegido en el mazo.',
        },
      ],
    },
    {
      source: 'simulation',
      label: 'Simulación',
      available: true,
      record: { wins: 7095, losses: 7004, ties: 80 },
      rate: bots,
      note: 'Bots g2 vs g2, 5 simulaciones, motor 0000000. El porcentaje depende del bot.',
    },
  ],
})
/** The same deck before anything is known of it: no match, no list like it in the era, no simulation. */
const emptyComparison = deckComparisonSchema.parse({
  deck: { id: '13', name: 'Mega-Altaria ex / Greninja', archived: false },
  columns: [
    {
      source: 'matches',
      label: 'Mis partidas',
      available: true,
      record: { wins: 0, losses: 0, ties: 0 },
      rate: null,
      note: 'Todavía no registraste partidas con este mazo.',
    },
    {
      source: 'tournament',
      label: 'Torneo',
      available: false,
      record: null,
      rate: null,
      note: 'Nadie jugó esta lista ni una parecida en la era.',
    },
    {
      source: 'simulation',
      label: 'Simulación',
      available: false,
      record: null,
      rate: null,
      note: 'Todavía no se simuló la lista actual de este mazo (Pruebas → Simulación).',
    },
  ],
})

/** A figure that was never null, for the tests that read its fields. */
function present(rate: WinRate, record?: GameRecord | null): Figure {
  const figure = figureFromRate(rate, record)
  if (!figure) throw new Error('the rate has games: it is a figure')
  return figure
}

describe('figureFromRate', () => {
  it('copies the rate as it comes: the value at full precision, the games, the interval, the flag and its kind', () => {
    expect(figureFromRate(mine, mineRecord)).toStrictEqual({
      value: (24 / 47) * 100,
      n: 47,
      ci95: [37.2, 64.7],
      orientative: false,
      sampleKind: 'matches',
      record: mineRecord,
    })
    expect(figureFromRate(bots)).toStrictEqual({
      value: (7095 / 14179) * 100,
      n: 14179,
      ci95: [49.2, 50.9],
      orientative: false,
      sampleKind: 'simulations',
      record: null,
    })
  })

  it('a tournament rate with 70 games in 14 lists stays orientativo, and brings its lists', () => {
    const figure = present(archetype)
    expect(figure.n).toBe(70)
    expect(figure.n).toBeGreaterThanOrEqual(ORIENTATIVE_BELOW)
    expect(figure.orientative).toBe(true)
    expect(figure.sampleKind).toBe('lists')
    expect(figure.samples).toBe(14)
    expect(orientativeText(figure.sampleKind)).toBe('orientativo: menos de 30 listas')
    expect(figureSample(figure)).toBe('n = 70 en 14 listas')
  })

  it('only a rate counted on lists brings them: for matches and simulations `samples` is the games again', () => {
    expect(present(mine)).not.toHaveProperty('samples')
    expect(present(bots)).not.toHaveProperty('samples')
    expect(present(exactList).samples).toBe(2)
    // A matchup of a tournament counts matches: the source does not decide what is counted.
    const matchup = winRateSchema.parse({ ...mine, source: 'tournament' })
    expect(present(matchup)).not.toHaveProperty('samples')
    expect(figureSample(present(matchup))).toBe('n = 47')
  })

  it('«orientativo» is the flag of the API, never worked out again from the games', () => {
    expect(present({ ...mine, games: 5, samples: 5, orientative: false }).orientative).toBe(false)
    expect(present({ ...mine, games: 500, samples: 500, orientative: true }).orientative).toBe(true)
    expect(present({ ...archetype, games: 2000, orientative: true }).orientative).toBe(true)
  })

  it('without a rate there is no figure; a real zero with a game behind it is one', () => {
    expect(figureFromRate(null)).toBeNull()
    expect(figureFromRate(null, { wins: 0, losses: 0, ties: 0 })).toBeNull()
    const zero = present(lostOnce, { wins: 0, losses: 1, ties: 0 })
    expect(zero.value).toBe(0)
    expect(zero.n).toBe(1)
    expect(figureText(zero)).toBe(`0${NBSP}%, n = 1, IC${NBSP}0,0${DASH}79,3${NBSP}%, orientativo`)
  })

  it('a rate over no games is no data either: its zero is never written as a result', () => {
    expect(figureFromRate({ ...lostOnce, games: 0, samples: 0 })).toBeNull()
    expect(figureText(figureFromRate({ ...lostOnce, games: 0, samples: 0 }))).toBe('sin datos')
  })

  it('the record is the one given, and null when none is', () => {
    expect(present(mine, mineRecord).record).toBe(mineRecord)
    expect(present(mine).record).toBeNull()
    expect(present(mine, null).record).toBeNull()
  })
})

describe('figureFromColumn', () => {
  const column = (source: WinRate['source'], from = comparison) => {
    const found = from.columns.find((item) => item.source === source)
    if (!found) throw new Error(`no ${source} column`)
    return found
  }

  it('each column of a deck is its headline rate with its record', () => {
    expect(figureFromColumn(column('matches'))).toStrictEqual(figureFromRate(mine, mineRecord))
    expect(figureFromColumn(column('tournament'))).toStrictEqual(
      figureFromRate(exactList, { wins: 1, losses: 7, ties: 0 }),
    )
    expect(figureFromColumn(column('simulation'))).toStrictEqual(
      figureFromRate(bots, { wins: 7095, losses: 7004, ties: 80 }),
    )
    // The three sources stay three figures: none of them is a mix of the others.
    expect(comparison.columns.map((item) => figureFromColumn(item)?.sampleKind)).toEqual([
      'matches',
      'lists',
      'simulations',
    ])
  })

  it('a column without a rate is «sin datos»: no match yet (a record of zeros), or a source that is not available', () => {
    expect(column('matches', emptyComparison).record).toEqual({ wins: 0, losses: 0, ties: 0 })
    for (const item of emptyComparison.columns) {
      expect(figureFromColumn(item), item.source).toBeNull()
      expect(figureText(figureFromColumn(item)), item.source).toBe('sin datos')
    }
  })
})

describe('figureSample', () => {
  it('is the sample of `formatSample` for every rate', () => {
    for (const rate of RATES) expect(figureSample(present(rate)), rate.source).toBe(formatSample(rate))
  })

  it('says «en N listas» only for a figure counted on lists, whatever a figure written by hand brings', () => {
    // A fixture or a later adapter may fill `samples` for another kind of sample: those are games again, not lists.
    const byHand: Figure = {
      value: 51.1,
      n: 47,
      ci95: [37.2, 64.7],
      orientative: false,
      sampleKind: 'matches',
      samples: 47,
    }
    expect(figureSample(byHand)).toBe('n = 47')
    expect(figureSample({ ...byHand, sampleKind: 'simulations' })).toBe('n = 47')
    expect(figureText(byHand)).toBe(`51,1${NBSP}%, n = 47, IC${NBSP}37,2${DASH}64,7${NBSP}%`)
    expect(figureText({ ...byHand, sampleKind: 'simulations' })).not.toMatch(/listas/)
    expect(figureSample({ ...byHand, sampleKind: 'lists', samples: 12 })).toBe('n = 47 en 12 listas')
    // Counted on lists, but nobody said how many: the games alone, never «en undefined listas».
    expect(figureSample({ ...byHand, sampleKind: 'lists', samples: undefined })).toBe('n = 47')
    const { samples: _lists, ...without } = byHand
    expect(figureSample({ ...without, sampleKind: 'lists' })).toBe('n = 47')
  })
})

describe('figureText', () => {
  it('says the whole figure: the value, its n, the interval and «orientativo»', () => {
    expect(figureText(figureFromRate(mine, mineRecord))).toBe(`51,1${NBSP}%, n = 47, IC${NBSP}37,2${DASH}64,7${NBSP}%`)
    expect(figureText(figureFromRate(archetype))).toBe(
      `35,7${NBSP}%, n = 70 en 14 listas, IC${NBSP}25,5${DASH}47,4${NBSP}%, orientativo`,
    )
    expect(figureText(figureFromRate(bots))).toBe(`50${NBSP}%, n = 14.179, IC${NBSP}49,2${DASH}50,9${NBSP}%`)
  })

  it('is the text of `formatRate` with commas where that one has brackets, for every rate', () => {
    for (const rate of RATES) {
      const canonical = /^(.+) \((.+)\)$/.exec(formatRate(rate))
      expect(canonical, formatRate(rate)).not.toBeNull()
      expect(figureText(figureFromRate(rate))).toBe(`${canonical?.[1]}, ${canonical?.[2]}`)
    }
    expect(figureText(null)).toBe(formatRate(null))
  })

  it('null is «sin datos», and no percentage is written', () => {
    expect(figureText(null)).toBe('sin datos')
    expect(NO_DATA).toBe('sin datos')
    expect(figureText(null)).not.toMatch(/%|\d/)
  })

  it('a value without an interval drops the «IC» piece and nothing else', () => {
    const expected: Figure = { value: 59.3, n: 41, ci95: null, orientative: false, sampleKind: 'matches' }
    expect(figureText(expected)).toBe(`59,3${NBSP}%, n = 41`)
    expect(figureText({ ...expected, orientative: true })).toBe(`59,3${NBSP}%, n = 41, orientativo`)
  })

  it('a number against the meta with no matchup with data says so; with some coverage it says nothing', () => {
    const expected: Figure = { value: 59.3, n: 41, ci95: [48.6, 70.1], orientative: false, sampleKind: 'matches' }
    expect(NO_COVERAGE).toBe('sin cruces con datos en el meta')
    expect(figureText({ ...expected, coverage: 0 })).toBe(
      `59,3${NBSP}%, n = 41, IC${NBSP}48,6${DASH}70,1${NBSP}%, sin cruces con datos en el meta`,
    )
    for (const coverage of [73.2, 100, null, undefined]) {
      expect(figureText({ ...expected, coverage }), String(coverage)).toBe(
        `59,3${NBSP}%, n = 41, IC${NBSP}48,6${DASH}70,1${NBSP}%`,
      )
    }
  })

  it('a score of another era says which one', () => {
    const score: Figure = {
      value: 50.3,
      n: 3600,
      ci95: [48.7, 51.9],
      orientative: false,
      sampleKind: 'simulations',
      stale: { era: 'B4b' },
      bot: 'g2',
    }
    expect(figureText(score)).toBe(`50,3${NBSP}%, n = 3.600, IC${NBSP}48,7${DASH}51,9${NBSP}%, de la era B4b`)
    expect(figureText({ ...score, stale: null })).toBe(`50,3${NBSP}%, n = 3.600, IC${NBSP}48,7${DASH}51,9${NBSP}%`)
  })

  it('no space of a figure breaks a line inside a number: before «%» and after «IC» it is a no-break space', () => {
    for (const rate of RATES) {
      const text = figureText(figureFromRate(rate))
      expect(text).not.toMatch(/\d %/)
      expect(text).not.toMatch(/IC /)
    }
  })
})

describe('the names of the sources and of what a sample counts', () => {
  it('one letter and one name for each source of the API, and nothing else', () => {
    const sources = winRateSchema.shape.source.options
    expect(Object.keys(SOURCE_LETTER).sort()).toEqual([...sources].sort())
    expect(Object.keys(SOURCE_NAME).sort()).toEqual([...sources].sort())
    expect(SOURCE_LETTER).toEqual({ matches: 'M', tournament: 'T', simulation: 'B' })
    expect(SOURCE_NAME).toEqual({ matches: 'Mis partidas', tournament: 'Torneos', simulation: 'Bots' })
    // Three sources, three letters: no two share one.
    expect(new Set(Object.values(SOURCE_LETTER)).size).toBe(sources.length)
  })

  it('«orientativo» says what it counted, for each kind of sample of the API', () => {
    const kinds = winRateSchema.shape.sampleKind.options
    expect(Object.keys(SAMPLE_NOUN).sort()).toEqual([...kinds].sort())
    expect(ORIENTATIVE_BELOW).toBe(30)
    expect(orientativeText('matches')).toBe('orientativo: menos de 30 partidas')
    expect(orientativeText('lists')).toBe('orientativo: menos de 30 listas')
    expect(orientativeText('simulations')).toBe('orientativo: menos de 30 partidas simuladas')
    // The word the tests of the screens look for comes first, whole.
    for (const kind of kinds) expect(orientativeText(kind)).toMatch(/^orientativo: menos de 30 \S/)
  })
})

describe('the interval, as it is written and said', () => {
  it('«IC 37,2–64,7 %», with one decimal at each end and no space that breaks', () => {
    expect(intervalText([37.2, 64.7])).toBe(`IC${NBSP}37,2${DASH}64,7${NBSP}%`)
    expect(intervalText([0, 79.3])).toBe(`IC${NBSP}0,0${DASH}79,3${NBSP}%`)
    expect(intervalText([34.2, 100])).toBe(`IC${NBSP}34,2${DASH}100,0${NBSP}%`)
    expect(intervalText([37.2, 64.7])).not.toMatch(/IC |\d %/)
  })

  it('is the piece `figureText` says, and the one `formatRate` writes', () => {
    for (const rate of RATES) {
      expect(figureText(figureFromRate(rate)), rate.source).toContain(`, ${intervalText(rate.ci95)}`)
      expect(formatRate(rate), rate.source).toContain(intervalText(rate.ci95))
    }
  })

  it('a legend says once which interval it is: the one of 95 %', () => {
    expect(INTERVAL_KEY).toBe(`IC: intervalo de confianza del 95${NBSP}%`)
    // «IC 95» with a plain space would break on a narrow line, and so would «95 %».
    expect(INTERVAL_KEY).not.toMatch(/IC 95|\d %/)
  })
})

describe('the key of «orientativo» in a legend', () => {
  it('with one kind of sample it is the text of the mark', () => {
    for (const kind of winRateSchema.shape.sampleKind.options) {
      expect(orientativeKey([kind]), kind).toBe(orientativeText(kind))
    }
    expect(orientativeKey(['lists'])).toBe('orientativo: menos de 30 listas')
  })

  it('with more than one, each kind after the first is another case, and the lists are the tournaments’', () => {
    expect(orientativeKey(['matches', 'lists'])).toBe('orientativo: menos de 30 partidas, o de 30 listas en torneos')
    expect(orientativeKey(['matches', 'simulations'])).toBe(
      'orientativo: menos de 30 partidas, o de 30 partidas simuladas',
    )
    expect(orientativeKey(['lists', 'simulations'])).toBe(
      'orientativo: menos de 30 listas en torneos, o de 30 partidas simuladas',
    )
    expect(orientativeKey(['matches', 'lists', 'simulations'])).toBe(
      'orientativo: menos de 30 partidas, o de 30 listas en torneos, o de 30 partidas simuladas',
    )
  })

  it('names each kind once, in one order, whatever order and however many times it is given', () => {
    const whole = orientativeKey(['matches', 'lists', 'simulations'])
    expect(orientativeKey(['simulations', 'lists', 'matches'])).toBe(whole)
    expect(orientativeKey(['lists', 'matches', 'lists', 'simulations', 'matches'])).toBe(whole)
    expect(orientativeKey(['lists', 'lists'])).toBe('orientativo: menos de 30 listas')
    expect(orientativeKey(['lists', 'matches'])).toBe(orientativeKey(['matches', 'lists']))
  })

  it('is null without a kind: a legend with no «orientativo» figure has no key for it', () => {
    expect(orientativeKey([])).toBeNull()
  })

  it('always starts with the word the tests of the screens look for, and says the threshold of the API', () => {
    for (const kinds of [['matches'], ['lists', 'matches'], ['matches', 'lists', 'simulations']] as const) {
      const key = orientativeKey(kinds)
      expect(key).toMatch(/^orientativo: menos de 30 \S/)
      expect(key?.match(/\d+/g)?.every((number) => Number(number) === ORIENTATIVE_BELOW)).toBe(true)
    }
  })
})
