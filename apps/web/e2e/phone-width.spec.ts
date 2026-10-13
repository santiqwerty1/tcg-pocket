/**
 * Phone review (13/10/2026): on a 375 px phone nothing makes the page wider than the screen, a pack's line wraps
 * inside its card, and a match row keeps the rival readable after a long deck name.
 */
import { expect, type Page, test } from '@playwright/test'

const PHONE = 375
test.use({ viewport: { width: PHONE, height: 812 } })

/** Opens every <details> of the page (Sobres' settings, the deck's sections) and waits for what they load. */
async function openAll(page: Page) {
  await page.evaluate(() => {
    for (const details of document.querySelectorAll('details')) details.open = true
  })
  await page.waitForLoadState('networkidle')
}

const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth)

test('Sobres fits the phone with every setting open, and each pack line wraps inside its card', async ({ page }) => {
  await page.goto('/sobres')
  await expect(page.getByRole('heading', { name: 'Qué sobre abrir' })).toBeVisible()
  const lines = page.getByTestId('pack-line')
  expect(await lines.count()).toBeGreaterThan(0)
  for (const width of await lines.evaluateAll((items) => items.map((item) => item.scrollWidth - item.clientWidth))) {
    expect(width).toBeLessThanOrEqual(1)
  }
  await openAll(page)
  await expect(page.getByText('intercambio').first()).toBeVisible()
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)
})

test('a match row keeps the rival readable after a long deck name', async ({ page }) => {
  const decks = (await (await page.request.get('/api/decks')).json()) as { items?: { id: string; name: string }[] }
  const deck = [...(decks.items ?? [])].sort((a, b) => b.name.length - a.name.length)[0]
  if (!deck) throw new Error('no deck')
  const logged = await page.request.post('/api/matches', {
    data: { deckId: deck.id, result: 'win', opponent: 'Gyarados ex' },
  })
  expect(logged.status()).toBe(201)
  await page.goto('/partidas/historial')
  const rival = page.locator('ul li a span.truncate', { hasText: 'Gyarados ex' }).first()
  await expect(rival).toBeVisible()
  // The whole name shows: nothing of it is cut.
  expect(await rival.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)
})

test('review of #87: a long word in a column of the deck’s «Rendimiento» wraps inside the column', async ({ page }) => {
  // The screens database has no tournaments: the tournament column gets the note it has with them.
  await page.route('**/api/decks/1/comparison*', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as { columns: { source: string; note: string }[] }
    body.columns = body.columns.map((column) =>
      column.source === 'tournament'
        ? {
            ...column,
            note: 'Era B4a (Ambición del Equipo Rocket), 1 torneo, media 48 %. Datos de torneo: Limitless (play.limitlesstcg.com).',
          }
        : column,
    )
    await route.fulfill({ response, json: body })
  })
  await page.goto('/mazos/1')
  const note = page.locator('[data-source="tournament"] p').last()
  await expect(note).toContainText('play.limitlesstcg.com')
  expect(await note.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)
})

for (const path of ['/partidas', '/partidas/estadisticas', '/partidas/semana', '/mazos', '/mazos/1', '/coleccion']) {
  test(`${path} fits the phone with every section open`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await openAll(page)
    expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE)
  })
}
