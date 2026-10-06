import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

describe('api tokens (e2e)', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
  })

  afterAll(async () => {
    await test.close()
  })

  const create = (body: Record<string, unknown>) => test.http().post('/api/tokens').set('Cookie', cookie).send(body)

  it('creates a worker token, shows it once and lists it without the secret', async () => {
    const created = await create({ name: 'PC de Santi', kind: 'worker', scopes: ['worker:claim'] })
    expect(created.status).toBe(201)
    expect(created.body.token).toMatch(/^tcg_wk_[A-Za-z0-9_-]{43}$/)
    expect(created.body.prefix).toBe(created.body.token.slice(0, 13))
    expect(created.body).toMatchObject({
      name: 'PC de Santi',
      kind: 'worker',
      scopes: ['worker:claim'],
      revokedAt: null,
    })
    expect(typeof created.body.id).toBe('number')

    const list = await test.http().get('/api/tokens').set('Cookie', cookie)
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(1)
    const item = list.body.items[0]
    expect(item).not.toHaveProperty('token')
    expect(item).not.toHaveProperty('tokenHash')
    expect(item).toMatchObject({
      id: created.body.id,
      name: 'PC de Santi',
      kind: 'worker',
      prefix: created.body.prefix,
    })
    expect(item.lastUsedAt).toBeNull()
  })

  it('rejects scopes that do not belong to the kind', async () => {
    const response = await create({ name: 'x', kind: 'worker', scopes: ['mcp:read'] })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('bad_request')
    const invalid = await create({ name: '', kind: 'other', scopes: [] })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('validation')
  })

  it('authenticates the worker stub with the bearer token and records last_used_at', async () => {
    const created = await create({ name: 'worker', kind: 'worker', scopes: ['worker:claim'] })
    const ping = await test.http().get('/api/worker/ping').set('Authorization', `Bearer ${created.body.token}`)
    expect(ping.status).toBe(200)
    expect(ping.body).toEqual({ ok: true, token: { name: 'worker', kind: 'worker' } })
    const row = await test.prisma.apiToken.findUniqueOrThrow({ where: { id: created.body.id } })
    expect(row.lastUsedAt).not.toBeNull()
  })

  it('enforces scopes: mcp tokens cannot call the worker and vice versa', async () => {
    const mcp = await create({ name: 'claude', kind: 'mcp', scopes: ['mcp:read', 'mcp:write'] })
    expect(mcp.body.token).toMatch(/^tcg_mcp_/)
    const worker = await create({ name: 'worker 2', kind: 'worker', scopes: ['worker:claim'] })

    const wrongKind = await test.http().get('/api/worker/ping').set('Authorization', `Bearer ${mcp.body.token}`)
    expect(wrongKind.status).toBe(403)
    expect(wrongKind.body.error.code).toBe('forbidden')
    const workerOnMcp = await test.http().post('/api/mcp').set('Authorization', `Bearer ${worker.body.token}`).send({})
    expect(workerOnMcp.status).toBe(403)
    const mcpStub = await test.http().post('/api/mcp').set('Authorization', `Bearer ${mcp.body.token}`).send({})
    expect(mcpStub.status).toBe(501)
    expect(mcpStub.body.error.code).toBe('not_implemented')
  })

  it('revokes a token and keeps it in the list as revoked', async () => {
    const created = await create({ name: 'temp', kind: 'worker', scopes: ['worker:claim'] })
    const revoke = await test.http().delete(`/api/tokens/${created.body.id}`).set('Cookie', cookie)
    expect(revoke.status).toBe(204)
    const ping = await test.http().get('/api/worker/ping').set('Authorization', `Bearer ${created.body.token}`)
    expect(ping.status).toBe(401)
    const list = await test.http().get('/api/tokens').set('Cookie', cookie)
    const revoked = list.body.items.find((token: { id: number }) => token.id === created.body.id)
    expect(revoked.revokedAt).not.toBeNull()
    const missing = await test.http().delete('/api/tokens/99999').set('Cookie', cookie)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('not_found')
  })

  it('requires the session for token management', async () => {
    expect((await test.http().get('/api/tokens')).status).toBe(401)
    const post = await test
      .http()
      .post('/api/tokens')
      .send({ name: 'x', kind: 'mcp', scopes: ['mcp:read'] })
    expect(post.status).toBe(401)
  })
})
