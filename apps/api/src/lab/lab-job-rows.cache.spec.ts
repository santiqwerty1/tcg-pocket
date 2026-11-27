import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeckSnapshot, Prisma, SimulationJob } from '../generated/prisma/client.js'
import {
  type JobChunk,
  LAB_HELD_BYTES,
  LAB_JOBS_HELD,
  LAB_ROWS_IDLE_MS,
  LabJobRowsCache,
  type LabRowsSource,
  type Stale,
  type Versions,
} from './lab-job-rows.cache.js'

/**
 * A database as the cache sees it: every write gives the row a new version, like Postgres' `xmin` (a transaction id,
 * never given twice), and the source answers as `prismaLabRows` does, counting what it reads.
 */
class FakeDb {
  private xid = 1000
  readonly jobs = new Map<number, { row: Omit<SimulationJob, 'params'>; params: Prisma.JsonValue }>()
  readonly chunks = new Map<number, { jobId: number; version: string; row: JobChunk }>()
  readonly snapshots = new Map<number, { version: string; row: DeckSnapshot }>()
  private nextChunk = 1
  readonly reads = { params: 0, chunkRows: 0, wholeJob: 0, snapshotRows: 0 }

  private version(): string {
    this.xid += 1
    return String(this.xid)
  }

  addJob(id: number, params: Prisma.JsonValue): void {
    this.jobs.set(id, { row: jobRow(id), params })
  }

  setParams(id: number, params: Prisma.JsonValue): void {
    const job = this.jobs.get(id)
    if (job) job.params = params
  }

  insertChunk(jobId: number, idx: number, patch: Partial<JobChunk> = {}): number {
    const id = this.nextChunk++
    this.chunks.set(id, { jobId, version: this.version(), row: { ...chunkRow(idx), ...patch, id } })
    return id
  }

  /** An UPDATE: the row changes and gets a new version, even when nothing in it changed (as Postgres does). */
  updateChunk(id: number, patch: Partial<JobChunk> = {}): void {
    const chunk = this.chunks.get(id)
    if (!chunk) throw new Error(`no chunk ${id}`)
    this.chunks.set(id, { ...chunk, version: this.version(), row: { ...chunk.row, ...patch, id } })
  }

  /** An engine change moves what a job played to a job of its own (an UPDATE of `job_id`). */
  moveChunk(id: number, toJob: number): void {
    const chunk = this.chunks.get(id)
    if (!chunk) throw new Error(`no chunk ${id}`)
    this.chunks.set(id, { ...chunk, jobId: toJob, version: this.version() })
  }

  deleteChunk(id: number): void {
    this.chunks.delete(id)
  }

  addSnapshot(id: number): void {
    this.snapshots.set(id, { version: this.version(), row: snapshotRow(id) })
  }

  /** One transaction: it sees the database as it was when it began (REPEATABLE READ), whatever is written later. */
  source(hooks: { beforeStale?: () => Promise<void> } = {}): LabRowsSource {
    const copy = <T>(value: T): T => structuredClone(value)
    const jobs = copy(this.jobs)
    const chunks = copy(this.chunks)
    const snapshots = copy(this.snapshots)
    const reads = this.reads
    const stale = (current: Map<number, string>, held: Versions): Stale => ({
      // In no particular order, as the database answers.
      changed: new Map([...current].filter(([id, version]) => held.get(id) !== version).reverse()),
      gone: [...held.keys()].filter((id) => !current.has(id)),
    })
    return {
      job: async (id) => {
        const job = jobs.get(id)
        return job ? copy(job.row) : null
      },
      paramsHash: async (id) => {
        const job = jobs.get(id)
        return job ? createHash('md5').update(JSON.stringify(job.params)).digest('hex') : null
      },
      params: async (id) => {
        reads.params += 1
        return copy(jobs.get(id)?.params ?? null)
      },
      staleChunks: async (jobId, held) => {
        await hooks.beforeStale?.()
        const current = new Map(
          [...chunks].filter(([, chunk]) => chunk.jobId === jobId).map(([id, chunk]) => [id, chunk.version]),
        )
        return stale(current, held)
      },
      chunks: async (jobId, ids) => {
        if (ids === null) reads.wholeJob += 1
        const wanted = ids === null ? null : new Set(ids)
        const rows = [...chunks]
          .filter(([id, chunk]) => chunk.jobId === jobId && (wanted === null || wanted.has(id)))
          .map(([, chunk]) => copy(chunk.row))
        reads.chunkRows += rows.length
        // No order, as a query without ORDER BY.
        return rows.reverse()
      },
      staleSnapshots: async (ids, held) => {
        const current = new Map(
          ids.flatMap((id) => {
            const snapshot = snapshots.get(id)
            return snapshot ? [[id, snapshot.version] as const] : []
          }),
        )
        return stale(current, held)
      },
      snapshots: async (ids) => {
        const rows = ids.flatMap((id) => {
          const snapshot = snapshots.get(id)
          return snapshot ? [copy(snapshot.row)] : []
        })
        reads.snapshotRows += rows.length
        return rows
      },
    }
  }
}

