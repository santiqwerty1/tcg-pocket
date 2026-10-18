import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { BACKUP_BLOBS_KEPT, BackupService } from '../src/backup/backup.service.js'
import { BackupCronService } from '../src/backup/backup-cron.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * PLAN §7 (backup acceptance): export → import into an empty database → identical export except `exportedAt`.
 * Fase 2: matches travel in the backup (schemaVersion 2); Fase 4: pack switches (3); Fase 8: the results of the games
 * against the bot (5). Older files still read.
 */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

interface Doc {
  schemaVersion: number
  exportedAt: string
  catalogCommit: string | null
  engineRev: string | null
  settings: unknown[]
  rarityRules: unknown[]
  collection: { stock: unknown[]; imports: { rows: unknown[] }[]; adjustments: unknown[] }
  decks: { id: number; variantOfId: number | null; revisions: { id: number }[]; changes: unknown[] }[]
  matches: { id: number; deckId: number; deckRevisionId: number; result: string; opponentText: string | null }[]
  tokens: { name: string }[]
  playedGames?: { id: number; humanLabel: string; rivalLabel: string; winner: string }[]
}

function withoutExportedAt(doc: Doc): Omit<Doc, 'exportedAt'> {
  const { exportedAt: _exportedAt, ...rest } = doc
  return rest
}

