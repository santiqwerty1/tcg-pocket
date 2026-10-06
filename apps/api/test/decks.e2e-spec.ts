import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** docs/PLAN.md §7 (M3 acceptance) against the real 40 decks and the 6/10/2026 collection export. */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

interface Draft {
  number: number | null
  title: string | null
  draft: { name?: string; energies: string[]; cards: { cardId: string; count: number }[]; notes?: string } | null
  errors: { code: string }[]
  warnings: { code: string }[]
  validation: { ok: boolean; errors: { code: string; message: string }[] } | null
  completeness: { complete: boolean; missingCount: number } | null
}

interface Summary {
  id: string
  name: string
  valid: boolean
  complete: boolean
  cardCount: number
  errorCount: number
  missingCount: number
  revisionNumber: number
  builtInGame: boolean
  archivedAt: string | null
}

describe('decks (e2e)', () => {
  let test: TestApp
  let cookie: string
  const decksMarkdown = readFileSync(DECKS_PATH, 'utf8')
  let drafts: Draft[]
  let created: Summary[]
  const deckId = (number: number): string => {
    const draft = drafts.find((d) => d.number === number)
    const summary = created.find((s) => s.name === (draft?.title ?? ''))
    if (!summary) throw new Error(`deck ${number} was not created`)
    return summary.id
  }

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await test
      .http()
      .post('/api/collection/imports')
      .set('Cookie', cookie)
      .attach('file', readFileSync(CSV_PATH), 'tcgcollectiontracterexport.csv')
    expect(preview.status).toBe(201)
    const applied = await test.http().post(`/api/collection/imports/${preview.body.id}/apply`).set('Cookie', cookie)
    expect(applied.status).toBe(200)
  })

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)
  const del = (path: string) => test.http().delete(path).set('Cookie', cookie)

  it('previews the 40 decks of mazos_40_listas.md: 0 errors, deck 10 must choose its energy', async () => {
    const explicit = await post('/api/decks/import').send({ text: decksMarkdown, format: 'spanish-file' })
    expect(explicit.status).toBe(200)
    drafts = explicit.body.drafts
    expect(drafts).toHaveLength(40)
    expect(drafts.map((d) => d.number)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    for (const draft of drafts) {
      expect(draft.errors, `deck ${draft.number}`).toEqual([])
      expect(draft.draft, `deck ${draft.number}`).not.toBeNull()
      expect(
        draft.draft?.cards.reduce((sum, c) => sum + c.count, 0),
        `deck ${draft.number}`,
      ).toBe(20)
      expect(draft.completeness?.complete, `deck ${draft.number}`).toBe(true)
      if (draft.number === 10) {
        expect(draft.warnings.map((w) => w.code)).toEqual(['energy_choice_required'])
        expect(draft.draft?.energies).toEqual([])
        expect(draft.validation?.ok).toBe(false)
        expect(draft.validation?.errors.map((e) => e.code)).toEqual(['energy_required'])
      } else {
        expect(draft.warnings, `deck ${draft.number}`).toEqual([])
        expect(draft.validation?.ok, `deck ${draft.number}`).toBe(true)
      }
    }
    expect(drafts[8]?.draft?.energies).toEqual(['fire', 'lightning'])
    expect(drafts[8]?.title).toBe('Mega-Rayquaza ex / Dragonair')

    const auto = await post('/api/decks/import').send({ text: decksMarkdown })
    expect(auto.body.drafts).toHaveLength(40)
    const one = await post('/api/decks/import').send({ text: '2 Riolu A2 91\n2 Lucario A2 92\n\nEnergy: Fighting' })
    expect(one.body.drafts).toHaveLength(1)
    expect(one.body.drafts[0].draft.cards).toEqual([
      { cardId: 'A2-91', count: 2 },
      { cardId: 'A2-92', count: 2 },
    ])
    expect(one.body.drafts[0].validation.ok).toBe(false)
    const broken = await post('/api/decks/import').send({ text: '- Pokémon: 1 Riolu\n- Entrenadores: 2 Copiona' })
    expect(broken.body.drafts[0].draft).toBeNull()
    expect(broken.body.drafts[0].errors[0].code).toBe('ambiguous_name')
    expect(broken.body.drafts[0].validation).toBeNull()
  })

  it('commits the 40 decks (deck 10 with Psychic): every one valid and complete', async () => {
    const inputs = drafts.map((d) => {
      const draft = d.draft as NonNullable<Draft['draft']>
      return {
        name: d.title ?? draft.name ?? `Mazo ${d.number}`,
        energies: d.number === 10 ? ['psychic'] : draft.energies,
        cards: draft.cards,
        ...(draft.notes ? { notes: draft.notes } : {}),
        tags: d.number !== null && d.number <= 25 ? ['principal'] : ['rotación'],
      }
    })
    const response = await post('/api/decks/import/commit').send({ decks: inputs })
    expect(response.status).toBe(201)
    created = response.body.created
    expect(created).toHaveLength(40)
    for (const deck of created) {
      expect(deck, deck.name).toMatchObject({
        valid: true,
        errorCount: 0,
        complete: true,
        missingCount: 0,
        cardCount: 20,
        revisionNumber: 1,
        builtInGame: false,
        archivedAt: null,
      })
      expect(typeof deck.id).toBe('string')
    }
    const list = await get('/api/decks')
    expect(list.body.items).toHaveLength(40)
    expect((await get('/api/decks?tag=principal')).body.items).toHaveLength(25)
    expect((await get('/api/decks?builtInGame=true')).body.items).toHaveLength(0)
    expect((await get('/api/decks?archived=true')).body.items).toHaveLength(0)
    const detail = await get(`/api/decks/${deckId(8)}`)
    expect(detail.status).toBe(200)
    expect(detail.body.revisions).toEqual([
      expect.objectContaining({ number: 1, source: 'import', cardCount: 20, energies: ['metal'] }),
    ])
    expect(detail.body.changes).toEqual([])
    expect(detail.body.cards.find((c: { card: { id: string } }) => c.card.id === 'B2-113')).toMatchObject({
      count: 1,
      group: { id: 'B2-113' },
      playable: 2,
      missing: 0,
    })
    expect(detail.body.validation.infos.map((i: { code: string }) => i.code)).toContain('same_group_split')
    expect(typeof detail.body.notes).toBe('string')
  })

  it('exports deck 9 to deckgym with an explicit Energy line, and to the other formats', async () => {
    const id = deckId(9)
    const deckgym = await get(`/api/decks/${id}/export?format=deckgym`)
    expect(deckgym.status).toBe(200)
    expect(deckgym.headers['content-type']).toContain('text/plain')
    expect(deckgym.text.startsWith('Energy: Fire, Lightning\n')).toBe(true)
    expect(deckgym.text.trim().split('\n')).toHaveLength(1 + (drafts[8]?.draft?.cards.length ?? 0))
    const spanish = await get(`/api/decks/${id}/export?format=spanish`)
    expect(spanish.text.startsWith('### Mega-Rayquaza ex / Dragonair\n- Energía: Fuego + Rayo\n')).toBe(true)
    const limitless = await get(`/api/decks/${id}/export?format=limitless`)
    expect(limitless.text.endsWith('Energy: Fire, Lightning')).toBe(true)
    const json = await get(`/api/decks/${id}/export?format=json`)
    expect(json.headers['content-type']).toContain('application/json')
    expect(JSON.parse(json.text)).toMatchObject({ schemaVersion: 1, energies: ['fire', 'lightning'] })
    expect((await get(`/api/decks/${id}/export?format=pdf`)).status).toBe(400)
    for (const deck of created) {
      const text = (await get(`/api/decks/${deck.id}/export?format=deckgym`)).text
      expect(text.startsWith('Energy: '), deck.name).toBe(true)
    }
  })

  it('refuses the 26th deck built in the game (I8)', async () => {
    for (const deck of created.slice(0, 25)) {
      const response = await patch(`/api/decks/${deck.id}`).send({ builtInGame: true })
      expect(response.status, deck.name).toBe(200)
      expect(response.body.builtInGame).toBe(true)
    }
    const limit = await patch(`/api/decks/${created[25]?.id}`).send({ builtInGame: true })
    expect(limit.status).toBe(409)
    expect(limit.body.error.code).toBe('built_in_game_limit')
    expect((await get('/api/decks?builtInGame=true')).body.items).toHaveLength(25)
    const unbuilt = await patch(`/api/decks/${created[0]?.id}`).send({ builtInGame: false })
    expect(unbuilt.body.builtInGame).toBe(false)
    expect(
      unbuilt.body.changes.map((c: { field: string; old: unknown; new: unknown }) => [c.field, c.old, c.new]),
    ).toEqual([
      ['builtInGame', false, true],
      ['builtInGame', true, false],
    ])
    expect((await patch(`/api/decks/${created[25]?.id}`).send({ builtInGame: true })).status).toBe(200)
  })

  it('creates a 19-card deck as invalid with a concrete message, and rejects unknown cards', async () => {
    const six = drafts.find((d) => d.number === 6)?.draft as NonNullable<Draft['draft']>
    const cards = six.cards.map((c) => ({ ...c }))
    const copiona = cards.find((c) => c.cardId === 'B1-225') as { count: number }
    copiona.count -= 1
    const response = await post('/api/decks').send({ name: 'Lucario con 19', energies: ['fighting'], cards })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ valid: false, errorCount: 1, cardCount: 19, complete: true })
    expect(response.body.validation.errors).toEqual([{ code: 'card_count', message: 'Tiene 19 cartas, falta 1' }])
    const unknown = await post('/api/decks').send({
      name: 'x',
      energies: ['fire'],
      cards: [{ cardId: 'ZZ-9', count: 1 }],
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('unknown_card')
    const noAttacker = await post('/api/decks/validate').send({ cards: six.cards, energies: ['water'] })
    expect(noAttacker.status).toBe(200)
    expect(noAttacker.body.validation.infos.map((e: { code: string }) => e.code)).toContain('energy_missing_for_card')
    const fromText = await post('/api/decks/validate').send({ text: '1 Riolu A2 91\nEnergy: Fighting' })
    expect(fromText.body.draft.cards).toEqual([{ cardId: 'A2-91', count: 1 }])
    expect(fromText.body.validation.errors.map((e: { code: string }) => e.code)).toContain('card_count')
    expect(fromText.body.completeness.complete).toBe(true)
    const nothing = await post('/api/decks/validate').send({})
    expect(nothing.status).toBe(400)
  })

  it('keeps revisions and a change log, restores, duplicates, archives and deletes', async () => {
    const id = deckId(6)
    const original = (await get(`/api/decks/${id}`)).body
    const cards = (original.cards as { card: { id: string }; count: number }[]).map((c) => ({
      cardId: c.card.id,
      count: c.count,
    }))
    const riolu = cards.find((c) => c.cardId === 'B3-79') as { count: number }
    riolu.count += 1
    const edited = await patch(`/api/decks/${id}`).send({
      cards,
      name: 'Lucario v2',
      note: 'tres Riolu',
      tags: ['test'],
    })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ name: 'Lucario v2', revisionNumber: 2, valid: false, cardCount: 21 })
    expect(edited.body.validation.errors.map((e: { code: string }) => e.code).sort()).toEqual([
      'card_count',
      'copies_per_name',
    ])
    expect(
      edited.body.revisions.map((r: { number: number; source: string; note: string }) => [r.number, r.source, r.note]),
    ).toEqual([
      [1, 'import', ''],
      [2, 'ui', 'tres Riolu'],
    ])
    expect(edited.body.changes.map((c: { field: string }) => c.field).sort()).toEqual(['builtInGame', 'name', 'tags'])
    expect(await test.prisma.deckCard.findFirst({ where: { deckId: Number(id), cardId: 'B3-79' } })).toMatchObject({
      count: riolu.count,
    })

    const same = await patch(`/api/decks/${id}`).send({ cards })
    expect(same.body.revisionNumber).toBe(2)
    expect(same.body.revisions).toHaveLength(2)

    const restored = await post(`/api/decks/${id}/revisions/1/restore`)
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ revisionNumber: 3, valid: true, cardCount: 20 })
    expect(restored.body.revisions[2]).toMatchObject({ number: 3, source: 'restore', note: 'Restaurada la revisión 1' })
    expect((await post(`/api/decks/${id}/revisions/9/restore`)).status).toBe(404)

    const copy = await post(`/api/decks/${id}/duplicate`).send({})
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ name: 'Lucario v2 (copia)', variantOfId: id, revisionNumber: 1, valid: true })
    expect(copy.body.revisions[0].source).toBe('duplicate')
    expect(copy.body.tags).toEqual(['test'])

    expect((await del(`/api/decks/${copy.body.id}`)).status).toBe(409)
    const archived = await patch(`/api/decks/${copy.body.id}`).send({ archived: true })
    expect(archived.body.archivedAt).not.toBeNull()
    expect((await get('/api/decks?archived=true')).body.items.map((d: { id: string }) => d.id)).toEqual([copy.body.id])
    expect((await del(`/api/decks/${copy.body.id}`)).status).toBe(204)
    expect((await get(`/api/decks/${copy.body.id}`)).status).toBe(404)
    expect((await get('/api/decks/abc')).status).toBe(404)
    const self = await patch(`/api/decks/${id}`).send({ variantOfId: id })
    expect(self.status).toBe(400)
  })

  it('answers which decks use a functional group, with string ids, from both endpoints', async () => {
    const byCard = await get('/api/decks/by-card/B2-113')
    expect(byCard.status).toBe(200)
    const ids = byCard.body.items.map((item: { id: string }) => item.id)
    expect(ids).toContain(deckId(8))
    expect(ids).toContain(deckId(39))
    const mawile = byCard.body.items.find((item: { id: string }) => item.id === deckId(8))
    expect(mawile).toEqual({ id: deckId(8), name: 'Mega-Mawile ex / Perrserker de Galar', count: 2, builtInGame: true })
    const group = await get('/api/groups/B2-113')
    expect(group.body.group.decks).toEqual(byCard.body.items)
    expect((await get('/api/decks/by-card/ZZ-1')).status).toBe(404)
    expect((await test.http().get('/api/decks')).status).toBe(401)
  })
})
