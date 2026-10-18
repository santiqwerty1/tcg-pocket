import { describe, expect, it } from 'vitest'
import {
  type ChatExistingMessage,
  type ChatExistingState,
  type ChatExportData,
  type ChatExportMessage,
  chatExportPageSchema,
  describeChatImport,
  planChatImport,
} from '../../src/mcp/chatTransfer.js'

/** The import into tcg-pocket (T1, the way back from the hub): new, identical and conflicts. */
describe('the plan of a chat import into tcg-pocket', () => {
  const NOW = new Date('2026-10-18T20:00:00.000Z')
  // A stand-in for md5: the plan only compares what it gets back.
  const hash = (value: string) => `h:${value}`
  const plan = (d: ChatExportData, e: ChatExistingState) => planChatImport(d, e, { hash, now: NOW })
  const message = (id: number, overrides: Partial<ChatExportMessage> = {}): ChatExportMessage => ({
    id,
    at: `2026-10-18T12:00:${String(id % 60).padStart(2, '0')}.000Z`,
    room: 'posta',
    fromName: 'Principal',
    fromKey: 'principal',
    toNames: ['Coordinador'],
    toKeys: ['coordinador'],
    topic: `Asunto ${id}`,
    body: `Texto ${id}`,
    via: 'puente-pc',
    relayRef: `pc-${id}`,
    ...overrides,
  })
  const asOwn = ({ topic, body, via: _via, ...m }: ChatExportMessage): ChatExistingMessage => ({
    ...m,
    at: new Date(m.at),
    topicHash: hash(topic),
    bodyHash: hash(body),
  })
  const data = (overrides: Partial<ChatExportData> = {}): ChatExportData => ({
    source: 'chat-hub',
    rooms: [
      { slug: 'posta', label: 'Posta' },
      { slug: 'tcg', label: 'tcg-pocket' },
    ],
    participants: [],
    messages: [message(1_000_001), message(1_000_002), message(1_000_003, { room: 'tcg' })],
    reads: [],
    ...overrides,
  })
  const infra = { key: 'infra', name: 'Infra', channel: 'relay' as const, rooms: [{ room: 'posta', sinceId: 0 }] }
  const empty = (overrides: Partial<ChatExistingState> = {}): ChatExistingState => ({
    participants: [infra],
    messages: [],
    relayRefs: new Map(),
    nextId: 20_001,
    roomMaxIds: new Map(),
    ...overrides,
  })

  it('the hub’s messages are new, keep their ids and raise the sequence past them', () => {
    const result = plan(data(), empty())
    expect(result.newMessages.map((m) => m.id)).toEqual([1_000_001, 1_000_002, 1_000_003])
    expect(result.conflicts).toEqual([])
    expect(result.nextIdAfter).toBe(1_000_004)
    expect(result.perRoom).toEqual([
      { room: 'posta', new: 2, identical: 0, conflicts: 0, old: 0, belowCursor: 0, ownMaxId: null },
      { room: 'tcg', new: 1, identical: 0, conflicts: 0, old: 0, belowCursor: 0, ownMaxId: null },
    ])
  })

  it('ids below the sequence do not move it', () => {
    expect(plan(data({ messages: [message(5)] }), empty()).nextIdAfter).toBeNull()
    expect(plan(data({ messages: [message(20_001)] }), empty()).nextIdAfter).toBe(20_002)
  })

  it('again: the same id with the same content is identical (the via does not count), and its reads still come', () => {
    const first = data({ reads: [{ participant: 'infra', messageId: 1_000_002, at: '2026-10-18T12:01:00.000Z' }] })
    const result = plan(
      first,
      empty({
        messages: first.messages.map((m) => asOwn({ ...m, via: 'otro' })),
        relayRefs: new Map(first.messages.map((m) => [m.relayRef as string, m.id])),
      }),
    )
    expect(result.newMessages).toEqual([])
    expect(result.identical).toBe(3)
    expect(result.conflicts).toEqual([])
    expect(result.reads.map((read) => read.messageId)).toEqual([1_000_002])
  })

  it('a read comes only of someone tcg-pocket has or gets (Santi always), and not ahead; the others are told', () => {
    const at = '2026-10-18T12:01:00.000Z'
    const result = plan(
      data({
        participants: [
          { key: 'nube', name: 'Nube', channel: 'connector', rooms: [{ room: 'posta', position: 0, sinceId: 0 }] },
        ],
        reads: [
          { participant: 'infra', messageId: 1_000_001, at },
          { participant: 'santi', messageId: 1_000_001, at },
          { participant: 'nube', messageId: 1_000_001, at },
          { participant: 'nadie', messageId: 1_000_001, at },
          { participant: 'nadie', messageId: 1_000_002, at },
          { participant: 'otro', messageId: 1_000_002, at },
          { participant: 'infra', messageId: 1_000_002, at: '2027-10-18T12:00:00.000Z' },
        ],
      }),
      empty(),
    )
    expect(result.reads.map((read) => `${read.participant}:${read.messageId}`)).toEqual([
      'infra:1000001',
      'santi:1000001',
      'nube:1000001',
    ])
    expect(result.readNotes).toEqual([
      '3 lecturas de quien tcg-pocket no tiene ni recibe («nadie», «otro»): no vienen.',
      '1 lectura con la hora en el futuro: no viene.',
    ])
    const text = describeChatImport(result, 'preview')
    expect(text).toContain('Aviso: 1 lectura con la hora en el futuro: no viene.')
    // Five names at most.
    const many = plan(
      data({ reads: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => ({ participant: k, messageId: 1_000_001, at })) }),
      empty(),
    )
    expect(many.readNotes).toEqual([
      '7 lecturas de quien tcg-pocket no tiene ni recibe («a», «b», «c», «d», «e», y 2 más): no vienen.',
    ])
  })

  it('an export that goes on after the cap says where, in the plan and in the preview', () => {
    expect(plan(data(), empty()).continueAfter).toBeNull()
    const part = plan(data({ continueAfter: 1_000_003 }), empty())
    expect(part.continueAfter).toBe(1_000_003)
    expect(describeChatImport(part, 'preview')).toContain(
      'Aviso: la exportación sigue después del mensaje 1000003 (llegó al tope de caracteres): esto es hasta ahí, y el resto se trae con --despues 1000003.',
    )
  })

  it('the way back with only some rooms is a conflict: both sides would give the same new ids', () => {
    const result = plan(data({ rooms: [{ slug: 'posta', label: 'Posta' }], messages: [message(1_000_001)] }), empty())
    expect(result.conflicts).toEqual([
      {
        id: 0,
        room: 'tcg',
        reason:
          'volver atrás con ids del hub va con todas las salas a la vez (falta «tcg») y con el hub sin escribir: con una sola, los dos lados darían los mismos ids nuevos',
      },
    ])
    expect(describeChatImport(result, 'refused')).toContain('(no se aplicó nada: hay conflictos)')
    // Ids below tcg-pocket's sequence do not raise it: one room alone is fine.
    expect(
      plan(data({ rooms: [{ slug: 'posta', label: 'Posta' }], messages: [message(7)] }), empty()).conflicts,
    ).toEqual([])
  })

  it('the sequence goes past what will be in tcg-pocket, not past a conflict or an old message', () => {
    const conflictOnly = plan(
      data({ messages: [message(1_000_005)] }),
      empty({ messages: [asOwn(message(1_000_005, { body: 'otro' }))] }),
    )
    expect(conflictOnly.nextIdAfter).toBeNull()
    // A new message below the sequence and a conflict above it: the conflict does not raise it.
    const mixed = plan(
      data({ messages: [message(5), message(1_000_005)] }),
      empty({ messages: [asOwn(message(1_000_005, { body: 'otro' }))] }),
    )
    expect(mixed.newMessages.map((m) => m.id)).toEqual([5])
    expect(mixed.nextIdAfter).toBeNull()
    expect(
      plan(data({ messages: [message(1_000_009, { at: '2026-07-01T00:00:00.000Z' })] }), empty()).nextIdAfter,
    ).toBeNull()
  })

  it('warns about new messages below the highest id tcg-pocket has in their room (a bridge past them never sees them)', () => {
    const result = plan(data({ messages: [message(5)] }), empty({ roomMaxIds: new Map([['posta', 19_000]]) }))
    expect(result.perRoom).toEqual([
      { room: 'posta', new: 1, identical: 0, conflicts: 0, old: 0, belowCursor: 1, ownMaxId: 19_000 },
    ])
    expect(describeChatImport(result, 'preview')).toContain(
      'Aviso: 1 mensaje nuevo de «posta» queda debajo del último id que tcg-pocket ya tiene en esa sala (19000): un puente que ya lee esa sala no lo ve.',
    )
  })

  it('a new participant in none of the rooms that come is not created (it would land in «tcg»)', () => {
    const result = plan(
      data({ participants: [{ key: 'solo-hub', name: 'Solo-Hub', channel: 'connector', rooms: [] }] }),
      empty(),
    )
    expect(result.newParticipants).toEqual([])
    expect(result.participantNotes).toEqual(['«Solo-Hub» no está en ninguna de las salas que vienen: no se importa.'])
  })

  it('every field that differs is a conflict, and a ref tcg-pocket has on another id', () => {
    const base = message(1)
    for (const [change, word] of [
      [{ at: '2026-10-18T13:00:00.000Z' }, 'hora'],
      [{ room: 'tcg' }, 'sala'],
      [{ fromName: 'PRINCIPAL' }, 'remitente'],
      [{ fromKey: 'otro' }, 'remitente'],
      [{ toNames: ['COORDINADOR'] }, 'destinatarios'],
      [{ toKeys: ['todos'] }, 'destinatarios'],
      [{ topic: 'otro' }, 'asunto'],
      [{ body: 'otro' }, 'texto'],
      [{ relayRef: null }, 'ref'],
    ] as [Partial<ChatExportMessage>, string][]) {
      const result = plan(data({ messages: [base] }), empty({ messages: [asOwn({ ...base, ...change })] }))
      expect(result.conflicts[0]?.reason, word).toContain(word)
    }
    const ref = plan(data({ messages: [message(2)] }), empty({ relayRefs: new Map([['pc-2', 7]]) }))
    expect(ref.conflicts).toEqual([{ id: 2, room: 'posta', reason: 'tcg-pocket ya tiene su ref en el mensaje 7' }])
  })

  it('a room tcg-pocket does not have, a room the export does not bring, a repeated id or ref: conflicts', () => {
    const result = plan(
      data({
        rooms: [
          { slug: 'posta', label: 'Posta' },
          { slug: 'otra', label: 'Otra' },
        ],
        messages: [
          message(1, { room: 'otra' }),
          message(2, { room: 'tcg' }),
          message(3),
          message(3),
          message(4, { relayRef: 'pc-3' }),
        ],
      }),
      empty(),
    )
    expect(result.conflicts.map((c) => [c.id, c.reason])).toEqual([
      [1, 'tcg-pocket no tiene la sala «otra»'],
      [2, 'su sala «tcg» no viene en la exportación'],
      [3, 'el id viene dos veces en la exportación'],
      [4, 'su ref también lo tiene el mensaje 3 de la exportación'],
    ])
  })

  it('an id past the highest an import takes is a conflict', () => {
    const result = plan(data({ messages: [message(2_000_000_000)] }), empty())
    expect(result.conflicts).toEqual([
      { id: 2_000_000_000, room: 'posta', reason: 'su id pasa el más alto que se importa (1999999999)' },
    ])
    expect(result.nextIdAfter).toBeNull()
  })

  it('an old message is still compared: the same id with another content is a conflict, not «viejo»', () => {
    const old = message(1, { at: '2026-07-01T00:00:00.000Z' })
    const result = plan(data({ messages: [old] }), empty({ messages: [asOwn({ ...old, body: 'otro texto' })] }))
    expect(result.conflicts).toEqual([
      { id: 1, room: 'posta', reason: 'tcg-pocket ya tiene ese id con otro contenido (texto)' },
    ])
    const same = plan(data({ messages: [old] }), empty({ messages: [asOwn(old)] }))
    expect(same.conflicts).toEqual([])
    expect(same.perRoom[0]?.old).toBe(1)
  })

  it('a time in the future is a conflict; past the retention does not come, nor its reads', () => {
    const result = plan(
      data({
        messages: [
          message(1, { at: '2026-10-18T20:10:00.000Z' }),
          message(2, { at: '2026-07-01T00:00:00.000Z' }),
          message(3),
        ],
        reads: [
          { participant: 'infra', messageId: 2, at: '2026-07-01T00:01:00.000Z' },
          { participant: 'infra', messageId: 3, at: '2026-10-18T12:01:00.000Z' },
          { participant: 'infra', messageId: 1, at: '2026-10-18T12:01:00.000Z' },
        ],
      }),
      empty(),
    )
    expect(result.conflicts.map((c) => c.id)).toEqual([1])
    expect(result.newMessages.map((m) => m.id)).toEqual([3])
    expect(result.perRoom).toEqual([
      { room: 'posta', new: 1, identical: 0, conflicts: 1, old: 1, belowCursor: 0, ownMaxId: null },
    ])
    expect(result.reads.map((r) => r.messageId)).toEqual([3])
  })

  it('participants: new ones with the rooms tcg-pocket has; Santi, «todos» or another owner never; another channel only told', () => {
    const result = plan(
      data({
        participants: [
          { key: 'santi', name: 'Santi', channel: 'owner', rooms: [{ room: 'posta', position: 0, sinceId: 0 }] },
          { key: 'jefe', name: 'Jefe', channel: 'owner', rooms: [{ room: 'posta', position: 0, sinceId: 0 }] },
          { key: 'todos', name: 'todos', channel: 'relay', rooms: [{ room: 'posta', position: 0, sinceId: 0 }] },
          {
            key: 'nube-hub',
            name: 'Nube-Hub',
            channel: 'connector',
            rooms: [
              { room: 'tcg', position: 1, sinceId: 1_000_100 },
              { room: 'posta', position: 0, sinceId: 1_000_050 },
              { room: 'otra', position: 2, sinceId: 0 },
            ],
          },
          { key: 'infra', name: 'Infra', channel: 'connector', rooms: [{ room: 'posta', position: 0, sinceId: 0 }] },
          { key: 'mal', name: 'Otro', channel: 'relay', rooms: [] },
        ],
      }),
      empty({
        participants: [{ key: 'infra', name: 'Infra', channel: 'relay', rooms: [{ room: 'tcg', sinceId: 0 }] }],
      }),
    )
    expect(result.newParticipants).toEqual([
      {
        key: 'nube-hub',
        name: 'Nube-Hub',
        channel: 'connector',
        rooms: [
          { room: 'posta', sinceId: 1_000_050 },
          { room: 'tcg', sinceId: 1_000_100 },
        ],
      },
    ])
    expect(result.participantNotes).toEqual([
      '«Jefe» viene como dueño: solo Santi lo es.',
      '«todos» no es una sesión: llega a todas. No se importa.',
      '«Infra» está en tcg-pocket como Sesión de la PC (puente) y viene como Sesión en la nube (conector): queda como está.',
      '«Otro» viene con la clave «mal»: no se importa.',
    ])
  })

  it('a participant tcg-pocket has joins the rooms it lacks; one it has keeps its start, and a difference is told', () => {
    const result = plan(
      data({
        participants: [
          {
            key: 'principal',
            name: 'Principal',
            channel: 'relay',
            rooms: [
              { room: 'tcg', position: 0, sinceId: 18_000 },
              { room: 'posta', position: 1, sinceId: 19_000 },
            ],
          },
        ],
      }),
      empty({
        participants: [
          { key: 'principal', name: 'Principal', channel: 'relay', rooms: [{ room: 'tcg', sinceId: 17_000 }] },
        ],
      }),
    )
    expect(result.newParticipants).toEqual([])
    expect(result.joins).toEqual([{ key: 'principal', channel: 'relay', room: 'posta', sinceId: 19_000 }])
    expect(result.participantNotes).toEqual([
      '«Principal» empieza «tcg» en el mensaje 17000 en tcg-pocket y en el 18000 en chat-hub: queda como está.',
    ])
  })

  it('a room outside CHAT_ROOMS in a participant is told', () => {
    const result = plan(
      data({
        rooms: [
          { slug: 'posta', label: 'Posta' },
          { slug: 'otra', label: 'Otra' },
        ],
        messages: [],
        participants: [
          {
            key: 'nube-hub',
            name: 'Nube-Hub',
            channel: 'connector',
            rooms: [
              { room: 'otra', position: 0, sinceId: 0 },
              { room: 'posta', position: 1, sinceId: 3 },
            ],
          },
        ],
      }),
      empty(),
    )
    expect(result.participantNotes).toEqual(['«Nube-Hub»: tcg-pocket no tiene «otra».'])
    expect(result.newParticipants[0]?.rooms).toEqual([{ room: 'posta', sinceId: 3 }])
  })

  it('says it in Spanish, in singular and plural', () => {
    const text = describeChatImport(plan(data(), empty()), 'preview')
    expect(text).toContain('Desde chat-hub (vista previa: nada cambió; --aplicar lo aplica):')
    expect(text).toMatch(/«posta»: 2 nuevos, 0 idénticos, 0 conflictos$/m)
    expect(text).toMatch(/«tcg»: 1 nuevo, 0 idénticos, 0 conflictos$/m)
    expect(text).toContain('La secuencia sube: los ids nuevos de tcg-pocket siguen desde 1000004')
    const one = describeChatImport(
      plan(data({ messages: [message(1)] }), empty({ messages: [asOwn(message(1, { body: 'x' }))] })),
      'applied',
    )
    expect(one).toMatch(/1 conflicto$/m)
    expect(one).toContain('(aplicado)')
  })

  it('the page schema: names by the list’s rule, storable texts, rooms once, any id of SERIAL', () => {
    const page = {
      format: 'chat-export',
      version: 1,
      source: 'chat-hub',
      exportedAt: '2026-10-18T20:00:00.000Z',
      rooms: [{ slug: 'posta', label: 'Posta' }],
      participants: [],
      messages: [message(1)],
      reads: [],
      next: null,
    }
    expect(chatExportPageSchema.safeParse(page).success).toBe(true)
    expect(chatExportPageSchema.safeParse({ ...page, version: 2 }).success).toBe(false)
    // The source is printed in the preview: no control characters (an ANSI escape would rewrite the terminal).
    expect(chatExportPageSchema.safeParse({ ...page, source: 'hub\u001b[2J' }).success).toBe(false)
    // An export may carry any id its side has; the plan is what refuses an id too high to import.
    expect(chatExportPageSchema.safeParse({ ...page, messages: [message(2_100_000_000)] }).success).toBe(true)
    expect(chatExportPageSchema.safeParse({ ...page, messages: [message(2_147_483_648)] }).success).toBe(false)
    expect(chatExportPageSchema.safeParse({ ...page, messages: [message(1, { body: 'a\u0000b' })] }).success).toBe(
      false,
    )
    const lookAlike = { key: 'sаnti', name: 'Sаnti', channel: 'relay', rooms: [] }
    expect(chatExportPageSchema.safeParse({ ...page, participants: [lookAlike] }).success).toBe(false)
    const twice = {
      key: 'x',
      name: 'X',
      channel: 'relay',
      rooms: [
        { room: 'posta', position: 0, sinceId: 0 },
        { room: 'posta', position: 1, sinceId: 0 },
      ],
    }
    expect(chatExportPageSchema.safeParse({ ...page, participants: [twice] }).success).toBe(false)
    const bad = (change: Record<string, unknown>) => chatExportPageSchema.safeParse({ ...page, ...change }).success
    expect(
      bad({
        rooms: [
          { slug: 'posta', label: 'a' },
          { slug: ' posta', label: 'b' },
        ],
      }),
    ).toBe(false)
    expect(
      bad({
        participants: [
          { key: 'principal', name: 'Principal', channel: 'relay', rooms: [] },
          { key: 'principal-2', name: 'PRINCIPAL', channel: 'relay', rooms: [] },
        ],
      }),
    ).toBe(false)
    expect(
      bad({
        participants: [
          { key: 'principal', name: 'Principal', channel: 'relay', rooms: [] },
          { key: 'principal', name: 'Infra', channel: 'relay', rooms: [] },
        ],
      }),
    ).toBe(false)
    expect(bad({ messages: [message(1, { fromKey: 'otro' })] })).toBe(false)
    expect(bad({ messages: [message(1, { toKeys: ['otro'] })] })).toBe(false)
    expect(bad({ messages: [message(1, { toNames: ['Coordinador', 'Infra'], toKeys: ['coordinador'] })] })).toBe(false)
    expect(bad({ messages: [message(1, { fromName: 'Prin\u0007cipal', fromKey: 'prin\u0007cipal' })] })).toBe(false)
    expect(bad({ rooms: [{ slug: 'posta', label: 'x'.repeat(81) }] })).toBe(false)
    expect(bad({ messages: [message(1, { toNames: ['todos'], toKeys: ['todos'] })] })).toBe(true)
  })
})
