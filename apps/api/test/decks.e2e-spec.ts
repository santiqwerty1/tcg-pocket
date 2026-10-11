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
    expect(one.body.drafts[0].cards).toEqual([
      { cardId: 'A2-91', count: 2, nameEs: 'Riolu', nameEn: 'Riolu', cardType: 'pokemon' },
      { cardId: 'A2-92', count: 2, nameEs: 'Lucario', nameEn: 'Lucario', cardType: 'pokemon' },
    ])
    expect(
      (drafts[9] as { cards?: { cardId: string; nameEs: string }[] }).cards?.find((c) => c.cardId === 'A3a-60')?.nameEs,
    ).toBe('Código Cero')
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

  it('re-checks the limit when un-archiving a deck that is still marked as built (I8 counts active decks)', async () => {
    const built = created[1] as Summary // built and active after the previous test
    const spare = created[0] as Summary // not built
    const other = created[26] as Summary // not built
    const activeBuilt = () => test.prisma.deck.count({ where: { builtInGame: true, archivedAt: null } })
    expect(await activeBuilt()).toBe(25)

    // Archiving keeps the mark but frees a slot…
    const archived = await patch(`/api/decks/${built.id}`).send({ archived: true })
    expect(archived.status).toBe(200)
    expect(archived.body.builtInGame).toBe(true)
    expect(archived.body.archivedAt).not.toBeNull()
    expect((await get('/api/decks?builtInGame=true')).body.items).toHaveLength(24)
    expect((await patch(`/api/decks/${spare.id}`).send({ builtInGame: true })).status).toBe(200)
    expect(await activeBuilt()).toBe(25)

    // …so bringing the deck back would make 26: refused, and it stays archived.
    const back = await patch(`/api/decks/${built.id}`).send({ archived: false })
    expect(back.status).toBe(409)
    expect(back.body.error.code).toBe('built_in_game_limit')
    expect(back.body.error.details).toEqual({ built: 25, max: 25 })
    expect((await get(`/api/decks/${built.id}`)).body.archivedAt).not.toBeNull()

    // Same when an archived deck is un-archived and marked in one patch; marking it while archived is fine (it does
    // not count) and the check happens when it comes back.
    expect((await patch(`/api/decks/${other.id}`).send({ archived: true })).status).toBe(200)
    const both = await patch(`/api/decks/${other.id}`).send({ archived: false, builtInGame: true })
    expect(both.status).toBe(409)
    expect(both.body.error.code).toBe('built_in_game_limit')
    expect((await patch(`/api/decks/${other.id}`).send({ builtInGame: true })).body).toMatchObject({
      builtInGame: true,
    })
    expect((await patch(`/api/decks/${other.id}`).send({ archived: false })).status).toBe(409)
    expect(await activeBuilt()).toBe(25)

    // Back to the previous state: free the slot, un-archive the built deck (fits again), reset the other one.
    expect((await patch(`/api/decks/${spare.id}`).send({ builtInGame: false })).status).toBe(200)
    const restored = await patch(`/api/decks/${built.id}`).send({ archived: false })
    expect(restored.status).toBe(200)
    expect(restored.body).toMatchObject({ builtInGame: true, archivedAt: null })
    expect((await patch(`/api/decks/${other.id}`).send({ archived: false, builtInGame: false })).status).toBe(200)
    expect(await activeBuilt()).toBe(25)
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

  it('opening hand odds (Fase 10): the key attacker by default, two cards at once, and counts typed by hand', async () => {
    interface EnergyOdds {
      attacker: { nameEs: string }
      types: string[]
      attacks: {
        name: string
        payable: boolean
        first: { energies: number; probability: number }[]
        second: { energies: number; probability: number }[]
      }[]
    }
    interface Odds {
      deck: { id: string } | null
      deckSize: number
      basics: number
      groups: { cards: { nameEs: string }[]; copies: number; basicCopies: number }[]
      rows: { turn: number; cardsSeen: number; each: number[]; all: number | null }[]
      basicsInHand: { count: number; probability: number }[]
      note: string
    }
    const blaziken = (await get(`/api/decks/${deckId(2)}/draw-odds`)).body as Odds
    expect(blaziken).toMatchObject({ deck: { id: deckId(2) }, deckSize: 20 })
    expect(blaziken.groups[0]?.cards[0]?.nameEs).toMatch(/Mega-Blaziken ex/)
    expect(blaziken.rows).toHaveLength(7)
    expect(blaziken.rows.map((row) => row.cardsSeen)).toEqual([5, 6, 7, 8, 9, 10, 11])
    expect(blaziken.rows[6]?.each[0]).toBeGreaterThan(blaziken.rows[0]?.each[0] ?? 1)
    expect(blaziken.basicsInHand.reduce((sum, row) => sum + row.probability, 0)).toBeCloseTo(1, 10)
    expect(blaziken.note).toContain('robo natural')
    // Fase 44: the Energy Zone for the attacker's attacks, and the odds counting the search cards.
    const energy = (blaziken as unknown as { energy: EnergyOdds }).energy
    expect(energy.attacker.nameEs).toMatch(/Mega-Blaziken ex/)
    expect(energy.types.length).toBeGreaterThan(0)
    for (const attack of energy.attacks) {
      expect(attack.first[0]?.energies).toBe(0)
      expect(attack.second[0]?.energies).toBe(1)
      expect(attack.first.at(-1)?.probability).toBeGreaterThanOrEqual(attack.first[0]?.probability ?? 0)
    }
    expect((blaziken as unknown as { search: { cards: Record<string, number> } }).search.cards.pokeball).toBe(2)
    const manectric = (await get(`/api/decks/${deckId(4)}/draw-odds`)).body as {
      search: { cards: Record<string, number>; rows: { turn: number; probability: number }[] }
      rows: { each: number[] }[]
    }
    expect(manectric.search.cards).toEqual({ pokeball: 2, research: 2, communication: 1 })
    expect(manectric.search.rows[4]?.probability).toBeGreaterThan(manectric.rows[4]?.each[0] ?? 1)
    // Review of #52: a saved deck that repeats a type (the input schema accepts it) shows the type once.
    const blazikenDeck = (await get(`/api/decks/${deckId(2)}`)).body as {
      cards: { card: { id: string }; count: number }[]
    }
    const repeated = await post('/api/decks').send({
      name: 'Blaziken con Fuego dos veces',
      energies: ['fire', 'fire'],
      cards: blazikenDeck.cards.map((entry) => ({ cardId: entry.card.id, count: entry.count })),
    })
    expect(repeated.status).toBe(201)
    const twice = (await get(`/api/decks/${repeated.body.id}/draw-odds`)).body as { energy: EnergyOdds | null }
    expect(twice.energy?.types).toEqual(['fire'])
    expect((await patch(`/api/decks/${repeated.body.id}`).send({ archived: true })).status).toBe(200)
    expect((await del(`/api/decks/${repeated.body.id}`)).status).toBe(204)

    const deck = (await get(`/api/decks/${deckId(2)}`)).body as {
      cards: { card: { id: string; cardType: string; evolutionType: string; nameEs: string } }[]
    }
    const basic = deck.cards.find((entry) => entry.card.cardType === 'pokemon' && entry.card.evolutionType === 'basic')
    const trainer = deck.cards.find((entry) => entry.card.cardType === 'trainer')
    const both = (
      await get(`/api/decks/${deckId(2)}/draw-odds?cards=${basic?.card.id}&cards2=${trainer?.card.id}&turns=3`)
    ).body as Odds
    expect(both.rows).toHaveLength(4)
    expect(both.groups[0]?.basicCopies).toBeGreaterThan(0)
    for (const row of both.rows) {
      expect(row.all).not.toBeNull()
      expect(row.all ?? 1).toBeLessThanOrEqual(Math.min(...row.each) + 1e-12)
    }
    expect((await get(`/api/decks/${deckId(2)}/draw-odds?cards=A1-1`)).status).toBe(400)
    expect(
      (await get(`/api/decks/${deckId(2)}/draw-odds?cards=${basic?.card.id}&cards2=${basic?.card.id}`)).status,
    ).toBe(400)

    const manual = await post('/api/decks/draw-odds').send({ basics: 18, groups: [{ basic: 0, other: 2 }] })
    expect(manual.status).toBe(200)
    expect((manual.body as Odds).rows[0]?.each[0]).toBeCloseTo(1 - 8568 / 15504, 10)
    expect(manual.body).toMatchObject({ search: null, energy: null })
    expect((await post('/api/decks/draw-odds').send({ basics: 2, groups: [{ basic: 3, other: 0 }] })).status).toBe(400)
    expect((await post('/api/decks/draw-odds').send({ basics: 5, groups: [] })).status).toBe(400)
  })
})
