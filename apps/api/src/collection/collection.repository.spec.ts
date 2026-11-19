import { describe, expect, it } from 'vitest'
import type { PrismaService } from '../prisma/prisma.service.js'
import { CollectionRepository } from './collection.repository.js'

interface StockRow {
  cardId: string
  amountOwned: number
  collected: boolean
}

/**
 * A database with a stock and its fingerprint (the real one is computed by Postgres; here, from the rows). It counts
 * the whole-stock reads and records the transactions' options.
 */
function fakeDatabase(rows: StockRow[]) {
  const state = { rows, reads: 0, transactions: [] as unknown[] }
  const fingerprint = () => JSON.stringify([...state.rows].sort((a, b) => a.cardId.localeCompare(b.cardId)))
  const prisma = {
    $queryRaw: async () => [{ fingerprint: fingerprint() }],
    collectionStock: {
      findMany: async () => {
        state.reads += 1
        return state.rows.map((row) => ({ ...row }))
      },
    },
    $transaction: async (operations: Promise<unknown>[], options: unknown) => {
      state.transactions.push(options)
      return Promise.all(operations)
    },
  }
  return { state, repository: new CollectionRepository(prisma as unknown as PrismaService) }
}

describe('CollectionRepository.loadStock (R-014)', () => {
  it('reads the whole stock once while its fingerprint stays (hit), in one snapshot with the fingerprint', async () => {
    const { state, repository } = fakeDatabase([{ cardId: 'A1-001', amountOwned: 2, collected: true }])
    const first = await repository.loadStock()
    const second = await repository.loadStock()
    expect(second).toEqual({ 'A1-001': { stockCardId: 'A1-001', amountOwned: 2, collected: true } })
    expect(state.reads).toBe(1)
    expect(state.transactions).toEqual([{ isolationLevel: 'RepeatableRead' }])
    // Every call gets its own objects, as before: a caller that changes one does not change the next.
    expect(second).not.toBe(first)
    ;(first['A1-001'] as { amountOwned: number }).amountOwned = 99
    expect((await repository.loadStock())['A1-001']?.amountOwned).toBe(2)
  })

  it('any write that changes the stock (this process or another) changes the fingerprint: read again (miss)', async () => {
    const { state, repository } = fakeDatabase([{ cardId: 'A1-001', amountOwned: 2, collected: true }])
    await repository.loadStock()
    state.rows = [
      { cardId: 'A1-001', amountOwned: 3, collected: true },
      { cardId: 'A1-002', amountOwned: 1, collected: false },
    ]
    const after = await repository.loadStock()
    expect(after['A1-001']?.amountOwned).toBe(3)
    expect(after['A1-002']).toEqual({ stockCardId: 'A1-002', amountOwned: 1, collected: false })
    expect(state.reads).toBe(2)
    // Back to the first content: the held stock is the second one, so it is read again, never served stale.
    state.rows = [{ cardId: 'A1-001', amountOwned: 2, collected: true }]
    expect(await repository.loadStock()).toEqual({
      'A1-001': { stockCardId: 'A1-001', amountOwned: 2, collected: true },
    })
    expect(state.reads).toBe(3)
  })
})
