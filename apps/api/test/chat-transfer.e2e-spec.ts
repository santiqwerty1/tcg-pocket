import type { AddressInfo } from 'node:net'
import { ServiceUnavailableException } from '@nestjs/common'
import type { ChatExportMessage, ChatExportPage } from '@tcg/domain'
import { ChatService, WRITE_LOCK_WAIT_MS } from '../src/chat/chat.service.js'
import { ChatImportError, ChatTransferService } from '../src/chat/chat-transfer.service.js'
import type { Prisma } from '../src/generated/prisma/client.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * The move of the chat to the hub (D-030, T1a): the export the hub imports (only with a `chat:export` token, alone),
 * and the import of the hub's export, the way back.
 */
describe('the chat’s move to the hub (e2e)', () => {
  let test: TestApp
  let cookie: string
  let base: string
  let prisma: PrismaService
  let chat: ChatService
  let transfer: ChatTransferService
  let exportToken: string
  let relayToken: string
  let readToken: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const post = (path: string) => test.http().post(path).set('Cookie', cookie)
    exportToken = (await post('/api/tokens').send({ name: 'exportar', kind: 'mcp', scopes: ['chat:export'] })).body
      .token
    relayToken = (await post('/api/tokens').send({ name: 'puente', kind: 'mcp', scopes: ['chat:relay'] })).body.token
    readToken = (await post('/api/tokens').send({ name: 'lectura', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] }))
      .body.token
    // Names of this file only: the e2e database is truncated once per run, and chat.e2e has its own list.
    for (const participant of [
      { name: 'Mudanza-Nube', channel: 'connector', rooms: ['posta', 'tcg'] },
      { name: 'Mudanza-PC', channel: 'relay', rooms: ['tcg', 'posta'] },
      { name: 'Mudanza-Solo', channel: 'relay', rooms: ['tcg'] },
    ]) {
      await test.http().put('/api/chat/participants').set('Cookie', cookie).send(participant).expect(200)
    }
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    prisma = test.app.get(PrismaService)
    chat = test.app.get(ChatService)
    transfer = test.app.get(ChatTransferService)
  })

  const cleanUp = async () => {
    await prisma.sessionChatSeen.deleteMany()
    await prisma.sessionChatMessage.deleteMany()
    await prisma.sessionChatParticipant.deleteMany({ where: { key: { in: ['nube-hub'] } } })
  }

  afterAll(async () => {
    // Nothing of this file stays for the next one.
    await cleanUp()
    await prisma.sessionChatParticipant.deleteMany({ where: { key: { startsWith: 'mudanza-' } } })
    await test.close()
  })

  beforeEach(cleanUp)

  const write = async (input: { from: string; to: string; topic: string; room: 'tcg' | 'posta'; ref?: string }) =>
    (await chat.write({ text: 'x', via: 'prueba', tokenId: null, caller: 'relay', ...input })).message

  describe('the chat:export scope', () => {
    it('goes alone, and no token gets it unless chosen: the default scopes do not have it', async () => {
      const mixed = await test
        .http()
        .post('/api/tokens')
        .set('Cookie', cookie)
        .send({ name: 'mezcla', kind: 'mcp', scopes: ['mcp:read', 'chat:export'] })
      expect(mixed.status).toBe(400)
      expect(mixed.body.error.message).toContain('chat:export va solo')
      const listed = await test.http().get('/api/tokens').set('Cookie', cookie)
      const withExport = (listed.body.items as { name: string; scopes: string[] }[]).filter((t) =>
        t.scopes.includes('chat:export'),
      )
      expect(withExport.map((t) => t.name)).toEqual(['exportar'])
    })
  })

  describe('GET /api/mcp/chat/export', () => {
    const get = (path: string, token?: string) =>
      fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

    it('only with the chat:export token: without a token 401, with the bridge’s or the connector’s 403', async () => {
      expect((await get('/api/mcp/chat/export')).status).toBe(401)
      expect((await get('/api/mcp/chat/export', relayToken)).status).toBe(403)
      expect((await get('/api/mcp/chat/export', readToken)).status).toBe(403)
      // The export token does nothing else: neither the bridge nor the MCP.
      expect((await get('/api/mcp/chat', exportToken)).status).toBe(403)
      const mcp = await fetch(`${base}/api/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${exportToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })
      expect(mcp.status).toBe(403)
      expect((await get('/api/mcp/chat/export', exportToken)).status).toBe(200)
    })

    it('in pages by id, only rooms of CHAT_ROOMS, with the participants (Santi aside) and the reads of each page', async () => {
      const first = await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Uno', room: 'tcg' })
      const second = await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Dos', room: 'posta' })
      const third = await write({ from: 'Mudanza-PC', to: 'todos', topic: 'Tres', room: 'tcg' })
      await chat.read({ as: 'Mudanza-Nube', room: 'tcg' })
      const page = async (query: string) =>
        (await (await get(`/api/mcp/chat/export${query}`, exportToken)).json()) as ChatExportPage
      const one = await page('?limit=2')
      expect(one).toMatchObject({ format: 'chat-export', version: 1, source: 'tcg-pocket', next: second.id })
      expect(one.messages.map((m) => m.id)).toEqual([first.id, second.id])
      expect(one.rooms).toEqual([
        { slug: 'tcg', label: 'tcg-pocket' },
        { slug: 'posta', label: 'Posta' },
      ])
      expect(one.participants.some((p) => p.key === 'santi')).toBe(false)
      expect(one.participants.find((p) => p.key === 'mudanza-nube')?.rooms.map((r) => [r.room, r.position])).toEqual([
        ['posta', 0],
        ['tcg', 1],
      ])
      expect(one.reads).toEqual([expect.objectContaining({ participant: 'mudanza-nube', messageId: first.id })])
      const two = await page(`?limit=2&after=${second.id}`)
      expect(two.messages.map((m) => m.id)).toEqual([third.id])
      expect(two.next).toBeNull()
      const posta = await page('?salas=posta')
      expect(posta.messages.map((m) => m.room)).toEqual(['posta'])
      expect(posta.participants.every((p) => p.rooms.every((r) => r.room === 'posta'))).toBe(true)
      expect((await get('/api/mcp/chat/export?salas=otra', exportToken)).status).toBe(400)
      expect((await get('/api/mcp/chat/export?limit=2001', exportToken)).status).toBe(400)
    })

    it('what it gives is what the import reads: tcg-pocket against itself is all identical', async () => {
      await write({ from: 'Mudanza-PC', to: 'Mudanza-Solo', topic: 'Uno', room: 'tcg', ref: 'r1' })
      await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Dos', room: 'posta' })
      const plan = await transfer.preview(
        await transfer.fetchExport({ url: `${base}/api/mcp/chat/export`, token: exportToken }),
      )
      expect(plan.conflicts).toEqual([])
      expect(plan.identical).toBe(2)
      expect(plan.newMessages).toEqual([])
      expect(plan.newParticipants).toEqual([])
      expect(plan.joins).toEqual([])
    })
  })

  describe('the import of the hub’s export (the way back)', () => {
    // A day ago, fixed once: the same message built twice is the same message.
    const base = Date.now() - 86_400_000
    const message = (id: number, overrides: Partial<ChatExportMessage> = {}): ChatExportMessage => ({
      id,
      at: new Date(base + (id % 1_000_000)).toISOString(),
      room: 'posta',
      fromName: 'Mudanza-PC',
      fromKey: 'mudanza-pc',
      toNames: ['Mudanza-Nube'],
      toKeys: ['mudanza-nube'],
      topic: `Asunto ${id}`,
      body: `Texto ${id}`,
      via: 'puente-hub',
      relayRef: `hub-${id}`,
      ...overrides,
    })
    const hubPages = (messages: ChatExportMessage[], size: number, reads: ChatExportPage['reads'] = []) => {
      const out: ChatExportPage[] = []
      for (let start = 0; start < messages.length || out.length === 0; start += size) {
        const part = messages.slice(start, start + size)
        out.push({
          format: 'chat-export',
          version: 1,
          source: 'chat-hub',
          exportedAt: new Date().toISOString(),
          // The way back brings every room at once (with only some, both sides would give the same new ids).
          rooms: [
            { slug: 'tcg', label: 'tcg-pocket' },
            { slug: 'posta', label: 'Posta' },
          ],
          participants: [
            {
              key: 'nube-hub',
              name: 'Nube-Hub',
              channel: 'connector',
              rooms: [{ room: 'posta', position: 0, sinceId: 1_000_000 }],
            },
            {
              key: 'mudanza-solo',
              name: 'Mudanza-Solo',
              channel: 'relay',
              rooms: [
                { room: 'tcg', position: 0, sinceId: 0 },
                { room: 'posta', position: 1, sinceId: 0 },
              ],
            },
          ],
          messages: part,
          reads: reads.filter((read) => part.some((m) => m.id === read.messageId)),
          next: start + size < messages.length ? (part.at(-1)?.id ?? null) : null,
        })
      }
      return out
    }
    const serve = (all: ChatExportPage[]) =>
      (async (url: URL | string) => {
        const after = Number(new URL(url).searchParams.get('after') ?? 0)
        const page = all.find((_item, index) => (index === 0 ? after === 0 : all[index - 1]?.next === after))
        return new Response(JSON.stringify(page ?? all[0]), { status: 200 })
      }) as typeof fetch
    const fetchFrom = (all: ChatExportPage[]) =>
      transfer.fetchExport({ url: 'https://hub.example.test/api/export', token: 't', fetchImpl: serve(all) })

    it('without --aplicar writes nothing; with it, the hub’s ids, participants and reads, and the sequence goes up', async () => {
      const own = await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Propio', room: 'posta' })
      const reads = [
        { participant: 'mudanza-nube', messageId: 1_000_002, at: new Date(Date.now() - 1_000).toISOString() },
      ]
      const data = await fetchFrom(hubPages([message(1_000_001), message(1_000_002)], 1, reads))
      const preview = await transfer.preview(data)
      expect(preview.newMessages.map((m) => m.id)).toEqual([1_000_001, 1_000_002])
      expect(await prisma.sessionChatMessage.count()).toBe(1)
      expect(await prisma.sessionChatParticipant.count({ where: { key: 'nube-hub' } })).toBe(0)

      const applied = await transfer.apply(data)
      expect(applied.nextIdAfter).toBe(1_000_003)
      const rows = await prisma.sessionChatMessage.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, relayRef: true },
      })
      expect(rows).toEqual([
        { id: own.id, relayRef: null },
        { id: 1_000_001, relayRef: 'hub-1000001' },
        { id: 1_000_002, relayRef: 'hub-1000002' },
      ])
      expect(await prisma.sessionChatSeen.count({ where: { messageId: 1_000_002 } })).toBe(1)
      const hubSession = await prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key: 'nube-hub' } })
      expect(hubSession).toMatchObject({
        channel: 'connector',
        rooms: ['posta'],
        sinceId: 0,
        roomSince: { posta: 1_000_000 },
      })
      // Mudanza-Solo was in «tcg» only: it joins «posta», last, from where it started in the hub.
      const solo = await prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key: 'mudanza-solo' } })
      expect(solo.rooms).toEqual(['tcg', 'posta'])
      expect(solo.roomSince).toMatchObject({ posta: 0 })
      // tcg-pocket's next message comes after everything: a bridge with the hub's cursor still sees it.
      const next = await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Después', room: 'posta' })
      expect(next.id).toBe(1_000_003)

      const again = await transfer.apply(data)
      expect(again.newMessages).toEqual([])
      expect(again.identical).toBe(2)
      expect(await prisma.sessionChatMessage.count()).toBe(4)
    })

    it('with a conflict, nothing is imported and the error says why', async () => {
      await transfer.apply(await fetchFrom(hubPages([message(1_000_001)], 10)))
      const changed = await fetchFrom(hubPages([message(1_000_001, { body: 'otro' }), message(1_000_002)], 10))
      const error = await transfer.apply(changed).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ChatImportError)
      expect((error as Error).message).toContain('(no se aplicó nada: hay conflictos)')
      expect((error as Error).message).toContain(
        '1000001 en «posta»: tcg-pocket ya tiene ese id con otro contenido (texto)',
      )
      expect((error as Error).message).toContain('Hay 1 conflicto: no se aplicó nada.')
      expect(await prisma.sessionChatMessage.findMany({ select: { id: true, body: true } })).toEqual([
        { id: 1_000_001, body: 'Texto 1000001' },
      ])
    })

    it('a room the source brings that was not asked for, or a page past its cap, is refused', async () => {
      const both = hubPages([message(1_000_001)], 10)
      await expect(
        transfer.fetchExport({ url: 'https://x.test/e', token: 't', rooms: ['posta'], fetchImpl: serve(both) }),
      ).rejects.toThrow('trajo la sala «tcg», que no se pidió')
      await expect(
        transfer.fetchExport({ url: 'https://x.test/e', token: 't', maxPageChars: 100, fetchImpl: serve(both) }),
      ).rejects.toThrow('pasa los 100 caracteres')
    })

    it('the rooms of every page come, and the participants are the latest page’s (one deleted meanwhile does not come back)', async () => {
      const all = hubPages([message(1_000_001), message(1_000_002)], 1)
      all[1] = {
        ...all[1],
        participants: [
          // Mudanza-Solo was deleted in the hub between the two pages.
          ...(all[1]?.participants ?? []).filter((participant) => participant.key !== 'mudanza-solo'),
          {
            key: 'nube-tarde',
            name: 'Nube-Tarde',
            channel: 'connector',
            rooms: [{ room: 'posta', position: 0, sinceId: 1 }],
          },
        ],
      } as ChatExportPage
      const data = await fetchFrom(all)
      expect(data.participants.map((p) => p.key)).toEqual(['nube-hub', 'nube-tarde'])
    })

    it('a page past its cap is refused while it streams; an export past its total comes up to it, with where to go on', async () => {
      const body = JSON.stringify(hubPages([message(1_000_001)], 10)[0])
      // Chunked, without Content-Length: the cap is checked while reading.
      const streamed = (async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const bytes = new TextEncoder().encode(body)
              for (let at = 0; at < bytes.length; at += 64) controller.enqueue(bytes.slice(at, at + 64))
              controller.close()
            },
          }),
          { status: 200 },
        )) as typeof fetch
      await expect(
        transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: streamed, maxPageChars: 100 }),
      ).rejects.toThrow('pasa los 100 caracteres')
      const two = hubPages([message(1_000_001), message(1_000_002)], 1)
      // One page fits, the second goes past the total: the first is what comes, and the rest from its last id.
      const cap = JSON.stringify(two[0]).length + 10
      const first = await transfer.fetchExport({
        url: 'https://x.test/e',
        token: 't',
        maxExportChars: cap,
        fetchImpl: serve(two),
      })
      expect(first.messages.map((m) => m.id)).toEqual([1_000_001])
      expect(first.continueAfter).toBe(1_000_001)
      const applied = await transfer.apply(first)
      expect(applied.newMessages.map((m) => m.id)).toEqual([1_000_001])
      expect(applied.continueAfter).toBe(1_000_001)
      const rest = await transfer.fetchExport({
        url: 'https://x.test/e',
        token: 't',
        after: 1_000_001,
        maxExportChars: cap,
        fetchImpl: serve(two),
      })
      expect(rest.messages.map((m) => m.id)).toEqual([1_000_002])
      expect(rest.continueAfter).toBeUndefined()
      expect((await transfer.apply(rest)).newMessages.map((m) => m.id)).toEqual([1_000_002])
      // A first page past the total alone cannot be split by id: refused.
      await expect(
        transfer.fetchExport({ url: 'https://x.test/e', token: 't', maxExportChars: 10, fetchImpl: serve(two) }),
      ).rejects.toThrow('Una sola página de la exportación pasa los 10 caracteres en total')
    })

    it('a page reads only up to what is left of the total: an endless second page stops there (the Coordinator on chat-hub#11)', async () => {
      const two = hubPages([message(1_000_001), message(1_000_002)], 1)
      let pulled = 0
      const firstThenEndless = (async (url: URL | string) => {
        if (Number(new URL(url).searchParams.get('after') ?? 0) === 0) {
          return new Response(JSON.stringify(two[0]), { status: 200 })
        }
        return new Response(
          new ReadableStream({
            pull(controller) {
              pulled += 1
              controller.enqueue(new TextEncoder().encode('x'.repeat(100)))
            },
          }),
          { status: 200 },
        )
      }) as typeof fetch
      const data = await transfer.fetchExport({
        url: 'https://x.test/e',
        token: 't',
        maxExportChars: JSON.stringify(two[0]).length + 1_000,
        fetchImpl: firstThenEndless,
      })
      expect(data.messages.map((m) => m.id)).toEqual([1_000_001])
      expect(data.continueAfter).toBe(1_000_001)
      // About 1,000 characters of the second page, not its page cap of 25 million.
      expect(pulled).toBeLessThan(50)
    })

    it('asks for pages of 100 (ordinary text fits its cap), and an endless error answer is not read whole', async () => {
      const asked: string[] = []
      const all = hubPages([message(1_000_001), message(1_000_002)], 1)
      const recording = (async (url: URL | string) => {
        asked.push(new URL(url).searchParams.get('limit') ?? '')
        return serve(all)(url)
      }) as typeof fetch
      await transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: recording })
      expect(asked).toEqual(['100', '100'])
      let pulled = 0
      const endless = (async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulled += 1
              controller.enqueue(new TextEncoder().encode('x'.repeat(100)))
            },
          }),
          { status: 500 },
        )) as typeof fetch
      const error = await transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: endless }).then(
        () => null,
        (caught: unknown) => caught as Error,
      )
      expect(error?.message).toBe(`La exportación contestó 500: ${'x'.repeat(300)}`)
      // It stopped after the first characters, not at the end of an endless body.
      expect(pulled).toBeLessThan(10)
    })

    /**
     * Holds what an import or Santi holds, from another connection, until `release`: `lock` runs inside that
     * transaction (an advisory lock, a row locked or changed).
     */
    const hold = async (lock: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      let release = () => {}
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let held = () => {}
      const holding = new Promise<void>((resolve) => {
        held = resolve
      })
      const done = prisma.$transaction(
        async (tx) => {
          await lock(tx)
          held()
          await released
        },
        { timeout: 60_000 },
      )
      await holding
      return async () => {
        release()
        await done
      }
    }
    /** Whether `promise` is still waiting after `ms`. */
    const stillWaiting = async (promise: Promise<unknown>, ms: number) => {
      let settled = false
      promise.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await new Promise((resolve) => setTimeout(resolve, ms))
      return !settled
    }
    const WRITE_LOCK = 20_261_009

    it('a chat write waits for an import that holds the lock past Prisma’s 5 s, and past its wait answers 503', async () => {
      const release = await hold((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`)
      const waiting = write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Durante', room: 'posta' })
      expect(await stillWaiting(waiting, 6_000)).toBe(true)
      await release()
      expect((await waiting).topic).toBe('Durante')

      chat.writeLockWaitMs = 300
      try {
        const releaseAgain = await hold((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`)
        const busy = await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Ocupado', room: 'posta' }).catch(
          (caught: unknown) => caught,
        )
        await releaseAgain()
        expect(busy).toBeInstanceOf(ServiceUnavailableException)
        expect((busy as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'chat_busy' })
      } finally {
        chat.writeLockWaitMs = WRITE_LOCK_WAIT_MS
      }
      expect(await prisma.sessionChatMessage.count({ where: { topic: 'Ocupado' } })).toBe(0)
    }, 30_000)

    it('the lock wait stays in its transaction: no connection of the pool keeps it (set_config with true)', async () => {
      chat.writeLockWaitMs = 4_321
      try {
        await write({ from: 'Mudanza-PC', to: 'Mudanza-Nube', topic: 'Local', room: 'posta' })
      } finally {
        chat.writeLockWaitMs = WRITE_LOCK_WAIT_MS
      }
      // More queries at once than the pool has connections: the one the write used is among them.
      const settings = await Promise.all(
        Array.from(
          { length: 30 },
          () =>
            prisma.$queryRaw<
              { v: string }[]
            >`SELECT current_setting('lock_timeout') AS v FROM (SELECT pg_sleep(0.05)) AS s`,
        ),
      )
      expect(settings.map(([row]) => row?.v)).not.toContain('4321ms')
    })

    it('the import waits for a write in course, and for a participant Santi is changing (it plans on what is there)', async () => {
      const data = await fetchFrom(hubPages([message(1_000_001)], 10))
      const releaseWrite = await hold((tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK}::bigint)`)
      const importing = transfer.apply(data)
      expect(await stillWaiting(importing, 1_000)).toBe(true)
      await releaseWrite()
      await importing
      await cleanUp()

      // Mudanza-Solo (relay, in «tcg») would join «posta»; Santi makes it a cloud session meanwhile: the import waits
      // for him and plans on that (another channel: told, no join), instead of joining one that changed.
      const asBefore = { channel: 'relay' as const, rooms: ['tcg'], roomSince: {} }
      await prisma.sessionChatParticipant.update({ where: { key: 'mudanza-solo' }, data: asBefore })
      const releaseRow = await hold((tx) =>
        tx.sessionChatParticipant.update({ where: { key: 'mudanza-solo' }, data: { channel: 'connector' } }),
      )
      const again = transfer.apply(data)
      expect(await stillWaiting(again, 1_000)).toBe(true)
      await releaseRow()
      try {
        const plan = await again
        expect(plan.joins).toEqual([])
        expect(plan.participantNotes.join('\n')).toContain('«Mudanza-Solo» está en tcg-pocket como')
        const solo = await prisma.sessionChatParticipant.findUniqueOrThrow({ where: { key: 'mudanza-solo' } })
        expect(solo.rooms).toEqual(['tcg'])
      } finally {
        await prisma.sessionChatParticipant.update({ where: { key: 'mudanza-solo' }, data: asBefore })
      }
    })

    it('a source that is not chat-export v1, goes back or skips ids is refused', async () => {
      const bad = (async () => new Response(JSON.stringify({ format: 'otro' }), { status: 200 })) as typeof fetch
      await expect(transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: bad })).rejects.toThrow(
        'no es chat-export v1',
      )
      const first = hubPages([message(1_000_001), message(1_000_002)], 1)[0]
      const back = (async () => new Response(JSON.stringify(first), { status: 200 })) as typeof fetch
      await expect(
        transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: back, after: 1_000_001 }),
      ).rejects.toThrow('no viene en orden')
      const skipping = (async () =>
        new Response(JSON.stringify({ ...first, next: 5 }), { status: 200 })) as typeof fetch
      await expect(transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: skipping })).rejects.toThrow(
        'no avanza bien',
      )
      const denied = (async () => new Response('{}', { status: 401 })) as typeof fetch
      await expect(transfer.fetchExport({ url: 'https://x.test/e', token: 't', fetchImpl: denied })).rejects.toThrow(
        '401',
      )
    })
  })
})
