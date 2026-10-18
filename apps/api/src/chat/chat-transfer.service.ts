/**
 * The move of the session chat to the hub (D-030, T1a): tcg-pocket's side of `chat-export` v1 (chat-hub's
 * docs/contrato.md, version 1.3). The export is what the hub imports, room by room (the token is `chat:export`, alone);
 * the import is the way back (D8), only from the machine (`chat-import`), because it writes messages with the ids
 * they bring.
 */
import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  CHAT_EXPORT_DEFAULT_LIMIT,
  CHAT_EXPORT_FORMAT,
  CHAT_EXPORT_VERSION,
  CHAT_OWNER,
  CHAT_ROOM_LABEL,
  CHAT_ROOMS,
  type ChatExistingMessage,
  type ChatExistingState,
  type ChatExportData,
  type ChatExportPage,
  type ChatImportPlan,
  type ChatRoom,
  chatExportPageSchema,
  chatKey,
  describeChatImport,
  planChatImport,
} from '@tcg/domain'
import { Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { roomsOf, sinceIn } from './chat.service.js'

export const CHAT_EXPORT_SOURCE = 'tcg-pocket'
/** The chat's insert lock (chat.service.ts): no message goes in while the import does. */
const WRITE_LOCK = 20_261_009
/**
 * The most characters the whole export may have: it is held in memory until the plan, and the CLI runs in the API's
 * machine (512 MB, with the API). The real chat is about 1 MB a week, some 13 MB in its 90 days. A bigger one comes
 * up to the cap, which is applied as it is, and says where to go on with `--despues` (review of #123, Codex).
 */
export const MAX_EXPORT_CHARS = 30_000_000
/** The most characters a page may have: a page of `IMPORT_PAGE_LIMIT` of ordinary text fits with room to spare. */
export const MAX_PAGE_CHARS = 25_000_000
/**
 * The messages per page this import asks for: 100 of the longest text the format allows (100,000 characters) are 10
 * million, so ordinary text and its reads fit `MAX_PAGE_CHARS` with room to spare (the default 500 might not). Only a
 * page full of escaped control characters (`\u0001` is six) could pass it, and then the import refuses it with a
 * clear error (the Coordinator on #123).
 */
const IMPORT_PAGE_LIMIT = 100
/** Characters of an error answer that are kept for the message (the rest is never read). */
const ERROR_DETAIL_CHARS = 300
/** At most this many pages: an export that never ends is not followed forever. */
const MAX_PAGES = 10_000
/** Ids or refs per query (Postgres takes up to 65,535 parameters). */
const CHUNK = 5_000
const OWNER_KEY = chatKey(CHAT_OWNER)

type Tx = Prisma.TransactionClient

/** The texts as Postgres' `md5()` gives them (over UTF-8). */
const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex')

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK))
  return out
}

export class ChatImportError extends Error {}

export interface ChatFetchInput {
  url: string
  token: string
  rooms?: readonly string[]
  after?: number
  fetchImpl?: typeof fetch
  /** For the tests: the cap of characters per page. */
  maxPageChars?: number
  /** For the tests: the cap of characters of the whole export. */
  maxExportChars?: number
}

/**
 * The body of a response, read in pieces: past `cap` characters it stops and gives null, whatever Content-Length
 * said (the rest is never read).
 */
async function readCapped(response: Response, cap: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > cap) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    if (text.length > cap) {
      await reader.cancel().catch(() => undefined)
      return null
    }
  }
  return text + decoder.decode()
}

/** The first `chars` characters of a body, and no more read (an error answer could be endless). */
async function readStart(response: Response, chars: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (text.length < chars) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => undefined)
  return text.slice(0, chars)
}

/** The participants an import looks at: the ones it brings and the ones its reads are of. */
function participantKeys(data: ChatExportData): string[] {
  return [...new Set([...data.participants.map((item) => item.key), ...data.reads.map((read) => read.participant)])]
}

/** `before` with `after` on top: an item of `after` replaces the one with its key, a new one goes last. */
function mergeBy<T>(before: readonly T[], after: readonly T[], key: (item: T) => string): T[] {
  const merged = new Map(before.map((item) => [key(item), item]))
  for (const item of after) merged.set(key(item), item)
  return [...merged.values()]
}

@Injectable()
export class ChatTransferService {
  constructor(private readonly prisma: PrismaService) {}

