import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * D-021: the chat between the Claude sessions that work on the app, through the MCP (the cloud sessions), through
 * `/api/mcp/chat` and through `scripts/chat.mjs` (the local ones). Only tokens with `mcp:write`.
 */
type Structured = Record<string, unknown>
interface Message {
  id: number
  from: string
  to: string[]
  topic: string
  text: string
}

/** The script in a child process, without blocking this one (it also serves the API the script talks to). */
function runScript(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; input?: string; encoding?: 'utf8' },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: options.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })
}

describe('chat between sessions (e2e)', () => {
  let test: TestApp
  let url: URL
  let base: string
  let readToken: string
  let writeToken: string
  const clients: Client[] = []

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    const cookie = await login(test, { secret: null })
    const post = (path: string) => test.http().post(path).set('Cookie', cookie)
    readToken = (await post('/api/tokens').send({ name: 'lectura', kind: 'mcp', scopes: ['mcp:read'] })).body.token
    writeToken = (await post('/api/tokens').send({ name: 'sesiones', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] }))
      .body.token
    await test.app.listen(0, '127.0.0.1')
    const { port } = test.app.getHttpServer().address() as AddressInfo
    base = `http://127.0.0.1:${port}`
    url = new URL(`${base}/api/mcp`)
  })

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined)
    await test.close()
  })

  async function connect(token = writeToken): Promise<Client> {
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    )
    clients.push(client)
    return client
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as {
      structuredContent?: Structured
      content: { text?: string }[]
      isError?: boolean
    }
    expect(result.isError, result.content[0]?.text).toBeFalsy()
    return result.structuredContent ?? {}
  }

  it('is only for tokens that can write', async () => {
    const reader = await connect(readToken)
    const names = (await reader.listTools()).tools.map((tool) => tool.name)
    expect(names).not.toContain('chat_read')
    expect(names).not.toContain('chat_write')
    expect(
      (await fetch(`${base}/api/mcp/chat?as=Nube2`, { headers: { Authorization: `Bearer ${readToken}` } })).status,
    ).toBe(403)
    expect((await fetch(`${base}/api/mcp/chat?as=Nube2`)).status).toBe(401)
    const writer = await connect()
    const tools = (await writer.listTools()).tools
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['chat_read', 'chat_write']))
    expect(writer.getInstructions()).toContain('chat_read y chat_write')
  })

  it('a message reaches its recipients once; «todos» reaches everyone but its sender; names fold', async () => {
    const nube = await connect()
    const sent = await call(nube, 'chat_write', {
      from: 'Nube 2',
      to: 'Coordinador',
      topic: 'Fase 43',
      text: 'Lista para integrar.',
    })
    expect(sent).toMatchObject({ sent: true, from: 'Nube 2', to: ['Coordinador'] })

    const first = await call(nube, 'chat_read', { as: 'coordinador' })
    expect(first.messages).toEqual([
      expect.objectContaining({ from: 'Nube 2', to: ['Coordinador'], topic: 'Fase 43', text: 'Lista para integrar.' }),
    ])
    expect(first.participants).toContain('Nube 2')
    expect((await call(nube, 'chat_read', { as: 'Coordinador' })).messages).toEqual([])
    // The sender does not get its own message.
    expect((await call(nube, 'chat_read', { as: 'nube-2' })).messages).toEqual([])

    await call(nube, 'chat_write', { from: 'Coordinador', to: 'Principal, todos', topic: 'Deploy', text: 'A las 16.' })
    expect(((await call(nube, 'chat_read', { as: 'Nube2' })).messages as Message[]).map((m) => m.topic)).toEqual([
      'Deploy',
    ])
    expect(((await call(nube, 'chat_read', { as: 'Principal' })).messages as Message[]).map((m) => m.topic)).toEqual([
      'Deploy',
    ])
    expect((await call(nube, 'chat_read', { as: 'Coordinador' })).messages).toEqual([])
    // all: the ones already read, too.
    const all = await call(nube, 'chat_read', { as: 'Coordinador', all: true })
    expect((all.messages as Message[]).map((m) => m.topic)).toEqual(['Fase 43'])
  })

  it('only what was returned is marked read: «all» with more unread than its limit loses nothing', async () => {
    const nube = await connect()
    // The broadcast of an earlier test is unread for any new participant: read it first.
    await call(nube, 'chat_read', { as: 'Pruebas' })
    for (const topic of ['uno', 'dos', 'tres']) {
      await call(nube, 'chat_write', { from: 'Coordinador', to: 'Pruebas', topic, text: topic })
    }
    const newest = await call(nube, 'chat_read', { as: 'Pruebas', all: true, limit: 1 })
    expect((newest.messages as Message[]).map((m) => m.topic)).toEqual(['tres'])
    expect(newest.unreadLeft).toBe(2)
    const rest = await call(nube, 'chat_read', { as: 'Pruebas' })
    expect((rest.messages as Message[]).map((m) => m.topic)).toEqual(['uno', 'dos'])
    expect(rest.unreadLeft).toBe(0)
    // A recipient chat_read could never use is refused when writing.
    const refused = (await nube.callTool({
      name: 'chat_write',
      arguments: { from: 'Nube2', to: 'Principal, Nube<2>', topic: 'x', text: 'x' },
    })) as { isError?: boolean }
    expect(refused.isError).toBe(true)
  })

  it('a reader that waits wakes up when its message is written', async () => {
    const nube = await connect()
    // The broadcast of the previous test is still unread for Laboratorio: read it first.
    expect(((await call(nube, 'chat_read', { as: 'Laboratorio' })).messages as Message[]).map((m) => m.topic)).toEqual([
      'Deploy',
    ])
    const started = Date.now()
    const waiting = call(nube, 'chat_read', { as: 'Laboratorio', waitSeconds: 20 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await call(nube, 'chat_write', { from: 'Infra', to: ['Laboratorio'], topic: 'perGame', text: 'Ya está.' })
    const view = await waiting
    expect((view.messages as Message[]).map((m) => m.text)).toEqual(['Ya está.'])
    expect(Date.now() - started).toBeLessThan(10_000)
    // Nothing new: a short wait comes back empty.
    expect((await call(nube, 'chat_read', { as: 'Laboratorio', waitSeconds: 1 })).messages).toEqual([])
  })

  it('works over HTTP and with scripts/chat.mjs (the local sessions)', async () => {
    const headers = { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' }
    const posted = await fetch(`${base}/api/mcp/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ from: 'Principal', to: ['Nube2'], topic: 'Fase 40', text: 'Te la paso.' }),
    })
    expect(posted.status).toBe(201)
    const read = (await (await fetch(`${base}/api/mcp/chat?as=Nube2`, { headers })).json()) as { messages: Message[] }
    expect(read.messages.map((m) => m.topic)).toEqual(['Fase 40'])

    const script = join(REPO_ROOT, 'scripts/chat.mjs')
    const env = { ...process.env, TCG_SERVER: base, TCG_CHAT_TOKEN: writeToken }
    const write = await runScript(
      process.execPath,
      [script, 'write', '--from', 'Nube2', '--to', 'Principal', '--topic', 'Recibido'],
      { env, input: 'Arranco mañana.', encoding: 'utf8' },
    )
    expect(write.status, write.stderr).toBe(0)
    expect(write.stdout).toMatch(/^✓ #\d+ .* · Nube2 → Principal/)
    const reading = await runScript(process.execPath, [script, 'read', '--as', 'Principal'], { env, encoding: 'utf8' })
    expect(reading.status, reading.stderr).toBe(0)
    expect(reading.stdout).toContain('Nube2 → Principal · Recibido')
    expect(reading.stdout).toContain('Arranco mañana.')
    const nothing = await runScript(process.execPath, [script, 'wait', '--as', 'Principal', '--minutes', '0.02'], {
      env,
      encoding: 'utf8',
    })
    expect(nothing.status).toBe(2)
    const noToken = await runScript(process.execPath, [script, 'read', '--as', 'Principal'], {
      env: { ...process.env, TCG_SERVER: base, TCG_CHAT_TOKEN: '', TCG_MCP_TOKEN: '' },
      encoding: 'utf8',
    })
    expect(noToken.status).toBe(1)
  })
})