function jobRow(id: number): Omit<SimulationJob, 'params'> {
  return {
    id,
    kind: 'explore',
    status: 'running',
    priority: 0,
    label: `Explorar #${id}`,
    engineRev: 'c87bad0',
    players: ['g2', 'g2'],
    gamesPerPair: 60,
    baseSeed: 7n,
    cores: null,
    replaySample: 0,
    totalGames: 100,
    gamesRev: 1,
    createdAt: new Date('2026-11-21T04:22:00Z'),
    startedAt: new Date('2026-11-21T04:22:05Z'),
    finishedAt: null,
    archivedAt: null,
    error: null,
  }
}

function chunkRow(idx: number): Omit<JobChunk, 'id'> {
  return {
    idx,
    snapshotAId: 10 + (idx % 3),
    snapshotBId: 20 + (idx % 5),
    status: 'queued',
    winsA: null,
    winsB: null,
    ties: null,
    firstGame: 0,
    extra: null,
  }
}

const done = (winsA: number) => ({
  status: 'done',
  winsA,
  winsB: 10 - winsA,
  ties: 0,
  extra: { perGame: { winners: 'A'.repeat(winsA) + 'B'.repeat(10 - winsA) }, analysisGames: { version: 1 } },
})

function snapshotRow(id: number): DeckSnapshot {
  return {
    id,
    key: `key-${id}`,
    label: `Lista ${id}`,
    sourceType: 'lab',
    sourceId: null,
    deckId: null,
    deckgymText: `Energy: Psychic\n2 Ralts A1 1\n`,
    energies: ['Psychic'],
    energySource: 'declared',
    cards: [{ cardId: 'A1-001', engineId: 'A1 001', playedAs: 'A1-001', count: 2 }],
    problems: [],
    simulable: true,
    createdAt: new Date('2026-11-21T04:22:00Z'),
  }
}

const labParams = (sideA: number[], sideB: number[], extra: Record<string, unknown> = {}) =>
  ({ sideA, sideB, lab: { mode: 'explore', era: 'C1', ...extra } }) as Prisma.JsonValue

const snapshotIds = (params: Prisma.JsonValue) => {
  const value = params as { sideA?: number[]; sideB?: number[]; lab?: unknown } | null
  return value?.lab ? [...(value.sideA ?? []), ...(value.sideB ?? [])] : null
}

/** A search: job 1 with lists 10–12 against rivals 20–24 and `chunks` chunks. */
function search(db: FakeDb, chunks = 15, jobId = 1): number[] {
  for (const id of [10, 11, 12, 20, 21, 22, 23, 24]) if (!db.snapshots.has(id)) db.addSnapshot(id)
  db.addJob(jobId, labParams([10, 11, 12], [20, 21, 22, 23, 24]))
  return Array.from({ length: chunks }, (_, idx) => db.insertChunk(jobId, idx))
}

/** What a read without anything held returns: the view of today, read whole. */
const fresh = (db: FakeDb, id = 1) => new LabJobRowsCache().read(id, db.source(), snapshotIds)

async function required<T>(value: Promise<T | null>): Promise<T> {
  const found = await value
  if (found === null) throw new Error('no job')
  return found
}