  /** A page of the rooms asked (only `CHAT_ROOMS`), in id order, with their participants and the reads of its messages. */
  async exportPage(input: { rooms: readonly ChatRoom[]; after?: number; limit?: number }): Promise<ChatExportPage> {
    const rooms = CHAT_ROOMS.filter((room) => input.rooms.includes(room))
    const limit = input.limit ?? CHAT_EXPORT_DEFAULT_LIMIT
    const [participantRows, messageRows] = await Promise.all([
      this.prisma.sessionChatParticipant.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.sessionChatMessage.findMany({
        where: { room: { in: [...rooms] }, id: { gt: input.after ?? 0 } },
        orderBy: { id: 'asc' },
        take: limit + 1,
      }),
    ])
    const messages = messageRows.slice(0, limit)
    const reads =
      messages.length === 0
        ? []
        : await this.prisma.sessionChatSeen.findMany({
            where: { messageId: { in: messages.map((row) => row.id) } },
            orderBy: [{ messageId: 'asc' }, { participant: 'asc' }],
          })
    const last = messages.at(-1)
    return {
      format: CHAT_EXPORT_FORMAT,
      version: CHAT_EXPORT_VERSION,
      source: CHAT_EXPORT_SOURCE,
      exportedAt: new Date().toISOString(),
      rooms: rooms.map((room) => ({ slug: room, label: CHAT_ROOM_LABEL[room] })),
      // Santi is not a participant to move: he is in every room on both sides.
      participants: participantRows
        .filter((row) => row.key !== OWNER_KEY && row.channel !== 'owner')
        .flatMap((row) => {
          const own = roomsOf(row)
            .map((room, position) => ({ room, position, sinceId: sinceIn(row, room) }))
            .filter((item) => rooms.includes(item.room))
          return own.length === 0 ? [] : [{ key: row.key, name: row.name, channel: row.channel, rooms: own }]
        }),
      messages: messages.map((row) => ({
        id: row.id,
        at: row.at.toISOString(),
        room: row.room,
        fromName: row.fromName,
        fromKey: row.fromKey,
        toNames: row.toNames,
        toKeys: row.toKeys,
        topic: row.topic,
        body: row.body,
        via: row.via,
        relayRef: row.relayRef,
      })),
      reads: reads.map((row) => ({ participant: row.participant, messageId: row.messageId, at: row.at.toISOString() })),
      next: messageRows.length > limit && last ? last.id : null,
    }
  }

