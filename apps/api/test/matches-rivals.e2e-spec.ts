import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogService } from '../src/catalog/catalog.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { type FetchLike, LimitlessTransport } from '../src/tournaments/limitless.client.js'
import { TournamentSyncService } from '../src/tournaments/tournament-sync.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * Pedido de Santi del 14/10: the rival's cards seen in a match, the era's archetypes they suggest (PMPT #45, B4a,
 * served by a fake Limitless), the matches to classify grouped by cards, and classifying them (and reclassifying).
 */
const LIMITLESS = join(REPO_ROOT, 'docs/fase0/limitless')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const BIG = '6a95b87b629039f77d8a6954'
const read = (file: string): unknown => JSON.parse(readFileSync(join(LIMITLESS, file), 'utf8'))

// Greninja (A1-89), Suicune ex and Indeedee ex: the rival of 14/10 that fits no archetype of B4a.
const GRENINJA = 'A1-89'
const INDEEDEE = 'B1-121'

interface Seen {
  cardId: string
  count: number
  nameEs: string
}

describe('rivals by the cards seen (e2e)', () => {
  let test: TestApp
  let cookie: string
  let deckId: string
  let suicune: string

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })
    const inputs = (preview.body.drafts as { title: string; draft: { energies: string[]; cards: unknown[] } | null }[])
      .filter((d) => d.draft && d.draft.energies.length > 0)
      .slice(0, 1)
      .map((d) => ({ name: d.title, energies: d.draft?.energies, cards: d.draft?.cards }))
    const created = await post('/api/decks/import/commit').send({ decks: inputs })
    expect(created.status).toBe(201)
    deckId = created.body.created[0].id
    const listing = [...(read('t1.json') as { id: string }[]), ...(read('t2.json') as { id: string }[])].filter(
      (tournament) => tournament.id === BIG,
    )
    const fake: FetchLike = async (url) => {
      const path = url.replace(test.env.limitlessBaseUrl, '')
      const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body })
      if (/^\/tournaments\?/.test(path)) return json(200, /page=1$/.test(path) ? listing : [])
      if (path === `/tournaments/${BIG}/details`) return json(200, read('big_details.json'))
      if (path === `/tournaments/${BIG}/standings`) return json(200, read('big_standings.json'))
      return json(404, { message: 'unknown path' })
    }
    test.app.get(LimitlessTransport).fetch = fake
    await test.app.get(TournamentSyncService).run({ now: new Date('2026-10-07T00:00:00Z') })
    suicune = test.app.get(CatalogService).requireIndex().groupsByNameEn('Suicune ex')[0]?.displayCardId as string
    expect(suicune).toBeTruthy()
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  it('a match keeps the cards seen, one line per name; old matches have none; bad cards are refused', async () => {
    const plain = await post('/api/matches').send({ deckId, result: 'win', opponent: 'Mega-Blaziken ex' })
    expect(plain.status).toBe(201)
    expect(plain.body.opponentCards).toEqual([])
    const seen = await post('/api/matches').send({
      deckId,
      result: 'loss',
      opponentCards: [
        { cardId: GRENINJA, count: 1 },
        { cardId: GRENINJA, count: 1 },
        { cardId: suicune, count: 1 },
      ],
    })
    expect(seen.status).toBe(201)
    expect(seen.body.opponent).toBeNull()
    expect((seen.body.opponentCards as Seen[]).map(({ cardId, count }) => ({ cardId, count }))).toEqual([
      { cardId: GRENINJA, count: 2 },
      { cardId: suicune, count: 1 },
    ])
    expect((seen.body.opponentCards as Seen[])[0]?.nameEs).toBeTruthy()
    // Editing: the cards change, and only them.
    const edited = await patch(`/api/matches/${seen.body.id}`).send({
      opponentCards: [
        { cardId: GRENINJA, count: 2 },
        { cardId: suicune, count: 1 },
        { cardId: INDEEDEE, count: 1 },
      ],
    })
    expect(edited.status).toBe(200)
    expect(edited.body.opponentCards).toHaveLength(3)
    expect(edited.body.result).toBe('loss')
    // Unknown card, three copies, too many cards, more than 20 copies (Codex on #114: 11 lines of two): 400.
    const names = new Set<string>()
    const eleven = test.app
      .get(CatalogService)
      .requireIndex()
      .catalog.groups.filter((group) => !names.has(group.nameEn) && names.add(group.nameEn))
      .slice(0, 11)
      .map((group) => ({ cardId: group.displayCardId, count: 2 }))
    for (const opponentCards of [
      [{ cardId: 'ZZ-999', count: 1 }],
      [{ cardId: GRENINJA, count: 3 }],
      Array.from({ length: 21 }, () => ({ cardId: GRENINJA, count: 1 })),
      eleven,
    ]) {
      expect((await post('/api/matches').send({ deckId, result: 'win', opponentCards })).status).toBe(400)
    }
    // Statistics by rival do not change: a match without a rival stays one.
    const stats = (await get('/api/matches/stats')).body as { byOpponent: { label: string }[] }
    expect(stats.byOpponent.map((row) => row.label)).toEqual(expect.arrayContaining(['Mega-Blaziken ex']))
  })

  it("the cards suggest the era's archetypes; Santi's rival only gets «parecido»", async () => {
    const suggestions = await get(`/api/matches/rival-suggestions?cards=${GRENINJA}x2,${suicune},${INDEEDEE}`)
    expect(suggestions.status).toBe(200)
    expect(suggestions.body).toMatchObject({ era: 'B4a', lists: 393 })
    const found = suggestions.body.suggestions as { kind: string; best: number; seen: number; text: string }[]
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((fit) => fit.kind === 'similar' && fit.seen === 3)).toBe(true)
    // One card of a played archetype: some list has it.
    const one = await get(`/api/matches/rival-suggestions?cards=${INDEEDEE}`)
    expect((one.body.suggestions as { kind: string }[])[0]?.kind).toBe('fits')
    expect((await get('/api/matches/rival-suggestions?cards=ZZ-999')).status).toBe(400)
    expect((await get(`/api/matches/rival-suggestions?cards=${GRENINJA}x5`)).status).toBe(400)
  })

  it('the matches to classify come grouped by cards; a group gets a name, and a rival can be renamed', async () => {
    // A second match against the same rival (fewer cards seen): same group.
    const other = await post('/api/matches').send({
      deckId,
      result: 'win',
      opponentCards: [
        { cardId: GRENINJA, count: 1 },
        { cardId: suicune, count: 1 },
      ],
    })
    expect(other.status).toBe(201)
    const pending = await get('/api/matches/unclassified')
    expect(pending.status).toBe(200)
    const groups = pending.body.groups as { matches: { id: string }[]; cards: Seen[]; text: string }[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.matches.map((match) => match.id)).toContain(other.body.id)
    expect(groups[0]?.matches).toHaveLength(2)
    expect(groups[0]?.text).toMatch(/^2 /)
    // Classified as one of the owner's own.
    const ids = groups[0]?.matches.map((match) => match.id) ?? []
    expect((await get('/api/matches/unclassified/count')).body).toEqual({ matches: 2 })
    const named = await post('/api/matches/classify').send({ matchIds: ids, opponent: '  Greninja   Suicune ' })
    expect(named.body).toMatchObject({ updated: 2, opponent: 'Greninja Suicune' })
    // What each match had, for «Deshacer».
    expect(named.body.previous).toEqual(expect.arrayContaining(ids.map((id) => ({ id, opponent: null }))))
    expect((await get('/api/matches/unclassified')).body.groups).toEqual([])
    expect((await get('/api/matches/unclassified/count')).body).toEqual({ matches: 0 })
    // A note about the rival, and a match of it in another mode: renaming carries both.
    const note = await test
      .http()
      .put('/api/rival-notes')
      .set('Cookie', cookie)
      .send({ opponent: 'Greninja Suicune', text: 'Cuidado con el agua.' })
    expect(note.status).toBeLessThan(300)
    const friendly = await post('/api/matches').send({
      deckId,
      result: 'tie',
      opponent: 'greninja suicune',
      mode: 'friend',
    })
    expect(friendly.status).toBe(201)
    // It is no archetype of the era: it shows among the owner's own (every mode counts), and can be moved later.
    const own = (await get('/api/matches/unclassified')).body.own as { key: string; label: string; games: number }[]
    expect(own).toContainEqual(expect.objectContaining({ label: 'Greninja Suicune', games: 3 }))
    const moved = await post('/api/matches/classify').send({
      from: 'greninja suicune',
      opponent: 'Suicune ex Baxcalibur',
    })
    expect(moved.body).toMatchObject({ updated: 3, opponent: 'Suicune ex Baxcalibur' })
    const notes = (await get('/api/rival-notes')).body.items as { key: string; text: string }[]
    expect(notes).toContainEqual(
      expect.objectContaining({ key: 'suicune ex baxcalibur', text: 'Cuidado con el agua.' }),
    )
    expect(notes.some((item) => item.key === 'greninja suicune')).toBe(false)
    expect(moved.body.noteMoved).toEqual({ from: 'Greninja Suicune', to: 'Suicune ex Baxcalibur' })
    // «Deshacer» the rename (Codex on #114): the matches and the note go back together.
    const back = await post('/api/matches/classify').send({
      matchIds: (moved.body.previous as { id: string }[]).map((row) => row.id),
      opponent: 'Greninja Suicune',
      note: { from: 'Suicune ex Baxcalibur', to: 'Greninja Suicune' },
    })
    expect(back.body).toMatchObject({
      updated: 3,
      noteMoved: { from: 'Suicune ex Baxcalibur', to: 'Greninja Suicune' },
    })
    const restored = (await get('/api/rival-notes')).body.items as { key: string; text: string }[]
    expect(restored).toContainEqual(expect.objectContaining({ key: 'greninja suicune', text: 'Cuidado con el agua.' }))
    expect(restored.some((item) => item.key === 'suicune ex baxcalibur')).toBe(false)
    // And again, to go on with the rest of the test.
    expect(
      (await post('/api/matches/classify').send({ from: 'Greninja Suicune', opponent: 'Suicune ex Baxcalibur' })).body
        .noteMoved,
    ).toEqual({ from: 'Greninja Suicune', to: 'Suicune ex Baxcalibur' })
    const noteLabel = async () =>
      ((await get('/api/rival-notes')).body.items as { key: string; label: string }[]).find(
        (item) => item.key === 'suicune ex baxcalibur',
      )?.label
    // Codex on #114: the same rival in another spelling renames the note's label too, and «Deshacer» gives it back.
    const respelled = await post('/api/matches/classify').send({
      from: 'Suicune ex Baxcalibur',
      opponent: 'Suicune EX Baxcalibur',
    })
    expect(respelled.body).toMatchObject({
      updated: 3,
      noteMoved: { from: 'Suicune ex Baxcalibur', to: 'Suicune EX Baxcalibur' },
    })
    expect(await noteLabel()).toBe('Suicune EX Baxcalibur')
    const spelledBack = await post('/api/matches/classify').send({
      matchIds: (respelled.body.previous as { id: string }[]).map((row) => row.id),
      opponent: 'Suicune ex Baxcalibur',
      expect: 'Suicune EX Baxcalibur',
      note: { from: 'Suicune EX Baxcalibur', to: 'Suicune ex Baxcalibur' },
    })
    expect(spelledBack.body).toMatchObject({ updated: 3, noteMoved: { to: 'Suicune ex Baxcalibur' } })
    expect(await noteLabel()).toBe('Suicune ex Baxcalibur')
    // Codex on #114: a stale «Deshacer» (every match edited since) restores no match, and the note stays where it is.
    const renamed = await post('/api/matches/classify').send({ from: 'Suicune ex Baxcalibur', opponent: 'Otro nombre' })
    const renamedIds = (renamed.body.previous as { id: string }[]).map((row) => Number(row.id))
    await test.prisma.match.updateMany({ where: { id: { in: renamedIds } }, data: { opponentText: 'Cambiado' } })
    const stale = await post('/api/matches/classify').send({
      matchIds: renamedIds.map(String),
      opponent: 'Suicune ex Baxcalibur',
      expect: 'Otro nombre',
      note: { from: 'Otro nombre', to: 'Suicune ex Baxcalibur' },
    })
    expect(stale.body).toMatchObject({ updated: 0, noteMoved: null })
    const notesNow = (await get('/api/rival-notes')).body.items as { key: string }[]
    expect(notesNow.some((item) => item.key === 'otro nombre')).toBe(true)
    // Back as it was, to go on with the rest of the test.
    await test.prisma.match.updateMany({
      where: { id: { in: renamedIds } },
      data: { opponentText: 'Suicune ex Baxcalibur' },
    })
    await test.prisma.rivalNote.update({
      where: { key: 'otro nombre' },
      data: { key: 'suicune ex baxcalibur', label: 'Suicune ex Baxcalibur' },
    })
    const list = (await get('/api/matches?opponent=Suicune%20ex%20Baxcalibur&opponentMatch=exact')).body.items as {
      opponent: string
      opponentCards: Seen[]
    }[]
    expect(list).toHaveLength(3)
    expect(list.filter((match) => match.opponentCards.length > 0)).toHaveLength(2)
    // «Deshacer» with `null`: back to «sin clasificar».
    // Codex on #114: with the rival they must still have, one edited since is left as it is.
    expect((await patch(`/api/matches/${ids[1]}`).send({ opponent: 'Otro rival' })).status).toBe(200)
    const undone = await post('/api/matches/classify').send({
      matchIds: ids,
      opponent: null,
      expect: 'Suicune ex Baxcalibur',
    })
    expect(undone.body).toMatchObject({ updated: 1, opponent: null, skipped: [ids[1]] })
    expect((await get(`/api/matches/${ids[1]}`)).body.opponent).toBe('Otro rival')
    // Assigning only the ones still without a rival: the edited one stays too.
    const again = await post('/api/matches/classify').send({ matchIds: ids, opponent: 'Uno', expect: null })
    expect(again.body).toMatchObject({ updated: 1, skipped: [ids[1]] })
    expect((await post('/api/matches/classify').send({ matchIds: [ids[0] as string], opponent: null })).status).toBe(
      200,
    )
    expect((await post('/api/matches/classify').send({ matchIds: [ids[1] as string], opponent: null })).status).toBe(
      200,
    )
    expect((await get('/api/matches/unclassified/count')).body).toEqual({ matches: 2 })
    // A card the catalog no longer has: the match can still be edited (its stored cards stay).
    await test.prisma.match.update({
      where: { id: Number(ids[0]) },
      data: { opponentCards: [{ cardId: 'GONE-1', count: 1 }] },
    })
    const kept = await patch(`/api/matches/${ids[0]}`).send({
      note: 'editada',
      opponentCards: [{ cardId: 'GONE-1', count: 1 }],
    })
    expect(kept.status).toBe(200)
    expect(
      (await get('/api/matches/unclassified')).body.groups.flatMap((group: { matches: { id: string }[] }) =>
        group.matches.map((match) => match.id),
      ),
    ).toContain(ids[0])
    // Refused: nothing to classify, an empty rival, a match that does not exist.
    expect((await post('/api/matches/classify').send({ opponent: 'X' })).status).toBe(400)
    expect((await post('/api/matches/classify').send({ matchIds: ids, opponent: '   ' })).status).toBe(400)
    expect((await post('/api/matches/classify').send({ matchIds: ['999999'], opponent: 'X' })).status).toBe(404)
  })

  it('needs a session', async () => {
    expect((await test.http().get('/api/matches/unclassified')).status).toBe(401)
    expect((await test.http().get(`/api/matches/rival-suggestions?cards=${GRENINJA}`)).status).toBe(401)
    expect(
      (
        await test
          .http()
          .post('/api/matches/classify')
          .send({ matchIds: ['1'], opponent: 'X' })
      ).status,
    ).toBe(401)
  })
})
