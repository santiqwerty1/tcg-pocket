/**
 * The move of the session chat to the hub (D-030, T1): `chat-export` v1, the format chat-hub and tcg-pocket hand each
 * other, the same both ways (chat-hub's docs/contrato.md, version 1.3), and the plan of an import into tcg-pocket (the
 * way back, D8). Ids travel as they are: a bridge keeps its cursor when it changes URL. The hub's own ids start at
 * 1,000,001, so they never collide with tcg-pocket's.
 *
 * Pure: the hash of the texts comes from outside (the API's md5, the same as Postgres' `md5()`), so the PWA can import
 * this module without Node's crypto.
 */
import { z } from 'zod'
import {
  CHAT_CHANNEL_LABEL,
  CHAT_EVERYONE,
  CHAT_OWNER,
  CHAT_ROOMS,
  type ChatChannel,
  type ChatRoom,
  chatKey,
  chatParticipantName,
} from './chatTools.js'

export const CHAT_EXPORT_FORMAT = 'chat-export'
export const CHAT_EXPORT_VERSION = 1
/** Messages per page: the default and the most a page brings. */
export const CHAT_EXPORT_DEFAULT_LIMIT = 500
export const CHAT_EXPORT_MAX_LIMIT = 2_000
/** The largest id of the table (`SERIAL`): an export may carry any id its side has. */
export const CHAT_EXPORT_MAX_ID = 2_147_483_647
/** The highest id an import takes: far from the end of `SERIAL`, so raising the sequence never runs out of ids. */
export const CHAT_IMPORT_MAX_ID = 1_999_999_999
/** Development chatter is kept three months (D-021): older messages do not come, the next write would delete them. */
export const CHAT_RETENTION_DAYS = 90
/** How far in the future a message's time may be (two clocks). */
export const CHAT_FUTURE_TOLERANCE_MS = 5 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** A UTF-16 unit of a pair without its other half. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
/** Text Postgres keeps as it came: no NUL, no half of a surrogate pair. */
export function chatStorable(value: string): boolean {
  return !value.includes('\u0000') && !LONE_SURROGATE.test(value)
}
const STORABLE = 'Sin caracteres nulos ni mitades de un par UTF-16'
const text = (max: number) => z.string().max(max).refine(chatStorable, STORABLE)
/** C0 and C1 control characters: never in a name, a key or a label. */
const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}
const noControl = (value: string) => ![...value].some(isControl)
/** A name as written in a message: data, not a member of the list. */
const writtenName = z
  .string()
  .min(1)
  .max(60)
  .refine(chatStorable, STORABLE)
  .refine(noControl, 'Sin caracteres de control')
const key = z.string().min(1).max(60).refine(chatStorable, STORABLE).refine(noControl, 'Sin caracteres de control')
const id = z.number().int().min(1).max(CHAT_EXPORT_MAX_ID)
/** The hub's rooms are data; tcg-pocket only knows `CHAT_ROOMS`, and the plan says so. */
const roomSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Una sala: minúsculas sin tilde, números y guiones')

export const chatExportPageSchema = z.object({
  format: z.literal(CHAT_EXPORT_FORMAT),
  version: z.literal(CHAT_EXPORT_VERSION),
  /** Printed in the preview: no control characters. */
  source: z.string().min(1).max(40).refine(chatStorable, STORABLE).refine(noControl, 'Sin caracteres de control'),
  exportedAt: z.iso.datetime({ offset: true }),
  rooms: z
    .array(
      z.object({
        slug: roomSlug,
        label: z.string().trim().min(1).max(80).refine(noControl, 'Sin caracteres de control'),
      }),
    )
    .max(100)
    .refine((rooms) => new Set(rooms.map((room) => room.slug)).size === rooms.length, 'Cada sala una vez'),
  participants: z
    .array(
      z.object({
        key,
        name: chatParticipantName,
        channel: z.enum(['owner', 'relay', 'connector']),
        rooms: z
          .array(
            z.object({
              room: roomSlug,
              position: z.number().int().min(0),
              sinceId: z.number().int().min(0).max(CHAT_EXPORT_MAX_ID),
            }),
          )
          .max(100)
          .refine((rooms) => new Set(rooms.map((item) => item.room)).size === rooms.length, 'Cada sala una vez'),
      }),
    )
    .max(1_000)
    .refine(
      (list) => new Set(list.map((item) => chatKey(item.name))).size === list.length,
      'Cada participante una vez (sin importar mayúsculas)',
    )
    .refine((list) => new Set(list.map((item) => item.key)).size === list.length, 'Cada clave una vez'),
  messages: z
    .array(
      z
        .object({
          id,
          at: z.iso.datetime({ offset: true }),
          room: roomSlug,
          fromName: writtenName,
          fromKey: key,
          toNames: z.array(writtenName).min(1).max(50),
          toKeys: z.array(key).min(1).max(50),
          topic: text(1_000),
          body: text(100_000),
          via: text(200),
          relayRef: z.string().min(1).max(200).refine(chatStorable, STORABLE).nullable(),
        })
        // The keys are their names in lower case (chatKey), «todos» included: a key that says another name is refused.
        .refine((message) => message.fromKey === chatKey(message.fromName), 'fromKey no es el nombre de fromName')
        .refine(
          (message) =>
            message.toKeys.length === message.toNames.length &&
            message.toKeys.every((item, index) => item === chatKey(message.toNames[index] ?? '')),
          'toKeys no son los nombres de toNames',
        ),
    )
    .max(CHAT_EXPORT_MAX_LIMIT),
  reads: z
    .array(z.object({ participant: key, messageId: id, at: z.iso.datetime({ offset: true }) }))
    .max(CHAT_EXPORT_MAX_LIMIT * 200),
  /** The `after` of the next page (the last id of this one), or null on the last one. */
  next: id.nullable(),
})

