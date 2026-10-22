import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { CatalogSyncService } from '../src/catalog/catalog-sync.service.js'
import { REPO_ROOT } from '../src/config/dotenv.js'
import { OWNER_TIME_ZONE, todayInOwnerZone } from '../src/config/time-zone.js'
import { SHEET_DECK_MAP_KEY } from '../src/matches/sheet-import.service.js'
import { RANK_NOTE_LOCK } from '../src/ranked/ranked.service.js'
import { createTestApp, login, seedOwner, type TestApp } from './helpers.js'

/**
 * T-022, «Importar desde la hoja»: the owner's match sheet (a synthetic one with its shape: title and instructions in
 * rows 1–3, headers in row 4) previewed without writing, applied all or nothing, uploaded again without repeating, the
 * possible repeats, the fingerprint of the preview, the cap and the session.
 */
const DECKS_PATH = join(REPO_ROOT, 'docs/context/mazos_40_listas.md')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const day = (offset: number) => todayInOwnerZone(new Date(Date.now() + offset * DAY_MS))
const HEADER = [
  'Código',
  'Salida',
  'Resultado',
  'Mazo (automático)',
  'Fecha',
  'Mazo rival',
  'Notas',
  'Rango',
  'Rango (efectivo)',
  'Temporada',
  'En la app (n.º)',
]
const WALL = new Intl.DateTimeFormat('en-GB', {
  timeZone: OWNER_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
/** One clock for the whole file: a row written in two tests names the same minute. */
const BASE = Date.now()
/** «dd/mm/aaaa hh:mm» in the owner's time zone, `hours` before BASE (whole minutes, as the sheet writes it). */
const ago = (hours: number) => WALL.format(new Date(BASE - hours * HOUR_MS)).replace(', ', ' ')
/** The instant the sheet's text names (the minute, in the owner's zone). */
const minuteOf = (hours: number) => {
  const date = new Date(BASE - hours * HOUR_MS)
  date.setUTCSeconds(0, 0)
  return date
}

interface Row {
  code?: string
  first?: string
  result?: string
  deck?: string
  date: string
  rival?: string
  note?: string
  rank?: string
  k?: string
}
const cell = (value: string) => (/[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
function sheet(rows: Row[]): string {
  const lines = [
    ['Registro de partidas', ...Array(10).fill('')],
    ['Instrucciones: elegí el código en A', ...Array(10).fill('')],
    Array(11).fill(''),
    HEADER,
    ...rows.map((row) => [
      row.code ?? 'M08',
      row.first ?? 'Primero',
      row.result ?? 'Victoria',
      row.deck ?? 'mawile',
      row.date,
      row.rival ?? 'Hoopa ex / Mega-Absol ex',
      row.note ?? '',
      row.rank ?? '',
      row.rank ?? '',
      'Temporada de hoy',
      row.k ?? '',
    ]),
  ]
  return `${lines.map((line) => line.map(cell).join(',')).join('\r\n')}\r\n`
}

interface PreviewRow {
  row: number
  status: string
  matchId: string | null
  write: boolean
  deck: { id: string; name: string } | null
  rank: { label: string; action: string | null; text: string | null } | null
  duplicateOf: { id: string; text: string } | null
  errors: string[]
  warnings: string[]
}

describe('importing the match sheet (e2e)', () => {
  let test: TestApp
  let cookie: string
  let mawile: string
  let butterfree: string
  const get = (path: string) => test.http().get(path).set('Cookie', cookie)
  const post = (path: string) => test.http().post(path).set('Cookie', cookie)
  const put = (path: string) => test.http().put(path).set('Cookie', cookie)
  const counts = async () => ({
    matches: await test.prisma.match.count(),
    ranks: await test.prisma.rankChange.count(),
    map: (await test.prisma.appSetting.findUnique({ where: { key: SHEET_DECK_MAP_KEY } }))?.value ?? null,
  })

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
      // One deck of each name (the list has two Mawile and two Blaziken decks).
      .filter(
        (d) =>
          d.draft &&
          d.draft.energies.length > 0 &&
          /^(?:\d+\.\s*)?(?:Butterfree \/|Mega-Mawile ex \/|Mega-Blaziken ex$)/u.test(d.title),
      )
      .map((d) => ({ name: d.title, energies: d.draft?.energies, cards: d.draft?.cards }))
    const created = await post('/api/decks/import/commit').send({ decks: inputs })
    expect(created.status).toBe(201)
    const decks = created.body.created as { id: string; name: string }[]
    mawile = decks.find((deck) => /Mawile/u.test(deck.name))?.id as string
    butterfree = decks.find((deck) => /Butterfree/u.test(deck.name))?.id as string
    expect(mawile && butterfree).toBeTruthy()
    // A season that holds the last nine days (the migration's are truncated by the tests): every row with a rank is
    // less than 200 hours old, and the one outside every season is 20 days old. Each test's rows that are written lie
    // more than a day from the others written: a match imported from the sheet that no row of a text is, the same day
    // as one of its rows, makes that row a possible repeat (a row corrected after its import).
    expect(
      (await put('/api/ranked/seasons/NOW').send({ name: 'Temporada de hoy', startsOn: day(-9), endsOn: day(12) }))
        .status,
    ).toBe(200)
  }, 120_000)

  afterAll(async () => {
    await test.close()
  })

  it('needs the session', async () => {
    const text = sheet([{ date: ago(50) }])
    expect((await test.http().post('/api/matches/import/preview').send({ text })).status).toBe(401)
    expect((await test.http().post('/api/matches/import').send({ text, fingerprint: 'x' })).status).toBe(401)
  })

  it('the preview writes nothing; applying writes the matches, their ranks and the decks of the codes; uploading again repeats none', async () => {
    const text = sheet([
      { date: ago(30), rank: 'Ultra Ball 4', note: 'Me sacó "Hoopa" en el turno 2, después Absol.\n¿Más bolas?' },
      { date: ago(29.5), first: '', rival: 'Mega-Blaziken ex', result: 'Derrota' },
      { code: 'M01', deck: 'butterfree', date: ago(29), rank: 'Ultra Ball 4' },
      { date: '' },
      { code: 'M01', deck: 'butterfree', date: ago(28.5), rank: 'Master Ball' },
    ])
    const before = await counts()
    const first = await post('/api/matches/import/preview').send({ text })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      delimiter: 'comma',
      headerRow: 4,
      firstRow: 5,
      mode: 'competitive',
      error: null,
    })
    // No deck saved yet: the codes wait for one, each with the deck its name suggests.
    expect(first.body.counts).toMatchObject({ rows: 5, unmapped: 4, errors: 1, write: 0 })
    expect(
      first.body.codes.map((code: { code: string; deckId: string | null; suggestion: { deckId: string } | null }) => [
        code.code,
        code.deckId,
        code.suggestion?.deckId,
      ]),
    ).toEqual([
      ['M01', null, butterfree],
      ['M08', null, mawile],
    ])
    const deckMap = { M08: mawile, M01: butterfree }
    const preview = await post('/api/matches/import/preview').send({ text, deckMap })
    expect(preview.body.counts).toMatchObject({ new: 4, errors: 1, write: 4, ranks: 2, warnings: 1 })
    const rows = preview.body.rows as PreviewRow[]
    expect(rows.map((row) => [row.row, row.status])).toEqual([
      [5, 'new'],
      [6, 'new'],
      [7, 'new'],
      [8, 'error'],
      [9, 'new'],
    ])
    expect(rows[3]?.errors).toEqual(['Falta la fecha.'])
    expect(rows[1]?.warnings).toEqual(['Sin «Salida»: el orden de turno queda sin anotar.'])
    expect(rows.map((row) => row.rank?.action ?? null)).toEqual(['note', null, 'same', null, 'note'])
    expect(await counts()).toEqual(before)

    const applied = await post('/api/matches/import').send({ text, deckMap, fingerprint: preview.body.fingerprint })
    expect(applied.status).toBe(200)
    const imported = applied.body.imported as { row: number; matchId: string }[]
    expect(imported.map((item) => item.row)).toEqual([5, 6, 7, 9])
    expect(applied.body.ranks).toBe(2)
    const ids = imported.map((item) => item.matchId)
    expect(applied.body.columnK).toEqual({ firstRow: 5, text: [ids[0], ids[1], ids[2], '', ids[3]].join('\n') })
    const matches = await test.prisma.match.findMany({ where: { id: { in: ids.map(Number) } }, orderBy: { id: 'asc' } })
    expect(matches.map((match) => [match.deckId, match.result, match.mode, match.wentFirst, match.source])).toEqual([
      [Number(mawile), 'win', 'competitive', true, 'ui'],
      [Number(mawile), 'loss', 'competitive', null, 'ui'],
      [Number(butterfree), 'win', 'competitive', true, 'ui'],
      [Number(butterfree), 'win', 'competitive', true, 'ui'],
    ])
    expect(matches[0]?.playedAt.toISOString()).toBe(minuteOf(30).toISOString())
    expect(matches[0]?.note).toBe('Me sacó "Hoopa" en el turno 2, después Absol.\n¿Más bolas?')
    expect(matches[1]?.opponentText).toBe('Mega-Blaziken ex')
    expect(matches.every((match) => /^sheet:[0-9a-f]{16}$/u.test(match.clientRef ?? ''))).toBe(true)
    // The ranks: noted a millisecond before their matches (the rank they were played at), once each.
    const ranks = await test.prisma.rankChange.findMany({ orderBy: { at: 'asc' } })
    expect(ranks.map((rank) => [rank.rank, rank.at.getTime()])).toEqual([
      ['ultra-4', minuteOf(30).getTime() - 1],
      ['master', minuteOf(28.5).getTime() - 1],
    ])
    const season = (await get('/api/ranked')).body.summary
    expect(season.byRank.map((row: { label: string; games: number }) => [row.label, row.games])).toEqual([
      ['Ultra Ball 4', 3],
      ['Master Ball', 1],
    ])
    expect((await counts()).map).toEqual({ M08: mawile, M01: butterfree })

    // Again, the whole sheet: nothing new, and column K has every number; the saved decks are used.
    const again = await post('/api/matches/import/preview').send({ text })
    expect(again.body.counts).toMatchObject({ new: 0, duplicate: 4, write: 0, unmapped: 0, possibleDuplicate: 0 })
    expect(again.body.columnK.text).toBe(applied.body.columnK.text)
    const twice = await post('/api/matches/import').send({ text, fingerprint: again.body.fingerprint })
    expect(twice.status).toBe(200)
    expect(twice.body.imported).toEqual([])
    expect(await test.prisma.match.count()).toBe(before.matches + 4)
    expect(await test.prisma.rankChange.count()).toBe(2)
  })

  it('a row with its number in column K is skipped; one that is not in the app says so', async () => {
    const existing = await post('/api/matches').send({ deckId: mawile, result: 'win', mode: 'competitive' })
    const text = sheet([
      { date: ago(48), k: existing.body.id },
      { date: ago(47), k: '999999' },
    ])
    const preview = await post('/api/matches/import/preview').send({ text })
    const rows = preview.body.rows as PreviewRow[]
    expect(rows.map((row) => [row.status, row.matchId, row.write])).toEqual([
      ['in_app', existing.body.id, false],
      ['in_app', '999999', false],
    ])
    expect(rows[1]?.warnings[0]).toMatch(/no está en la app/u)
    expect(preview.body.columnK.text).toBe(`${existing.body.id}\n999999`)
  })

  it('a match of the app with the deck and the result 15 minutes around is a possible repeat, imported only when picked', async () => {
    const logged = await post('/api/matches').send({
      deckId: butterfree,
      result: 'loss',
      mode: 'competitive',
      playedAt: new Date(minuteOf(60).getTime() + 10 * 60 * 1000).toISOString(),
    })
    expect(logged.status).toBe(201)
    const text = sheet([
      { code: 'M01', deck: 'butterfree', result: 'Derrota', date: ago(60) },
      { code: 'M01', deck: 'butterfree', result: 'Derrota', date: ago(62) },
    ])
    const plain = await post('/api/matches/import/preview').send({ text })
    const rows = plain.body.rows as PreviewRow[]
    expect(rows.map((row) => [row.status, row.write])).toEqual([
      ['possible_duplicate', false],
      ['new', true],
    ])
    expect(rows[0]?.duplicateOf?.id).toBe(logged.body.id)
    expect(rows[0]?.duplicateOf?.text).toMatch(new RegExp(`^n\\.º ${logged.body.id}, Derrota del `, 'u'))
    // Applying what was previewed leaves it out.
    const picked = await post('/api/matches/import/preview').send({ text, include: [5] })
    expect(picked.body.counts).toMatchObject({ picked: 1, write: 2 })
    expect(picked.body.fingerprint).not.toBe(plain.body.fingerprint)
    const before = await test.prisma.match.count()
    // The include sent and the preview's fingerprint must agree: picking it after the preview is another preview.
    const stale = await post('/api/matches/import').send({ text, include: [5], fingerprint: plain.body.fingerprint })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('import_changed')
    expect(await test.prisma.match.count()).toBe(before)
    const applied = await post('/api/matches/import').send({ text, include: [5], fingerprint: picked.body.fingerprint })
    expect(applied.status).toBe(200)
    expect(applied.body.imported.map((item: { row: number }) => item.row)).toEqual([5, 6])
  })

  it('something that changed since the preview (a match logged meanwhile) is a 409, and nothing is written', async () => {
    const text = sheet([{ date: ago(120) }, { date: ago(121), result: 'Derrota' }])
    const preview = await post('/api/matches/import/preview').send({ text })
    expect(preview.body.counts.write).toBe(2)
    // The same match logged in the app meanwhile: the first row is now a possible repeat.
    expect(
      (
        await post('/api/matches').send({
          deckId: mawile,
          result: 'win',
          mode: 'competitive',
          playedAt: minuteOf(120).toISOString(),
        })
      ).status,
    ).toBe(201)
    const before = await counts()
    const applied = await post('/api/matches/import').send({ text, fingerprint: preview.body.fingerprint })
    expect(applied.status).toBe(409)
    expect(applied.body.error.code).toBe('import_changed')
    expect(await counts()).toEqual(before)
  })

  it('all or nothing: a write that fails after the matches and the ranks leaves none of them, nor the decks saved', async () => {
    // The decks of the codes cannot be saved (a trigger of the test): the matches and the ranks go in before them.
    await test.prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION e2e_refuse_map() RETURNS trigger AS $$ BEGIN IF NEW.key = '${SHEET_DECK_MAP_KEY}' AND NEW.value ? 'M02' THEN RAISE EXCEPTION 'e2e: map refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`,
    )
    await test.prisma.$executeRawUnsafe(
      'CREATE TRIGGER e2e_refuse_map BEFORE INSERT OR UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION e2e_refuse_map()',
    )
    try {
      const text = sheet([
        { code: 'M02', deck: 'blaziken', date: ago(151) },
        { code: 'M02', deck: 'blaziken', date: ago(150), rank: 'Principiante 1' },
      ])
      const blaziken = (await get('/api/decks')).body.items.find((deck: { name: string }) =>
        /Blaziken/u.test(deck.name),
      ).id as string
      const deckMap = { M02: blaziken }
      const preview = await post('/api/matches/import/preview').send({ text, deckMap })
      expect(preview.body.counts).toMatchObject({ write: 2, ranks: 1 })
      const before = await counts()
      const applied = await post('/api/matches/import').send({ text, deckMap, fingerprint: preview.body.fingerprint })
      expect(applied.status).toBe(500)
      expect(await counts()).toEqual(before)
      expect(await test.prisma.match.count({ where: { deckId: Number(blaziken) } })).toBe(0)
      expect(await test.prisma.rankChange.count({ where: { rank: 'beginner-1' } })).toBe(0)
    } finally {
      await test.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS e2e_refuse_map ON app_settings')
      await test.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_refuse_map()')
    }
  })

  it('a rank outside every season: the match goes in, the rank does not', async () => {
    const text = sheet([{ code: 'M01', deck: 'butterfree', date: ago(24 * 20), rank: 'Ultra Ball 1' }])
    const preview = await post('/api/matches/import/preview').send({ text })
    const row = (preview.body.rows as PreviewRow[])[0]
    expect(row).toMatchObject({ status: 'new', write: true, rank: { label: 'Ultra Ball 1', action: 'skip' } })
    expect(row?.warnings[0]).toMatch(/no cae en ninguna temporada/u)
    const before = await test.prisma.rankChange.count()
    const applied = await post('/api/matches/import').send({ text, fingerprint: preview.body.fingerprint })
    expect(applied.body).toMatchObject({ ranks: 0, imported: [{ row: 5 }] })
    expect(await test.prisma.rankChange.count()).toBe(before)
  })

  it('another mode for the whole import; a casual match carries no rank', async () => {
    const text = sheet([{ date: ago(90), rank: 'Ultra Ball 2' }])
    const preview = await post('/api/matches/import/preview').send({ text, mode: 'casual' })
    expect(preview.body.mode).toBe('casual')
    expect((preview.body.rows as PreviewRow[])[0]?.rank?.action).toBe('skip')
    const applied = await post('/api/matches/import').send({
      text,
      mode: 'casual',
      fingerprint: preview.body.fingerprint,
    })
    const id = Number(applied.body.imported[0].matchId)
    expect((await test.prisma.match.findUnique({ where: { id } }))?.mode).toBe('casual')
  })

  it('more than 500 new matches: the preview says so and applying refuses it', async () => {
    const rows: Row[] = []
    // A rival of its own: no old sheet row elsewhere says the same.
    for (let i = 0; i < 501; i++) {
      rows.push({ code: 'M01', deck: 'butterfree', date: ago(200 + i * 0.5), rival: 'Rival del tope' })
    }
    const text = sheet(rows)
    const preview = await post('/api/matches/import/preview').send({ text })
    expect(preview.body).toMatchObject({ tooMany: true, maxNew: 500, counts: { write: 501 } })
    const before = await test.prisma.match.count()
    const applied = await post('/api/matches/import').send({ text, fingerprint: preview.body.fingerprint })
    expect(applied.status).toBe(400)
    expect(applied.body.error.code).toBe('too_many')
    expect(await test.prisma.match.count()).toBe(before)
  })

  it('pasted from the sheet (tabs) reads the same; a text without the headers says what is missing', async () => {
    const pasted = sheet([{ date: ago(30) }]).replaceAll(',', '\t')
    const preview = await post('/api/matches/import/preview').send({ text: pasted })
    expect(preview.body).toMatchObject({ delimiter: 'tab', headerRow: 4 })
    // The first row of the first import: found by its key.
    expect((preview.body.rows as PreviewRow[])[0]?.status).toBe('duplicate')
    const none = await post('/api/matches/import/preview').send({ text: 'M08,Primero,Victoria' })
    expect(none.body.error).toMatch(/No encontré la fila de encabezados/u)
    const refused = await post('/api/matches/import').send({ text: 'M08,Primero,Victoria', fingerprint: 'x' })
    expect(refused.status).toBe(400)
  })

  it('review: applying with other decks than the preview (same number of rows) is a 409', async () => {
    const text = sheet([{ code: 'M09', deck: 'mawile', date: ago(175) }])
    const preview = await post('/api/matches/import/preview').send({ text, deckMap: { M09: mawile } })
    expect(preview.body.counts.write).toBe(1)
    const before = await counts()
    const applied = await post('/api/matches/import').send({
      text,
      deckMap: { M09: butterfree },
      fingerprint: preview.body.fingerprint,
    })
    expect(applied.status).toBe(409)
    expect(await counts()).toEqual(before)
  })

  it('review: a match imported and moved in the app is still that row; a row with K finds its match whatever its date', async () => {
    const text = sheet([{ code: 'M01', deck: 'butterfree', date: ago(230) }])
    const preview = await post('/api/matches/import/preview').send({ text })
    const applied = await post('/api/matches/import').send({ text, fingerprint: preview.body.fingerprint })
    const id = applied.body.imported[0].matchId as string
    // Three days earlier: far from every date of the sheet (loaded by its key, not by the dates).
    const moved = await test
      .http()
      .patch(`/api/matches/${id}`)
      .set('Cookie', cookie)
      .send({ playedAt: new Date(minuteOf(230).getTime() + 72 * HOUR_MS).toISOString() })
    expect(moved.status).toBe(200)
    const again = await post('/api/matches/import/preview').send({ text })
    expect((again.body.rows as PreviewRow[])[0]).toMatchObject({ status: 'duplicate', matchId: id })
    const withK = await post('/api/matches/import/preview').send({
      text: sheet([{ code: 'M01', deck: 'butterfree', date: ago(300), k: id }]),
    })
    // Found (not «no está en la app»), and far from its row: said (review of #143).
    expect((withK.body.rows as PreviewRow[])[0]).toMatchObject({
      status: 'in_app',
      matchId: id,
      warnings: [`La partida n.º ${id} de la columna K tiene otra fecha: ¿pegaste los números corridos?`],
    })
  })

  it('review: a match being saved when the import starts is seen by it (the matches table is locked): 409, no repeat', async () => {
    const text = sheet([{ date: ago(190) }])
    const preview = await post('/api/matches/import/preview').send({ text })
    expect(preview.body.counts.write).toBe(1)
    const deck = await test.prisma.deck.findUniqueOrThrow({
      where: { id: Number(mawile) },
      select: { currentRevisionId: true },
    })
    const other = new pg.Client({ connectionString: test.env.databaseUrl })
    await other.connect()
    try {
      // The same match, saved by another request whose transaction has not committed yet.
      await other.query('BEGIN')
      await other.query(
        `INSERT INTO matches (deck_id, deck_revision_id, result, mode, played_at) VALUES ($1, $2, 'win', 'competitive', $3)`,
        [Number(mawile), deck.currentRevisionId, minuteOf(190)],
      )
      const applying = post('/api/matches/import')
        .send({ text, fingerprint: preview.body.fingerprint })
        .then((response) => response)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await other.query('COMMIT')
      const applied = await applying
      expect(applied.status).toBe(409)
      expect(await test.prisma.match.count({ where: { playedAt: minuteOf(190) } })).toBe(1)
    } finally {
      await other.end()
    }
  })

  it('review: a row corrected after its import (another time, the same day) names the match of its old version', async () => {
    // Fixed times of one day (13 days ago), so the correction never crosses midnight.
    const date = WALL.format(new Date(BASE - 13 * DAY_MS)).slice(0, 10)
    const first = sheet([{ code: 'M01', deck: 'butterfree', date: `${date} 12:00` }])
    const preview = await post('/api/matches/import/preview').send({ text: first })
    const applied = await post('/api/matches/import').send({ text: first, fingerprint: preview.body.fingerprint })
    const id = applied.body.imported[0].matchId as string
    const corrected = sheet([{ code: 'M01', deck: 'butterfree', date: `${date} 12:40` }])
    const again = await post('/api/matches/import/preview').send({ text: corrected })
    const row = (again.body.rows as PreviewRow[])[0]
    expect(row).toMatchObject({ status: 'possible_duplicate', write: false, duplicateOf: { id } })
    expect(row?.duplicateOf?.text).toMatch(/importada de una fila que ya no está igual en la hoja$/u)
    expect(again.body.orphans).toEqual([
      { id, text: expect.stringMatching(new RegExp(`^n\\.º ${id}, Victoria del `, 'u')) },
    ])
  })

  it('review of #143: a row whose day was corrected names the match of its old version (loaded with its rival)', async () => {
    const date = (days: number) => WALL.format(new Date(BASE - days * DAY_MS)).slice(0, 10)
    const first = sheet([{ code: 'M01', deck: 'butterfree', date: `${date(16)} 12:00`, rival: 'Gyarados ex' }])
    const preview = await post('/api/matches/import/preview').send({ text: first })
    const applied = await post('/api/matches/import').send({ text: first, fingerprint: preview.body.fingerprint })
    const id = applied.body.imported[0].matchId as string
    const corrected = sheet([{ code: 'M01', deck: 'butterfree', date: `${date(15)} 12:00`, rival: 'Gyarados ex' }])
    const row = ((await post('/api/matches/import/preview').send({ text: corrected })).body.rows as PreviewRow[])[0]
    expect(row).toMatchObject({ status: 'possible_duplicate', write: false, duplicateOf: { id } })
  })

  /** Codex on #143: an archived deck without matches, chosen for a code (what can be deleted while importing). */
  async function deletableDeck(code: string, hours: number) {
    const created = await post('/api/decks').send({ name: `Para borrar ${code}`, energies: ['fire'], cards: [] })
    expect(created.status).toBe(201)
    const deckId = created.body.id as string
    expect(
      (await test.http().patch(`/api/decks/${deckId}`).set('Cookie', cookie).send({ archived: true })).status,
    ).toBe(200)
    const text = sheet([{ code, deck: 'para borrar', date: ago(hours) }])
    const deckMap = { [code]: deckId }
    const preview = await post('/api/matches/import/preview').send({ text, deckMap })
    expect(preview.body.counts.write).toBe(1)
    return { deckId, body: { text, deckMap, fingerprint: preview.body.fingerprint as string } }
  }

  it('Codex on #143: a deck deleted while the import starts makes it a 409, never a 500', async () => {
    const { deckId, body } = await deletableDeck('M30', 250)
    const other = new pg.Client({ connectionString: test.env.databaseUrl })
    await other.connect()
    try {
      // The delete is under way (not committed) when the import starts: the import waits for it, then finds no deck.
      await other.query('BEGIN')
      await other.query('DELETE FROM decks WHERE id = $1', [Number(deckId)])
      const applying = post('/api/matches/import')
        .send(body)
        .then((response) => response)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await other.query('COMMIT')
      const applied = await applying
      expect(applied.status).toBe(409)
      expect(applied.body.error.code).toBe('import_changed')
    } finally {
      await other.end()
    }
  })

  it('Codex on #143: a deck delete while the import holds it waits, and then says the deck has matches (409)', async () => {
    const { deckId, body } = await deletableDeck('M31', 260)
    const deck = await test.prisma.deck.findUniqueOrThrow({
      where: { id: Number(mawile) },
      select: { currentRevisionId: true },
    })
    const other = new pg.Client({ connectionString: test.env.databaseUrl })
    await other.connect()
    try {
      // A match being saved elsewhere (far from the sheet) holds the matches table: the import has its decks locked
      // and waits there.
      await other.query('BEGIN')
      await other.query(
        `INSERT INTO matches (deck_id, deck_revision_id, result, mode, played_at) VALUES ($1, $2, 'loss', 'casual', $3)`,
        [Number(mawile), deck.currentRevisionId, new Date(BASE - 400 * DAY_MS)],
      )
      const applying = post('/api/matches/import')
        .send(body)
        .then((response) => response)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      let deleted = false
      const deleting = test
        .http()
        .delete(`/api/decks/${deckId}`)
        .set('Cookie', cookie)
        .then((response) => {
          deleted = true
          return response
        })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(deleted).toBe(false)
      await other.query('COMMIT')
      const applied = await applying
      expect(applied.status).toBe(200)
      const refused = await deleting
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe('deck_has_matches')
      expect(await test.prisma.deck.count({ where: { id: Number(deckId) } })).toBe(1)
    } finally {
      await other.end()
    }
  })

  /** Runs `start` while another transaction holds the ranks' lock: did it wait for it? */
  async function underRankLock<T>(start: () => PromiseLike<T>): Promise<{ waited: boolean; result: T }> {
    const holder = new pg.Client({ connectionString: test.env.databaseUrl })
    await holder.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT pg_advisory_xact_lock($1::bigint)', [RANK_NOTE_LOCK])
      let done = false
      const running = Promise.resolve(start()).then((result) => {
        done = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const waited = !done
      await holder.query('COMMIT')
      return { waited, result: await running }
    } finally {
      await holder.end()
    }
  }

  it('Codex and review of #143: every write of ranks and seasons waits for the ranks’ lock', async () => {
    const noted = (
      await post('/api/ranked/ranks').send({ rank: 'great-1', at: new Date(BASE - 500 * HOUR_MS).toISOString() })
    ).body as { id: string; at: string }
    // Deleting a rank.
    const deleting = await underRankLock(() =>
      test.http().delete(`/api/ranked/ranks/${noted.id}`).set('Cookie', cookie),
    )
    expect(deleting).toMatchObject({ waited: true, result: { status: 204 } })
    // Noting the rank now.
    const now = await underRankLock(() => post('/api/ranked/ranks').send({ rank: 'great-2' }))
    expect(now).toMatchObject({ waited: true, result: { status: 201 } })
    // «Deshacer» of a rank Claude noted.
    const audit = await test.prisma.mcpAudit.create({
      data: {
        tokenName: 'e2e',
        tool: 'ranked_rank_note',
        args: {},
        ok: true,
        ms: 1,
        undo: {
          kind: 'rank_change',
          id: now.result.body.id,
          at: now.result.body.at,
          rank: 'great-2',
          points: null,
          before: null,
          label: 'Super Ball 2',
        },
      },
    })
    const undone = await underRankLock(() => post(`/api/mcp-audit/${audit.id}/undo`).send())
    expect(undone).toMatchObject({ waited: true, result: { status: 200 } })
    expect(await test.prisma.rankChange.count({ where: { id: Number(now.result.body.id) } })).toBe(0)
    // Editing and deleting a season.
    const season = await underRankLock(() =>
      put('/api/ranked/seasons/OLD').send({ name: 'Temporada vieja', startsOn: day(-60), endsOn: day(-50) }),
    )
    expect(season).toMatchObject({ waited: true, result: { status: 200 } })
    const gone = await underRankLock(() => test.http().delete('/api/ranked/seasons/OLD').set('Cookie', cookie))
    expect(gone).toMatchObject({ waited: true, result: { status: 204 } })
    // Restoring a backup rewrites the ranks (and the matches) too.
    const file = (await get('/api/backup/export').responseType('blob')).body as Buffer
    const restored = await underRankLock(() =>
      post('/api/backup/import?mode=replace').attach('file', file, 'backup.json.gz'),
    )
    expect(restored).toMatchObject({ waited: true, result: { status: 200 } })
    // The monthly drill takes it before the tables (the order of every other writer).
    const drill = await underRankLock(() => post('/api/backup/drill').send())
    expect(drill).toMatchObject({ waited: true, result: { status: 200, body: { drill: { ok: true } } } })
  })
})
