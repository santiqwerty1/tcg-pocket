/**
 * The bytes the API reads from the database, as Supabase counts them in its egress (infra-egress): what arrives on the
 * sockets of the pool's connections, the ones open now and the ones it opens while it counts. Locally there is no TLS,
 * so it is a little less than in production; what matters is what a call reads.
 */
import type { Socket } from 'node:net'
import type pg from 'pg'

type Counted = pg.PoolClient & { connection: { stream: Socket } }

export function countDatabaseBytes(pool: pg.Pool): { bytes: () => number; stop: () => void } {
  const sockets = new Set<Socket>()
  const start = new Map<Socket, number>()
  const add = (client: pg.PoolClient) => {
    const socket = (client as Counted).connection.stream
    if (sockets.has(socket)) return
    sockets.add(socket)
    start.set(socket, socket.bytesRead)
  }
  for (const client of (pool as unknown as { _clients: pg.PoolClient[] })._clients) add(client)
  pool.on('connect', add)
  return {
    bytes: () => [...sockets].reduce((sum, socket) => sum + socket.bytesRead - (start.get(socket) ?? 0), 0),
    stop: () => {
      pool.off('connect', add)
    },
  }
}
