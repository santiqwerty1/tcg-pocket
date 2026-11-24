import { describe, expect, it } from 'vitest'
import type { CollectionImportRow } from '../generated/prisma/client.js'
import { IMPORT_ROWS_HELD, ImportRowsCache } from './import-rows.cache.js'

const row = (importId: number, cardId: string, numberOwned = 1): CollectionImportRow => ({
  importId,
  cardId,
  internalId: 1,
  numberOwned,
  collected: true,
})

/** Rows by import id, counting the reads. */
function store() {
  const data = new Map<number, CollectionImportRow[]>()
  const reads: number[] = []
  return {
    data,
    reads,
    reader: (id: number) => async () => {
      reads.push(id)
      return (data.get(id) ?? []).map((item) => ({ ...item }))
    },
  }
}

describe('ImportRowsCache (R-014)', () => {
  it('reads an import once (miss), then serves it (hit); the rows cannot be changed by whoever gets them', async () => {
    const db = store()
    db.data.set(7, [row(7, 'A1-001'), row(7, 'A1-002', 2)])
    const cache = new ImportRowsCache()
    const first = await cache.rowsOf(7, db.reader(7))
    const again = await cache.rowsOf(7, db.reader(7))
    expect(again).toBe(first)
    expect(again.map((item) => item.cardId)).toEqual(['A1-001', 'A1-002'])
    expect(db.reads).toEqual([7])
    expect(Object.isFrozen(first)).toBe(true)
    expect(() => {
      ;(first[0] as { numberOwned: number }).numberOwned = 9
    }).toThrow(TypeError)
  })

  it('keeps the last imports used; the least recently used goes first', async () => {
    const db = store()
    const cache = new ImportRowsCache()
    for (let id = 1; id <= IMPORT_ROWS_HELD; id++) await cache.rowsOf(id, db.reader(id))
    // Import 1 used again: now 2 is the oldest.
    await cache.rowsOf(1, db.reader(1))
    await cache.rowsOf(IMPORT_ROWS_HELD + 1, db.reader(IMPORT_ROWS_HELD + 1))
    expect(cache.size).toBe(IMPORT_ROWS_HELD)
    await cache.rowsOf(1, db.reader(1))
    await cache.rowsOf(2, db.reader(2))
    expect(db.reads.filter((id) => id === 1)).toEqual([1])
    expect(db.reads.filter((id) => id === 2)).toEqual([2, 2])
  })

  it('a restore clears it: an id may now be another import', async () => {
    const db = store()
    db.data.set(3, [row(3, 'A1-001')])
    const cache = new ImportRowsCache()
    await cache.rowsOf(3, db.reader(3))
    db.data.set(3, [row(3, 'B1-050', 2)])
    cache.clear()
    expect((await cache.rowsOf(3, db.reader(3))).map((item) => item.cardId)).toEqual(['B1-050'])
    expect(db.reads).toEqual([3, 3])
  })

  it('while a restore runs nothing is served from memory nor kept, until after its commit is seen', async () => {
    const db = store()
    db.data.set(3, [row(3, 'A1-001')])
    const cache = new ImportRowsCache()
    await cache.rowsOf(3, db.reader(3))
    let release: () => void = () => undefined
    const committed = new Promise<void>((resolve) => {
      release = resolve
    })
    const restore = cache.whileReplacing(async () => {
      // The restore's transaction has committed in the database, but this process has not seen it yet.
      db.data.set(3, [row(3, 'B1-050')])
      await committed
    })
    expect((await cache.rowsOf(3, db.reader(3))).map((item) => item.cardId)).toEqual(['B1-050'])
    expect(cache.size).toBe(0)
    release()
    await restore
    expect(cache.size).toBe(0)
    expect((await cache.rowsOf(3, db.reader(3))).map((item) => item.cardId)).toEqual(['B1-050'])
    expect(db.reads).toEqual([3, 3, 3])
  })

  it('a failed restore also ends: imports are served again', async () => {
    const db = store()
    const cache = new ImportRowsCache()
    await expect(
      cache.whileReplacing(async () => {
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    await cache.rowsOf(4, db.reader(4))
    await cache.rowsOf(4, db.reader(4))
    expect(db.reads).toEqual([4])
  })

  it('rows read while a restore cleared it are returned but not kept', async () => {
    const db = store()
    db.data.set(3, [row(3, 'A1-001')])
    const cache = new ImportRowsCache()
    const racing = await cache.rowsOf(3, async () => {
      const rows = await db.reader(3)()
      db.data.set(3, [row(3, 'B1-050')])
      cache.clear()
      return rows
    })
    expect(racing.map((item) => item.cardId)).toEqual(['A1-001'])
    expect(cache.size).toBe(0)
    expect((await cache.rowsOf(3, db.reader(3))).map((item) => item.cardId)).toEqual(['B1-050'])
  })
})
