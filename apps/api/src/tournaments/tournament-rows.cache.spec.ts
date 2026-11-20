import { describe, expect, it } from 'vitest'
import { type StampedTournament, TournamentRowsCache } from './tournament-rows.cache.js'

interface Row {
  tournamentId: string
  value: string
}

/** A store of rows by tournament that counts which ids each read asked for. */
function store(initial: Record<string, string[]>) {
  const data = new Map(Object.entries(initial))
  const reads: string[][] = []
  return {
    data,
    reads,
    read: async (ids: string[]) => {
      reads.push([...ids].sort())
      const out = new Map<string, Row[]>()
      for (const id of ids) {
        const values = data.get(id)
        if (values && values.length > 0)
          out.set(
            id,
            values.map((value) => ({ tournamentId: id, value })),
          )
      }
      return out
    },
  }
}

const list = (...pairs: [string, string | null][]): StampedTournament[] => pairs.map(([id, stamp]) => ({ id, stamp }))
const values = (rows: readonly Row[]) => rows.map((row) => `${row.tournamentId}:${row.value}`)

describe('TournamentRowsCache (R-014)', () => {
  it('reads every tournament once, then only the new ones; the rows come in the order of the list', async () => {
    const db = store({ a: ['a1', 'a2'], b: ['b1'], c: ['c1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)

    const first = await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    expect(values(first.rows)).toEqual(['a:a1', 'a:a2', 'b:b1'])
    expect(first.read).toBe(2)

    // Same stamps: nothing is read (hit).
    const again = await cache.rowsOf('era', list(['b', '1'], ['a', '1']), db.read)
    expect(values(again.rows)).toEqual(['b:b1', 'a:a1', 'a:a2'])
    expect(again.read).toBe(0)

    // A new tournament (miss): only it is read.
    const grown = await cache.rowsOf('era', list(['a', '1'], ['b', '1'], ['c', '1']), db.read)
    expect(values(grown.rows)).toEqual(['a:a1', 'a:a2', 'b:b1', 'c:c1'])
    expect(db.reads).toEqual([['a', 'b'], ['c']])
  })

  it('a tournament whose stamp moved is read again, and only it', async () => {
    const db = store({ a: ['a1'], b: ['b1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    // The sync downloads «a» again: new rows, new stamp.
    db.data.set('a', ['a1', 'a-late'])
    const after = await cache.rowsOf('era', list(['a', '2'], ['b', '1']), db.read)
    expect(values(after.rows)).toEqual(['a:a1', 'a:a-late', 'b:b1'])
    expect(db.reads.at(-1)).toEqual(['a'])
  })

  it('without the stamp moving, a rewrite is not seen: that is what the stamp is for (and the generation, below)', async () => {
    const db = store({ a: ['a1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    await cache.rowsOf('era', list(['a', '1']), db.read)
    db.data.set('a', ['other'])
    expect(values((await cache.rowsOf('era', list(['a', '1']), db.read)).rows)).toEqual(['a:a1'])
  })

  it('a tournament with no rows is kept as empty; one without a stamp is read every time', async () => {
    const db = store({ a: [], b: ['b1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    await cache.rowsOf('era', list(['a', '1'], ['b', null]), db.read)
    await cache.rowsOf('era', list(['a', '1'], ['b', null]), db.read)
    expect(db.reads).toEqual([['a', 'b'], ['b']])
    expect(cache.size).toBe(1)
  })

  it('a tournament that left the scope is dropped; if it comes back it is read again', async () => {
    const db = store({ a: ['a1'], b: ['b1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    // «b» grew after it was downloaded: the sync sets it back to «listed», out of the scope.
    const without = await cache.rowsOf('era', list(['a', '1']), db.read)
    expect(values(without.rows)).toEqual(['a:a1'])
    expect(cache.size).toBe(1)
    await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    expect(db.reads).toEqual([['a', 'b'], ['b']])
  })

  it('keeps the tournaments of the last two scopes, each once; a third scope drops the oldest', async () => {
    const db = store({ a: ['a1'], b: ['b1'], c: ['c1'], x: ['x1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    await cache.rowsOf('era|STANDARD|1', list(['a', '1'], ['b', '1']), db.read)
    // Another minimum size: a subset of the same tournaments, not a second copy of them.
    await cache.rowsOf('era|STANDARD|64', list(['b', '1']), db.read)
    expect(cache.size).toBe(2)
    expect(db.reads).toEqual([['a', 'b']])
    // A third scope (another format): the oldest scope goes, with the tournaments only it held.
    await cache.rowsOf('era|NOEX|1', list(['x', '1']), db.read)
    expect(cache.size).toBe(2)
    await cache.rowsOf('era|STANDARD|64', list(['b', '1']), db.read)
    await cache.rowsOf('era|STANDARD|1', list(['a', '1'], ['b', '1']), db.read)
    expect(db.reads).toEqual([['a', 'b'], ['x'], ['a']])
  })

  it('a new generation (a backup restore) reads everything again', async () => {
    const db = store({ a: ['a1'], b: ['b1'] })
    let generation = 0
    const cache = new TournamentRowsCache<Row>(2, () => generation)
    await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    db.data.set('a', ['restored'])
    generation += 1
    const after = await cache.rowsOf('era', list(['a', '1'], ['b', '1']), db.read)
    expect(values(after.rows)).toEqual(['a:restored', 'b:b1'])
    expect(db.reads.at(-1)).toEqual(['a', 'b'])
  })

  it('rows read while the generation changed are returned but not kept', async () => {
    const db = store({ a: ['old'] })
    let generation = 0
    const cache = new TournamentRowsCache<Row>(2, () => generation)
    const racing = await cache.rowsOf('era', list(['a', '1']), async (ids) => {
      const out = await db.read(ids)
      // A restore commits while this read is in flight.
      db.data.set('a', ['restored'])
      generation += 1
      return out
    })
    expect(values(racing.rows)).toEqual(['a:old'])
    expect(cache.size).toBe(0)
    expect(values((await cache.rowsOf('era', list(['a', '1']), db.read)).rows)).toEqual(['a:restored'])
  })

  it('two reads at once keep what each read and never mix their stamps', async () => {
    const db = store({ a: ['a1'], b: ['b1'] })
    const cache = new TournamentRowsCache<Row>(2, () => 0)
    const [one, two] = await Promise.all([
      cache.rowsOf('era', list(['a', '1']), db.read),
      cache.rowsOf('noex', list(['b', '1']), db.read),
    ])
    expect(values(one.rows)).toEqual(['a:a1'])
    expect(values(two.rows)).toEqual(['b:b1'])
    expect(cache.size).toBe(2)
    expect((await cache.rowsOf('era', list(['a', '1']), db.read)).read).toBe(0)
  })
})