describe('backup and settings (e2e)', () => {
  let test: TestApp
  let cookie: string
  let exported: Buffer
  let document: Doc
  let deckIds: string[]

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
  })

  afterAll(async () => {
    await test.close()
  })

  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)

  it('stores settings by known key', async () => {
    expect((await get('/api/settings')).body).toEqual({})
    const saved = await put('/api/settings/ui').send({ value: { thumbnails: true } })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({ key: 'ui', value: { thumbnails: true } })
    expect((await put('/api/settings/minPlayers').send({ value: 16 })).body).toEqual({ key: 'minPlayers', value: 16 })
    expect((await get('/api/settings')).body).toEqual({ minPlayers: 16, ui: { thumbnails: true } })
    const unknown = await put('/api/settings/whatever').send({ value: 1 })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('validation')
    expect((await put('/api/settings/ui').send({})).status).toBe(400)
    expect((await test.http().get('/api/settings')).status).toBe(401)
  })

  it('exports everything the owner produced as gzip JSON', async () => {
    // Owner data: the real collection, an active and a resolved adjustment, decks with revisions and changes, a token.
    const preview = await post('/api/collection/imports').attach('file', readFileSync(CSV_PATH), 'export.csv')
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const latias = await post('/api/collection/adjustments').send({ functionalGroupId: 'A4a-36', playableCopies: 1 })
    expect(
      (await post(`/api/collection/adjustments/${latias.body.id}/resolve`).send({ resolution: 'user' })).status,
    ).toBe(200)
    expect(
      (await post('/api/collection/adjustments').send({ functionalGroupId: 'B2-113', playableCopies: 1 })).status,
    ).toBe(201)
    const drafts = (await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })).body.drafts
    const inputs = drafts
      .slice(0, 2)
      .map((d: { title: string; draft: { energies: string[]; cards: unknown[]; notes?: string } }) => ({
        name: d.title,
        energies: d.draft.energies,
        cards: d.draft.cards,
        notes: d.draft.notes ?? '',
        tags: ['backup'],
      }))
    const created = (await post('/api/decks/import/commit').send({ decks: inputs })).body.created
    deckIds = created.map((d: { id: string }) => d.id)
    const first = (await get(`/api/decks/${deckIds[0]}`)).body
    const cards = first.cards.map((c: { card: { id: string }; count: number }) => ({
      cardId: c.card.id,
      count: c.count,
    }))
    cards[0].count = 1
    expect(
      (await patch(`/api/decks/${deckIds[0]}`).send({ cards, name: 'Editado', builtInGame: true, note: 'r2' })).status,
    ).toBe(200)
    const copy = await post(`/api/decks/${deckIds[0]}/duplicate`).send({ name: 'Copia' })
    expect(copy.status).toBe(201)
    deckIds.push(copy.body.id)
    expect((await post('/api/tokens').send({ name: 'worker', kind: 'worker', scopes: ['worker:claim'] })).status).toBe(
      201,
    )
    // Two matches: one now on the edited deck (revision 2), one dated last week on the second deck.
    expect(
      (await post('/api/matches').send({ deckId: deckIds[0], result: 'win', opponent: 'Mega-Blaziken ex' })).status,
    ).toBe(201)
    expect(
      (
        await post('/api/matches').send({
          deckId: deckIds[1],
          result: 'loss',
          wentFirst: false,
          mode: 'competitive',
          note: 'backup',
          playedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          // Version 9 (14/10): the rival's cards seen travel with the match.
          opponentCards: [{ cardId: 'A1-89', count: 2 }],
        })
      ).status,
    ).toBe(201)
    // Pack switch (Fase 4): B4b turned off travels in the backup; A4b starts off by default.
    expect((await patch('/api/packs/B4b/deluxepackmega').send({ available: false })).status).toBe(200)
    // «Tiempo limitado» with its last day travels too.
    expect((await patch('/api/packs/A1/mewtwopack').send({ limited: true, limitedUntil: '2026-12-01' })).status).toBe(
      200,
    )

    // Notes by rival (Fase 12) travel too.
    expect((await put('/api/rival-notes').send({ opponent: 'Mega Blaziken ex', text: 'Nota de prueba.' })).status).toBe(
      200,
    )
    // Games against the bot (Fase 8, D-019): only the finished one travels, and only its result.
    const engineRev = test.env.engineRev ?? 'test'
    await test.prisma.liveGame.create({
      data: {
        status: 'done',
        humanSnapshotId: 901,
        botSnapshotId: 902,
        humanLabel: 'Editado (rev. 2)',
        rivalLabel: 'Mega-Blaziken ex',
        bot: 'e2',
        seed: 12345678901234n,
        engineRev,
        choices: [0, 1, 2],
        log: [{ turn: 1 }],
        winner: 'you',
        turns: 9,
        finishedAt: new Date(),
      },
    })
    await test.prisma.liveGame.create({
      data: {
        status: 'waiting',
        humanSnapshotId: 901,
        botSnapshotId: 903,
        humanLabel: 'Editado (rev. 2)',
        rivalLabel: 'Lucario',
        bot: 'e2',
        seed: 7n,
        engineRev,
        choices: [],
      },
    })

    const response = await get('/api/backup/export').responseType('blob')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/gzip')
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="tcgpocket-backup-\d{8}\.json\.gz"$/)
    exported = response.body as Buffer
    document = JSON.parse(gunzipSync(exported).toString('utf8')) as Doc
    const seen = document.matches.map((match) => (match as { opponentCards?: unknown }).opponentCards)
    expect(seen).toEqual(expect.arrayContaining([[], [{ cardId: 'A1-89', count: 2 }]]))
    expect(document).toMatchObject({
      schemaVersion: 9,
      catalogCommit: test.env.catalogCommit,
      engineRev: test.env.engineRev,
      settings: [
        { key: 'minPlayers', value: 16 },
        { key: 'ui', value: { thumbnails: true } },
      ],
    })
    expect(document.collection.stock.length).toBeGreaterThan(2000)
    expect(document.collection.imports).toHaveLength(1)
    expect(document.collection.imports[0]?.rows).toHaveLength(4317)
    expect(document.collection.imports[0]).not.toHaveProperty('rawFileGz')
    expect(document.collection.adjustments).toHaveLength(2)
    expect(document.decks.map((d) => d.id)).toEqual(deckIds.map(Number))
    expect(document.decks[0]?.revisions).toHaveLength(2)
    expect(document.decks[0]?.changes.length).toBeGreaterThanOrEqual(2)
    expect(document.decks[2]?.variantOfId).toBe(Number(deckIds[0]))
    const packs = (document as unknown as { packs: Record<string, unknown>[] }).packs
    expect(packs.find((pack) => pack.id === 'B4b/deluxepackmega')).toEqual({
      id: 'B4b/deluxepackmega',
      available: false,
      pointsBalance: null,
      limited: true,
      limitedUntil: '2026-10-28',
    })
    expect(packs.find((pack) => pack.id === 'A4b/deluxepack')?.available).toBe(false)
    expect(packs.find((pack) => pack.id === 'A1/mewtwopack')).toMatchObject({
      available: true,
      limited: true,
      limitedUntil: '2026-12-01',
    })
    expect(document.matches).toHaveLength(2)
    expect(document.matches[0]).toMatchObject({
      deckId: Number(deckIds[0]),
      deckRevisionId: document.decks[0]?.revisions[1]?.id,
      result: 'win',
      opponentText: 'Mega-Blaziken ex',
    })
    expect(document.matches[1]).toMatchObject({ deckId: Number(deckIds[1]), result: 'loss', mode: 'competitive' })
    expect(document.tokens.map((t) => t.name)).toEqual(['worker'])
    expect(document.tokens[0]).not.toHaveProperty('tokenHash')
    expect(document.rarityRules.length).toBeGreaterThan(0)
    expect((document as unknown as { rivalNotes: unknown[] }).rivalNotes).toEqual([
      expect.objectContaining({ key: 'mega blaziken ex', label: 'Mega Blaziken ex', text: 'Nota de prueba.' }),
    ])
    expect(document.playedGames).toEqual([
      {
        id: expect.any(Number),
        humanLabel: 'Editado (rev. 2)',
        rivalLabel: 'Mega-Blaziken ex',
        bot: 'e2',
        seed: '12345678901234',
        engineRev,
        winner: 'you',
        turns: 9,
        createdAt: expect.any(String),
        finishedAt: expect.any(String),
      },
    ])
  })

  it('dry-run reports counts and notices without touching the data', async () => {
    const response = await post('/api/backup/import?mode=dry-run').attach('file', exported, 'backup.json.gz')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ schemaVersion: 9, catalogCommit: test.env.catalogCommit })
    expect(response.body.diff.incoming.matches).toBe(2)
    expect(response.body.diff.incoming.playedGames).toBe(1)
    expect(response.body.diff.incoming).toEqual(response.body.diff.current)
    expect(response.body.diff.needsReview).toBe(false)
    expect(response.body.diff.unknownCardIds).toEqual([])
    expect(response.body.diff.notices.some((n: string) => n.includes('tokens'))).toBe(true)
    expect((await post('/api/backup/import').attach('file', Buffer.from('nope'), 'x.gz')).body.error.code).toBe(
      'invalid_backup',
    )
    const old = gzipSync(Buffer.from(JSON.stringify({ ...document, schemaVersion: 99 })))
    expect((await post('/api/backup/import').attach('file', old, 'x.gz')).body.error.code).toBe('unsupported_schema')
    // A gzip bomb (300 MiB of zeros in ~300 KB, concatenated gzip members) is refused before it can inflate.
    const member = gzipSync(Buffer.alloc(1024 * 1024))
    const bomb = Buffer.concat(Array.from({ length: 300 }, () => member))
    expect(bomb.length).toBeLessThan(1024 * 1024)
    const bombed = await post('/api/backup/import').attach('file', bomb, 'bomb.json.gz')
    expect(bombed.status).toBe(400)
    expect(bombed.body.error.code).toBe('invalid_backup')
    expect(bombed.body.error.message).toContain('128 MB')
    // A version-3 file from before «tiempo limitado» still reads (the switches stay as they are).
    const packsOnly = (document as unknown as { packs: Record<string, unknown>[] }).packs.map(
      ({ limited: _limited, limitedUntil: _until, ...rest }) => rest,
    )
    const earlier = gzipSync(Buffer.from(JSON.stringify({ ...document, packs: packsOnly })))
    expect((await post('/api/backup/import?mode=dry-run').attach('file', earlier, 'x.gz')).status).toBe(200)
    expect((await post('/api/backup/import?mode=replace')).status).toBe(400)
    expect((await post('/api/backup/import?mode=nope').attach('file', exported, 'b.gz')).status).toBe(400)
  })

  it('restores into an emptied database and exports the same document (except exportedAt)', async () => {
    await test.prisma.match.deleteMany()
    await test.prisma.liveGame.deleteMany({ where: { status: 'done' } })
    await test.prisma.rivalNote.deleteMany()
    await test.prisma.deck.deleteMany()
    await test.prisma.collectionAdjustment.deleteMany()
    await test.prisma.collectionStock.deleteMany()
    await test.prisma.collectionImport.deleteMany()
    await test.prisma.appSetting.deleteMany()
    await test.prisma.pack.updateMany({ data: { available: true, limited: false, limitedUntil: null } })
    expect((await get('/api/decks')).body.items).toEqual([])
    expect((await get('/api/collection/summary')).body.copies).toBe(0)

    const response = await post('/api/backup/import?mode=replace').attach('file', exported, 'backup.json.gz')
    expect(response.status).toBe(200)
    expect(response.body.applied).toBe(true)
    expect(response.body.counts).toMatchObject({
      decks: 3,
      imports: 1,
      importRows: 4317,
      adjustments: 2,
      settings: 2,
      matches: 2,
      playedGames: 1,
      rivalNotes: 1,
    })
    const packs = (await get('/api/packs')).body.items as { id: string; available: boolean }[]
    expect(packs.find((pack) => pack.id === 'B4b/deluxepackmega')).toMatchObject({
      available: false,
      limited: true,
      limitedUntil: '2026-10-28',
    })
    expect(packs.find((pack) => pack.id === 'A4b/deluxepack')?.available).toBe(false)

    const again = await get('/api/backup/export').responseType('blob')
    const restored = JSON.parse(gunzipSync(again.body as Buffer).toString('utf8')) as Doc
    expect(restored.exportedAt).not.toBe(document.exportedAt)
    expect(withoutExportedAt(restored)).toEqual(withoutExportedAt(document))

    const decks = await get('/api/decks')
    expect(decks.body.items.map((d: { id: string }) => d.id)).toEqual(deckIds)
    expect(decks.body.items[0]).toMatchObject({ name: 'Editado', revisionNumber: 2, builtInGame: true })
    expect((await get(`/api/decks/${deckIds[0]}`)).body.changes.length).toBeGreaterThanOrEqual(2)
    expect((await get('/api/groups/A1-1')).body.group.playable).toBe(3)
    expect((await get('/api/groups/B2-113')).body.group).toMatchObject({ playable: 1, fromStock: 2 })
    expect((await get('/api/collection/summary')).body).toMatchObject({ copies: 4714, activeAdjustments: 1 })
    expect((await get('/api/collection/imports')).body.items[0].status).toBe('applied')
    expect((await get('/api/settings')).body).toEqual({ minPlayers: 16, ui: { thumbnails: true } })

    // Sequences follow the restored ids: new rows do not collide.
    const fresh = await post('/api/decks').send({ name: 'Nuevo', energies: ['fire'], cards: [] })
    expect(fresh.status).toBe(201)
    expect(Number(fresh.body.id)).toBeGreaterThan(Math.max(...deckIds.map(Number)))
    expect(
      (await post('/api/collection/adjustments').send({ functionalGroupId: 'A4a-36', playableCopies: 2 })).status,
    ).toBe(201)

    // Matches come back with their deck revision; the statistics see them and new ids do not collide.
    const matches = await get('/api/matches')
    expect(matches.body.total).toBe(2)
    expect(matches.body.items[0]).toMatchObject({ deck: { id: deckIds[0] }, deckRevision: 2, result: 'win' })
    expect((await get('/api/matches/stats')).body.overall.record).toEqual({ wins: 1, losses: 1, ties: 0 })
    const logged = await post('/api/matches').send({ deckId: deckIds[0], result: 'tie' })
    expect(logged.status).toBe(201)
    expect(Number(logged.body.id)).toBeGreaterThan(Math.max(...document.matches.map((m) => m.id)))
    expect((await test.http().delete(`/api/matches/${logged.body.id}`).set('Cookie', cookie)).status).toBe(204)

    // The finished game comes back as a result (no moves, no replay); the one being played was left alone.
    const games = (await get('/api/play')).body.items as { id: number; status: string; human: string; rival: string }[]
    expect(games.map((game) => [game.status, game.rival])).toEqual([
      ['waiting', 'Lucario'],
      ['done', 'Mega-Blaziken ex'],
    ])
    const played = await get(`/api/play/${games[1]?.id}`)
    expect(played.status).toBe(200)
    expect(played.body).toMatchObject({
      status: 'done',
      winner: 'you',
      turns: 9,
      replay: false,
      log: [],
      human: { label: 'Editado (rev. 2)', deckId: null },
      rival: { label: 'Mega-Blaziken ex' },
    })
  })

  it('reads a version 1 backup (no matches) and warns that restoring it drops the current matches', async () => {
    const { matches: _matches, ...rest } = document
    const v1 = gzipSync(Buffer.from(JSON.stringify({ ...rest, schemaVersion: 1 })))
    const dry = await post('/api/backup/import?mode=dry-run').attach('file', v1, 'v1.json.gz')
    expect(dry.status).toBe(200)
    expect(dry.body.schemaVersion).toBe(1)
    expect(dry.body.diff.incoming.matches).toBe(0)
    expect(dry.body.diff.current.matches).toBe(2)
    expect(dry.body.diff.notices.some((n: string) => n.includes('no trae partidas'))).toBe(true)
    expect(dry.body.diff.notices.some((n: string) => n.includes('partidas contra el bot'))).toBe(true)
    expect(dry.body.diff.notices.some((n: string) => n.includes('notas por rival'))).toBe(true)
  })

  it('refuses a backup whose matches point to a deck revision that is not in the file', async () => {
    const otherDeckRevision = document.decks[1]?.revisions[0]?.id
    const broken = {
      ...document,
      matches: [{ ...document.matches[0], deckRevisionId: otherDeckRevision }],
    }
    const response = await post('/api/backup/import?mode=dry-run').attach(
      'file',
      gzipSync(Buffer.from(JSON.stringify(broken))),
      'b.json.gz',
    )
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('invalid_backup')
    expect(response.body.error.details).toEqual([
      { id: document.matches[0]?.id, deckId: document.matches[0]?.deckId, deckRevisionId: otherDeckRevision },
    ])
  })

  it('refuses a replace that references cards missing from the catalog', async () => {
    const broken = {
      ...document,
      collection: {
        ...document.collection,
        stock: [
          ...document.collection.stock,
          {
            cardId: 'ZZ-1',
            amountOwned: 1,
            collected: true,
            source: 'manual',
            importId: null,
            updatedAt: document.exportedAt,
          },
        ],
      },
    }
    const file = gzipSync(Buffer.from(JSON.stringify(broken)))
    const dry = await post('/api/backup/import?mode=dry-run').attach('file', file, 'b.json.gz')
    expect(dry.body.diff.unknownCardIds).toEqual(['ZZ-1'])
    const replace = await post('/api/backup/import?mode=replace').attach('file', file, 'b.json.gz')
    expect(replace.status).toBe(400)
    expect(replace.body.error.code).toBe('unknown_card')
    expect((await get('/api/decks')).body.items.length).toBe(4)
  })

  it('keeps the last 14 daily snapshots and serves them', async () => {
    const backup = test.app.get(BackupService)
    const cron = test.app.get(BackupCronService)
    await cron.daily()
    expect(await test.prisma.backupBlob.count()).toBe(0)
    test.env.backupCron = true
    await cron.daily()
    expect(await test.prisma.backupBlob.count()).toBe(1)
    for (let i = 0; i < BACKUP_BLOBS_KEPT + 2; i += 1) await backup.snapshot()
    expect(await test.prisma.backupBlob.count()).toBe(BACKUP_BLOBS_KEPT)

    const list = await get('/api/backup/blobs')
    expect(list.status).toBe(200)
    expect(list.body.items).toHaveLength(BACKUP_BLOBS_KEPT)
    const newest = list.body.items[0]
    expect(typeof newest.id).toBe('string')
    expect(newest.sizeBytes).toBeGreaterThan(1000)
    const download = await get(`/api/backup/blobs/${newest.id}`).responseType('blob')
    expect(download.status).toBe(200)
    expect(download.headers['content-type']).toBe('application/gzip')
    const parsed = JSON.parse(gunzipSync(download.body as Buffer).toString('utf8')) as Doc
    expect(parsed.schemaVersion).toBe(9)
    expect(parsed.matches).toHaveLength(2)
    expect(parsed.decks).toHaveLength(4)
    expect((await get('/api/backup/blobs/999999')).status).toBe(404)
    expect((await test.http().get('/api/backup/export')).status).toBe(401)
  })

  /** The owner's data, without the drill's own record (it is the one thing the drill keeps). */
  const owned = (doc: unknown) => {
    const copy = withoutExportedAt(JSON.parse(JSON.stringify(doc)) as Doc)
    return { ...copy, settings: (copy.settings as { key: string }[]).filter((row) => row.key !== 'backupDrill') }
  }

  it('D-015: simulations stay outside backup v7 and replace preserves their priority', async () => {
    const job = await test.prisma.simulationJob.create({
      data: {
        kind: 'matrix',
        label: 'Adelantada fuera del backup',
        params: {},
        priority: 2,
        engineRev: test.env.engineRev,
        players: ['r', 'r'],
        gamesPerPair: 10,
        baseSeed: 1n,
        totalGames: 10,
      },
    })
    try {
      const copy = await get('/api/backup/export').responseType('blob')
      const doc = JSON.parse(gunzipSync(copy.body as Buffer).toString('utf8'))
      expect(doc.schemaVersion).toBe(9)
      expect(Object.keys(doc).some((key) => /simulat/i.test(key))).toBe(false)
      expect(JSON.stringify(doc)).not.toContain(job.label)
      expect((await post('/api/backup/import?mode=replace').attach('file', copy.body, 'backup.json.gz')).status).toBe(
        200,
      )
      expect(await test.prisma.simulationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
        priority: 2,
        status: 'queued',
      })
    } finally {
      await test.prisma.simulationJob.delete({ where: { id: job.id } })
    }
  })

  it('prueba del backup (Fase 35): restores a fresh copy inside a transaction, compares it and rolls back', async () => {
    const backup = test.app.get(BackupService)
    const before = owned(await backup.exportDocument())
    const blobs = await test.prisma.backupBlob.count()
    expect((await get('/api/backup/drill')).body).toEqual({ drill: null })

    const ran = await test.http().post('/api/backup/drill').set('Cookie', cookie)
    expect(ran.status).toBe(200)
    expect(ran.body.drill).toMatchObject({ ok: true, differences: [], error: null })
    expect(ran.body.drill.counts).toMatchObject({ decks: 4, matches: 2 })
    expect(ran.body.drill.sizeBytes).toBeGreaterThan(1000)
    expect((await get('/api/backup/drill')).body.drill.blobId).toBe(ran.body.drill.blobId)
    // The copy it made is kept like a daily one (the oldest goes); the data did not move.
    expect(await test.prisma.backupBlob.count()).toBe(Math.min(blobs + 1, BACKUP_BLOBS_KEPT))
    expect(owned(await backup.exportDocument())).toEqual(before)

    // A restore that does not give the file back: the drill says what changed and Avisos warns.
    const real = backup.exportDocument.bind(backup)
    const spy = vi.spyOn(backup, 'exportDocument').mockImplementation(async (db) => {
      const doc = await real(db)
      return db ? { ...doc, matches: [] } : doc
    })
    try {
      const failed = await backup.drill()
      expect(failed).toMatchObject({ ok: false, differences: ['matches (2 → 0)'], error: null })
    } finally {
      spy.mockRestore()
    }
    const alerts = (await get('/api/alerts')).body.items as { code: string; title: string }[]
    expect(alerts.find((alert) => alert.code === 'backup_drill')?.title).toBe('Falló la prueba del backup')
    expect(owned(await backup.exportDocument())).toEqual(before)
  })
})
