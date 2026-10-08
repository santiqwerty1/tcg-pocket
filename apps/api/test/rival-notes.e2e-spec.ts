import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Notas por rival (Fase 12): one note per opponent key, any spelling finds it; empty text deletes it. */
describe('rival notes (e2e)', () => {
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

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)

  it('writes, finds by any spelling, appends, lists, deletes', async () => {
    expect((await get('/api/rival-notes')).body).toEqual({ items: [] })
    const saved = await put('/api/rival-notes').send({
      opponent: 'Mega Blaziken ex',
      text: '  Guardar el Pokémon con más PS para cuando entra el Mega.  ',
      archetypeId: 'mega-blaziken-ex',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.note).toMatchObject({
      key: 'mega blaziken ex',
      label: 'Mega Blaziken ex',
      archetypeId: 'mega-blaziken-ex',
      text: 'Guardar el Pokémon con más PS para cuando entra el Mega.',
    })
    const found = await get('/api/rival-notes/lookup').query({ opponent: 'mega-blaziken EX' })
    expect(found.body.note?.text).toContain('más PS')
    expect((await get('/api/rival-notes/lookup').query({ opponent: 'Darkrai ex' })).body).toEqual({ note: null })

    // Append keeps the archetype and adds a paragraph; the label follows the latest spelling.
    const appended = await put('/api/rival-notes').send({
      opponent: 'Mega-Blaziken ex',
      text: 'Ojo con el segundo turno.',
      append: true,
    })
    expect(appended.body.note).toMatchObject({
      label: 'Mega-Blaziken ex',
      archetypeId: 'mega-blaziken-ex',
      text: 'Guardar el Pokémon con más PS para cuando entra el Mega.\n\nOjo con el segundo turno.',
    })
    await put('/api/rival-notes').send({ opponent: 'Darkrai ex / Arceus', text: 'Sacar la Darkrai rápido.' })
    const list = (await get('/api/rival-notes')).body.items as { label: string }[]
    expect(list.map((item) => item.label)).toEqual(['Darkrai ex / Arceus', 'Mega-Blaziken ex'])

    // Empty text deletes; DELETE by key too; a missing key is a 404.
    expect((await put('/api/rival-notes').send({ opponent: 'darkrai ex arceus', text: '   ' })).body).toEqual({
      note: null,
    })
    expect((await test.http().delete('/api/rival-notes/mega%20blaziken%20ex').set('Cookie', cookie)).status).toBe(204)
    expect((await test.http().delete('/api/rival-notes/mega%20blaziken%20ex').set('Cookie', cookie)).status).toBe(404)
    expect((await get('/api/rival-notes')).body.items).toEqual([])

    expect((await put('/api/rival-notes').send({ opponent: '¡¡!!', text: 'x' })).status).toBe(400)
    expect((await put('/api/rival-notes').send({ opponent: 'X', text: 'a'.repeat(5001) })).status).toBe(400)
    expect((await test.http().get('/api/rival-notes')).status).toBe(401)
  })
})
