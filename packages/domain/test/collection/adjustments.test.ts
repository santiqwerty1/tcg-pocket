import { describe, expect, it } from 'vitest'
import {
  activeAdjustmentsByGroup,
  adjustmentForCard,
  adjustmentsHidingChange,
  adjustmentsMatchingStock,
  type CollectionAdjustment,
  groupStockSum,
  manualEdit,
  planAdjustmentConversion,
  playableOf,
  resolveAdjustment,
  type StockQuantities,
} from '../../src/collection/index.js'
import { realCsvNormalized } from '../helpers/collectionCsv.js'
import { catalogIndex } from '../helpers/loadFixtures.js'

const index = catalogIndex()
const stock = (): StockQuantities => realCsvNormalized().units

function adjustment(overrides: Partial<CollectionAdjustment> = {}): CollectionAdjustment {
  return {
    id: 'adj-latias',
    functionalGroupId: 'A4a-36',
    playableCopies: 2,
    reason: 'test',
    active: true,
    createdAt: '2026-10-06T00:00:00.000Z',
    resolvedAt: null,
    resolution: null,
    ...overrides,
  }
}

/** The real stock with Latias A4a-36 at `amount` copies (an older state of the collection). */
function withLatias(amount: number): StockQuantities {
  return manualEdit(index, stock(), 'A4a-36', { amountOwned: amount }).stock
}

describe('activeAdjustmentsByGroup', () => {
  it('indexes active adjustments and rejects two active ones for the same group', () => {
    const resolved = adjustment({
      id: 'old',
      active: false,
      resolvedAt: '2026-10-05T00:00:00.000Z',
      resolution: 'user',
    })
    const byGroup = activeAdjustmentsByGroup([
      resolved,
      adjustment(),
      adjustment({ id: 'latios', functionalGroupId: 'A4a-37' }),
    ])
    expect([...byGroup.keys()]).toEqual(['A4a-36', 'A4a-37'])
    expect(byGroup.get('A4a-36')?.id).toBe('adj-latias')
    expect(() => activeAdjustmentsByGroup([adjustment(), adjustment({ id: 'dup' })])).toThrow(
      /Two active adjustments for group A4a-36: adj-latias and dup/,
    )
    expect(() => playableOf(index, stock(), [adjustment(), adjustment({ id: 'dup' })], 'A4a-36')).toThrow()
  })

  it('finds the active adjustment of the group an edition belongs to (rule c)', () => {
    expect(adjustmentForCard(index, [adjustment()], 'A4a-36')?.id).toBe('adj-latias')
    expect(adjustmentForCard(index, [adjustment()], 'P-A-101')?.id).toBe('adj-latias')
    expect(adjustmentForCard(index, [adjustment()], 'A4a-37')).toBeNull()
    expect(adjustmentForCard(index, [adjustment()], 'nope')).toBeNull()
  })
})

describe('rule (a): adjustments already matched by the stock', () => {
  it('lists Latias = 2 for the CSV of 2026-10-06 and not Latias = 1', () => {
    expect(groupStockSum(index, stock(), 'A4a-36')).toBe(2)
    expect(adjustmentsMatchingStock(index, stock(), [adjustment({ playableCopies: 2 })])).toEqual([
      {
        adjustmentId: 'adj-latias',
        groupId: 'A4a-36',
        nameEn: 'Latias',
        nameEs: 'Latias',
        playableCopies: 2,
        stockSum: 2,
      },
    ])
    expect(adjustmentsMatchingStock(index, stock(), [adjustment({ playableCopies: 1 })])).toEqual([])
    expect(adjustmentsMatchingStock(index, stock(), [adjustment({ playableCopies: 2, active: false })])).toEqual([])
    expect(adjustmentsMatchingStock(index, stock(), [adjustment({ functionalGroupId: 'gone' })])).toEqual([])
  })
})

