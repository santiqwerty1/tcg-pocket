/**
 * P-015 (R-014, egress de Supabase): the rows the detail of a Laboratorio job reads, kept between calls. While a search
 * runs its page asks every 5 s, and every call read each chunk of the job with its per-game results (`extra`), the
 * job's whole `params` (the search's state, ~65 KB on average) and the snapshot of each list: ~7 MB a call measured in
 * production on 12/11/2026, ~5 GB an hour with the page open.
 *
 * Now a call asks the database what changed since the last one and reads only that, in one REPEATABLE READ snapshot
 * (what a call returns is one state of the database, as when it was one query):
 * - A chunk or a snapshot is held with its row version, Postgres' `xmin`: the transaction that wrote that version of
 *   the row. Every UPDATE writes a new version with its own transaction id, whoever runs it (the queue, «Reintentar lo
 *   que falló», an engine change, the exact cache, «repetir los últimos», a CLI, SQL by hand), and a transaction id is
 *   never given again, so a row held under the version the database has now is the row the database has. The held
 *   ids and versions go to the database as parameters (which are not egress); it answers with the ids of the rows that
 *   are new or changed and of the held ones that left (deleted by «Frenar», moved to another job by an engine change),
 *   and only the new or changed rows are read whole.
 * - `params` is held with the md5 of its text, computed by the database (the stock's way since #191, DECISIONES
 *   69.14): the same md5 is the same state, written by whoever.
 * A chunk's row is held whatever its status: one still queued or playing changes its version when it changes.
 *
 * Memory (R-008, 512 MB): a search like #125 (2,322 chunks, 88,956 games, 130 snapshots) takes ~5–7 MB here. Only the
 * last `LAB_JOBS_HELD` jobs viewed are held, within `LAB_HELD_BYTES` among them all (a bigger job is read every time,
 * as before, without pushing the others out), and a job not viewed for `LAB_ROWS_IDLE_MS` goes.
 */
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { type DeckSnapshot, Prisma, type SimulationJob } from '../generated/prisma/client.js'

/** What the Laboratorio reads of a chunk to score its lists. */
export const CHUNK_SELECT = {
  idx: true,
  snapshotAId: true,
  snapshotBId: true,
  status: true,
  winsA: true,
  winsB: true,
  ties: true,
  firstGame: true,
  extra: true,
} as const

export interface ChunkRow {
  idx: number
  snapshotAId: number | null
  snapshotBId: number | null
  status: string
  winsA: number | null
  winsB: number | null
  ties: number | null
  firstGame: number
  /** `perGame` (T-017 A2, H-010): each game by index, when the job asked for it. */
  extra: Prisma.JsonValue | null
}

/** A chunk with its id: what the database names when it changes or leaves the job. */
export type JobChunk = ChunkRow & { id: number }

const JOB_CHUNK_SELECT = { id: true, ...CHUNK_SELECT } as const

/** Row id → its version (`xmin`). */
export type Versions = ReadonlyMap<number, string>

/** The rows that are new or changed, with their version now, and the held ids that are no longer there. */
export interface Stale {
  changed: Map<number, string>
  gone: number[]
}

/** How the cache reads the database (`prismaLabRows`, in one transaction; tests fake it). */
export interface LabRowsSource {
  /** The job's row without `params`, or null when there is none. */
  job(id: number): Promise<Omit<SimulationJob, 'params'> | null>
  /** md5 of `params` as the database writes it out. */
  paramsHash(id: number): Promise<string | null>
  params(id: number): Promise<Prisma.JsonValue>
  staleChunks(jobId: number, held: Versions): Promise<Stale>
  /** The job's chunks of `ids`, or every one of them (`null`). */
  chunks(jobId: number, ids: readonly number[] | null): Promise<JobChunk[]>
  staleSnapshots(ids: readonly number[], held: Versions): Promise<Stale>
  snapshots(ids: readonly number[]): Promise<DeckSnapshot[]>
}

/** What `LabService.job` reads: the job, its chunks by idx and the snapshots asked for, by id. */
export interface LabJobRows {
  job: SimulationJob
  chunks: readonly JobChunk[]
  snapshots: readonly DeckSnapshot[]
}

/** Jobs held: the one on screen and another one or two. */
export const LAB_JOBS_HELD = 3
/**
 * What the jobs held may take among them all (R-008), estimated as twice the JSON of each row plus a little per row
 * (`heldBytes`). Measured on Node 24: 2–2.9 KB of heap for a chunk of 38 games with its `extra` (~1.4 KB of JSON) and
 * ~15 KB for one of 1,000 games (~10.5 KB of JSON). A search like #125 is ~7 MB by this estimate (4.6–6.8 MB
 * measured); the biggest the limits allow (`EXPLORE_LIMITS`: 5,200 chunks of 500 games) would be ~60 MB, and is read
 * whole every time, as before.
 */
