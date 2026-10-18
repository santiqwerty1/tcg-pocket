/**
 * The move of the session chat to the hub (D-030, T1b): the rooms Santi marked as moved, and where to. Turned on and
 * off by hand from his session (Más → Tokens de API). A moved room takes no writes in tcg-pocket any more: the bridge
 * gets `410 chat_moved` with the hub's URL, and the old connector's `chat_read`/`chat_write` go to the hub (D5).
 */
import { GoneException, Inject, Injectable } from '@nestjs/common'
import { CHAT_ROOMS, type ChatRoom } from '@tcg/domain'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { ENV, type Env } from '../config/env.js'
import type { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { CHAT_WRITE_LOCK } from './chat-locks.js'

/** The `app_settings` key: `{ <room>: { url, since } }`. */
export const CHAT_MOVED_KEY = 'chat_moved'

export interface ChatMovedRoom {
  room: ChatRoom
  /** The hub's origin (`https://…`, no path): its `/api/mcp` is where the connector's calls go. */
  url: string
  /** When Santi marked it (ISO 8601); null if what is stored is not a date (a hand edit): the room stays moved. */
  since: string | null
}

const entrySchema = z.object({ url: z.string(), since: z.unknown() })
const isoDate = z.iso.datetime({ offset: true })

/**
 * The moved rooms in a stored value, room by room: an entry that is not one (a hand edit, a room tcg-pocket does not
 * have) is left out and told to `ignored`, and the others stay moved. `allowLocal`: as when it was written.
 */
export function chatMovedFrom(
  value: unknown,
  options: { allowLocal?: boolean; ignored?: (key: string) => void } = {},
): Map<ChatRoom, ChatMovedRoom> {
  const moved = new Map<ChatRoom, ChatMovedRoom>()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return moved
  for (const [key, raw] of Object.entries(value)) {
    const room = CHAT_ROOMS.find((item) => item === key)
    const entry = entrySchema.safeParse(raw)
    if (!room || !entry.success || hubOrigin(entry.data.url, options) !== entry.data.url) {
      options.ignored?.(key)
      continue
    }
    const since = isoDate.safeParse(entry.data.since)
    moved.set(room, { room, url: entry.data.url, since: since.success ? since.data : null })
  }
  return moved
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
/** Names that only mean something inside a network (Fly's `.internal`, mDNS), or none at all. */
const INTERNAL_NAME = /(^|\.)(internal|local|localhost)$/

/**
 * The hub's origin from what Santi typed, or null: https to a public name, no user or password, no path, query or
 * fragment. No IP literal or internal name (the token would go to whatever answers there: the metadata address, the
 * private network). `allowLocal`: http to this machine, only outside production, for trying it locally.
 */
export function hubOrigin(value: string, options: { allowLocal?: boolean } = {}): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return null
  }
  if (options.allowLocal && LOCAL_HOSTS.has(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return url.origin
  }
  const host = url.hostname
  // A name with its final dot (`metadata.`, `chat-hub.internal.`) is the same name: never one of these.
  if (host.endsWith('.')) return null
  const literal = IPV4.test(host) || host.startsWith('[')
  if (url.protocol !== 'https:' || literal || !host.includes('.') || INTERNAL_NAME.test(host)) return null
  return url.origin
}

/** The answer of a bridge route of a moved room: it stops there, and the URL says where the room is now. */
export function chatMovedError(moved: ChatMovedRoom): GoneException {
  return new GoneException({
    code: 'chat_moved',
    message: `La sala «${moved.room}» se mudó al hub (${moved.url}): tcg-pocket ya no la recibe. Cambiá la URL del puente a la del hub.`,
    details: { sala: moved.room, url: moved.url },
  })
}

@Injectable()
export class ChatMovedService {
  /** http to this machine counts only outside production, as when Santi marks a room. */
  readonly allowLocal: boolean

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.allowLocal = !env.isProduction
    this.logger.setContext(ChatMovedService.name)
  }

  /** What is stored, read by production's rules; an entry that is not one is left out and logged. */
  private read(value: unknown): Map<ChatRoom, ChatMovedRoom> {
    return chatMovedFrom(value, {
      allowLocal: this.allowLocal,
      ignored: (key) => this.logger.warn({ key }, 'chat_moved entry ignored'),
    })
  }

  async all(): Promise<Map<ChatRoom, ChatMovedRoom>> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CHAT_MOVED_KEY } })
    return this.read(row?.value)
  }

  async of(room: ChatRoom): Promise<ChatMovedRoom | null> {
    return (await this.all()).get(room) ?? null
  }

  /** A bridge route, or a write from anywhere, in a moved room: `410 chat_moved`. */
  async refuseIfMoved(room: ChatRoom): Promise<void> {
    const moved = await this.of(room)
    if (moved) throw chatMovedError(moved)
  }

  /** The same, inside a write's transaction, after its lock (what Santi committed meanwhile counts). */
  async refuseIfMovedIn(tx: Prisma.TransactionClient, room: ChatRoom): Promise<void> {
    const row = await tx.appSetting.findUnique({ where: { key: CHAT_MOVED_KEY } })
    const moved = this.read(row?.value).get(room)
    if (moved) throw chatMovedError(moved)
  }

  /**
   * Marks `room` as moved to `url` (an origin, see `hubOrigin`), in one statement: the other rooms stay as they are.
   * Under the chat's write lock: a write already waiting for it goes first, and any later one sees the room moved.
   */
  async set(room: ChatRoom, url: string): Promise<ChatMovedRoom> {
    const since = new Date().toISOString()
    const entry = JSON.stringify({ [room]: { url, since } })
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAT_WRITE_LOCK}::bigint)`
        await tx.$executeRaw`
      INSERT INTO "app_settings" ("key", "value", "updated_at") VALUES (${CHAT_MOVED_KEY}, ${entry}::jsonb, now())
      ON CONFLICT ("key") DO UPDATE SET
        "value" = (CASE WHEN jsonb_typeof("app_settings"."value") = 'object' THEN "app_settings"."value" ELSE '{}'::jsonb END)
          || EXCLUDED."value",
        "updated_at" = now()`
      },
      { timeout: 15_000 },
    )
    return { room, url, since }
  }

  /** Back to tcg-pocket: whether it was moved. */
  async clear(room: ChatRoom): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE "app_settings" SET "value" = "value" - ${room}::text, "updated_at" = now()
      WHERE "key" = ${CHAT_MOVED_KEY} AND jsonb_typeof("value") = 'object' AND "value" ? ${room}::text`
    return changed > 0
  }
}
