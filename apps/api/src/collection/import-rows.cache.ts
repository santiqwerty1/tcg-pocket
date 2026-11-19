/**
 * R-014 (egress de Supabase): the rows of the last imports read, by import id. An import's rows never change once it
 * exists: they are inserted in the same transaction that creates it, nothing updates them, and they go only with their
 * import (the pruning of remote imports, a restore). Its id is never handed out again, except by a backup restore,
 * which brings imports back with their own ids and sets the sequence after them: it runs inside `whileReplacing`.
 *
 * Every read of one import's rows went to the database (~2,760 rows each, ~40 a day by 19/11/2026, plus «suerte de los
 * sobres», up to 8 imports each time). The import itself (status, diff) is still read every time; only its rows are
 * kept. About 150 KB per import (R-008).
 */
import { Injectable } from '@nestjs/common'
import type { CollectionImportRow } from '../generated/prisma/client.js'

export type ImportRow = Readonly<CollectionImportRow>

/** «Suerte de los sobres» compares up to 8 imports; a few more for the import views. */
export const IMPORT_ROWS_HELD = 12

@Injectable()
export class ImportRowsCache {
  /** By import id; a Map keeps insertion order, so the first key is the least recently used. */
  private readonly held = new Map<number, readonly ImportRow[]>()
  private generation = 0
  /** Restores in course: nothing read meanwhile is kept (what was held goes when one starts and when it ends). */
  private replacing = 0
  private readonly max = IMPORT_ROWS_HELD

  /** The rows of import `id`: the ones held, or `read` (not kept if a restore runs, began or ended while it read). */
  async rowsOf(id: number, read: () => Promise<CollectionImportRow[]>): Promise<readonly ImportRow[]> {
    const hit = this.held.get(id)
    if (hit) {
      this.held.delete(id)
      this.held.set(id, hit)
      return hit
    }
    const generation = this.generation
    const rows = Object.freeze((await read()).map((row) => Object.freeze(row)))
    if (generation === this.generation && this.replacing === 0) {
      this.held.set(id, rows)
      for (const oldest of this.held.keys()) {
        if (this.held.size <= this.max) break
        this.held.delete(oldest)
      }
    }
    return rows
  }

  /**
   * Runs a backup restore: from before it starts until after its commit is seen here, every read goes to the database
   * (an id may become another import as soon as it commits), and then everything held is forgotten.
   */
  async whileReplacing<T>(work: () => Promise<T>): Promise<T> {
    this.replacing += 1
    this.clear()
    try {
      return await work()
    } finally {
      this.replacing -= 1
      this.clear()
    }
  }

  /** Forgets every import. */
  clear(): void {
    this.held.clear()
    this.generation += 1
  }

  /** Imports held now. */
  get size(): number {
    return this.held.size
  }
}