export const LAB_HELD_BYTES = 32 * 1024 * 1024
/** A job not viewed for this long goes. */
export const LAB_ROWS_IDLE_MS = 15 * 60 * 1000
/** Past this many new or changed chunks, the job's chunks are read whole instead of by id (bind parameters). */
const READ_WHOLE_FROM = 5_000

interface Held<T> {
  version: string
  row: T
  /** Its estimated heap (`heldBytes`). */
  bytes: number
}

interface HeldJob {
  params: { hash: string; value: Prisma.JsonValue; bytes: number }
  chunks: ReadonlyMap<number, Held<JobChunk>>
  snapshots: ReadonlyMap<number, Held<DeckSnapshot>>
  bytes: number
  seenAt: number
}

@Injectable()
export class LabJobRowsCache implements OnModuleDestroy {
  /** By job id; a Map keeps insertion order, so the first key is the least recently viewed. */
  private readonly held = new Map<number, HeldJob>()
  private timer: NodeJS.Timeout | undefined
  /** The clock (tests move it). */
  now: () => number = () => Date.now()
  /** The memory budget (tests lower it). */
  maxBytes = LAB_HELD_BYTES

  /**
   * The rows of job `id` as the database has them now: the held ones it says did not change, and the rest read.
   * `snapshotIds` says which snapshots the job's `params` name, or null when it is not a job whose rows are held (then
   * only the job is read). Run it inside one REPEATABLE READ transaction (`source`), so that it all is one snapshot.
   */
  async read(
    id: number,
    source: LabRowsSource,
    snapshotIds: (params: Prisma.JsonValue) => readonly number[] | null,
  ): Promise<LabJobRows | null> {
    this.sweep()
    // Taken now: another call may replace or drop it while this one reads. What it held is checked again below, so an
    // older read that lands after a newer one leaves rows that the next call checks like any other.
    const held = this.held.get(id)
    const job = await source.job(id)
    if (!job) {
      this.held.delete(id)
      return null
    }
    const hash = await source.paramsHash(id)
    const kept = hash !== null && held?.params.hash === hash ? held.params : null
    const params = kept ? kept.value : deepFreeze(await source.params(id))
    const ids = snapshotIds(params)
    if (ids === null) {
      this.held.delete(id)
      return { job: { ...job, params }, chunks: [], snapshots: [] }
    }
    const wanted = [...new Set(ids)]
    const chunks = await refresh(
      held?.chunks,
      (versions) => source.staleChunks(id, versions),
      (changed, whole) => source.chunks(id, whole ? null : changed),
    )
    const snapshots =
      wanted.length === 0
        ? new Map<number, Held<DeckSnapshot>>()
        : await refresh(
            held?.snapshots,
            (versions) => source.staleSnapshots(wanted, versions),
            (changed) => source.snapshots(changed),
          )
    const paramsBytes = kept ? kept.bytes : heldBytes(params)
    let bytes = paramsBytes
    for (const item of chunks.values()) bytes += item.bytes
    for (const item of snapshots.values()) bytes += item.bytes
    // A job bigger than the whole budget is read every time, as before, and pushes nothing out.
    if (hash !== null && bytes <= this.maxBytes) {
      this.hold(id, {
        params: { hash, value: params, bytes: paramsBytes },
        chunks,
        snapshots,
        bytes,
        seenAt: this.now(),
      })
    } else {
      this.held.delete(id)
    }
    return {
      job: { ...job, params },
      chunks: [...chunks.values()].map((item) => item.row).sort((a, b) => a.idx - b.idx),
      snapshots: [...snapshots.values()].map((item) => item.row).sort((a, b) => a.id - b.id),
    }
  }

  /** Forgets every job. */
  clear(): void {
    this.held.clear()
  }

  /** Jobs held now. */
  get jobs(): number {
    return this.held.size
  }

  /** Chunks held now, among every job. */
  get chunks(): number {
    let total = 0
    for (const job of this.held.values()) total += job.chunks.size
    return total
  }

  /** The estimated heap of what is held now. */
  get bytes(): number {
    let total = 0
    for (const job of this.held.values()) total += job.bytes
    return total
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private hold(id: number, job: HeldJob): void {
    this.held.delete(id)
    this.held.set(id, job)
    // The least recently viewed go first; the one just read alone fits (checked before holding it).
    for (const oldest of this.held.keys()) {
      if (this.held.size <= LAB_JOBS_HELD && this.bytes <= this.maxBytes) break
      this.held.delete(oldest)
    }
    this.schedule()
  }

  /** Drops the jobs not viewed for `LAB_ROWS_IDLE_MS`. */
  private sweep(): void {
    const now = this.now()
    for (const [id, job] of this.held) if (now - job.seenAt >= LAB_ROWS_IDLE_MS) this.held.delete(id)
  }

  /**
   * While something is held, a sweep when the least recently viewed job turns idle, so that a page closed lets its
   * rows go with nobody asking. That job is the first one held (a view moves a job to the end), and it only gets older.
   */
  private schedule(): void {
    if (this.timer) return
    const oldest = this.held.values().next().value
    if (!oldest) return
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        this.sweep()
        this.schedule()
      },
      Math.max(0, oldest.seenAt + LAB_ROWS_IDLE_MS - this.now()),
    )
    this.timer.unref()
  }
}

