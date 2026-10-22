/**
 * The errors of a transaction that waited too long: a lock wait past `lock_timeout` (Postgres 55P03) and a transaction
 * past Prisma's timeout (P2028). Services that wait for an advisory lock turn them into a `503 …_busy`, never a 500.
 */

/** Postgres gave up waiting for a lock (`lock_timeout`), wherever the driver adapter nests the code. */
export function isLockTimeout(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth++) {
    const { code, originalCode, meta, message, cause } = current as {
      code?: unknown
      originalCode?: unknown
      meta?: { code?: unknown; driverAdapterError?: unknown }
      message?: unknown
      cause?: unknown
    }
    if ([code, originalCode, meta?.code].includes('55P03')) return true
    if (typeof message === 'string' && /lock timeout/i.test(message)) return true
    current = cause ?? meta?.driverAdapterError
  }
  return false
}

/** Prisma closed an interactive transaction that ran past its `timeout` (P2028). */
export function isTransactionTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2028'
}