  /**
   * Every page of the export at `url` (with `?salas&after`), put together. Each page has to come in id order, after
   * the one before, and say as `next` its own last id: a source that skips ids, or goes back, is refused. A page that
   * would take it past `MAX_EXPORT_CHARS` is left out: what came is a whole part (ids go up), and `continueAfter` says
   * where the rest starts.
   */
  async fetchExport(input: ChatFetchInput): Promise<ChatExportData> {
    const fetchImpl = input.fetchImpl ?? fetch
    let after = input.after ?? 0
    let data: ChatExportData | null = null
    let total = 0
    const totalCap = input.maxExportChars ?? MAX_EXPORT_CHARS
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
      const url = new URL(input.url)
      if (input.rooms && input.rooms.length > 0) url.searchParams.set('salas', input.rooms.join(','))
      url.searchParams.set('after', String(after))
      url.searchParams.set('limit', String(IMPORT_PAGE_LIMIT))
      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
        })
      } catch (error) {
        const cause =
          error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : error
        throw new ChatImportError(`No se pudo leer la exportación (${url.origin}): ${String(cause)}`)
      }
      if (!response.ok) {
        const detail = await readStart(response, ERROR_DETAIL_CHARS).catch(() => '')
        throw new ChatImportError(`La exportación contestó ${response.status}: ${detail}`)
      }
      // A page reads up to its cap and up to what is left of the total, so what is held never passes the total (the
      // Coordinator on chat-hub#11: 29 million held and a page of 24 would pass a heap of 160 MB).
      const pageCap = input.maxPageChars ?? MAX_PAGE_CHARS
      const left = totalCap - total
      const body = await readCapped(response, Math.min(pageCap, left))
      if (body === null && left >= pageCap)
        throw new ChatImportError(`Una página de la exportación pasa los ${pageCap} caracteres.`)
      if (body === null) {
        // The pages before this one are a whole part: they are what comes, and the rest from here (Codex on #123).
        if (data !== null) return { ...data, continueAfter: after }
        throw new ChatImportError(`Una sola página de la exportación pasa los ${totalCap} caracteres en total.`)
      }
      total += body.length
      let json: unknown = null
      try {
        json = JSON.parse(body)
      } catch {}
      const parsed = chatExportPageSchema.safeParse(json)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new ChatImportError(
          `La exportación no es chat-export v1: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
        )
      }
      const page = parsed.data
      // Only the rooms asked: anything else from the source is refused, never imported quietly.
      if (input.rooms && input.rooms.length > 0) {
        const asked = new Set(input.rooms)
        const extra = [...page.rooms.map((room) => room.slug), ...page.messages.map((message) => message.room)].find(
          (room) => !asked.has(room),
        )
        if (extra !== undefined) throw new ChatImportError(`La exportación trajo la sala «${extra}», que no se pidió.`)
      }
      let previous = after
      for (const message of page.messages) {
        if (message.id <= previous) {
          throw new ChatImportError(
            `La exportación no viene en orden: el mensaje ${message.id} después del ${previous}.`,
          )
        }
        previous = message.id
      }
      if (page.next !== null && (page.messages.length === 0 || page.next !== previous)) {
        throw new ChatImportError(
          `La exportación no avanza bien: next ${page.next}, y su último mensaje es ${previous}.`,
        )
      }
      if (data === null) {
        data = { source: page.source, rooms: [], participants: [], messages: [], reads: [] }
      }
      // Every page repeats the rooms and the participants as they were then. A room a later page renames wins; the
      // participants are the whole list of the latest page, so one deleted meanwhile is not brought back (Codex on #123).
      data.rooms = mergeBy(data.rooms, page.rooms, (room) => room.slug)
      data.participants = page.participants
      data.messages.push(...page.messages)
      data.reads.push(...page.reads)
      if (page.next === null) return data
      after = page.next
    }
    throw new ChatImportError(`La exportación pasó las ${MAX_PAGES} páginas.`)
  }

  /** What the import would do now, without changing anything. */
  async preview(data: ChatExportData): Promise<ChatImportPlan> {
    return planChatImport(data, await this.existing(this.prisma, data), { hash: md5 })
  }

  /**
   * Does it, in one transaction under the insert lock: the plan is made again inside it, so what it applies is what
   * tcg-pocket has then. With a conflict, nothing changes and the error explains it. The sequence goes up to the
   * highest id it brought, never down: the next message of tcg-pocket comes after everything.
   */
  async apply(data: ChatExportData): Promise<ChatImportPlan> {
    return this.applyInTransaction(data).catch((error: unknown) => {
      // A participant or a message that came in between the plan and its insert, or a message the retention deleted:
      // the transaction rolled back, so nothing changed.
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2025'].includes(error.code)) {
        throw new ChatImportError(
          `Algo cambió en tcg-pocket mientras se importaba (${error.code}): no se aplicó nada. Volvé a correrlo.`,
        )
      }
      throw error
    })
  }

  private applyInTransaction(data: ChatExportData): Promise<ChatImportPlan> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`
        // The participants it reads stay as they are until the commit: Santi's list and a bridge's join wait (they do
        // not take the write lock), so the plan is made on what is there and is what gets applied.
        await tx.$queryRaw`
          SELECT "key" FROM "session_chat_participants" WHERE "key" = ANY(${participantKeys(data)}::text[]) FOR UPDATE`
        const plan = planChatImport(data, await this.existing(tx, data), { hash: md5 })
        if (plan.conflicts.length > 0) {
          const n = plan.conflicts.length
          throw new ChatImportError(
            `${describeChatImport(plan, 'refused')}\n\nHay ${n === 1 ? '1 conflicto' : `${n} conflictos`}: no se aplicó nada.`,
          )
        }
        for (const participant of plan.newParticipants) {
          await tx.sessionChatParticipant.create({
            data: {
              key: participant.key,
              name: participant.name,
              channel: participant.channel,
              sinceId: 0,
              rooms: participant.rooms.map((item) => item.room),
              roomSince: Object.fromEntries(participant.rooms.map((item) => [item.room, item.sinceId])),
            },
          })
        }
        for (const join of plan.joins) {
          // Only the participant the plan saw (same channel, not in the room yet): one changed or removed meanwhile by
          // Santi or a bridge, which do not take this lock, refuses the whole import instead of half-applying it.
          const joined = await tx.$executeRaw`
            UPDATE "session_chat_participants"
            SET "rooms" = array_append("rooms", ${join.room}),
              "room_since" = (CASE WHEN jsonb_typeof("room_since") = 'object' THEN "room_since" ELSE '{}'::jsonb END)
                || jsonb_build_object(${join.room}::text, ${join.sinceId}::int)
            WHERE "key" = ${join.key} AND "channel" = ${join.channel}::"session_chat_channel"
              AND NOT (${join.room} = ANY("rooms"))`
          if (joined !== 1) {
            throw new ChatImportError(
              `«${join.key}» cambió en tcg-pocket mientras se importaba: no se aplicó nada. Volvé a correrlo.`,
            )
          }
        }
        for (let start = 0; start < plan.newMessages.length; start += 1_000) {
          await tx.sessionChatMessage.createMany({
            data: plan.newMessages
              .slice(start, start + 1_000)
              .map((message) => ({ ...message, at: new Date(message.at) })),
          })
        }
        for (let start = 0; start < plan.reads.length; start += 5_000) {
          await tx.sessionChatSeen.createMany({
            data: plan.reads
              .slice(start, start + 5_000)
              .map((read) => ({ participant: read.participant, messageId: read.messageId, at: new Date(read.at) })),
            skipDuplicates: true,
          })
        }
        if (plan.nextIdAfter !== null) {
          await tx.$executeRaw`SELECT setval('session_chat_messages_id_seq', ${plan.nextIdAfter - 1}::bigint, true)`
        }
        return plan
      },
      { timeout: 300_000, maxWait: 30_000 },
    )
  }

  private async existing(db: Tx, data: ChatExportData): Promise<ChatExistingState> {
    const ids = data.messages.map((message) => message.id)
    const refs = data.messages.flatMap((message) => (message.relayRef === null ? [] : [message.relayRef]))
    const participants = await db.sessionChatParticipant.findMany({ where: { key: { in: participantKeys(data) } } })
    const messages: ChatExistingMessage[] = []
    for (const part of chunks(ids)) {
      // Without the texts: their MD5, so a repeated import does not hold them twice.
      const rows = await db.$queryRaw<
        {
          id: number
          at: Date
          room: string
          from_name: string
          from_key: string
          to_names: string[]
          to_keys: string[]
          topic_md5: string
          body_md5: string
          relay_ref: string | null
        }[]
      >`SELECT id, at, room, from_name, from_key, to_names, to_keys, md5(topic) AS topic_md5, md5(body) AS body_md5,
          relay_ref FROM session_chat_messages WHERE id = ANY(${part}::int[])`
      for (const row of rows) {
        messages.push({
          id: row.id,
          at: row.at,
          room: row.room,
          fromName: row.from_name,
          fromKey: row.from_key,
          toNames: row.to_names,
          toKeys: row.to_keys,
          topicHash: row.topic_md5,
          bodyHash: row.body_md5,
          relayRef: row.relay_ref,
        })
      }
    }
    const relayRefs = new Map<string, number>()
    for (const part of chunks(refs)) {
      const rows = await db.sessionChatMessage.findMany({
        where: { relayRef: { in: part } },
        select: { id: true, relayRef: true },
      })
      for (const row of rows) if (row.relayRef !== null) relayRefs.set(row.relayRef, row.id)
    }
    const exportedRooms = data.rooms.map((room) => room.slug)
    const maxRows =
      exportedRooms.length === 0
        ? []
        : await db.sessionChatMessage.groupBy({
            by: ['room'],
            where: { room: { in: exportedRooms } },
            _max: { id: true },
          })
    const roomMaxIds = new Map<string, number>()
    for (const row of maxRows) {
      const max = row._max?.id
      if (typeof max === 'number') roomMaxIds.set(row.room, max)
    }
    const [sequence] = await db.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
      SELECT last_value, is_called FROM session_chat_messages_id_seq`
    return {
      participants: participants.map((row) => ({
        key: row.key,
        name: row.name,
        channel: row.channel,
        rooms: roomsOf(row).map((room) => ({ room, sinceId: sinceIn(row, room) })),
      })),
      messages,
      relayRefs,
      nextId: sequence ? Number(sequence.last_value) + (sequence.is_called ? 1 : 0) : 1,
      roomMaxIds,
    }
  }
}