describe('rule (b): adjustments hiding a stock change', () => {
  it('lists Latias = 1 when the stock goes from 3 to 2 copies', () => {
    const latias1 = adjustment({ playableCopies: 1 })
    expect(playableOf(index, stock(), [latias1], 'A4a-36')?.playable).toBe(1)
    expect(adjustmentsHidingChange(index, withLatias(3), stock(), [latias1])).toEqual([
      {
        adjustmentId: 'adj-latias',
        groupId: 'A4a-36',
        nameEn: 'Latias',
        nameEs: 'Latias',
        playableCopies: 1,
        stockBefore: 3,
        stockAfter: 2,
      },
    ])
  })

  it('stays silent when the sum did not change, when it lands on the override, or without active adjustments', () => {
    const latias1 = adjustment({ playableCopies: 1 })
    expect(adjustmentsHidingChange(index, stock(), stock(), [latias1])).toEqual([])
    expect(adjustmentsHidingChange(index, withLatias(3), withLatias(1), [latias1])).toEqual([])
    expect(adjustmentsMatchingStock(index, withLatias(1), [latias1])).toHaveLength(1)
    expect(
      adjustmentsHidingChange(index, withLatias(3), stock(), [adjustment({ playableCopies: 1, active: false })]),
    ).toEqual([])
    expect(adjustmentsHidingChange(index, withLatias(3), stock(), [])).toEqual([])
  })
})

describe('rule (d): converting an adjustment into a manual edit', () => {
  it('plans a delta of −1 on A4a-36 for Latias = 1', () => {
    const plan = planAdjustmentConversion(index, stock(), adjustment({ playableCopies: 1 }), 'A4a-36')
    expect(plan).toEqual({
      ok: true,
      adjustmentId: 'adj-latias',
      groupId: 'A4a-36',
      targetCardId: 'A4a-36',
      stockCardId: 'A4a-36',
      twinCardIds: [],
      stockSum: 2,
      playableCopies: 1,
      delta: -1,
      amountBefore: 2,
      amountAfter: 1,
    })
    if (!plan.ok) throw new Error('unreachable')
    const edited = manualEdit(index, stock(), plan.targetCardId, { amountOwned: plan.amountAfter })
    expect(groupStockSum(index, edited.stock, 'A4a-36')).toBe(1)
    expect(adjustmentsMatchingStock(index, edited.stock, [adjustment({ playableCopies: 1 })])).toHaveLength(1)
  })

  it('plans a positive delta on another edition of the group and reports twins of the target', () => {
    const plan = planAdjustmentConversion(index, stock(), adjustment({ playableCopies: 4 }), 'P-A-101')
    expect(plan).toMatchObject({ ok: true, stockCardId: 'P-A-101', delta: 2, amountBefore: 0, amountAfter: 2 })
    const bulbasaur = planAdjustmentConversion(
      index,
      stock(),
      adjustment({ functionalGroupId: 'A1-1', playableCopies: 5 }),
      'A4b-1',
    )
    expect(bulbasaur).toMatchObject({ ok: true, stockCardId: 'A1-1', twinCardIds: ['A1-1'], delta: 2, amountAfter: 4 })
  })

  it('rejects an inactive adjustment, a target outside the group, an unknown card and a negative result', () => {
    expect(planAdjustmentConversion(index, stock(), adjustment({ active: false }), 'A4a-36')).toMatchObject({
      ok: false,
      code: 'inactive',
    })
    expect(planAdjustmentConversion(index, stock(), adjustment(), 'A4a-37')).toMatchObject({
      ok: false,
      code: 'target_not_in_group',
    })
    expect(planAdjustmentConversion(index, stock(), adjustment(), 'nope')).toMatchObject({
      ok: false,
      code: 'unknown_card',
    })
    const negative = planAdjustmentConversion(index, stock(), adjustment({ playableCopies: 1 }), 'P-A-101')
    expect(negative).toMatchObject({ ok: false, code: 'negative_amount' })
    if (negative.ok) throw new Error('unreachable')
    expect(negative.message).toContain('P-A-101')
  })
})

describe('resolveAdjustment', () => {
  it('returns an inactive copy with the resolution and leaves the original untouched', () => {
    const original = adjustment()
    const resolved = resolveAdjustment(original, 'converted', '2026-10-07T10:00:00.000Z')
    expect(resolved).toEqual({
      ...original,
      active: false,
      resolvedAt: '2026-10-07T10:00:00.000Z',
      resolution: 'converted',
    })
    expect(original.active).toBe(true)
  })
})
