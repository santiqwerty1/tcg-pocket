import { describe, expect, it } from 'vitest'
import { ENERGY_ZONE_TURNS, energyZoneOdds } from '../../src/decks/energyZone.js'
import { seededRandom } from '../../src/lab/mutate.js'

describe('Energy Zone, turn by turn (Fase 44)', () => {
  it('one type: the cost is paid as soon as enough energies came; the first player gets none on turn 1', () => {
    const odds = energyZoneOdds(['fire'], ['fire', 'fire', 'colorless'])
    expect(odds.first.map((row) => [row.energies, row.probability])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 1],
      [4, 1],
      [5, 1],
    ])
    expect(odds.second.map((row) => row.energies)).toEqual([1, 2, 3, 4, 5, 6])
    expect(odds.likelyTurn).toEqual({ first: 4, second: 3 })
    expect(odds.first).toHaveLength(ENERGY_ZONE_TURNS)
  })

  it('two types: two fire among three energies, binomial with ½', () => {
    const odds = energyZoneOdds(['fire', 'water'], ['fire', 'fire', 'colorless'])
    // Three energies: P(at least 2 fire) = (3 + 1) / 8.
    expect(odds.second[2]?.probability).toBeCloseTo(4 / 8, 12)
    // Four: P(≥ 2 fire) = 1 − (1 + 4) / 16.
    expect(odds.second[3]?.probability).toBeCloseTo(11 / 16, 12)
    expect(odds.likelyTurn).toEqual({ first: 4, second: 3 })
  })

  it('three types and two typed costs: matches a simulation', () => {
    const types = ['grass', 'water', 'psychic'] as const
    const cost = ['grass', 'psychic', 'colorless'] as const
    const odds = energyZoneOdds([...types], [...cost], 8)
    const random = seededRandom(44)
    const runs = 60_000
    for (const turn of [3, 5, 8]) {
      let paid = 0
      for (let run = 0; run < runs; run++) {
        const got = { grass: 0, water: 0, psychic: 0 }
        for (let i = 0; i < turn; i++) got[types[Math.floor(random() * 3)] as keyof typeof got] += 1
        if (got.grass >= 1 && got.psychic >= 1 && turn >= 3) paid += 1
      }
      expect(odds.second[turn - 1]?.probability).toBeCloseTo(paid / runs, 2)
    }
  })

  it('a type the deck does not select can never be paid; a free attack always can', () => {
    const odds = energyZoneOdds(['fire', 'water'], ['lightning'])
    expect(odds.payable).toBe(false)
    expect(odds.second.every((row) => row.probability === 0)).toBe(true)
    expect(odds.likelyTurn).toEqual({ first: null, second: null })
    expect(energyZoneOdds(['fire'], []).first[0]?.probability).toBe(1)
    expect(() => energyZoneOdds([], ['fire'])).toThrow(RangeError)
  })
})