export type ChatExportPage = z.infer<typeof chatExportPageSchema>
export type ChatExportMessage = ChatExportPage['messages'][number]
export type ChatExportParticipant = ChatExportPage['participants'][number]
export type ChatExportRead = ChatExportPage['reads'][number]

/** Every page of one export, put together. */
export interface ChatExportData {
  source: string
  rooms: ChatExportPage['rooms']
  participants: ChatExportParticipant[]
  messages: ChatExportMessage[]
  reads: ChatExportRead[]
}

/** A message as tcg-pocket has it, with what an import compares: the texts as their hash. */
export interface ChatExistingMessage {
  id: number
  at: Date
  room: string
  fromName: string
  fromKey: string
  toNames: string[]
  toKeys: string[]
  topicHash: string
  bodyHash: string
  relayRef: string | null
}

export interface ChatExistingParticipant {
  key: string
  name: string
  channel: ChatChannel
  /** Its rooms in order, with where it starts reading each (`sinceIn`). */
  rooms: { room: string; sinceId: number }[]
}

export interface ChatExistingState {
  participants: ChatExistingParticipant[]
  /** tcg-pocket's messages with an id of the export. */
  messages: ChatExistingMessage[]
  /** tcg-pocket's messages with a `relayRef` of the export: ref → id. */
  relayRefs: Map<string, number>
  /** The id the sequence gives next. */
  nextId: number
  /** The highest id tcg-pocket has in each room of the export (none: no messages there). */
  roomMaxIds: Map<string, number>
}

export interface ChatImportConflict {
  id: number
  room: string
  reason: string
}

export interface ChatImportRoomSummary {
  room: string
  new: number
  identical: number
  conflicts: number
  old: number
  /** New messages below the highest id tcg-pocket already has in the room: a bridge past them never sees them. */
  belowCursor: number
  /** That highest id, when there are such messages. */
  ownMaxId: number | null
}

