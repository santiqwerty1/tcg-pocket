import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTrackerCsv } from '../../src/collection/index.js'
import { packLuck, rarityShareOfPack } from '../../src/packs/index.js'
import { COLLECTION_CSV_PATH, catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const rows = parseTrackerCsv(readFileSync(COLLECTION_CSV_PATH)).rows
const before = new Map<number, number>()
for (const row of rows) before.set(row.internalId, Math.max(before.get(row.internalId) ?? 0, row.numberOwned))

/** Versions printed only in B4 (a Deluxe reprint shares the id and is left out, H-005). */
const onlyB4 = (internalId: number) =>
  index.cardsByInternalId(internalId).every((card) => card.expansionId === 'B4' || card.rarity === 'P')

/** The 6/10 collection plus `copies` more of the first versions of B4 with that rarity. */
function gain(base: ReadonlyMap<number, number>, rarity: string, versions: number, copies = 1): Map<number, number> {
  const after = new Map(base)
  const cards = index.catalog.cards.filter(
    (card) => card.expansionId === 'B4' && card.rarity === rarity && onlyB4(card.internalId),
  )
  const seen = new Set<number>()
  for (const card of cards) {
    if (seen.size >= versions) break
    if (seen.has(card.internalId)) continue
    seen.add(card.internalId)
    after.set(card.internalId, (after.get(card.internalId) ?? 0) + copies)
  }
  return after
}

describe('suerte de los sobres (Fase 17)', () => {
  it('per-card rarity shares of a standard pack: 60 % ◊, 3,3 % ☆ and above, 1,7 % ◊◊◊◊', () => {
    const share = rarityShareOfPack({
      cardsPerPack: 5,
      containsShinies: false,
      containsBabies: false,
      containsLinkedCards: false,
    })
    expect(share['◊']).toBeCloseTo(0.6, 10)
    expect(share['◊◊◊◊']).toBeCloseTo((1.666 + 6.664) / 500, 10)
    const rare = ['☆', '☆☆', '☆☆☆', 'Crown Rare'].reduce((sum, r) => sum + (share[r as '☆'] ?? 0), 0)
    expect(rare).toBeCloseTo((3.334 + 13.336) / 500, 10)
    expect(Object.values(share).reduce((sum, value) => sum + (value ?? 0), 0)).toBeCloseTo(1, 3)
  })

  it('H-005: a version also printed in the Deluxe is left out (it could come from either pack)', () => {
    const reprinted = index.catalog.cards.filter(
      (card) =>
        card.expansionId === 'B4b' &&
        card.rarity === '◊◊◊◊' &&
        index.cardsByInternalId(card.internalId).some((other) => other.expansionId !== 'B4b'),
    )
    expect(reprinted.length).toBeGreaterThanOrEqual(60)
    const after = gain(before, '◊', 30)
    for (const card of reprinted.slice(0, 20)) after.set(card.internalId, (after.get(card.internalId) ?? 0) + 1)
    const luck = packLuck(before, after, index)
    expect(luck.ambiguous).toBe(20)
    expect(luck.gained).toBe(30)
    expect(luck.ex.observed).toBe(0)
    expect(luck.ex.expected).toBeLessThan(1)
  })

  it('nothing in, nothing to say', () => {
    const luck = packLuck(before, before, index)
    expect(luck).toMatchObject({ gained: 0, packsEstimate: 0, rare: { observed: 0, check: { verdict: 'too_few' } } })
  })

  it('many art rares among few commons: luckier than packs give', () => {
    const commons = gain(before, '◊', 40)
    const after = gain(commons, '☆', 12)
    const luck = packLuck(before, after, index)
    expect(luck.gained).toBe(52)
    expect(luck.byRarity['☆']).toBe(12)
    expect(luck.rare.observed).toBe(12)
    expect(luck.rare.expectedShare).toBeGreaterThan(2)
    expect(luck.rare.expectedShare).toBeLessThan(6)
    expect(luck.rare.check.verdict).toBe('lucky')
    expect(luck.packsEstimate).toBeCloseTo(52 / 5, 10)
  })

  it('only commons: no rares at all is unlucky once there are enough of them', () => {
    const luck = packLuck(before, gain(before, '◊', 60, 2), index)
    expect(luck.rare.observed).toBe(0)
    expect(luck.rare.check.verdict).toBe('unlucky')
    // Copies lost (traded away) do not count.
    const lost = new Map(before)
    for (const [id, count] of lost) if (count > 0) lost.set(id, count - 1)
    expect(packLuck(before, lost, index).gained).toBe(0)
  })
})
