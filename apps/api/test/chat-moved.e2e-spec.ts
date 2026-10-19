import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { GoneException } from '@nestjs/common'
import { AlertsService } from '../src/alerts/alerts.service.js'
import { BackupService } from '../src/backup/backup.service.js'
import { ChatService } from '../src/chat/chat.service.js'
import { HubForwardService } from '../src/chat/hub-forward.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * The move of the chat to the hub (D-030, T1b): Santi marks a room as moved; its bridge gets `410 chat_moved`, nothing
 * is written in it here, and the old connector's chat tools go to the hub with tcg-pocket's token there (D5).
 */
type ToolResult = { structuredContent?: Record<string, unknown>; content: { text?: string }[]; isError?: boolean }
interface HubCall {
  auth: string | undefined
  protocol: string | undefined
  body: { method?: string; id?: number; params?: { name?: string; arguments?: Record<string, unknown> } }
}

const HUB_TOKEN = 'hub_mcp_token_de_las_pruebas_0123456789'

describe('the chat’s move to the hub: the moved rooms (e2e)', () => {
  let test: TestApp
  let cookie: string
  let base: string
  let prisma: PrismaService
  let forward: HubForwardService
  let writeToken: string
  let relayToken: string
  let hub: Server
  let hubBase: string
  const hubCalls: HubCall[] = []
  let hubMode: 'ok' | 'busy' | 'slow' | 'redirect' | 'unauthorized' | 'cut' = 'ok'
  const hubPaths: string[] = []
  let hubClosed = 0
  const clients: Client[] = []

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let text = ''
      req.on('data', (chunk) => {
        text += chunk
      })
      req.on('end', () => resolve(text))
    })

  beforeAll(async () => {
    // A hub of its own: it checks nothing but records every call, and answers like the real one (a read as an event
    // stream, a write as JSON).
    hub = createServer(async (req, res) => {
      const body = JSON.parse((await readBody(req)) || '{}') as HubCall['body']
      hubPaths.push(req.url ?? '')
      hubCalls.push({
        auth: req.headers.authorization,
        protocol: req.headers['mcp-protocol-version'] as string | undefined,
        body,
      })
      if (hubMode === 'busy') {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '5' })
        res.end(JSON.stringify({ error: { code: 'chat_busy', message: 'ocupado' } }))
        return
      }
      if (hubMode === 'redirect') {
        res.writeHead(302, { Location: '/otro' })
        res.end()
        return
      }
      if (hubMode === 'unauthorized') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 'unauthenticated', message: 'no' } }))
        return
      }
      if (hubMode === 'cut') {
        // The event stream's headers at once, then the hub goes away mid-answer (a deploy).
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('event: message\n')
        setTimeout(() => req.socket.destroy(), 100)
        return
      }
      if (hubMode === 'slow') {
        res.on('close', () => {
          hubClosed += 1
        })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        return
      }
      const args = body.params?.arguments ?? {}
      if (body.params?.name === 'chat_read') {
        const structured = {
          as: args.as,
          sala: args.sala,
          messages: [{ id: 1_000_007, from: 'Coordinador', to: ['todos'], topic: 'Desde el hub', text: 'hola' }],
          unreadLeft: 0,
          participants: ['Santi', 'Coordinador', 'Moved-Nube'],
        }
        const answer = {
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured },
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(`event: message\ndata: ${JSON.stringify(answer)}\n\n`)
        return
      }
      const sent = { sent: true, id: 1_000_008, sala: args.sala, from: args.from }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify(sent) }], structuredContent: sent },
        }),
      )
    })
    await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve))
    hubBase = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`

    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const post = (path: string) => test.http().post(path).set('Cookie', cookie)
    writeToken = (await post('/api/tokens').send({ name: 'nube', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] })).body
      .token
    relayToken = (await post('/api/tokens').send({ name: 'puente', kind: 'mcp', scopes: ['chat:relay'] })).body.token
    for (const participant of [
      { name: 'Moved-Nube', channel: 'connector', rooms: ['posta'] },
      { name: 'Moved-Tcg', channel: 'connector', rooms: ['tcg'] },
      { name: 'Moved-PC', channel: 'relay', rooms: ['posta', 'tcg'] },
    ]) {
      await test.http().put('/api/chat/participants').set('Cookie', cookie).send(participant).expect(200)
    }
    await test.app.listen(0, '127.0.0.1')
    base = `http://127.0.0.1:${(test.app.getHttpServer().address() as AddressInfo).port}`
    prisma = test.app.get(PrismaService)
    forward = test.app.get(HubForwardService)
  })

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
    await prisma.sessionChatMessage.deleteMany()
    await prisma.appSetting.deleteMany({ where: { key: 'chat_moved' } })
    await prisma.sessionChatParticipant.deleteMany({ where: { key: { startsWith: 'moved-' } } })
    await test.close()
    await new Promise((resolve) => hub.close(resolve))
  })

  beforeEach(async () => {
    hubCalls.length = 0
    hubPaths.length = 0
    hubMode = 'ok'
    forward.answerMs = 15_000
    forward.maxAnswerChars = 2_000_000
    forward.token = HUB_TOKEN
    await prisma.sessionChatMessage.deleteMany()
    await prisma.appSetting.deleteMany({ where: { key: 'chat_moved' } })
  })

  const session = () => ({
    put: (room: string, url: string) => test.http().put(`/api/chat/moved/${room}`).set('Cookie', cookie).send({ url }),
    del: (room: string) => test.http().delete(`/api/chat/moved/${room}`).set('Cookie', cookie),
    get: () => test.http().get('/api/chat/moved').set('Cookie', cookie),
  })

  async function connect(): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${writeToken}` } },
      }),
    )
    clients.push(client)
    return client
  }

  const relay = (path: string, init: RequestInit = {}) =>
    fetch(`${base}/api/mcp/chat${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json' },
    })

  it('Santi marks a room as moved from his session (an origin), sees it, gets an alert, and brings it back', async () => {
    await test.http().put('/api/chat/moved/posta').send({ url: hubBase }).expect(401)
    for (const bad of [
      'http://hub.example.dev',
      `${hubBase}/api/mcp`,
      'no es una url',
      'https://169.254.169.254',
      'https://10.0.0.5',
      'https://chat-hub.internal',
      'https://metadata',
    ]) {
      expect((await session().put('posta', bad)).status, bad).toBe(400)
    }
    expect((await session().put('otra', hubBase)).status).toBe(400)
    const marked = await session().put('posta', `${hubBase}/`)
    expect(marked.status).toBe(200)
    expect(marked.body).toMatchObject({ room: 'posta', url: hubBase })
    const listed = (await session().get().expect(200)).body
    expect(listed.forwarding).toBe(true)
    expect(listed.items).toEqual([
      { room: 'tcg', label: 'tcg-pocket', url: null, since: null },
      { room: 'posta', label: 'Posta', url: hubBase, since: expect.any(String) },
    ])
    const alerts = await (
      test.app.get(AlertsService) as unknown as { chatMoved(): Promise<{ code: string }[]> }
    ).chatMoved()
    expect(alerts.map((alert) => alert.code)).toEqual(['chat_moved'])
    await session().del('posta').expect(204)
    expect((await session().get()).body.items[1].url).toBeNull()
    await session().del('posta').expect(204)
  })

  it('the bridge of a moved room gets 410 chat_moved with the URL on every route; the other room works', async () => {
    await session().put('posta', hubBase).expect(200)
    const write = JSON.stringify({ from: 'Moved-PC', to: 'Moved-Nube', topic: 'Hola', text: 'x', ref: 'pc-1' })
    for (const [path, init] of [
      ['?sala=posta&after=0', {}],
      ['?sala=posta', { method: 'POST', body: write }],
      ['/participants?sala=posta', {}],
      ['/participants?sala=posta', { method: 'POST', body: JSON.stringify({ name: 'Otra-PC', channel: 'relay' }) }],
    ] as const) {
      const answer = await relay(path, init)
      expect(answer.status, path).toBe(410)
      expect(await answer.json()).toMatchObject({
        error: { code: 'chat_moved', details: { sala: 'posta', url: hubBase } },
      })
    }
    expect(await prisma.sessionChatMessage.count()).toBe(0)
    expect(await prisma.sessionChatParticipant.count({ where: { key: 'otra-pc' } })).toBe(0)
    // «tcg» is still here.
    const tcg = await relay('?sala=tcg', {
      method: 'POST',
      body: JSON.stringify({ from: 'Moved-PC', to: 'Moved-Tcg', topic: 'Hola', text: 'x', ref: 'pc-2' }),
    })
    expect(tcg.status).toBe(201)
    // Any other write in the moved room is refused too (the service, not only the routes).
    const direct = await test.app
      .get(ChatService)
      .write({
        from: 'Moved-PC',
        to: 'Moved-Nube',
        topic: 'x',
        text: 'x',
        via: 'prueba',
        tokenId: null,
        caller: 'relay',
        room: 'posta',
      })
      .catch((caught: unknown) => caught)
    expect(direct).toBeInstanceOf(GoneException)
    expect(await prisma.sessionChatMessage.count({ where: { room: 'posta' } })).toBe(0)
  })

  it('the old connector’s chat tools of a moved room go to the hub, with its token and the room; nothing is written here', async () => {
    await session().put('posta', hubBase).expect(200)
    const client = await connect()
    // Moved-Nube's main room is «posta»: without «sala», the call goes to the hub with the room explicit.
    const sent = (await client.callTool({
      name: 'chat_write',
      arguments: { from: 'Moved-Nube', to: 'Coordinador', topic: 'Desde la nube vieja', text: 'hola hub' },
    })) as ToolResult
    expect(sent.isError, sent.content[0]?.text).toBeFalsy()
    expect(sent.structuredContent).toMatchObject({ sent: true, id: 1_000_008, sala: 'posta' })
    expect(sent.content.at(-1)?.text).toContain('se mudó al hub')
    expect(hubCalls).toHaveLength(1)
    expect(hubCalls[0]).toMatchObject({
      auth: `Bearer ${HUB_TOKEN}`,
      protocol: '2025-06-18',
      body: {
        method: 'tools/call',
        params: {
          name: 'chat_write',
          arguments: {
            from: 'Moved-Nube',
            to: 'Coordinador',
            topic: 'Desde la nube vieja',
            text: 'hola hub',
            sala: 'posta',
          },
        },
      },
    })
    // tcg-pocket's own token never goes to the hub.
    expect(JSON.stringify(hubCalls)).not.toContain(writeToken)

    const read = (await client.callTool({
      name: 'chat_read',
      arguments: { as: 'Moved-Nube', sala: 'posta' },
    })) as ToolResult
    expect(read.isError, read.content[0]?.text).toBeFalsy()
    expect(read.structuredContent).toMatchObject({ as: 'Moved-Nube', sala: 'posta', messages: [{ id: 1_000_007 }] })
    expect(hubCalls[1]?.body.params).toMatchObject({
      name: 'chat_read',
      arguments: { as: 'Moved-Nube', sala: 'posta' },
    })
    expect(await prisma.sessionChatMessage.count()).toBe(0)

    // A room that is still here is not forwarded.
    const local = (await client.callTool({
      name: 'chat_write',
      arguments: { from: 'Moved-Tcg', to: 'Moved-PC', topic: 'Local', text: 'x', sala: 'tcg' },
    })) as ToolResult
    expect(local.isError, local.content[0]?.text).toBeFalsy()
    expect(hubCalls).toHaveLength(2)
    expect(await prisma.sessionChatMessage.count({ where: { room: 'tcg' } })).toBe(1)
  })

  it('without HUB_MCP_TOKEN it says where the room went; a busy hub is an error to retry; nothing is written here', async () => {
    await session().put('posta', hubBase).expect(200)
    const client = await connect()
    const args = { from: 'Moved-Nube', to: 'Coordinador', topic: 'x', text: 'x' }
    forward.token = null
    const without = (await client.callTool({ name: 'chat_write', arguments: args })) as ToolResult
    expect(without.isError).toBe(true)
    expect(without.content[0]?.text).toContain(`La sala «posta» se mudó al hub (${hubBase}): usá el conector nuevo`)
    expect(hubCalls).toHaveLength(0)
    forward.token = HUB_TOKEN
    hubMode = 'busy'
    const busy = (await client.callTool({ name: 'chat_write', arguments: args })) as ToolResult
    expect(busy.isError).toBe(true)
    expect(busy.content[0]?.text).toContain('contestó 503: probá de nuevo en unos segundos')
    expect(await prisma.sessionChatMessage.count()).toBe(0)
  })

  it('a hub that redirects, says 401, answers too long or too late, or goes away mid-answer: an error that says so', async () => {
    await session().put('posta', hubBase).expect(200)
    const client = await connect()
    const write = async () =>
      (await client.callTool({
        name: 'chat_write',
        arguments: { from: 'Moved-Nube', to: 'Coordinador', topic: 'x', text: 'x' },
      })) as ToolResult
    // A redirect is never followed: the token does not go to another place.
    hubMode = 'redirect'
    const redirected = await write()
    expect(redirected.isError).toBe(true)
    expect(redirected.content[0]?.text).toContain('probá de nuevo')
    expect(hubPaths).toEqual(['/api/mcp'])
    hubMode = 'unauthorized'
    expect((await write()).content[0]?.text).toContain('rechazó el token de reenvío (401): avisale a Santi')
    hubMode = 'ok'
    forward.maxAnswerChars = 100
    expect((await write()).content[0]?.text).toContain('su respuesta pasó los 100 caracteres')
    forward.maxAnswerChars = 2_000_000
    hubMode = 'slow'
    forward.answerMs = 300
    expect((await write()).content[0]?.text).toContain('no contestó a tiempo: probá de nuevo')
    forward.answerMs = 15_000
    hubMode = 'cut'
    const cut = (await client.callTool({ name: 'chat_read', arguments: { as: 'Moved-Nube' } })) as ToolResult
    expect(cut.isError).toBe(true)
    expect(cut.content[0]?.text).toContain('se cortó la conexión: probá de nuevo')
    expect(await prisma.sessionChatMessage.count()).toBe(0)
  })

  it('a write that waits for the lock while the room is marked as moved takes nothing; the switch waits for writes', async () => {
    const { default: pg } = await import('pg')
    const other = new pg.Client({ connectionString: test.env.databaseUrl })
    await other.connect()
    try {
      // A write in course holds the chat's write lock: the new one passes the first look and waits.
      await other.query('BEGIN')
      await other.query('SELECT pg_advisory_xact_lock(20261009)')
      const writing = test.app
        .get(ChatService)
        .write({
          from: 'Moved-PC',
          to: 'Moved-Nube',
          topic: 'Carrera',
          text: 'x',
          via: 'prueba',
          tokenId: null,
          caller: 'relay',
          room: 'posta',
        })
        .catch((caught: unknown) => caught)
      // Santi's switch waits for the same lock.
      let switched = false
      const switching = session()
        .put('posta', hubBase)
        .then((answer) => {
          switched = true
          return answer
        })
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(switched).toBe(false)
      // Meanwhile the room is marked as moved by another way (as if the switch had gone first): the write that was
      // waiting sees it under the lock.
      await other.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('chat_moved', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ posta: { url: hubBase, since: new Date().toISOString() } })],
      )
      await other.query('COMMIT')
      expect(await writing).toBeInstanceOf(GoneException)
      expect((await switching).status).toBe(200)
      expect(await prisma.sessionChatMessage.count({ where: { topic: 'Carrera' } })).toBe(0)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      await other.end()
    }
  })

  it('a bridge’s join that waits for the lock while the room is marked as moved adds no one (verification of #129)', async () => {
    const { default: pg } = await import('pg')
    const other = new pg.Client({ connectionString: test.env.databaseUrl })
    await other.connect()
    try {
      await other.query('BEGIN')
      await other.query('SELECT pg_advisory_xact_lock(20261009)')
      // The route's first look passes (the room is not moved yet); the join waits for the lock.
      const joining = relay('/participants?sala=posta', {
        method: 'POST',
        body: JSON.stringify({ name: 'Moved-Nueva', channel: 'relay' }),
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
      await other.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('chat_moved', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ posta: { url: hubBase, since: new Date().toISOString() } })],
      )
      await other.query('COMMIT')
      const answer = await joining
      expect(answer.status).toBe(410)
      expect(await answer.json()).toMatchObject({ error: { code: 'chat_moved' } })
      expect(await prisma.sessionChatParticipant.count({ where: { key: 'moved-nueva' } })).toBe(0)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      await other.end()
    }
  })

  it('a restore keeps where the rooms live: a moved room does not come back with an old backup', async () => {
    const backup = test.app.get(BackupService)
    const before = await backup.exportDocument()
    await session().put('posta', hubBase).expect(200)
    await prisma.$transaction(
      (tx) =>
        (backup as unknown as { restoreInto(tx: unknown, document: unknown): Promise<void> }).restoreInto(tx, before),
      { timeout: 60_000 },
    )
    expect((await session().get()).body.items[1].url).toBe(hubBase)
    // A backup that says another place does not move it either.
    const elsewhere = {
      ...before,
      settings: [
        ...before.settings,
        {
          key: 'chat_moved',
          value: { tcg: { url: 'https://otro.example.dev', since: new Date().toISOString() } },
          updatedAt: new Date(),
        },
      ],
    }
    await prisma.$transaction(
      (tx) =>
        (backup as unknown as { restoreInto(tx: unknown, document: unknown): Promise<void> }).restoreInto(
          tx,
          elsewhere,
        ),
      { timeout: 60_000 },
    )
    const items = (await session().get()).body.items as { url: string | null }[]
    expect(items.map((item) => item.url)).toEqual([null, hubBase])
  })

  it('a wait the client cuts cuts the forward to the hub too', async () => {
    await session().put('posta', hubBase).expect(200)
    hubMode = 'slow'
    const cut = new AbortController()
    const call = fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writeToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'chat_read', arguments: { as: 'Moved-Nube', waitSeconds: 30 } },
      }),
      signal: cut.signal,
    }).then(
      (response) => response.text(),
      () => 'cut',
    )
    await vi.waitFor(() => expect(hubCalls).toHaveLength(1), { timeout: 5_000 })
    const closedBefore = hubClosed
    cut.abort()
    expect(await call).toBe('cut')
    await vi.waitFor(() => expect(hubClosed).toBe(closedBefore + 1), { timeout: 5_000 })
  })
})
