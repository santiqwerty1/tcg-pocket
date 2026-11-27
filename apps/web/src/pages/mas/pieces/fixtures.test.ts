// The test data of «Piezas de la interfaz» is written in the API's shapes. Here each one goes through the schema the
// web reads that answer with, so the gallery (and the tests of the pieces, which share these figures) cannot drift
// from what a real screen is given. Every number is invented.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deckComparisonSchema, winRateSchema } from '@/api/schemas'
import { figureFromColumn, figureFromRate } from '@/lib/figure'
import { ORIENTATIVE_BELOW } from '@/lib/matches'
import {
  ARCHETYPE,
  BOTS,
  COLLECTION,
  COVERED,
  DECK,
  DECK_EMPTY,
  EXACT_LIST,
  EXPECTED,
  FEW,
  LONG_NAME,
  LOST_ONCE,
  MINE,
  NOTES,
  POPULAR,
  RATES,
  RECORDS,
  SHARES,
  STALE,
  WON_TWICE,
} from './fixtures'

const NAMES = Object.keys(RATES) as (keyof typeof RATES)[]
const DECK_REF = { id: '1', name: 'Mazo de prueba', archived: false }

describe('the test data of «Piezas de la interfaz»', () => {
  it('has a rate of each kind, and every rate is one the web’s schema reads as it is', () => {
    expect(NAMES).toEqual(['mine', 'few', 'exactList', 'archetype', 'popular', 'bots', 'lostOnce', 'wonTwice'])
    for (const name of NAMES) expect(winRateSchema.parse(RATES[name]), name).toEqual(RATES[name])
    expect(new Set(NAMES.map((name) => RATES[name].source))).toEqual(new Set(['matches', 'tournament', 'simulation']))
    expect(new Set(NAMES.map((name) => RATES[name].sampleKind))).toEqual(new Set(['matches', 'lists', 'simulations']))
  })

  it('every rate is the one its record gives: the games, the percentage, the interval around it', () => {
    expect(Object.keys(RECORDS)).toEqual(NAMES)
    for (const name of NAMES) {
      const rate = RATES[name]
      const record = RECORDS[name]
      const games = record.wins + record.losses + record.ties
      expect(rate.games, name).toBe(games)
      expect(rate.value, name).toBeCloseTo((record.wins / games) * 100, 10)
      expect(rate.ci95[0], name).toBeLessThanOrEqual(rate.value)
      expect(rate.ci95[1], name).toBeGreaterThanOrEqual(rate.value)
      expect(rate.ci95[0], name).toBeGreaterThanOrEqual(0)
      expect(rate.ci95[1], name).toBeLessThanOrEqual(100)
    }
  })

  it('«orientativo» is what the API would say: under 30 of what the rate counts, lists for a tournament one', () => {
    for (const name of NAMES) {
      const rate = RATES[name]
      // Own matches and simulated games are their own sample; a tournament rate counts the lists they were played in.
      if (rate.sampleKind === 'lists') expect(rate.samples, name).toBeLessThanOrEqual(rate.games)
      else expect(rate.samples, name).toBe(rate.games)
      expect(rate.orientative, name).toBe(rate.samples < ORIENTATIVE_BELOW)
    }
    // The case the mark exists for: more than 30 games and still «orientativo», because they are in 14 lists.
    expect(RATES.archetype.games).toBeGreaterThanOrEqual(ORIENTATIVE_BELOW)
    expect(RATES.archetype.orientative).toBe(true)
  })

  it('the figures are what the adapter makes of each rate with its record', () => {
    const made = {
      mine: MINE,
      few: FEW,
      exactList: EXACT_LIST,
      archetype: ARCHETYPE,
      popular: POPULAR,
      bots: BOTS,
      lostOnce: LOST_ONCE,
      wonTwice: WON_TWICE,
    }
    expect(Object.keys(made)).toEqual(NAMES)
    for (const name of NAMES) {
      expect(made[name], name).toEqual(figureFromRate(winRateSchema.parse(RATES[name]), RECORDS[name]))
    }
    // The states a piece has to draw are all here: a real zero, a hundred, lists, thousands.
    expect(LOST_ONCE).toMatchObject({ value: 0, n: 1 })
    expect(WON_TWICE).toMatchObject({ value: 100, n: 2 })
    expect(EXACT_LIST).toMatchObject({ sampleKind: 'lists', samples: 2, orientative: true })
    expect(BOTS.n).toBeGreaterThan(9999)
    // And the longest n a block writes: thousands of games in thousands of lists, with nothing «orientativo».
    expect(POPULAR).toMatchObject({ sampleKind: 'lists', orientative: false })
    expect(POPULAR.n).toBeGreaterThan(9999)
    expect(POPULAR.samples).toBeGreaterThan(999)
  })

  it('the figures that are not a rate: one with no interval and no coverage, one with part of it, one of another era', () => {
    expect(EXPECTED).toMatchObject({ ci95: null, coverage: 0 })
    expect(COVERED.ci95).not.toBeNull()
    expect(COVERED.coverage).toBeGreaterThan(0)
    expect(COVERED.coverage).toBeLessThan(100)
    expect(STALE.stale).toEqual({ era: 'B4b' })
    for (const figure of [EXPECTED, COVERED, STALE]) {
      expect(figure.value).toBeGreaterThanOrEqual(0)
      expect(figure.value).toBeLessThanOrEqual(100)
      expect(figure.n).toBeGreaterThan(0)
    }
  })

  it('each deck is an answer of the comparison the web reads as it is, with its three sources in order', () => {
    for (const columns of [DECK, DECK_EMPTY]) {
      expect(deckComparisonSchema.parse({ deck: DECK_REF, columns }).columns).toEqual(columns)
      expect(columns.map((column) => column.source)).toEqual(['matches', 'tournament', 'simulation'])
    }
    // With a number in each source; the headline of the tournament one is its first row, as the API builds it.
    expect(DECK.map((column) => figureFromColumn(column))).toEqual([MINE, EXACT_LIST, BOTS])
    expect(DECK[1]?.rows?.[0]).toMatchObject({ rate: DECK[1]?.rate, record: DECK[1]?.record })
    expect(DECK[2]?.blindSpot?.text).toBe(NOTES.blindSpot)
    // Without any: own matches are there with nothing to count, the other two have no source.
    expect(DECK_EMPTY.map((column) => figureFromColumn(column))).toEqual([null, null, null])
    expect(DECK_EMPTY.map((column) => column.available)).toEqual([true, false, false])
  })

  it('the rest is what its piece needs: a name longer than a line, shares from the largest, three parts to count', () => {
    expect(LONG_NAME.length).toBeGreaterThan(60)
    expect([...SHARES]).toEqual([...SHARES].sort((a, b) => b - a))
    expect(Object.values(COLLECTION).every((count) => count > 0)).toBe(true)
  })

  it('says it is invented, where whoever opens the file reads it first', () => {
    const text = readFileSync(resolve(process.cwd(), 'src/pages/mas/pieces/fixtures.ts'), 'utf8')
    expect(text.slice(0, 600)).toContain('EVERY NUMBER HERE IS INVENTED')
  })
})
