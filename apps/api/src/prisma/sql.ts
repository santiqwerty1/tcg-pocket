/**
 * Small helpers for the few bulk writes that are simpler in plain SQL over the `pg` pool (catalog sync, import
 * apply): chunked `INSERT` / `INSERT … ON CONFLICT` well under Postgres' 65 535-parameter limit.
 */
import type pg from 'pg'

const MAX_PARAMS_PER_STATEMENT = 30_000

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

export interface InsertOptions {
  /** Expression per column used in VALUES (`$n` is substituted for the placeholder), e.g. `{ source: '$n::my_enum' }`. */
  casts?: Record<string, string> | undefined
}

export interface UpsertOptions extends InsertOptions {
  /**
   * What to do on conflict: `update` (default) overwrites every non-conflict column with the incoming values;
   * `nothing` keeps the existing row untouched (seed-once tables such as `rarity_rules`).
   */
  action?: 'update' | 'nothing' | undefined
}

async function insertChunks(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  suffix: string,
  casts: Record<string, string> | undefined,
): Promise<void> {
  if (rows.length === 0) return
  const columnList = columns.map(quoteIdentifier).join(', ')
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length))
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const params: unknown[] = []
    const tuples = chunk.map((row) => {
      if (row.length !== columns.length)
        throw new Error(`insert(${table}): row has ${row.length} values for ${columns.length} columns`)
      return `(${row
        .map((value, at) => {
          params.push(value)
          const placeholder = `$${params.length}`
          const cast = casts?.[columns[at] as string]
          return cast ? cast.replace('$n', placeholder) : placeholder
        })
        .join(', ')})`
    })
    await client.query(
      `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES ${tuples.join(', ')}${suffix}`,
      params,
    )
  }
}

/** Plain chunked `INSERT` (append-only tables such as `catalog_sync_changes`). */
export function insertMany(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  options: InsertOptions = {},
): Promise<void> {
  return insertChunks(client, table, columns, rows, '', options.casts)
}

export function upsertMany(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  conflictColumns: readonly string[],
  options: UpsertOptions = {},
): Promise<void> {
  const updatable = columns.filter((column) => !conflictColumns.includes(column))
  const conflictList = conflictColumns.map(quoteIdentifier).join(', ')
  const action =
    updatable.length === 0 || options.action === 'nothing'
      ? 'DO NOTHING'
      : `DO UPDATE SET ${updatable
          .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
          .join(', ')}`
  return insertChunks(client, table, columns, rows, ` ON CONFLICT (${conflictList}) ${action}`, options.casts)
}

export async function deleteNotIn(
  client: pg.PoolClient,
  table: string,
  column: string,
  keep: readonly string[],
): Promise<number> {
  const result = await client.query(
    `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} <> ALL($1::text[])`,
    [keep],
  )
  return result.rowCount ?? 0
}
