import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv } from '../../src/collection/index.js'
import {
  collectionWanted,
  DELUXE_POSITIONS,
  editionChances,
  packProfile,
  packsForConfidence,
  positionTable,
  pullRate,
  SHINY_POSITION_4,
  SHINY_POSITION_5,
  STANDARD_POSITION_4,
  STANDARD_POSITION_5,
  tableSum,
} from '../../src/packs/index.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
const owned = (stockCardId: string) => units[stockCardId]?.amountOwned ?? 0

interface FixtureRow {
  expansion: string
  pack: string
  openable: boolean
  error?: string
  p_a: number
  E_a: number
  n_a: number
  p_b: number
  E_b: number
  n_b: number
  p_c: number
  E_c: number
  n_c: number
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../docs/fase0/fixtures-sobres-2026-10-06.json'), 'utf8'),
) as FixtureRow[]

const card = (id: string) => {
  const found = index.cardById(id)
  if (!found) throw new Error(`no ${id}`)
  return found
}
const profile = (packId: string) => {
  const found = packProfile(packId, index)
  if (!found) throw new Error(`no profile for ${packId}`)
  return found
}

describe('position tables (PLAN §7 Fase 4 a)', () => {
  it('add up to 100 % per position; Deluxe position 3 is 99.999 % as published', () => {
    for (const table of [STANDARD_POSITION_4, STANDARD_POSITION_5, SHINY_POSITION_4, SHINY_POSITION_5]) {
      expect(tableSum(table)).toBeCloseTo(100, 9)
    }
    expect(tableSum(DELUXE_POSITIONS[0] ?? {})).toBe(100)
    expect(tableSum(DELUXE_POSITIONS[1] ?? {})).toBeCloseTo(100, 9)
    expect(tableSum(DELUXE_POSITIONS[2] ?? {})).toBeCloseTo(99.999, 9)
    expect(tableSum(DELUXE_POSITIONS[3] ?? {})).toBe(100)
    const deluxe = { cardsPerPack: 4 as const, containsShinies: true, containsBabies: false, containsLinkedCards: true }
    expect(positionTable(deluxe, 4)).toEqual({ '◊◊◊◊': 100 })
    expect(() => positionTable({ ...deluxe, cardsPerPack: 5 }, 6)).toThrow(RangeError)
  })

  it('the corrected model keeps every rarity at 100 % of its table; the tracker model overshoots in B sets', () => {
    // B4 ruleroftheskiespack: ◊◊◊ has 28 cards, 2 of them babies (bug 1: denominator 26).
    const b4 = profile('B4/ruleroftheskiespack')
    const tripleDiamond = b4.cards.filter((c) => c.rarity === '◊◊◊')
    const mass = (model: 'tracker' | 'corrected') =>
      tripleDiamond.reduce((sum, c) => sum + (editionChances(c, b4, model).perPosition[4] ?? 0), 0) * 100
    expect(mass('corrected')).toBeCloseTo(19.81, 9)
    expect(mass('tracker')).toBeCloseTo((19.81 * 28) / 26, 9)
  })
})

describe('tracker model = tracker Overview with the 6/10 collection (PLAN §7 Fase 4 b)', () => {
  const rows = fixtures.filter((row) => !row.error)
  it('covers the 29 packs with a pack structure', () => {
    expect(rows).toHaveLength(29)
  })

  const filters = {
    a: collectionWanted(index, owned, { rarities: [], copies: 1 }),
    b: collectionWanted(index, owned, { rarities: [], copies: 1 }, { byGroup: true }),
    c: collectionWanted(index, owned, { rarities: ['◊', '◊◊', '◊◊◊', '◊◊◊◊'], copies: 2 }, { byGroup: true }),
  }

  it.each(rows.map((row) => [`${row.expansion}/${row.pack}`, row] as const))('%s', (packId, row) => {
    const pack = profile(packId)
    for (const [key, wanted, byGroup] of [
      ['a', filters.a, false],
      ['b', filters.b, true],
      ['c', filters.c, true],
    ] as const) {
      const result = pullRate(pack, wanted, { model: 'tracker', byGroup })
      expect(result.probability * 100, `p_${key}`).toBeCloseTo(row[`p_${key}`], 4)
      expect(result.expected, `E_${key}`).toBeCloseTo(row[`E_${key}`], 4)
      expect(result.matched.length, `n_${key}`).toBe(row[`n_${key}`])
    }
  })
})

describe('single cards (docs/fase0/sobres.md §3)', () => {
  const single = (cardId: string, packId: string, model: 'tracker' | 'corrected' = 'tracker') =>
    pullRate(profile(packId), [card(cardId)], { model, byGroup: false }).probability * 100

  it('reproduces the per-card fixtures', () => {
    expect(single('A1-4', 'A1/mewtwopack')).toBeCloseTo(1.66073, 4)
    expect(single('A1-286', 'A1/mewtwopack')).toBeCloseTo(0.077, 4)
    expect(single('A4-32', 'A4/ho-ohpack')).toBeCloseTo(2.41848, 4)
    expect(single('A4a-105', 'A4a/suicunepack')).toBeCloseTo(0.20677, 4)
    expect(single('A2b-100', 'A2b/shiningrevelrypack')).toBeCloseTo(0.36283, 4)
    expect(single('A4b-1', 'A4b/deluxepack')).toBeCloseTo(1.09688, 4)
    expect(single('A4b-360', 'A4b/deluxepack')).toBeCloseTo(0.15625, 4)
    expect(single('B4b-428', 'B4b/deluxepackmega')).toBeCloseTo(0.099, 4)
    expect(single('B1-109', 'B1/megablazikenpack')).toBeCloseTo(1.76286, 4)
  })

  it('bug 1: a ◊◊◊ baby in a set without baby slot uses the full denominator in the corrected model', () => {
    // B1 megablazikenpack: 15 ◊◊◊ cards, 1 baby → tracker /14, corrected /15.
    expect(single('B1-109', 'B1/megablazikenpack', 'corrected')).toBeLessThan(single('B1-109', 'B1/megablazikenpack'))
  })

  it('bug 2: Hoopa ex wanted in deck mode is 0 % in B4b for the tracker and 1/70 corrected (4th card ◊◊◊◊)', () => {
    const hoopa = [card('B4-103')]
    const b4b = profile('B4b/deluxepackmega')
    expect(pullRate(b4b, hoopa, { model: 'tracker', byGroup: true }).probability).toBe(0)
    expect(pullRate(b4b, hoopa, { model: 'corrected', byGroup: true }).probability).toBeCloseTo(1 / 70, 12)
    const b4 = profile('B4/ruleroftheskiespack')
    expect(pullRate(b4, hoopa, { model: 'tracker', byGroup: true }).probability * 100).toBeCloseTo(1.064, 3)
  })
})

describe('packsForConfidence', () => {
  it('is the geometric quantile, rounded up', () => {
    expect(packsForConfidence(0.5904, 0.5)).toBe(1)
    expect(packsForConfidence(0.5904, 0.9)).toBe(3)
    expect(packsForConfidence(1 / 70, 0.5)).toBe(49)
    expect(packsForConfidence(1 / 70, 0.9)).toBe(161)
    expect(packsForConfidence(0, 0.9)).toBeNull()
    expect(packsForConfidence(1, 0.9)).toBe(1)
  })
})