afterEach(() => {
  vi.useRealTimers()
})

describe('LabJobRowsCache (P-015)', () => {
  it('reads a job whole once; then, with nothing changed, no chunk, snapshot or params, and returns the same', async () => {
    const db = new FakeDb()
    const ids = search(db)
    for (const id of ids.slice(0, 10)) db.updateChunk(id, done(6))
    const cache = new LabJobRowsCache()
    const first = await cache.read(1, db.source(), snapshotIds)
    expect(db.reads).toEqual({ params: 1, chunkRows: 15, wholeJob: 1, snapshotRows: 8 })
    // By idx, whatever order the database gave them in.
    expect(first?.chunks.map((chunk) => chunk.idx)).toEqual([...Array(15).keys()])
    expect(first?.snapshots.map((snapshot) => snapshot.id)).toEqual([10, 11, 12, 20, 21, 22, 23, 24])
    const again = await cache.read(1, db.source(), snapshotIds)
    expect(db.reads).toEqual({ params: 1, chunkRows: 15, wholeJob: 1, snapshotRows: 8 })
    expect(again).toEqual(first)
    expect(again).toEqual(await fresh(db))
    expect(cache.jobs).toBe(1)
    expect(cache.chunks).toBe(15)
  })

  it('a chunk that changes is read again, and only it: a result, a retry, a copy from the exact cache, a lease', async () => {
    const db = new FakeDb()
    const ids = search(db)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    const [a, b, c, d] = ids as [number, number, number, number]
    db.updateChunk(a, done(7)) // a result
    db.updateChunk(b, { status: 'failed' }) // its last attempt
    db.updateChunk(c, done(3)) // the exact cache (#46) fills a queued chunk
    db.updateChunk(d, { status: 'leased' }) // a claim or a heartbeat
    const before = db.reads.chunkRows
    const read = await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.chunkRows - before).toBe(4)
    expect(read).toEqual(await fresh(db))
    // «Reintentar lo que falló»: failed → queued, and later the good result.
    db.updateChunk(b, { status: 'queued' })
    expect(await cache.read(1, db.source(), snapshotIds)).toEqual(await fresh(db))
    db.updateChunk(b, done(9))
    const retried = await cache.read(1, db.source(), snapshotIds)
    expect(retried?.chunks.find((chunk) => chunk.id === b)).toMatchObject({ status: 'done', winsA: 9 })
    expect(retried).toEqual(await fresh(db))
  })

  it('a row rewritten with the same values gets a new version and is read again (never trusted on its looks)', async () => {
    const db = new FakeDb()
    const ids = search(db, 3)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    db.updateChunk(ids[0] as number)
    const before = db.reads.chunkRows
    await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.chunkRows - before).toBe(1)
  })

  it('an engine change: the chunks played move to a job of their own and new ones take their idx', async () => {
    const db = new FakeDb()
    const ids = search(db, 6)
    for (const id of ids) db.updateChunk(id, done(5))
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    // EngineChangeService.replayWhole: what was played goes to job 2; fresh chunks, queued, with the same idx.
    db.addJob(2, labParams([10, 11, 12], [20, 21, 22, 23, 24]))
    for (const id of ids) db.moveChunk(id, 2)
    for (let idx = 0; idx < 6; idx++) db.insertChunk(1, idx)
    const read = await cache.read(1, db.source(), snapshotIds)
    expect(read?.chunks).toHaveLength(6)
    expect(read?.chunks.every((chunk) => chunk.status === 'queued' && !ids.includes(chunk.id))).toBe(true)
    expect(read).toEqual(await fresh(db))
    // The job kept apart reads its own (the same rows, now under it).
    expect((await cache.read(2, db.source(), snapshotIds))?.chunks.map((chunk) => chunk.id)).toEqual(ids)
  })

  it('«Frenar»: the queued chunks deleted are gone; a job deleted is gone and forgotten', async () => {
    const db = new FakeDb()
    const ids = search(db, 8)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    for (const id of ids.slice(4)) db.deleteChunk(id)
    const read = await cache.read(1, db.source(), snapshotIds)
    expect(read?.chunks.map((chunk) => chunk.id)).toEqual(ids.slice(0, 4))
    expect(read).toEqual(await fresh(db))
    db.jobs.delete(1)
    for (const id of ids.slice(0, 4)) db.deleteChunk(id)
    expect(await cache.read(1, db.source(), snapshotIds)).toBeNull()
    expect(cache.jobs).toBe(0)
  })

  it('params are read again only when their md5 changes; new lists bring only their snapshots', async () => {
    const db = new FakeDb()
    search(db, 4)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.params).toBe(1)
    // A new round: two variants (snapshots 13 and 14) and their chunks.
    db.addSnapshot(13)
    db.addSnapshot(14)
    db.setParams(1, labParams([10, 11, 12, 13, 14], [20, 21, 22, 23, 24], { round: 2 }))
    db.insertChunk(1, 4, { snapshotAId: 13 })
    db.insertChunk(1, 5, { snapshotAId: 14 })
    const snapshotsBefore = db.reads.snapshotRows
    const read = await required(cache.read(1, db.source(), snapshotIds))
    expect(db.reads.params).toBe(2)
    expect(db.reads.snapshotRows - snapshotsBefore).toBe(2)
    expect((read.job.params as { lab: { round?: number } }).lab.round).toBe(2)
    expect(read).toEqual(await fresh(db))
  })

  it('what it returns cannot be changed by whoever gets it (the next call shares it)', async () => {
    const db = new FakeDb()
    const ids = search(db, 2)
    db.updateChunk(ids[0] as number, done(4))
    const cache = new LabJobRowsCache()
    const read = await required(cache.read(1, db.source(), snapshotIds))
    const chunk = read.chunks[0] as JobChunk
    expect(() => {
      ;(chunk as { winsA: number | null }).winsA = 9
    }).toThrow(TypeError)
    expect(() => {
      ;(chunk.extra as { perGame: { winners: string } }).perGame.winners = 'x'
    }).toThrow(TypeError)
    expect(() => {
      ;(read.job.params as { sideA: number[] }).sideA.push(99)
    }).toThrow(TypeError)
    expect(() => {
      ;(read.snapshots[0] as DeckSnapshot).energies.push('Fire')
    }).toThrow(TypeError)
  })

  it('a job that is not of the Laboratorio is read but nothing of it is held', async () => {
    const db = new FakeDb()
    db.addJob(5, { sideA: [1], sideB: [2] })
    db.insertChunk(5, 0)
    const cache = new LabJobRowsCache()
    const read = await cache.read(5, db.source(), snapshotIds)
    expect(read?.chunks).toEqual([])
    expect(cache.jobs).toBe(0)
  })

  it('holds the last jobs viewed; the least recently viewed goes first', async () => {
    const db = new FakeDb()
    const cache = new LabJobRowsCache()
    for (let job = 1; job <= LAB_JOBS_HELD + 1; job++) search(db, 3, job)
    for (let job = 1; job <= LAB_JOBS_HELD; job++) await cache.read(job, db.source(), snapshotIds)
    // Job 1 viewed again: now 2 is the oldest.
    await cache.read(1, db.source(), snapshotIds)
    await cache.read(LAB_JOBS_HELD + 1, db.source(), snapshotIds)
    expect(cache.jobs).toBe(LAB_JOBS_HELD)
    const whole = db.reads.wholeJob
    await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(whole)
    await cache.read(2, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(whole + 1)
  })

  it('holds what fits in its memory budget: a bigger job is read every time, and others make room', async () => {
    expect(new LabJobRowsCache().maxBytes).toBe(LAB_HELD_BYTES)
    const db = new FakeDb()
    const cache = new LabJobRowsCache()
    const small = search(db, 20, 1)
    search(db, 20, 2)
    // Job 3: as many chunks, but their per-game results are 50 times bigger.
    for (const id of search(db, 20, 3)) db.updateChunk(id, { ...done(5), extra: { perGame: 'x'.repeat(20_000) } })
    for (const id of small) db.updateChunk(id, done(5))
    await cache.read(1, db.source(), snapshotIds)
    const one = cache.bytes
    await cache.read(2, db.source(), snapshotIds)
    const two = cache.bytes - one
    // The estimate follows what a row holds: job 1's results make it bigger than job 2, with the same chunks.
    expect(one).toBeGreaterThan(two)
    cache.maxBytes = one + two
    await cache.read(3, db.source(), snapshotIds)
    // Too big for the whole budget: not held, and the others stay.
    expect(cache.jobs).toBe(2)
    expect(cache.bytes).toBe(one + two)
    await cache.read(3, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(4)
    // Job 1 again: it fits with job 2, whatever order they are viewed in.
    await cache.read(1, db.source(), snapshotIds)
    expect(cache.jobs).toBe(2)
    // A fourth job that fits alone but not with the others: the least recently viewed (2) goes.
    search(db, 20, 4)
    await cache.read(4, db.source(), snapshotIds)
    expect(cache.jobs).toBe(2)
    expect(cache.bytes).toBeLessThanOrEqual(cache.maxBytes)
    const whole = db.reads.wholeJob
    await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(whole)
    await cache.read(2, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(whole + 1)
  })

  it('a job not viewed for a while goes, also with nobody asking (a page closed)', async () => {
    vi.useFakeTimers()
    const db = new FakeDb()
    search(db, 3)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    vi.advanceTimersByTime(LAB_ROWS_IDLE_MS - 1000)
    expect(cache.jobs).toBe(1)
    // Viewed again: its idle time starts over.
    await cache.read(1, db.source(), snapshotIds)
    vi.advanceTimersByTime(LAB_ROWS_IDLE_MS - 1000)
    expect(cache.jobs).toBe(1)
    vi.advanceTimersByTime(1000)
    expect(cache.jobs).toBe(0)
    // And the next view reads it whole.
    await cache.read(1, db.source(), snapshotIds)
    expect(db.reads.wholeJob).toBe(2)
    cache.onModuleDestroy()
  })

  it('two calls at once: an older read that lands last leaves nothing the next call trusts blindly', async () => {
    const db = new FakeDb()
    const ids = search(db, 4)
    const cache = new LabJobRowsCache()
    await cache.read(1, db.source(), snapshotIds)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // The slow call checks the versions only after the gate opens, but takes what it held now.
    db.updateChunk(ids[0] as number, done(2))
    const slow = cache.read(1, db.source({ beforeStale: () => gate }), snapshotIds)
    await Promise.resolve()
    db.updateChunk(ids[0] as number, done(8))
    db.deleteChunk(ids[3] as number)
    const quick = await cache.read(1, db.source(), snapshotIds)
    expect(quick).toEqual(await fresh(db))
    release()
    await slow
    db.updateChunk(ids[1] as number, done(5))
    expect(await cache.read(1, db.source(), snapshotIds)).toEqual(await fresh(db))
  })

  it('after any sequence of writes, it returns what a read of everything returns', async () => {
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const db = new FakeDb()
    search(db, 40, 1)
    db.addJob(9, labParams([10], [20]))
    const cache = new LabJobRowsCache()
    let round = 0
    for (let step = 0; step < 400; step++) {
      const mine = [...db.chunks].filter(([, chunk]) => chunk.jobId === 1).map(([id]) => id)
      const pick = mine[Math.floor(random() * mine.length)]
      const what = random()
      if (what < 0.4 && pick !== undefined) db.updateChunk(pick, done(Math.floor(random() * 11)))
      else if (what < 0.55 && pick !== undefined) db.updateChunk(pick, { status: random() < 0.5 ? 'leased' : 'queued' })
      else if (what < 0.65 && pick !== undefined) db.moveChunk(pick, 9)
      else if (what < 0.72 && pick !== undefined) db.deleteChunk(pick)
      else if (what < 0.85) db.insertChunk(1, 40 + step)
      else if (what < 0.9) {
        round += 1
        db.setParams(1, labParams([10, 11, 12], [20, 21, 22, 23, 24], { round }))
      }
      if (random() < 0.6) {
        const read = await cache.read(1, db.source(), snapshotIds)
        expect(read).toEqual(await fresh(db))
      }
    }
  })
})
