import { describe, expect, it } from 'vitest'
import {
  type CollectionAdjustment,
  editionStatus,
  playableCopies,
  playableOf,
  type StockQuantities,
} from '../../src/collection/index.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const stock = (): StockQuantities => realCsvNormalized().units
const playable = (cardId: string): number => playableOf(index, stock(), [], cardId)?.playable ?? Number.NaN

describe('playableCopies on the real export of 2026-10-06', () => {
  it('covers the 2,319 groups: 1,255 with ≥ 2 copies, 1,853 with ≥ 1, 466 with 0', () => {
    const all = playableCopies(index, stock())
    expect(all.size).toBe(2319)
    const values = [...all.values()]
    expect(values.filter((g) => g.playable >= 2)).toHaveLength(1255)
    expect(values.filter((g) => g.playable >= 1)).toHaveLength(1853)
    expect(values.filter((g) => g.playable === 0)).toHaveLength(466)
    expect(values.every((g) => g.adjustment === null && g.playable === g.fromStock)).toBe(true)
    expect(values.reduce((sum, g) => sum + g.fromStock, 0)).toBe(4714)
    expect([...all.keys()]).toEqual(index.catalog.groups.map((g) => g.id))
  })

  it('Mega Mawile ex = 2: B2-113 and B2-201 own 1 each, B4b-157 shares the stock of B2-113', () => {
    const mawile = playableOf(index, stock(), [], 'B2-113')
    expect(mawile).toMatchObject({ groupId: 'B2-113', nameEn: 'Mega Mawile ex', fromStock: 2, playable: 2 })
    const owned = Object.fromEntries(mawile?.editions.map((e) => [e.cardId, e.owned]) ?? [])
    expect(owned).toEqual({ 'B2-113': 1, 'B2-188': 0, 'B2-201': 1, 'B4a-108': 0, 'B4b-157': 1 })
    expect(mawile?.editions.find((e) => e.cardId === 'B4b-157')?.stockCardId).toBe('B2-113')
  })

  it('Small Balloon = 3 (B3b-64: 1 + B4b-372: 2; B4b-206 shares B3b-64)', () => {
    const balloon = playableOf(index, stock(), [], 'B3b-64')
    expect(balloon?.nameEs).toBe('Globito')
    expect(balloon?.playable).toBe(3)
    const owned = Object.fromEntries(balloon?.editions.map((e) => [e.cardId, [e.stockCardId, e.owned]]) ?? [])
    expect(owned).toMatchObject({ 'B3b-64': ['B3b-64', 1], 'B4b-372': ['B4b-372', 2], 'B4b-206': ['B3b-64', 1] })
  })

  it('Bulbasaur A1-1 = 3 (A1-1: 2 + A1-227: 1; A4b-1 is not double counted)', () => {
    const bulbasaur = playableOf(index, stock(), [], 'A1-1')
    expect(bulbasaur?.playable).toBe(3)
    const owned = Object.fromEntries(bulbasaur?.editions.map((e) => [e.cardId, e.owned]) ?? [])
    expect(owned).toMatchObject({ 'A1-1': 2, 'A4b-1': 2, 'A1-227': 1 })
    expect(bulbasaur?.editions.find((e) => e.cardId === 'A4b-1')?.stockCardId).toBe('A1-1')
    expect(playableOf(index, stock(), [], 'A4b-1')?.groupId).toBe('A1-1')
    expect(playableOf(index, stock(), [], 'P-A-23')?.groupId).toBe('A1-1')
  })

  it('matches the verified playable counts of the plan fixtures', () => {
    expect(playable('A4a-36')).toBe(2) // Latias
    expect(playable('A4a-37')).toBe(2) // Latios
    expect(playable('B4-103')).toBe(1) // Hoopa ex
    expect(playable('A4-83')).toBe(2) // Espeon ex
    expect(playable('B4-35')).toBe(1) // Mega Sharpedo ex
    expect(playable('B1-157')).toBe(1) // Hydreigon
    expect(playable('B3b-15')).toBe(1) // Milotic ex
    expect(playable('A1-89')).toBe(1) // Greninja
    expect(playable('A2-91')).toBe(1) // Riolu
    expect(playable('B3-79')).toBe(9) // Riolu (B3)
    expect(playable('A3-84')).toBe(0) // Tapu Lele
    expect(playable('A3-147')).toBe(0) // Leaf Cape
    expect(playableOf(index, stock(), [], 'nope')).toBeUndefined()
  })

  it('applies an active adjustment as an absolute override and attaches it', () => {
    const adjustment: CollectionAdjustment = {
      id: 'adj-1',
      functionalGroupId: 'A4a-36',
      playableCopies: 1,
      reason: 'Perdí una Latias',
      active: true,
      createdAt: '2026-10-06T00:00:00.000Z',
      resolvedAt: null,
      resolution: null,
    }
    const latias = playableOf(index, stock(), [adjustment], 'A4a-36')
    expect(latias).toMatchObject({ fromStock: 2, playable: 1 })
    expect(latias?.adjustment).toEqual({
      id: 'adj-1',
      functionalGroupId: 'A4a-36',
      playableCopies: 1,
      reason: 'Perdí una Latias',
      createdAt: '2026-10-06T00:00:00.000Z',
    })
    const inactive = {
      ...adjustment,
      active: false,
      resolvedAt: '2026-10-07T00:00:00.000Z',
      resolution: 'user' as const,
    }
    expect(playableOf(index, stock(), [inactive], 'A4a-36')).toMatchObject({ playable: 2, adjustment: null })
    const all = playableCopies(index, stock(), [adjustment])
    expect(all.get('A4a-36')?.playable).toBe(1)
    expect(all.get('A4a-37')?.playable).toBe(2)
  })
})

describe('editionStatus', () => {
  it('reads an edition through its stock unit and names its twins', () => {
    expect(editionStatus(index, stock(), 'A4b-1')).toEqual({
      cardId: 'A4b-1',
      stockCardId: 'A1-1',
      functionalGroupId: 'A1-1',
      twinCardIds: ['A1-1'],
      owned: 2,
      collected: true,
    })
    expect(editionStatus(index, stock(), 'B4b-372')).toMatchObject({
      stockCardId: 'B4b-372',
      twinCardIds: [],
      owned: 2,
    })
    expect(editionStatus(index, {}, 'A1-1')).toMatchObject({ owned: 0, collected: false })
    expect(editionStatus(index, stock(), 'nope')).toBeUndefined()
  })
})
