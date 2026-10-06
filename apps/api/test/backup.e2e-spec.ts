import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { BACKUP_BLOBS_KEPT, BackupService } from '../src/backup/backup.service.js'
import { BackupCronService } from '../src/backup/backup-cron.service.js'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** PLAN §7 (backup acceptance): export → import into an empty database → identical export except `exportedAt`. */
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
  decks: { id: number; variantOfId: number | null; revisions: unknown[]; changes: unknown[] }[]
  tokens: { name: string }[]
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

    const response = await get('/api/backup/export').responseType('blob')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/gzip')
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="tcgpocket-backup-\d{8}\.json\.gz"$/)
    exported = response.body as Buffer
    document = JSON.parse(gunzipSync(exported).toString('utf8')) as Doc
    expect(document).toMatchObject({
      schemaVersion: 1,
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
    expect(document.tokens.map((t) => t.name)).toEqual(['worker'])
    expect(document.tokens[0]).not.toHaveProperty('tokenHash')
    expect(document.rarityRules.length).toBeGreaterThan(0)
  })

  it('dry-run reports counts and notices without touching the data', async () => {
    const response = await post('/api/backup/import?mode=dry-run').attach('file', exported, 'backup.json.gz')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ schemaVersion: 1, catalogCommit: test.env.catalogCommit })
    expect(response.body.diff.incoming).toEqual(response.body.diff.current)
    expect(response.body.diff.needsReview).toBe(false)
    expect(response.body.diff.unknownCardIds).toEqual([])
    expect(response.body.diff.notices.some((n: string) => n.includes('tokens'))).toBe(true)
    expect((await post('/api/backup/import').attach('file', Buffer.from('nope'), 'x.gz')).body.error.code).toBe(
      'invalid_backup',
    )
    const old = gzipSync(Buffer.from(JSON.stringify({ ...document, schemaVersion: 7 })))
    expect((await post('/api/backup/import').attach('file', old, 'x.gz')).body.error.code).toBe('unsupported_schema')
    // A gzip bomb (300 MiB of zeros in ~300 KB, concatenated gzip members) is refused before it can inflate.
    const member = gzipSync(Buffer.alloc(1024 * 1024))
    const bomb = Buffer.concat(Array.from({ length: 300 }, () => member))
    expect(bomb.length).toBeLessThan(1024 * 1024)
    const bombed = await post('/api/backup/import').attach('file', bomb, 'bomb.json.gz')
    expect(bombed.status).toBe(400)
    expect(bombed.body.error.code).toBe('invalid_backup')
    expect(bombed.body.error.message).toContain('128 MB')
    expect((await post('/api/backup/import?mode=replace')).status).toBe(400)
    expect((await post('/api/backup/import?mode=nope').attach('file', exported, 'b.gz')).status).toBe(400)
  })

  it('restores into an emptied database and exports the same document (except exportedAt)', async () => {
    await test.prisma.deck.deleteMany()
    await test.prisma.collectionAdjustment.deleteMany()
    await test.prisma.collectionStock.deleteMany()
    await test.prisma.collectionImport.deleteMany()
    await test.prisma.appSetting.deleteMany()
    expect((await get('/api/decks')).body.items).toEqual([])
    expect((await get('/api/collection/summary')).body.copies).toBe(0)

    const response = await post('/api/backup/import?mode=replace').attach('file', exported, 'backup.json.gz')
    expect(response.status).toBe(200)
    expect(response.body.applied).toBe(true)
    expect(response.body.counts).toMatchObject({ decks: 3, imports: 1, importRows: 4317, adjustments: 2, settings: 2 })

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
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.decks).toHaveLength(4)
    expect((await get('/api/backup/blobs/999999')).status).toBe(404)
    expect((await test.http().get('/api/backup/export')).status).toBe(401)
  })
})
