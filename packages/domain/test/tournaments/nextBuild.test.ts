import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeImportRows, parseTrackerCsv, playableCopies } from '../../src/collection/index.js'
import { cheapestPrint, DEFAULT_RARITY_RULES } from '../../src/packs/index.js'
import {
  buildDataset,
  DEFAULT_SET_RELEASES,
  NEXT_BUILD_MAX_MISSING,
  NEXT_BUILD_MIN_LISTS,
  nextBuildCost,
  nextBuildCostText,
  nextBuilds,
  parseStandings,
} from '../../src/tournaments/index.js'
import { BIG_ID, readLimitless } from '../helpers/limitless.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const units = normalizeImportRows(parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows, index).units
const copies = new Map([...playableCopies(index, units, [])].map(([groupId, c]) => [groupId, c.playable]))
const playable = (groupId: string) => copies.get(groupId) ?? 0
// PMPT #45 (393 lists, 5/9/2026) against the collection of 6/10/2026.
const dataset = buildDataset({
  tournaments: [
    { id: BIG_ID, name: 'PMPT #45', date: new Date('2026-09-05T16:00:00Z'), format: 'STANDARD', players: 393 },
  ],
  entries: parseStandings(readLimitless('big_standings.json')).map((entry) => ({ ...entry, tournamentId: BIG_ID })),
  index,
  sets: DEFAULT_SET_RELEASES,
  era: 'B4a',
  format: 'STANDARD',
  minPlayers: 12,
})
const cost = (groupId: string) => {
  const print = cheapestPrint(index, groupId, (rarity) => DEFAULT_RARITY_RULES[rarity])
  return print ? { points: print.points, tradeable: print.tradeable } : null
}

describe('¿qué mazo armo después? (Fase 44)', () => {
  const rows = nextBuilds(dataset, { playable, cost, built: () => false })

  it('one row per archetype: its closest list, within reach, of an archetype with enough lists', () => {
    expect(rows.length).toBeGreaterThan(3)
    expect(new Set(rows.map((row) => row.archetypeId)).size).toBe(rows.length)
    for (const row of rows) {
      expect(row.closest.missingCopies).toBeLessThanOrEqual(NEXT_BUILD_MAX_MISSING)
      expect(row.archetype.lists).toBeGreaterThanOrEqual(NEXT_BUILD_MIN_LISTS)
      expect(row.closest.list.archetypeId).toBe(row.archetypeId)
    }
  })

  it('ranked by the low end of the archetype’s interval', () => {
    const lows = rows.map((row) => row.archetype.rate?.ci95[0] ?? 0)
    expect(lows).toEqual([...lows].sort((a, b) => b - a))
  })

  it('the cost is the cheapest print of each missing copy; nothing missing costs nothing', () => {
    for (const row of rows) {
      const expected = row.closest.missing.reduce(
        (sum, item) => sum + (cost(item.groupId)?.points ?? 0) * (item.need - item.have),
        0,
      )
      // Copies without a point price leave the others' points standing.
      expect(row.points).toBe(expected)
      if (row.closest.missingCopies === 0) expect(row).toMatchObject({ points: 0, unpriced: 0 })
    }
  })

  it('a copy without a point price can still be traded', () => {
    // Codex on #52: the rarity rules set points and trading apart; with no priced print the copy was not tradeable.
    expect(index.expansionById('A1')?.tradeable).toBe(true)
    const card = index.cardsOfExpansion('A1')[0]
    const groupId = card?.functionalGroupId ?? ''
    const cost = nextBuildCost(index, groupId, () => ({ points: null, verified: true, tradeable: true }))
    expect(cost).toEqual({ points: null, tradeable: true })
    expect(nextBuildCost(index, groupId, () => ({ points: 100, verified: true, tradeable: false }))).toEqual({
      points: 100,
      tradeable: false,
    })
  })

  it('the cost in words says what can be traded, with a price or without one', () => {
    expect(nextBuildCostText({ points: 400, unpriced: 0, tradeable: 2 })).toBe(
      '400 puntos de sobre (2 copias intercambiables)',
    )
    expect(nextBuildCostText({ points: 0, unpriced: 1, tradeable: 1 })).toBe(
      '1 copia sin precio en puntos (1 copia intercambiable)',
    )
    expect(nextBuildCostText({ points: 1350, unpriced: 2, tradeable: 0 })).toBe(
      '1.350 puntos de sobre + 2 copias sin precio en puntos (0 copias intercambiables)',
    )
  })

  it('archetypes I already have a deck of go last; a tighter reach leaves only what is close', () => {
    const first = rows[0]?.archetypeId ?? ''
    const marked = nextBuilds(dataset, { playable, cost, built: (id) => id === first })
    expect(marked.at(-1)).toMatchObject({ archetypeId: first, built: true })
    const ready = nextBuilds(dataset, { playable, cost, built: () => false, maxMissing: 0 })
    expect(ready.every((row) => row.closest.missingCopies === 0)).toBe(true)
  })
})
