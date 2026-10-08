import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** Fixtures of docs/PLAN.md §7 (M2 acceptance) and Apéndice B for the 6/10/2026 export. */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const CSV_FILE_NAME = 'tcgcollectiontracterexport-2026-10-06.csv'
const EXPECTED = {
  rows: 4317,
  naiveTotal: 5844,
  dedupTotal: 4714,
  stockUnitsCollected: 2083,
  groupsWithOne: 1853,
  groupsWithTwo: 1255,
  groupsMissing: 466,
}
const PLAYABLE: Record<string, number> = {
  'B2-113': 2, // Mega-Mawile ex
  'B3b-64': 3, // Globito
  'A1-1': 3, // Bulbasaur (A4b-1 shares the stock unit)
  'A4a-36': 2, // Latias
  'A4a-37': 2, // Latios
  'B4-103': 1, // Hoopa ex
  'A4-83': 2, // Espeon ex
  'B4-35': 1, // Mega Sharpedo ex
  'A2-91': 1, // Riolu
  'B3-79': 9, // Riolu (B3)
}
const LATIAS = 'A4a-36'

describe('collection (e2e)', () => {
  let test: TestApp
  let cookie: string
  const csvBytes = readFileSync(CSV_PATH)
  let importId: string
  let latiasTwoId: string

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
  const patch = (path: string) => test.http().patch(path).set('Cookie', cookie)
  const playableOf = async (groupId: string): Promise<number> => {
    const response = await get(`/api/groups/${groupId}`)
    expect(response.status).toBe(200)
    return response.body.group.playable as number
  }

  it('starts empty and requires the session', async () => {
    const summary = await get('/api/collection/summary')
    expect(summary.status).toBe(200)
    expect(summary.body).toEqual({
      copies: 0,
      stockUnitsCollected: 0,
      groupsWithAtLeast: { one: 0, two: 0 },
      groupsMissing: 2319,
      lastImportAt: null,
      activeAdjustments: 0,
    })
    expect((await test.http().get('/api/collection/summary')).status).toBe(401)
    expect((await test.http().post('/api/collection/imports').attach('file', csvBytes, CSV_FILE_NAME)).status).toBe(401)
  })

  it('rejects a file that is not a tracker export and a body without file nor csv', async () => {
    const notCsv = await post('/api/collection/imports').attach('file', Buffer.from('hola\n1,2'), 'x.csv')
    expect(notCsv.status).toBe(400)
    expect(notCsv.body.error.code).toBe('invalid_csv')
    const nothing = await post('/api/collection/imports').send({})
    expect(nothing.status).toBe(400)
    expect(nothing.body.error.code).toBe('validation')
  })

  it('an adjustment created before the import is reported as already matching (rule a)', async () => {
    const created = await post('/api/collection/adjustments').send({
      functionalGroupId: LATIAS,
      playableCopies: 2,
      reason: 'tengo dos',
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      functionalGroupId: LATIAS,
      nameEs: 'Latias',
      playableCopies: 2,
      fromStock: 0,
      active: true,
      reason: 'tengo dos',
      resolvedAt: null,
      resolution: null,
    })
    expect(typeof created.body.id).toBe('string')
    latiasTwoId = created.body.id
    const duplicate = await post('/api/collection/adjustments').send({ functionalGroupId: LATIAS, playableCopies: 1 })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('adjustment_active')
    const unknownGroup = await post('/api/collection/adjustments').send({
      functionalGroupId: 'ZZ-1',
      playableCopies: 1,
    })
    expect(unknownGroup.status).toBe(404)
    expect(await playableOf(LATIAS)).toBe(2)
  })

  it('previews the real CSV: 4317 rows, naive 5844 vs dedup 4714, no errors', async () => {
    const response = await post('/api/collection/imports').attach('file', csvBytes, CSV_FILE_NAME)
    expect(response.status).toBe(201)
    const preview = response.body
    expect(preview).toMatchObject({
      fileName: CSV_FILE_NAME,
      status: 'pending',
      appliedAt: null,
      rowCount: EXPECTED.rows,
      naiveTotal: EXPECTED.naiveTotal,
      dedupTotal: EXPECTED.dedupTotal,
      bom: true,
      lineEnding: 'LF',
      errors: [],
      unknownIds: [],
      twinConflicts: [],
      internalIdMismatches: 0,
      blocked: false,
      adjustmentsHidingChange: [],
    })
    expect(typeof preview.id).toBe('string')
    expect(preview.summary.unitsChanged).toBe(preview.changes.length)
    expect(preview.summary.newUnits).toBe(preview.changes.length)
    expect(preview.summary.copiesDelta).toBe(EXPECTED.dedupTotal)
    expect(preview.changes[0]).toEqual({
      stockCardId: 'A1-1',
      cardIds: ['A1-1', 'A4b-1'],
      nameEs: 'Bulbasaur',
      before: null,
      after: { amountOwned: 2, collected: true },
    })
    expect(preview.changes.find((change: { stockCardId: string }) => change.stockCardId === 'B1a-28').after).toEqual({
      amountOwned: 0,
      collected: true,
    })
    expect(preview.adjustmentsMatching).toEqual([
      { adjustmentId: latiasTwoId, groupId: LATIAS, nameEs: 'Latias', playableCopies: 2, stockSum: 2 },
    ])
    importId = preview.id

    const list = await get('/api/collection/imports')
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0]).toMatchObject({
      id: importId,
      fileName: CSV_FILE_NAME,
      status: 'pending',
      rowCount: EXPECTED.rows,
      summary: preview.summary,
    })
    const detail = await get(`/api/collection/imports/${importId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.changes).toHaveLength(preview.changes.length)
    expect(detail.body.adjustmentsMatching).toEqual(preview.adjustmentsMatching)
    expect((await get('/api/collection/imports/999999')).status).toBe(404)
    expect((await get('/api/collection/imports/abc')).status).toBe(404)
  })

  it('applies the import once and computes the playable copies of PLAN §7', async () => {
    const applied = await post(`/api/collection/imports/${importId}/apply`)
    expect(applied.status).toBe(200)
    expect(applied.body.applied).toBe(true)
    expect(applied.body.summary.copiesDelta).toBe(EXPECTED.dedupTotal)
    const again = await post(`/api/collection/imports/${importId}/apply`)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('import_not_pending')
    expect((await post(`/api/collection/imports/${importId}/discard`)).status).toBe(409)
    const detail = await get(`/api/collection/imports/${importId}`)
    expect(detail.body.status).toBe('applied')
    expect(detail.body.appliedAt).not.toBeNull()

    for (const [groupId, expected] of Object.entries(PLAYABLE)) {
      expect(await playableOf(groupId), groupId).toBe(expected)
    }
    const bulbasaur = await get('/api/groups/A1-1')
    const twin = bulbasaur.body.group.editions.find((edition: { card: { id: string } }) => edition.card.id === 'A4b-1')
    expect(twin).toMatchObject({ owned: 2, collected: true, twinCardIds: ['A1-1'] })
    expect(await test.prisma.collectionStock.count({ where: { source: 'import', importId: Number(importId) } })).toBe(
      await test.prisma.collectionStock.count(),
    )
  })

  it('summarizes the collection and resolves the matching adjustment', async () => {
    const summary = await get('/api/collection/summary')
    expect(summary.body).toMatchObject({
      copies: EXPECTED.dedupTotal,
      stockUnitsCollected: EXPECTED.stockUnitsCollected,
      groupsWithAtLeast: { one: EXPECTED.groupsWithOne, two: EXPECTED.groupsWithTwo },
      groupsMissing: EXPECTED.groupsMissing,
      activeAdjustments: 1,
    })
    expect(summary.body.lastImportAt).not.toBeNull()

    const resolved = await post(`/api/collection/adjustments/${latiasTwoId}/resolve`).send({
      resolution: 'csv_matches',
    })
    expect(resolved.status).toBe(200)
    expect(resolved.body).toMatchObject({ id: latiasTwoId, active: false, resolution: 'csv_matches', fromStock: 2 })
    expect(resolved.body.resolvedAt).not.toBeNull()
    expect((await post(`/api/collection/adjustments/${latiasTwoId}/resolve`).send({ resolution: 'user' })).status).toBe(
      409,
    )
    const active = await get('/api/collection/adjustments?active=true')
    expect(active.body.items).toEqual([])
    const all = await get('/api/collection/adjustments')
    expect(all.body.items.map((item: { id: string }) => item.id)).toEqual([latiasTwoId])
    expect((await get('/api/collection/summary')).body.activeAdjustments).toBe(0)
  })

  it('lists groups and stock with search, expansion, missingOnly/onlyOwned and pagination', async () => {
    const latias = await get('/api/collection/groups?q=Latias')
    expect(latias.status).toBe(200)
    expect(latias.body.items[0]).toMatchObject({
      group: { id: LATIAS, nameEs: 'Latias' },
      playable: 2,
      fromStock: 2,
      hasAdjustment: false,
    })
    const missing = await get('/api/collection/groups?missingOnly=true&limit=5')
    expect(missing.body.total).toBe(EXPECTED.groupsMissing)
    expect(missing.body.items).toHaveLength(5)
    expect(missing.body.items.every((item: { playable: number }) => item.playable === 0)).toBe(true)
    const paged = await get('/api/collection/groups?limit=10&offset=2319')
    expect(paged.body).toEqual({ items: [], total: 2319 })
    const byExpansion = await get('/api/collection/groups?expansion=A4b&missingOnly=false&limit=500')
    expect(byExpansion.body.total).toBeGreaterThan(100)
    expect(byExpansion.body.items[0].group.id).toBe('A1-1')
    const badBool = await get('/api/collection/groups?missingOnly=maybe')
    expect(badBool.status).toBe(400)

    const stock = await get('/api/collection/stock?q=bulbasaur&expansion=A4b')
    expect(stock.body.items.length).toBeGreaterThanOrEqual(1)
    expect(stock.body.items.find((item: { card: { id: string } }) => item.card.id === 'A4b-1')).toMatchObject({
      card: { id: 'A4b-1', stockCardId: 'A1-1' },
      owned: 2,
      collected: true,
      twinCardIds: ['A1-1'],
    })
    const owned = await get('/api/collection/stock?onlyOwned=true&limit=1')
    expect(owned.body.items[0].owned).toBeGreaterThan(0)
    expect(owned.body.total).toBeLessThan(4317)
    const everything = await get('/api/collection/stock?limit=1')
    expect(everything.body.total).toBe(4317)
  })

  it('exports the tracker CSV byte-identical to the imported file and re-imports it with an empty diff', async () => {
    const response = await get('/api/collection/export.csv').responseType('blob')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toBe('attachment; filename="tcgcollectiontracterexport.csv"')
    const exported = response.body as Buffer
    expect(exported.length).toBe(csvBytes.length)
    expect(exported.equals(csvBytes)).toBe(true)

    const again = await post('/api/collection/imports').send({ csv: exported.toString('utf8') })
    expect(again.status).toBe(201)
    expect(again.body).toMatchObject({
      fileName: null,
      rowCount: EXPECTED.rows,
      naiveTotal: EXPECTED.naiveTotal,
      dedupTotal: EXPECTED.dedupTotal,
      changes: [],
      summary: { unitsChanged: 0, copiesDelta: 0, newUnits: 0, zeroedUnits: 0, collectedChanged: 0 },
    })
    const discarded = await post(`/api/collection/imports/${again.body.id}/discard`)
    expect(discarded.status).toBe(204)
    expect((await get(`/api/collection/imports/${again.body.id}`)).body.status).toBe('discarded')
  })

  it('a conflicting file (twins with different values) is blocked from being applied', async () => {
    const lines = csvBytes.toString('utf8').split('\n')
    const header = lines[0] as string
    const a11 = lines.find((line) => line.startsWith('A1-1,')) as string
    const a4b1 = lines.find((line) => line.startsWith('A4b-1,')) as string
    const bumped = a4b1.replace(/,(\d+),A4b,/, (_match, owned: string) => `,${Number(owned) + 1},A4b,`)
    expect(bumped).not.toBe(a4b1)
    const conflict = await post('/api/collection/imports').send({ csv: [header, a11, bumped].join('\n') })
    expect(conflict.status).toBe(201)
    expect(conflict.body.blocked).toBe(true)
    expect(conflict.body.twinConflicts).toHaveLength(1)
    expect(conflict.body.twinConflicts[0].stockCardId).toBe('A1-1')
    expect(
      conflict.body.twinConflicts[0].rows.map((row: { cardId: string; line: number }) => [row.cardId, row.line]),
    ).toEqual([
      ['A1-1', 2],
      ['A4b-1', 3],
    ])
    const apply = await post(`/api/collection/imports/${conflict.body.id}/apply`)
    expect(apply.status).toBe(409)
    expect(apply.body.error.code).toBe('import_blocked')
    expect((await post(`/api/collection/imports/${conflict.body.id}/discard`)).status).toBe(204)
  })

  it('manual edits act on the stock unit and report the active adjustment (rules b and c)', async () => {
    // Raise Latias to 3 by hand, then freeze it at 1 with an adjustment: the real CSV (2) hides the change (rule b).
    const raised = await patch(`/api/collection/stock/${LATIAS}`).send({ amountOwned: 3 })
    expect(raised.status).toBe(200)
    expect(raised.body).toEqual({
      stockCardId: LATIAS,
      cardIds: [LATIAS],
      affectedTwinIds: [],
      before: { amountOwned: 2, collected: true },
      after: { amountOwned: 3, collected: true },
      activeAdjustment: null,
    })
    const latiasOne = await post('/api/collection/adjustments').send({
      functionalGroupId: LATIAS,
      playableCopies: 1,
      reason: 'una está prestada',
    })
    expect(latiasOne.status).toBe(201)
    expect(latiasOne.body.fromStock).toBe(3)
    expect(await playableOf(LATIAS)).toBe(1)

    const preview = await post('/api/collection/imports').attach('file', csvBytes, CSV_FILE_NAME)
    expect(preview.status).toBe(201)
    expect(preview.body.adjustmentsMatching).toEqual([])
    expect(preview.body.adjustmentsHidingChange).toEqual([
      {
        adjustmentId: latiasOne.body.id,
        groupId: LATIAS,
        nameEs: 'Latias',
        playableCopies: 1,
        sumBefore: 3,
        sumAfter: 2,
      },
    ])
    expect(preview.body.changes.map((change: { stockCardId: string }) => change.stockCardId)).toEqual([LATIAS])
    expect((await post(`/api/collection/imports/${preview.body.id}/discard`)).status).toBe(204)

    // Editing A4b-1 edits the A1-1 unit (I3); editing Latias with the adjustment active reports it (rule c).
    const twin = await patch('/api/collection/stock/A4b-1').send({ amountOwned: 4 })
    expect(twin.status).toBe(200)
    expect(twin.body).toMatchObject({
      stockCardId: 'A1-1',
      cardIds: ['A1-1', 'A4b-1'],
      affectedTwinIds: ['A1-1'],
      before: { amountOwned: 2, collected: true },
      after: { amountOwned: 4, collected: true },
      activeAdjustment: null,
    })
    expect(await playableOf('A1-1')).toBe(5)
    const withAdjustment = await patch(`/api/collection/stock/${LATIAS}`).send({ collected: false })
    expect(withAdjustment.body.after).toEqual({ amountOwned: 3, collected: false })
    expect(withAdjustment.body.activeAdjustment).toMatchObject({
      id: latiasOne.body.id,
      functionalGroupId: LATIAS,
      nameEs: 'Latias',
      playableCopies: 1,
      reason: 'una está prestada',
    })
    expect((await patch('/api/collection/stock/ZZ-1').send({ amountOwned: 1 })).status).toBe(404)
    expect((await patch(`/api/collection/stock/${LATIAS}`).send({ amountOwned: -1 })).status).toBe(400)
    expect((await patch(`/api/collection/stock/${LATIAS}`).send({})).status).toBe(400)

    // Rule (d): convert the adjustment into a manual edit of the Latias edition (3 → 1) and resolve it.
    const wrongGroup = await post(`/api/collection/adjustments/${latiasOne.body.id}/convert`).send({
      targetCardId: 'A1-1',
    })
    expect(wrongGroup.status).toBe(400)
    expect(wrongGroup.body.error.code).toBe('conversion_target_not_in_group')
    const converted = await post(`/api/collection/adjustments/${latiasOne.body.id}/convert`).send({
      targetCardId: LATIAS,
    })
    expect(converted.status).toBe(200)
    expect(converted.body).toMatchObject({
      adjustment: { id: latiasOne.body.id, active: false, resolution: 'converted', fromStock: 1 },
      stockCardId: LATIAS,
      affectedTwinIds: [],
      before: { amountOwned: 3, collected: false },
      after: { amountOwned: 1, collected: false },
    })
    expect(await playableOf(LATIAS)).toBe(1)
    expect(
      (await post(`/api/collection/adjustments/${latiasOne.body.id}/convert`).send({ targetCardId: LATIAS })).status,
    ).toBe(409)
    expect((await get('/api/collection/summary')).body.activeAdjustments).toBe(0)
  })

  it('suerte de los sobres (Fase 17): what came in since the last import, by rarity, against the packs', async () => {
    const lines = csvBytes.toString('utf8').split('\n')
    const header = lines[0] as string
    const body = lines.slice(1).filter((line) => line.trim() !== '')
    const count = new Map<string, number>()
    for (const line of body) {
      const internalId = line.split(',')[2] as string
      count.set(internalId, (count.get(internalId) ?? 0) + 1)
    }
    // One more copy of 10 art rares (☆) and 20 commons (◊) of B4 that have no twin row.
    const touched = new Set<string>()
    const bump = (rarity: string, howMany: number) => {
      let left = howMany
      return (line: string) => {
        const cells = line.split(',')
        if (left === 0 || cells[4] !== 'B4' || cells[6] !== rarity || count.get(cells[2] as string) !== 1) return line
        left -= 1
        touched.add(cells[0] as string)
        cells[3] = String(Number(cells[3]) + 1)
        cells[7] = (cells[7] ?? '').replace('FALSE', 'TRUE')
        return cells.join(',')
      }
    }
    const rares = bump('☆', 10)
    const commons = bump('◊', 20)
    const csv = [header, ...body.map((line) => commons(rares(line)))].join('\n')
    expect(touched.size).toBe(30)
    const preview = await post('/api/collection/imports').send({ csv })
    expect(preview.status).toBe(201)
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const luck = (await get('/api/collection/pack-luck')).body as {
      imports: number
      intervals: {
        luck: {
          gained: number
          rare: { observed: number; check: { verdict: string } }
          packsEstimate: number
        }
      }[]
    }
    expect(luck.imports).toBeGreaterThanOrEqual(2)
    expect(luck.intervals[0]?.luck).toMatchObject({ gained: 30, rare: { observed: 10 } })
    expect(luck.intervals[0]?.luck.rare.check.verdict).toBe('lucky')
    expect(luck.intervals[0]?.luck.packsEstimate).toBeCloseTo(6, 10)
  })
})
