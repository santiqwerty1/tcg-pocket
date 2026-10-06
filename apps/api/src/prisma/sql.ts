/**
 * Small helpers for the few bulk writes that are simpler in plain SQL over the `pg` pool (catalog sync, import
 * apply): chunked `INSERT … ON CONFLICT` upserts well under Postgres' 65 535-parameter limit.
 */
import type pg from 'pg'

const MAX_PARAMS_PER_STATEMENT = 30_000

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

/** Values to append verbatim after each `EXCLUDED.<column>` assignment (e.g. casts); none by default. */
export interface UpsertOptions {
  /** Expression per column used in VALUES (`$n` is substituted for the placeholder), e.g. `{ source: '$n::my_enum' }`. */
  casts?: Record<string, string> | undefined
}

export async function upsertMany(
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  conflictColumns: readonly string[],
  options: UpsertOptions = {},
): Promise<void> {
  if (rows.length === 0) return
  const updatable = columns.filter((column) => !conflictColumns.includes(column))
  const columnList = columns.map(quoteIdentifier).join(', ')
  const conflictList = conflictColumns.map(quoteIdentifier).join(', ')
  const action =
    updatable.length === 0
      ? 'DO NOTHING'
      : `DO UPDATE SET ${updatable
          .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
          .join(', ')}`
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length))
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const params: unknown[] = []
    const tuples = chunk.map((row) => {
      if (row.length !== columns.length)
        throw new Error(`upsertMany(${table}): row has ${row.length} values for ${columns.length} columns`)
      return `(${row
        .map((value, at) => {
          params.push(value)
          const placeholder = `$${params.length}`
          const cast = options.casts?.[columns[at] as string]
          return cast ? cast.replace('$n', placeholder) : placeholder
        })
        .join(', ')})`
    })
    await client.query(
      `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES ${tuples.join(', ')} ON CONFLICT (${conflictList}) ${action}`,
      params,
    )
  }
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