export interface ChatImportPlan {
  source: string
  /** New participants, with their rooms in order and where they start in each (`room_since`). */
  newParticipants: {
    key: string
    name: string
    channel: 'relay' | 'connector'
    rooms: { room: ChatRoom; sinceId: number }[]
  }[]
  /** A room a participant of tcg-pocket joins, last, starting where it started in the source (with the channel it has). */
  joins: { key: string; channel: 'relay' | 'connector'; room: ChatRoom; sinceId: number }[]
  /** Told, never changed. */
  participantNotes: string[]
  /** Reads that do not come (of nobody tcg-pocket has or gets, or with a time ahead), told. */
  readNotes: string[]
  newMessages: ChatExportMessage[]
  identical: number
  conflicts: ChatImportConflict[]
  reads: ChatExportRead[]
  perRoom: ChatImportRoomSummary[]
  maxId: number
  /** The sequence goes up so the next id is this one; null when it does not move (it never goes down). */
  nextIdAfter: number | null
  names: Record<string, string>
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const knownRoom = (room: string): room is ChatRoom => (CHAT_ROOMS as readonly string[]).includes(room)

/** What differs between tcg-pocket's message and the export's with the same id (empty: identical; the via does not count). */
export function chatMessageDifferences(
  own: ChatExistingMessage,
  incoming: ChatExportMessage,
  hash: (value: string) => string,
): string[] {
  const differences: string[] = []
  if (own.room !== incoming.room) differences.push('sala')
  if (own.at.getTime() !== new Date(incoming.at).getTime()) differences.push('hora')
  if (own.fromKey !== incoming.fromKey || own.fromName !== incoming.fromName) differences.push('remitente')
  if (!sameList(own.toKeys, incoming.toKeys) || !sameList(own.toNames, incoming.toNames)) {
    differences.push('destinatarios')
  }
  if (own.topicHash !== hash(incoming.topic)) differences.push('asunto')
  if (own.bodyHash !== hash(incoming.body)) differences.push('texto')
  if (own.relayRef !== incoming.relayRef) differences.push('ref')
  return differences
}

/**
 * What an import into tcg-pocket would do: the preview, and the same plan the apply runs inside its transaction. The
 * same id with the same content is «identical»; the same id with something else, a `relayRef` tcg-pocket has on another
 * id, a repeated id or ref, a room tcg-pocket does not have, or a time in the future, is a conflict, and the apply
 * changes nothing.
 */
export function planChatImport(
  data: ChatExportData,
  existing: ChatExistingState,
  options: { hash: (value: string) => string; now?: Date },
): ChatImportPlan {
  const now = options.now ?? new Date()
  const exported = new Set(data.rooms.map((room) => room.slug))
  const participantNotes: string[] = []
  const newParticipants: ChatImportPlan['newParticipants'] = []
  const joins: ChatImportPlan['joins'] = []
  const own = new Map(existing.participants.map((row) => [row.key, row]))
  const names = new Map(existing.participants.map((row) => [row.key, row.name]))
  const ownerKey = chatKey(CHAT_OWNER)
  for (const incoming of data.participants) {
    const k = chatKey(incoming.name)
    if (k !== incoming.key) {
      participantNotes.push(`«${incoming.name}» viene con la clave «${incoming.key}»: no se importa.`)
      continue
    }
    if (k === CHAT_EVERYONE) {
      participantNotes.push(`«${incoming.name}» no es una sesión: llega a todas. No se importa.`)
      continue
    }
    if (k === ownerKey || incoming.channel === 'owner') {
      if (k !== ownerKey) participantNotes.push(`«${incoming.name}» viene como dueño: solo ${CHAT_OWNER} lo es.`)
      continue
    }
    const rooms = incoming.rooms.filter((item) => exported.has(item.room)).sort((a, b) => a.position - b.position)
    const unknown = rooms.filter((item) => !knownRoom(item.room)).map((item) => `«${item.room}»`)
    if (unknown.length > 0) participantNotes.push(`«${incoming.name}»: tcg-pocket no tiene ${unknown.join(', ')}.`)
    const wanted = rooms.flatMap((item) => (knownRoom(item.room) ? [{ room: item.room, sinceId: item.sinceId }] : []))
    const mine = own.get(k)
    if (mine && mine.channel !== incoming.channel) {
      participantNotes.push(
        `«${incoming.name}» está en tcg-pocket como ${CHAT_CHANNEL_LABEL[mine.channel]} y viene como ${CHAT_CHANNEL_LABEL[incoming.channel]}: queda como está.`,
      )
      continue
    }
    names.set(k, mine?.name ?? incoming.name)
    if (!mine) {
      // In none of the rooms that come: created without rooms, it would land in «tcg» by default (roomsOf).
      if (wanted.length === 0) {
        participantNotes.push(`«${incoming.name}» no está en ninguna de las salas que vienen: no se importa.`)
        continue
      }
      newParticipants.push({ key: k, name: incoming.name, channel: incoming.channel, rooms: wanted })
      continue
    }
    for (const item of wanted) {
      const room = mine.rooms.find((r) => r.room === item.room)
      if (!room) joins.push({ key: k, channel: incoming.channel, room: item.room, sinceId: item.sinceId })
      else if (room.sinceId !== item.sinceId) {
        participantNotes.push(
          `«${mine.name}» empieza «${item.room}» en el mensaje ${room.sinceId} en tcg-pocket y en el ${item.sinceId} en ${data.source}: queda como está.`,
        )
      }
    }
  }

  const ownMessages = new Map(existing.messages.map((row) => [row.id, row]))
  const newMessages: ChatExportMessage[] = []
  const conflicts: ChatImportConflict[] = []
  const perRoom = new Map<string, ChatImportRoomSummary>()
  const summary = (room: string) => {
    let row = perRoom.get(room)
    if (!row) {
      row = { room, new: 0, identical: 0, conflicts: 0, old: 0, belowCursor: 0, ownMaxId: null }
      perRoom.set(room, row)
    }
    return row
  }
  const oldest = now.getTime() - CHAT_RETENTION_DAYS * DAY_MS
  const latest = now.getTime() + CHAT_FUTURE_TOLERANCE_MS
  const seenIds = new Set<number>()
  const taken = new Set<number>()
  const seenRefs = new Map<string, number>()
  let identical = 0
  let maxId = 0
  /** The highest id that will be in tcg-pocket: the sequence goes past it, not past a conflict or an old one. */
  let maxNewId = 0
  for (const message of data.messages) {
    maxId = Math.max(maxId, message.id)
    const room = summary(message.room)
    const conflict = (reason: string) => {
      conflicts.push({ id: message.id, room: message.room, reason })
      room.conflicts += 1
    }
    if (seenIds.has(message.id)) {
      conflict('el id viene dos veces en la exportación')
      continue
    }
    seenIds.add(message.id)
    if (!exported.has(message.room)) {
      conflict(`su sala «${message.room}» no viene en la exportación`)
      continue
    }
    if (!knownRoom(message.room)) {
      conflict(`tcg-pocket no tiene la sala «${message.room}»`)
      continue
    }
    if (message.relayRef !== null) {
      const other = seenRefs.get(message.relayRef)
      if (other !== undefined) {
        conflict(`su ref también lo tiene el mensaje ${other} de la exportación`)
        continue
      }
      seenRefs.set(message.relayRef, message.id)
    }
    if (message.id > CHAT_IMPORT_MAX_ID) {
      conflict(`su id pasa el más alto que se importa (${CHAT_IMPORT_MAX_ID})`)
      continue
    }
    const at = new Date(message.at).getTime()
    if (at > latest) {
      conflict(`su hora (${message.at}) está en el futuro`)
      continue
    }
    const mine = ownMessages.get(message.id)
    // The same id with another content is a conflict even when the message is past the retention: two histories.
    if (mine && at < oldest) {
      const differences = chatMessageDifferences(mine, message, options.hash)
      if (differences.length > 0) conflict(`tcg-pocket ya tiene ese id con otro contenido (${differences.join(', ')})`)
      else room.old += 1
      continue
    }
    if (at < oldest) {
      room.old += 1
      continue
    }
    if (mine) {
      const differences = chatMessageDifferences(mine, message, options.hash)
      if (differences.length === 0) {
        identical += 1
        room.identical += 1
        taken.add(message.id)
      } else conflict(`tcg-pocket ya tiene ese id con otro contenido (${differences.join(', ')})`)
      continue
    }
    const refOwner = message.relayRef === null ? undefined : existing.relayRefs.get(message.relayRef)
    if (refOwner !== undefined && refOwner !== message.id) {
      conflict(`tcg-pocket ya tiene su ref en el mensaje ${refOwner}`)
      continue
    }
    newMessages.push(message)
    room.new += 1
    taken.add(message.id)
    maxNewId = Math.max(maxNewId, message.id)
    const roomMax = existing.roomMaxIds.get(message.room)
    if (roomMax !== undefined && message.id < roomMax) {
      room.belowCursor += 1
      room.ownMaxId = roomMax
    }
  }

  // Ids of the hub's own above tcg-pocket's sequence: the way back. With only some rooms, tcg-pocket and the hub would
  // go on giving the same new ids (one in each room), and the next move would collide: all the rooms at once.
  const raises = maxNewId > 0 && maxNewId >= existing.nextId
  const missing = CHAT_ROOMS.filter((room) => !exported.has(room))
  if (raises && missing.length > 0) {
    conflicts.push({
      id: 0,
      room: missing.join(', '),
      reason: `volver atrás con ids del hub va con todas las salas a la vez (falta ${missing.map((room) => `«${room}»`).join(', ')}) y con el hub sin escribir: con una sola, los dos lados darían los mismos ids nuevos`,
    })
  }

  // A read counts when its message is (or will be) in tcg-pocket, and so is its participant (Santi always is), with
  // a time that is not ahead: a read of nobody would be a row of nobody (`session_chat_seen` has no foreign key).
  const present = new Set([
    ownerKey,
    ...existing.participants.map((row) => row.key),
    ...newParticipants.map((row) => row.key),
  ])
  const reads: ChatExportRead[] = []
  const nobody = new Map<string, number>()
  let ahead = 0
  for (const read of data.reads) {
    if (!taken.has(read.messageId)) continue
    if (!present.has(read.participant)) nobody.set(read.participant, (nobody.get(read.participant) ?? 0) + 1)
    else if (new Date(read.at).getTime() > latest) ahead += 1
    else reads.push(read)
  }
  const readNotes: string[] = []
  if (nobody.size > 0) {
    const n = [...nobody.values()].reduce((sum, value) => sum + value, 0)
    const who = [...nobody.keys()].slice(0, 5).map((k) => `«${k}»`)
    if (nobody.size > 5) who.push(`y ${nobody.size - 5} más`)
    readNotes.push(
      `${count(n, 'lectura', 'lecturas')} de quien tcg-pocket no tiene ni recibe (${who.join(', ')}): no ${n === 1 ? 'viene' : 'vienen'}.`,
    )
  }
  if (ahead > 0) {
    readNotes.push(
      `${count(ahead, 'lectura', 'lecturas')} con la hora en el futuro: no ${ahead === 1 ? 'viene' : 'vienen'}.`,
    )
  }

  return {
    source: data.source,
    newParticipants,
    joins,
    participantNotes,
    readNotes,
    newMessages,
    identical,
    conflicts,
    reads,
    perRoom: [...perRoom.values()].sort((a, b) => a.room.localeCompare(b.room)),
    maxId,
    nextIdAfter: raises ? maxNewId + 1 : null,
    names: Object.fromEntries(names),
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the summary is of: a preview, an apply, or an apply refused for its conflicts. */
export type ChatImportOutcome = 'preview' | 'applied' | 'refused'

const OUTCOME_HEADER: Record<ChatImportOutcome, string> = {
  preview: ' (vista previa: nada cambió; --aplicar lo aplica)',
  applied: ' (aplicado)',
  refused: ' (no se aplicó nada: hay conflictos)',
}

/** The preview, in Spanish, one line per thing. */
export function describeChatImport(plan: ChatImportPlan, outcome: ChatImportOutcome): string {
  const name = (k: string) => plan.names[k] ?? k
  const lines = [`Desde ${plan.source}${OUTCOME_HEADER[outcome]}:`]
  for (const room of plan.perRoom) {
    const parts = [
      count(room.new, 'nuevo', 'nuevos'),
      count(room.identical, 'idéntico', 'idénticos'),
      count(room.conflicts, 'conflicto', 'conflictos'),
    ]
    if (room.old > 0) parts.push(`${count(room.old, 'viejo', 'viejos')} (más de 90 días: no vienen)`)
    lines.push(`  «${room.room}»: ${parts.join(', ')}`)
  }
  if (plan.perRoom.length === 0) lines.push('  sin mensajes')
  for (const room of plan.perRoom) {
    if (room.belowCursor === 0) continue
    lines.push(
      `Aviso: ${count(room.belowCursor, 'mensaje nuevo', 'mensajes nuevos')} de «${room.room}» ${room.belowCursor === 1 ? 'queda' : 'quedan'} debajo del último id que tcg-pocket ya tiene en esa sala (${room.ownMaxId}): un puente que ya lee esa sala no ${room.belowCursor === 1 ? 'lo ve' : 'los ve'}.`,
    )
  }
  if (plan.newParticipants.length > 0) {
    lines.push(
      `Participantes nuevos: ${plan.newParticipants.map((p) => `${p.name} (${p.channel}; ${p.rooms.map((r) => `«${r.room}»`).join(', ')})`).join(', ')}`,
    )
  }
  if (plan.joins.length > 0)
    lines.push(`Entran a salas: ${plan.joins.map((j) => `${name(j.key)} → «${j.room}»`).join(', ')}`)
  for (const note of plan.participantNotes) lines.push(`Aviso: ${note}`)
  lines.push(`Lecturas: ${plan.reads.length} (las que ya están se saltean)`)
  for (const note of plan.readNotes) lines.push(`Aviso: ${note}`)
  if (plan.nextIdAfter !== null)
    lines.push(`La secuencia sube: los ids nuevos de tcg-pocket siguen desde ${plan.nextIdAfter}`)
  if (plan.conflicts.length > 0) {
    lines.push(`Conflictos (${plan.conflicts.length}; con alguno, --aplicar no cambia nada):`)
    for (const item of plan.conflicts.slice(0, 20)) {
      lines.push(item.id === 0 ? `  ${item.reason}` : `  ${item.id} en «${item.room}»: ${item.reason}`)
    }
    if (plan.conflicts.length > 20) lines.push(`  … y ${plan.conflicts.length - 20} más`)
  }
  return lines.join('\n')
}