/**
 * The rows now: the held ones the database says are the same, plus the new or changed ones read (frozen: whoever gets
 * them shares them with the next call), less the ones that left.
 */
async function refresh<T extends { id: number }>(
  held: ReadonlyMap<number, Held<T>> | undefined,
  staleOf: (versions: Versions) => Promise<Stale>,
  read: (ids: number[], whole: boolean) => Promise<T[]>,
): Promise<Map<number, Held<T>>> {
  const before = held ?? new Map<number, Held<T>>()
  const versions = new Map([...before].map(([key, item]) => [key, item.version]))
  const { changed, gone } = await staleOf(versions)
  const now = new Map(before)
  for (const key of gone) now.delete(key)
  if (changed.size === 0) return now
  // With nothing held, or too many ids for one query, every row (as one query used to); only the changed ones are taken.
  const rows = await read([...changed.keys()], before.size === 0 || changed.size > READ_WHOLE_FROM)
  const fresh = new Map(rows.map((row) => [row.id, row]))
  for (const [key, version] of changed) {
    const row = fresh.get(key)
    // In the same snapshot it is always there; if not, it is not held (nor returned) rather than held under a guess.
    if (row) now.set(key, { version, row: deepFreeze(row), bytes: heldBytes(row) })
    else now.delete(key)
  }
  return now
}

/** A row's heap, estimated: twice its JSON and a little more (`LAB_HELD_BYTES`). */
function heldBytes(value: unknown): number {
  const json = JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))
  return 200 + 2 * (json?.length ?? 0)
}

/** Plain objects and arrays frozen all the way down (a Date or a Buffer is left as it is). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  if (value instanceof Date || ArrayBuffer.isView(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

/** The rows of `table` that match `where` and are not held under their version now, and the held ids that do not match. */
async function staleRows(
  tx: Prisma.TransactionClient,
  table: 'simulation_chunks' | 'deck_snapshots',
  where: Prisma.Sql,
  held: Versions,
): Promise<Stale> {
  const relation = Prisma.raw(`"${table}"`)
  const rows =
    held.size === 0
      ? await tx.$queryRaw<{ id: number; version: string | null }[]>`
          SELECT t."id", t.xmin::text AS version FROM ${relation} t WHERE ${where}`
      : await tx.$queryRaw<{ id: number; version: string | null }[]>`
          WITH held AS (
            SELECT * FROM unnest(${[...held.keys()]}::int[], ${[...held.values()]}::text[]) AS h(id, version)
          ), cur AS (
            SELECT t."id", t.xmin::text AS version FROM ${relation} t WHERE ${where}
          )
          SELECT c."id", c.version FROM cur c LEFT JOIN held h ON h.id = c."id"
          WHERE h.version IS DISTINCT FROM c.version
          UNION ALL
          SELECT h.id, NULL FROM held h WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c."id" = h.id)`
  const stale: Stale = { changed: new Map(), gone: [] }
  for (const row of rows) {
    if (row.version === null) stale.gone.push(row.id)
    else stale.changed.set(row.id, row.version)
  }
  return stale
}

/** The source over a transaction of Prisma (REPEATABLE READ: `LabService.job`). */
export function prismaLabRows(tx: Prisma.TransactionClient): LabRowsSource {
  return {
    job: (id) => tx.simulationJob.findUnique({ where: { id }, omit: { params: true } }),
    paramsHash: async (id) => {
      const rows = await tx.$queryRaw<{ hash: string }[]>`
        SELECT md5("params"::text) AS hash FROM "simulation_jobs" WHERE "id" = ${id}`
      return rows[0]?.hash ?? null
    },
    params: async (id) =>
      (await tx.simulationJob.findUniqueOrThrow({ where: { id }, select: { params: true } })).params,
    staleChunks: (jobId, held) => staleRows(tx, 'simulation_chunks', Prisma.sql`t."job_id" = ${jobId}`, held),
    chunks: (jobId, ids) =>
      tx.simulationChunk.findMany({
        where: ids === null ? { jobId } : { jobId, id: { in: [...ids] } },
        select: JOB_CHUNK_SELECT,
      }),
    staleSnapshots: (ids, held) => staleRows(tx, 'deck_snapshots', Prisma.sql`t."id" = ANY(${[...ids]}::int[])`, held),
    snapshots: (ids) => tx.deckSnapshot.findMany({ where: { id: { in: [...ids] } } }),
  }
}
