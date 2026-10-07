import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { todayInOwnerZone } from '../src/config/time-zone.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/** docs/PLAN.md §7 Fase 4 (M4) against the 6/10/2026 collection and the 40 decks. */
const CSV_PATH = join(REPO_ROOT, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')

interface Row {
  packId: string
  nameEs: string
  expansionId: string
  available: boolean
  probability: number
  expectedValue: number
  otherModel: { model: string; probability: number; reasons: string[] }
  limited: {
    until: string | null
    daysLeft: number | null
    exclusive: { cardId: string; nameEs: string; rarity: string; holo: boolean; goal: string }[]
  } | null
}

/** Today in Buenos Aires plus `days`, as YYYY-MM-DD. */
function dayFromToday(days: number): string {
  const date = new Date(`${todayInOwnerZone()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

describe('packs (e2e)', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await createTestApp()
    await seedOwner(test.app, { totp: false })
    cookie = await login(test, { secret: null })
    const summary = await test.app
      .get(CatalogSyncService)
      .sync({ trackerCommit: test.env.catalogCommit, engineRev: test.env.engineRev, source: 'fixtures' })
    expect(summary.status).toBe('applied')
    const preview = await post('/api/collection/imports').attach('file', readFileSync(CSV_PATH), 'export.csv')
    expect((await post(`/api/collection/imports/${preview.body.id}/apply`)).status).toBe(200)
    const drafts = (await post('/api/decks/import').send({ text: readFileSync(DECKS_PATH, 'utf8') })).body.drafts as {
      title: string
      draft: { energies: string[]; cards: unknown[] }
    }[]
    const inputs = drafts.map((d) => ({
      name: d.title,
      energies: d.draft.energies.length > 0 ? d.draft.energies : ['psychic'],
      cards: d.draft.cards,
    }))
    expect((await post('/api/decks/import/commit').send({ decks: inputs })).status).toBe(201)
  })

  afterAll(async () => {
    await test.close()
  })

  function get(path: string) {
    return test.http().get(path).set('Cookie', cookie)
  }
  function post(path: string) {
    return test.http().post(path).set('Cookie', cookie)
  }
  function patch(path: string) {
    return test.http().patch(path).set('Cookie', cookie)
  }
  function put(path: string) {
    return test.http().put(path).set('Cookie', cookie)
  }

  it('lists the 29 openable packs with their switch: A4b off by default, B4b on and limited (acceptance d)', async () => {
    const response = await get('/api/packs')
    expect(response.status).toBe(200)
    const items = response.body.items as {
      id: string
      available: boolean
      limited: boolean
      limitedUntil: string | null
      cardsPerPack: number
      inTrackerOverview: boolean
    }[]
    expect(items).toHaveLength(29)
    expect(items.some((item) => item.id.endsWith('/everypack'))).toBe(false)
    expect(items.find((item) => item.id === 'A4b/deluxepack')).toMatchObject({
      available: false,
      limited: false,
      limitedUntil: null,
      cardsPerPack: 4,
      inTrackerOverview: false,
    })
    expect(items.find((item) => item.id === 'B4b/deluxepackmega')).toMatchObject({
      available: true,
      limited: true,
      limitedUntil: '2026-10-28',
    })

    const off = await patch('/api/packs/A2b/shiningrevelrypack').send({ available: false })
    expect(off.body).toMatchObject({ id: 'A2b/shiningrevelrypack', available: false })
    expect((await patch('/api/packs/A2b/shiningrevelrypack').send({ available: true })).status).toBe(200)
    expect((await patch('/api/packs/A1/nada').send({ available: false })).status).toBe(404)
    expect((await patch('/api/packs/A1/everypack').send({ available: false })).status).toBe(404)
    expect((await patch('/api/packs/A1/mewtwopack').send({})).status).toBe(400)

    const limited = await patch('/api/packs/A1/mewtwopack').send({ limited: true, limitedUntil: '2026-11-30' })
    expect(limited.body).toMatchObject({ available: true, limited: true, limitedUntil: '2026-11-30' })
    expect((await get('/api/packs')).body.items).toContainEqual(
      expect.objectContaining({ id: 'A1/mewtwopack', limited: true, limitedUntil: '2026-11-30' }),
    )
    const back = await patch('/api/packs/A1/mewtwopack').send({ limited: false, limitedUntil: null })
    expect(back.body).toMatchObject({ limited: false, limitedUntil: null })
    expect((await patch('/api/packs/A1/mewtwopack').send({ limitedUntil: '30/11/2026' })).status).toBe(400)
  })

  it('rarity rules: tracker costs plus ✵/✵✵ unverified; the owner can confirm them', async () => {
    const rules = (await get('/api/rarity-rules')).body.items as {
      rarity: string
      points: number | null
      verified: boolean
      tradeable: boolean
    }[]
    expect(rules.find((rule) => rule.rarity === '◊◊◊◊')).toEqual({
      rarity: '◊◊◊◊',
      points: 500,
      verified: false,
      tradeable: true,
    })
    expect(rules.find((rule) => rule.rarity === '✵')).toMatchObject({ points: 1000, verified: false })
    expect(rules.find((rule) => rule.rarity === '✵✵')).toMatchObject({ points: 1350, verified: false })
    expect(rules.find((rule) => rule.rarity === 'P')).toMatchObject({ points: null })
    const confirmed = await patch(`/api/rarity-rules/${encodeURIComponent('◊◊◊◊')}`).send({ verified: true })
    expect(confirmed.body).toEqual({ rarity: '◊◊◊◊', points: 500, verified: true, tradeable: true })
    expect((await patch('/api/rarity-rules/X').send({ verified: true })).status).toBe(404)
  })

  it('PLAN §7 Fase 4 (c): deck 13 missing one Hoopa ex → B4b first (1,43 %) above B4 (1,06 %)', async () => {
    // Deck 13 as its note says: a second Hoopa ex (one copy missing), target with top priority.
    const detail = (await get('/api/decks/13')).body as { cards: { card: { id: string }; count: number }[] }
    const cards = detail.cards
      .filter((entry) => entry.card.id !== 'A2-110')
      .map((entry) => ({ cardId: entry.card.id, count: entry.card.id === 'B4-103' ? 2 : entry.count }))
    expect((await patch('/api/decks/13').send({ cards, packPriority: 3 })).status).toBe(200)
    // The Deluxe Mega is limited (28/10/2026): a last day far away keeps the acceptance independent of the clock.
    expect((await patch('/api/packs/B4b/deluxepackmega').send({ limitedUntil: '2099-12-31' })).status).toBe(200)

    const response = await post('/api/packs/recommend').send({ collection: null })
    expect(response.status).toBe(200)
    const body = response.body as {
      model: string
      goals: { decks: { id: string; priority: number }[] }
      rows: Row[]
      missing: Record<string, unknown>[]
      decks: { deckId: string; bestPacks: { packId: string; expectedPacks: number; method: string }[] }[]
      assumptions: string[]
    }
    expect(body.model).toBe('corrected')
    expect(body.goals.decks).toEqual([{ id: '13', name: 'Hoopa ex / Mega-Absol ex', priority: 3 }])
    expect(body.rows[0]).toMatchObject({ packId: 'B4b/deluxepackmega', expansionId: 'B4b', available: true })
    expect(body.rows[0]?.probability).toBeCloseTo(100 / 70, 9)
    expect(body.rows[1]?.packId).toBe('B4/ruleroftheskiespack')
    expect(body.rows[1]?.probability).toBeCloseTo(1.064, 3)
    expect(body.rows[0]?.otherModel).toEqual({ model: 'tracker', probability: 0, reasons: ['reprints'] })
    // Limited, but for the decks every B4b card is a reprint: nothing only it gives, no boost.
    expect(body.rows[0]?.limited).toMatchObject({ until: '2099-12-31', exclusive: [] })
    expect(body.rows.find((row) => row.packId === 'B4/ruleroftheskiespack')?.limited).toBeNull()
    expect(body.missing).toEqual([
      expect.objectContaining({
        nameEs: 'Hoopa ex',
        missing: 1,
        cheapest: { cardId: 'B4-103', rarity: '◊◊◊◊', points: 500, verified: true, tradeable: true },
        tradeable: true,
        bestPack: expect.objectContaining({ packId: 'B4b/deluxepackmega', nameEs: expect.any(String), limited: true }),
        afterLimited: expect.objectContaining({ packId: 'B4/ruleroftheskiespack' }),
        pointsInPacks: 100,
        advice: 'open',
      }),
    ])
    expect(body.decks[0]?.bestPacks[0]).toMatchObject({ packId: 'B4b/deluxepackmega', method: 'exact', limited: true })
    expect(body.decks[0]?.bestPacks[0]?.expectedPacks).toBeCloseTo(70, 6)
    expect(body.assumptions.length).toBeGreaterThan(3)
  })

  it('with the tracker model B4b gives 0 % (bug 2) and B4 comes first; saved settings are the defaults', async () => {
    const tracker = await post('/api/packs/recommend').send({ collection: null, model: 'tracker' })
    expect((tracker.body.rows as Row[])[0]?.packId).toBe('B4/ruleroftheskiespack')
    expect((tracker.body.rows as Row[]).find((row) => row.packId === 'B4b/deluxepackmega')?.probability).toBe(0)

    expect((await put('/api/settings/packModel').send({ value: 'tracker' })).status).toBe(200)
    expect((await put('/api/settings/rarityFilter').send({ value: null })).status).toBe(200)
    const saved = await post('/api/packs/recommend').send({})
    expect(saved.body).toMatchObject({ model: 'tracker', collection: null, alpha: 0.7 })
    expect((await put('/api/settings/packModel').send({ value: 'corrected' })).status).toBe(200)
  })

  it('collection goal and α: filter (a) with the tracker model puts the Deluxe ex first when it is available', async () => {
    const collection = { rarities: [], copies: 1 }
    const onlyCollection = await post('/api/packs/recommend').send({ collection, alpha: 0, model: 'tracker' })
    const rows = onlyCollection.body.rows as Row[]
    expect(rows.find((row) => row.packId === 'A4b/deluxepack')?.probability).toBeCloseTo(96.5096, 4)
    expect(rows.find((row) => row.packId === 'A3/solgaleopack')?.probability).toBeCloseTo(78.0258, 4)

    const available = await post('/api/packs/recommend').send({ collection, alpha: 0, onlyAvailable: true })
    expect((available.body.rows as Row[]).some((row) => row.packId === 'A4b/deluxepack')).toBe(false)

    // α = 0.7 (the default) with the whole collection as goal: each goal is scaled to its best pack, so the deck
    // missing one Hoopa ex still decides; scores are 0…1.
    const decks = await post('/api/packs/recommend').send({ collection, alpha: 0.7 })
    expect((decks.body.rows as Row[])[0]?.packId).toBe('B4b/deluxepackmega')
    expect((decks.body.rows as Row[])[0]?.expectedValue).toBeGreaterThan(0.7)
    expect((decks.body.rows as Row[]).every((row) => row.expectedValue <= 1)).toBe(true)
    expect((await post('/api/packs/recommend').send({ alpha: 2 })).status).toBe(400)
    expect((await post('/api/packs/recommend').send({ collection: { rarities: ['X'], copies: 1 } })).status).toBe(400)
    expect((await test.http().post('/api/packs/recommend').send({})).status).toBe(401)
  })

  it('limited time: days left, the versions only B4b gives weigh more, and past its last day it is off sale', async () => {
    const collection = { rarities: [], copies: 1 }
    expect((await patch('/api/packs/B4b/deluxepackmega').send({ limitedUntil: dayFromToday(3) })).status).toBe(200)
    const running = await post('/api/packs/recommend').send({ collection, alpha: 0, limitedBoost: 1 })
    expect(running.body).toMatchObject({ limitedBoost: 1, today: todayInOwnerZone() })
    const b4b = (running.body.rows as Row[]).find((row) => row.packId === 'B4b/deluxepackmega')
    expect(b4b?.limited?.daysLeft).toBe(3)
    // Versions, not functional cards: B4b-237 (new holographic Bulbasaur) is there, B4b-1 (= B1a-1) is not.
    const versions = new Set(b4b?.limited?.exclusive.map((item) => item.cardId))
    expect(b4b?.limited?.exclusive.every((item) => item.goal === 'collection')).toBe(true)
    expect(versions.has('B4b-1')).toBe(false)
    expect(running.body.collectionOutOfPacks.versions).toBeGreaterThan(0)

    expect((await put('/api/settings/limitedBoost').send({ value: 3 })).status).toBe(200)
    const boosted = await post('/api/packs/recommend').send({ collection, alpha: 0 })
    expect(boosted.body.limitedBoost).toBe(3)
    // Against a pack that stays, B4b gains: its exclusive versions weigh ×3 (each goal is scaled to its best pack).
    const ratio = (body: { rows: Row[] }) => {
      const value = (packId: string) => body.rows.find((row) => row.packId === packId)?.expectedValue ?? Number.NaN
      return value('B4b/deluxepackmega') / value('B4/ruleroftheskiespack')
    }
    expect(ratio(boosted.body)).toBeGreaterThan(ratio(running.body))
    expect((await post('/api/packs/recommend').send({ limitedBoost: 6 })).status).toBe(400)

    expect((await patch('/api/packs/B4b/deluxepackmega').send({ limitedUntil: dayFromToday(-1) })).status).toBe(200)
    const over = await post('/api/packs/recommend').send({ collection: null })
    const rows = over.body.rows as Row[]
    const at = rows.findIndex((row) => row.packId === 'B4b/deluxepackmega')
    expect(rows[at]).toMatchObject({ available: false, limited: { daysLeft: -1 } })
    expect(rows.slice(0, at).every((row) => row.available)).toBe(true)
    expect(rows[0]?.packId).toBe('B4/ruleroftheskiespack')

    expect((await patch('/api/packs/B4b/deluxepackmega').send({ limitedUntil: '2026-10-28' })).status).toBe(200)
    expect((await put('/api/settings/limitedBoost').send({ value: 2 })).status).toBe(200)
  })
})
