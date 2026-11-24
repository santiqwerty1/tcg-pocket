/**
 * The frame of mock-up D around today's screens (phase 0b): one column of 480 px, the header, the tab bar with the
 * magnifier, the fixed row above it and the Menú. What jsdom cannot see is checked here, on the built app: that it
 * fits, that the bars cover nothing, that a tab remembers its place and its scroll, and that the look chosen in the
 * Menú reaches the page and stays.
 */
import { expect, type Locator, type Page, test } from '@playwright/test'

const COLUMN = 480
const HEADER = 52
const BAR = 58
const ROW = 60

/** The screens a tab or a view starts at, a deck and the Menú; whether the shell draws its fixed row there. */
const SCREENS: [path: string, row: boolean][] = [
  ['/partidas', false],
  ['/mazos', true],
  ['/mazos/1', false],
  ['/sobres', true],
  ['/coleccion', true],
  ['/torneos', true],
  ['/eventos', true],
  ['/laboratorio', true],
  ['/simulacion', true],
  ['/jugar', true],
  ['/mas', false],
]

const bar = (page: Page) => page.getByRole('navigation', { name: 'Secciones' })
const tab = (page: Page, name: string) => bar(page).getByRole('link', { name, exact: true })
const row = (page: Page) => page.locator('[data-slot="fixed-row"]')
// The one h1 of a screen, the header's: a page that wrote a second one would make this ambiguous, and fail.
const title = (page: Page) => page.getByRole('heading', { level: 1 })
const scrollY = (page: Page) => page.evaluate(() => window.scrollY)
const path = (page: Page) => page.evaluate(() => window.location.pathname + window.location.search)

/** The screen is drawn: its title is up and nothing in it is still loading. */
async function ready(page: Page) {
  await expect(title(page)).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

async function open(page: Page, to: string) {
  await page.goto(to)
  await ready(page)
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

function measure(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect
        ? {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : null
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
      height: window.innerHeight,
      column: box('#root'),
      header: box('header'),
      zone: box('[data-slot="bottom-zone"]'),
      bar: box('[data-slot="tab-bar"]'),
      row: box('[data-slot="fixed-row"]'),
    }
  })
}

function present(box: Box | null, what: string): Box {
  if (!box) throw new Error(`no ${what} on the page`)
  return box
}

for (const width of [360, 375, 412, 1280]) {
  test(`the frame fits at ${width} px: one column, header ${HEADER}, bar ${BAR}, row ${ROW}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    for (const [to, hasRow] of SCREENS) {
      await open(page, to)
      const seen = await measure(page)
      // A phone widens its window to fit a page that overflows: the window itself has to be the one asked for.
      expect(seen.width, `${to}: the window keeps its width`).toBe(width)
      expect(seen.scrollWidth, `${to}: no sideways scroll`).toBeLessThanOrEqual(seen.width)

      // The app is one column: the whole window on a phone, 480 px in the middle of anything wider.
      const column = present(seen.column, 'column')
      expect(column.width, `${to}: column`).toBeCloseTo(Math.min(width, COLUMN), 0)
      expect((column.left + column.right) / 2, `${to}: column centred`).toBeCloseTo(seen.width / 2, 0)

      const header = present(seen.header, 'header')
      expect(header.height, `${to}: header`).toBeCloseTo(HEADER, 0)
      expect(header.top, `${to}: header at the top`).toBeCloseTo(0, 0)
      expect(header.left, `${to}: header in the column`).toBeCloseTo(column.left, 0)
      expect(header.right, `${to}: header in the column`).toBeCloseTo(column.right, 0)

      const tabs = present(seen.bar, 'tab bar')
      expect(tabs.height, `${to}: bar`).toBeCloseTo(BAR, 0)
      expect(tabs.bottom, `${to}: bar at the bottom`).toBeCloseTo(seen.height, 0)
      expect(tabs.left, `${to}: bar in the column`).toBeCloseTo(column.left, 0)
      expect(tabs.right, `${to}: bar in the column`).toBeCloseTo(column.right, 0)
      expect(tabs.left, `${to}: bar in the window`).toBeGreaterThanOrEqual(-0.5)
      expect(tabs.right, `${to}: bar in the window`).toBeLessThanOrEqual(seen.width + 0.5)

      if (!hasRow) {
        expect(seen.row, `${to}: no fixed row`).toBeNull()
        continue
      }
      const fixed = present(seen.row, `fixed row at ${to}`)
      expect(fixed.height, `${to}: row`).toBeCloseTo(ROW, 0)
      // 12 px from each side of the column and 8 px over the bar.
      expect(fixed.left, `${to}: row in the column`).toBeCloseTo(column.left + 12, 0)
      expect(fixed.right, `${to}: row in the column`).toBeCloseTo(column.right - 12, 0)
      expect(fixed.bottom, `${to}: row over the bar`).toBeCloseTo(tabs.top - 8, 0)
      expect(fixed.top, `${to}: row in the window`).toBeGreaterThan(header.bottom)
    }

    if (width < COLUMN) return
    // Screens that used the width of a PC: in the column they are a phone's, and still do not overflow.
    for (const to of ['/simulacion/analisis', '/simulacion/calibracion', '/jugar/ejercicios']) {
      await open(page, to)
      const seen = await measure(page)
      expect(seen.width, `${to}: the window keeps its width`).toBe(width)
      expect(seen.scrollWidth, `${to}: no sideways scroll`).toBeLessThanOrEqual(seen.width)
      expect(present(seen.column, 'column').width, `${to}: column`).toBeCloseTo(COLUMN, 0)
    }
  })
}

test.describe('on a 360 px phone', () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test('nothing is covered: every screen ends above the bottom zone', async ({ page }) => {
    for (const to of [...SCREENS.map(([screen]) => screen), '/mazos/1/editar', '/partidas/historial', '/mas/ajustes']) {
      await open(page, to)
      // Scrolled to the end again on every look: a screen may still grow while its last pieces arrive.
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              window.scrollTo(0, document.documentElement.scrollHeight)
              const last = document.querySelector('main')?.lastElementChild?.getBoundingClientRect().bottom
              // With its fade, when it holds a row.
              const zone = document.querySelector('[data-slot="bottom-zone"]')?.getBoundingClientRect().top
              const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
              return last === undefined || zone === undefined || !atEnd ? Number.NaN : last - zone
            }),
          { message: `${to}: scrolled to the end, the page ends above the bottom zone` },
        )
        .toBeLessThanOrEqual(0.5)
    }
  })

  test('nothing is covered: the bars a page keeps in reach, the views and the action take a tap', async ({ page }) => {
    const top = async (name: 'tab-bar' | 'fixed-row') =>
      (await page.locator(`[data-slot="${name}"]`).boundingBox())?.y ?? Number.NaN
    const bottom = async (locator: Locator) => {
      const box = await locator.boundingBox()
      return box ? box.y + box.height : Number.NaN
    }
    /**
     * Where a control is right now. A trial click cannot tell: Playwright scrolls the control into reach first, and
     * at the end of the page a bar is no longer stuck, so a bar hidden under the tab bar would pass.
     */
    const reach = (locator: Locator) =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        const tabs = document.querySelector('[data-slot="tab-bar"]')?.getBoundingClientRect()
        return {
          onTop: element.contains(hit),
          overTheBar: tabs ? rect.bottom <= tabs.top + 0.5 : false,
          scrollY: window.scrollY,
          // With this much left to scroll the bar is stuck, not at its place in the page's flow.
          long: document.documentElement.scrollHeight - window.innerHeight > 100,
        }
      })
    const IN_REACH = { onTop: true, overTheBar: true, scrollY: 0, long: true }

    // Hoy: «Guardar partida» with a deck (the one it opens with) and a result chosen.
    await open(page, '/partidas')
    const form = page.getByRole('form', { name: 'Nueva partida' })
    await form.getByRole('button', { name: 'Victoria' }).click()
    const save = form.getByRole('button', { name: /Guardar partida/ })
    await expect(save).toBeEnabled()
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await reach(save), '«Guardar partida» from the top of Hoy').toEqual(IN_REACH)
    await save.click({ trial: true })
    expect(await bottom(save)).toBeLessThanOrEqual((await top('tab-bar')) + 0.5)
    await expect(row(page)).toHaveCount(0)

    // The deck editor: «Guardar» and «Cancelar», stuck over the bar from the top of a long page.
    await open(page, '/mazos/1/editar')
    const keep = page.getByRole('button', { name: 'Guardar', exact: true })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await reach(keep), '«Guardar» from the top of the editor').toEqual(IN_REACH)
    expect(
      await reach(page.getByRole('button', { name: 'Cancelar', exact: true })),
      '«Cancelar» from the top of the editor',
    ).toEqual(IN_REACH)
    await keep.click({ trial: true })
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click({ trial: true })
    expect(await bottom(keep)).toBeLessThanOrEqual((await top('tab-bar')) + 0.5)
    await expect(row(page)).toHaveCount(0)

    // A view of the fixed row, and the row's action.
    await open(page, '/sobres')
    await page.getByRole('tab', { name: 'Colección' }).click({ trial: true })
    await page.getByRole('tab', { name: 'Sobres' }).click({ trial: true })
    expect(await bottom(row(page))).toBeLessThanOrEqual((await top('tab-bar')) + 0.5)
    await open(page, '/mazos')
    await page.getByRole('link', { name: 'Nuevo mazo' }).click({ trial: true })
    // And every tab, with the row above them.
    for (const name of ['Hoy', 'Mazos', 'Cartas', 'Meta', 'Pruebas']) await tab(page, name).click({ trial: true })
    await bar(page).getByRole('button', { name: 'Buscar' }).click({ trial: true })

    // The fade over the row belongs to the bottom zone, which takes no tap of its own: right above the row, a tap
    // still reaches the page.
    await open(page, '/sobres')
    expect(
      await page.evaluate(() => {
        const fixed = document.querySelector('[data-slot="fixed-row"]')?.getBoundingClientRect()
        const zone = document.querySelector('[data-slot="bottom-zone"]')?.getBoundingClientRect()
        if (!fixed || !zone) return null
        const hit = document.elementFromPoint(fixed.left + fixed.width / 2, fixed.top - 10)
        return {
          inTheFade: fixed.top - 10 > zone.top,
          reachesThePage: hit !== null && document.querySelector('main')?.contains(hit) === true,
        }
      }),
    ).toEqual({ inTheFade: true, reachesThePage: true })
  })

  /** Two frames: a scroll the browser makes for the focus has happened by then. */
  const settled = (page: Page) =>
    page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const keptFree = (page: Page) =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return { top: style.scrollPaddingTop, bottom: style.scrollPaddingBottom }
    })

  test('a label tapped right above the tab bar does not move a screen that has no fixed row', async ({ page }) => {
    // Only the tab bar is over the end of the Menú: the band kept free for what takes the focus is the bar's.
    await open(page, '/mas')
    expect(await keptFree(page)).toEqual({ top: `${HEADER + 12}px`, bottom: `${BAR + 12}px` })
    const thumbnails = page.getByRole('switch', { name: /Miniaturas de cartas/ })
    await expect(thumbnails).toBeEnabled()
    const before = await thumbnails.getAttribute('aria-checked')
    // The switch 40 px above the tab bar: in plain sight, and inside what a screen WITH a row keeps free.
    await thumbnails.evaluate((element) => {
      const tabs = document.querySelector('[data-slot="tab-bar"]')?.getBoundingClientRect().top ?? 0
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().bottom - (tabs - 40))
    })
    await settled(page)
    const at = await scrollY(page)
    expect(at, 'the Menú is long enough to put the switch there').toBeGreaterThan(0)
    const box = await thumbnails.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(780 - BAR - 40, 0)

    // A tap on the text of its label, by coordinates (a locator's tap would scroll first): the control takes the
    // focus through the label, which is when a browser brings it into the band it keeps free.
    const text = await page.getByText('Miniaturas de cartas', { exact: true }).boundingBox()
    if (!text) throw new Error('no label text')
    await page.touchscreen.tap(text.x + text.width / 2, text.y + text.height / 2)
    await expect(thumbnails).not.toHaveAttribute('aria-checked', before ?? '')
    await settled(page)
    expect(await scrollY(page), 'the page stays where it was').toBe(at)
    // Back as it was (the choice is the server's), and still no jump.
    await expect(thumbnails).toBeEnabled()
    await page.touchscreen.tap(text.x + text.width / 2, text.y + text.height / 2)
    await expect(thumbnails).toHaveAttribute('aria-checked', before ?? '')
    await settled(page)
    expect(await scrollY(page)).toBe(at)

    // With a fixed row, or a bar of the page's own, the band is the whole of what covers the end of the page.
    for (const to of ['/coleccion', '/mazos', '/mazos/1/editar', '/partidas']) {
      await open(page, to)
      expect(await keptFree(page), to).toEqual({ top: `${HEADER + 12}px`, bottom: `${BAR + ROW + 24}px` })
    }
  })

  test('the focus on the header or on a page’s own bar does not move the page', async ({ page }) => {
    // The header is stuck inside the band kept free at the top: Tab onto its controls must not scroll for them.
    await open(page, '/coleccion')
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      'the collection is long enough to scroll 600 px',
    ).toBeGreaterThan(600)
    await page.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => scrollY(page)).toBe(600)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused()
    await settled(page)
    expect(await scrollY(page), 'the skip link').toBe(600)
    await page.keyboard.press('Tab')
    await expect(page.locator('header').getByRole('link', { name: /^Menú: aspecto, ajustes y sistema/ })).toBeFocused()
    await settled(page)
    expect(await scrollY(page), 'the way to the Menú').toBe(600)
    // While the focus is there its band is not kept; it is again as soon as the focus goes into the page.
    expect((await keptFree(page)).top).toBe('0px')
    await page.keyboard.press('Tab')
    await expect(page.locator('main :focus')).toHaveCount(1)
    expect((await keptFree(page)).top).toBe(`${HEADER + 12}px`)

    // «Volver», on an inner page.
    await open(page, '/partidas/historial')
    await page.evaluate(() => {
      // Tall enough to scroll, whatever the history holds.
      const spacer = document.createElement('div')
      spacer.style.height = '1500px'
      document.querySelector('main')?.append(spacer)
      window.scrollTo(0, 500)
    })
    await expect.poll(() => scrollY(page)).toBe(500)
    await page.getByRole('button', { name: 'Volver' }).focus()
    await settled(page)
    expect(await scrollY(page), '«Volver»').toBe(500)

    // The bar of the deck editor is stuck inside the band kept free at the bottom.
    await open(page, '/mazos/1/editar')
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => scrollY(page)).toBe(300)
    for (const name of ['Guardar', 'Cancelar']) {
      await page.getByRole('button', { name, exact: true }).focus()
      await settled(page)
      expect(await scrollY(page), `«${name}»`).toBe(300)
      expect((await keptFree(page)).bottom, `«${name}»`).toBe('0px')
    }
    // A field of the page is still brought out from under the header.
    const field = page.locator('main input:not([type="hidden"])').first()
    await field.evaluate((element) => {
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 20)
    })
    await settled(page)
    await field.focus()
    await settled(page)
    expect((await field.boundingBox())?.y, 'a field under the header is scrolled out').toBeGreaterThanOrEqual(HEADER)
  })

  test('the fixed row is not drawn under a sheet or a dialog, and comes back when it closes', async ({ page }) => {
    await open(page, '/mazos')
    await expect(row(page)).toBeVisible()
    await page.getByRole('button', { name: 'Al azar' }).click()
    const sheet = page.getByRole('dialog', { name: 'Mazo al azar' })
    await expect(sheet).toBeVisible()
    await expect(row(page)).toBeHidden()
    // The tab bar stays where it was, under the scrim (out of reach of a screen reader while the sheet is open).
    await expect(page.locator('[data-slot="tab-bar"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(row(page)).toBeVisible()

    await open(page, '/sobres')
    await expect(row(page)).toBeVisible()
    const magnifier = bar(page).getByRole('button', { name: 'Buscar' })
    await magnifier.click()
    const search = page.getByRole('dialog', { name: 'Buscar' })
    await expect(search.getByRole('searchbox', { name: 'Buscar en toda la app' })).toBeFocused()
    await expect(row(page)).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
    await expect(row(page)).toBeVisible()
    await expect(magnifier).toBeFocused()
  })

  test('tap targets: every link and button of the header, the row and the bar is 44 × 44 or more', async ({ page }) => {
    const small = () =>
      page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll(
            'header a, header button, [data-slot="bottom-zone"] a, [data-slot="bottom-zone"] button',
          ),
        ]
        return {
          count: controls.length,
          small: controls
            .map((control) => {
              const rect = control.getBoundingClientRect()
              const name = control.getAttribute('aria-label') ?? control.textContent?.trim() ?? ''
              return { name, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 }
            })
            .filter((control) => control.width < 43.5 || control.height < 43.5),
        }
      })
    // A root, the row's action, a deck (its pager lives in the header), two and three views, an inner page, the Menú;
    // with how many controls the frame has there, so a selector that finds nothing cannot pass.
    const screens: [string, number][] = [
      ['/partidas', 7],
      ['/mazos', 8],
      ['/mazos/1', 10],
      ['/sobres', 9],
      ['/laboratorio', 10],
      ['/partidas/historial', 8],
      ['/mas', 7],
    ]
    for (const [to, count] of screens) {
      await open(page, to)
      if (to === '/mazos/1') await expect(page.getByRole('navigation', { name: 'Otros mazos' })).toContainText('1/3')
      const seen = await small()
      expect(seen.small, to).toEqual([])
      expect(seen.count, `${to}: controls of the frame`).toBe(count)
    }
    // With the views «arriba» they are tabs in the header.
    await page.evaluate(() => localStorage.setItem('tcg.look', JSON.stringify({ views: 'top' })))
    await open(page, '/laboratorio')
    await expect(page.locator('header').getByRole('tablist', { name: 'Vistas de Pruebas' })).toBeVisible()
    const top = await small()
    expect(top.small).toEqual([])
    expect(top.count).toBe(10)
  })

  test('the skip link is the first stop: it moves the focus to the page and leaves the address alone', async ({
    page,
  }) => {
    await open(page, '/mazos')
    const skip = page.getByRole('link', { name: 'Saltar al contenido' })
    // Off the screen until it has the focus.
    expect((await skip.boundingBox())?.y ?? 0).toBeLessThan(0)
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await expect.poll(async () => (await skip.boundingBox())?.y).toBe(8)
    const box = await skip.boundingBox()
    expect(box?.x).toBe(8)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('principal')
    expect(await page.evaluate(() => window.location.hash)).toBe('')
    expect(await path(page)).toBe('/mazos')
  })

  test('tabs remember: the place, its scroll, and a second tap returns to the start', async ({ page }) => {
    await open(page, '/mazos')
    await page.locator('main a[href="/mazos/1"]').first().click()
    await expect(page).toHaveURL(/\/mazos\/1$/)
    await ready(page)
    await tab(page, 'Hoy').click()
    await expect(page).toHaveURL(/\/partidas$/)
    await expect(tab(page, 'Hoy')).toHaveAttribute('aria-current', 'page')
    // Back to the deck, not to the list.
    await tab(page, 'Mazos').click()
    await expect(page).toHaveURL(/\/mazos\/1$/)
    await expect(tab(page, 'Mazos')).toHaveAttribute('aria-current', 'page')
    // And its «Volver» goes up to the list, not back to Hoy.
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(page).toHaveURL(/\/mazos$/)
    await page.locator('main a[href="/mazos/1"]').first().click()
    await expect(page).toHaveURL(/\/mazos\/1$/)
    // A second tap on the lit tab: its start.
    await tab(page, 'Mazos').click()
    await expect(page).toHaveURL(/\/mazos$/)
    await expect(title(page)).toHaveText('Mazos')

    // A long screen keeps its scroll.
    await open(page, '/coleccion')
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
      'the collection is long enough to scroll 400 px',
    ).toBeGreaterThan(400)
    // The summary's placeholder tiles carry no aria-busy: wait for the real ones, or they would arrive above the fold
    // after the scroll and the browser's scroll anchoring would move the page.
    await expect(page.getByText('Copias jugables', { exact: true }).first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(() => scrollY(page)).toBe(400)
    // The scroll event that the frame listens to comes with the next frame.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await tab(page, 'Hoy').click()
    await expect(page).toHaveURL(/\/partidas$/)
    await expect.poll(() => scrollY(page)).toBe(0)
    await tab(page, 'Cartas').click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect
      .poll(async () => Math.abs((await scrollY(page)) - 400), { message: 'the scroll of Colección comes back' })
      .toBeLessThanOrEqual(2)
    // The lit tab, away from its start: the start, at the top.
    await tab(page, 'Cartas').click()
    await expect(page).toHaveURL(/\/sobres$/)
    // The address changes before the new screen is drawn: wait for its title, not only for «nothing is loading».
    await expect(title(page)).toHaveText('Sobres')
    await ready(page)
    await expect.poll(() => scrollY(page)).toBe(0)
    // And already there, it scrolls to the top.
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => scrollY(page)).toBe(300)
    await tab(page, 'Cartas').click()
    await expect.poll(() => scrollY(page)).toBe(0)
    await expect(page).toHaveURL(/\/sobres$/)
  })

  test('a view takes the place of the history entry, and opens at the top', async ({ page }) => {
    await open(page, '/sobres')
    const entries = await page.evaluate(() => window.history.length)
    await page.evaluate(() => window.scrollTo(0, 200))
    await page.getByRole('tab', { name: 'Colección' }).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(page.getByRole('tab', { name: 'Colección' })).toHaveAttribute('aria-selected', 'true')
    await expect(title(page)).toHaveText('Colección')
    await expect.poll(() => scrollY(page)).toBe(0)
    expect(await page.evaluate(() => window.history.length)).toBe(entries)
    await page.getByRole('tab', { name: 'Sobres' }).click()
    await expect(page).toHaveURL(/\/sobres$/)
    expect(await page.evaluate(() => window.history.length)).toBe(entries)
    // The three of Pruebas, with the keyboard: the arrows move, open and keep the focus.
    await open(page, '/laboratorio')
    const count = await page.evaluate(() => window.history.length)
    await page.getByRole('tab', { name: 'Laboratorio' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/\/simulacion$/)
    await expect(page.getByRole('tab', { name: 'Simulación' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(page).toHaveURL(/\/jugar$/)
    await expect(page.getByRole('tab', { name: 'Practicar' })).toBeFocused()
    await expect(title(page)).toHaveText('Jugar contra un bot')
    expect(await page.evaluate(() => window.history.length)).toBe(count)
  })

  /** A link opened with nothing of the app behind: the right screen, and the tab it belongs to (none on the Menú). */
  const COLD: [to: string, lands: string, heading: string, lit: string | null][] = [
    ['/', '/partidas', 'Hoy', 'Hoy'],
    // The shortcuts of the installed app.
    ['/partidas', '/partidas', 'Hoy', 'Hoy'],
    ['/mazos', '/mazos', 'Mazos', 'Mazos'],
    ['/sobres', '/sobres', 'Sobres', 'Cartas'],
    ['/coleccion/importar', '/coleccion/importar', 'Importar colección', 'Cartas'],
    ['/mas', '/mas', 'Menú', null],
    ['/mas/backup', '/mas/backup', 'Copia de seguridad', null],
    ['/torneos/ajustes', '/torneos/ajustes', 'Ajustes de torneos', 'Meta'],
    ['/jugar/situaciones', '/jugar/situaciones', 'Situaciones para resolver', 'Pruebas'],
    // Where a notification leads.
    ['/jugar/1', '/jugar/1', 'Partida', 'Pruebas'],
    ['/laboratorio/1', '/laboratorio/1', 'Laboratorio', 'Pruebas'],
    ['/simulacion/1', '/simulacion/1', 'Simulación', 'Pruebas'],
    ['/partidas/semana?semana=2026-11-16', '/partidas/semana?semana=2026-11-16', 'Tu semana', 'Hoy'],
    // Where «Compartir» leaves a deck's text.
    ['/mazos/importar?compartido=1', '/mazos/importar?compartido=1', 'Importar mazos', 'Mazos'],
  ]

  test('cold deep links open the right screen under the right tab', async ({ page }) => {
    for (const [to, lands, heading, lit] of COLD) {
      await page.goto(to)
      await expect(title(page), to).toHaveText(heading)
      expect(await path(page), to).toBe(lands)
      const current = bar(page).locator('[aria-current="page"]')
      if (lit === null) await expect(current, to).toHaveCount(0)
      else await expect(current, to).toHaveText([lit])
      // The Menú is one tap away from every screen outside it.
      await expect(page.locator('header').getByRole('link', { name: /^Menú: aspecto, ajustes y sistema/ })).toHaveCount(
        lands.startsWith('/mas') ? 0 : 1,
      )
    }
  })

  test('«Volver» on the first screen of a visit goes up, and up again, without leaving the app', async ({ page }) => {
    await page.goto('/mas/backup')
    await expect(title(page)).toHaveText('Copia de seguridad')
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(title(page)).toHaveText('Menú')
    expect(await path(page)).toBe('/mas')
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(title(page)).toHaveText('Hoy')
    expect(await path(page)).toBe('/partidas')
    // A root has no «Volver»: the way out of the app is the browser's.
    await expect(page.getByRole('button', { name: 'Volver' })).toHaveCount(0)
    // The same from two levels down in a tab.
    await page.goto('/jugar/situaciones')
    await expect(title(page)).toHaveText('Situaciones para resolver')
    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(title(page)).toHaveText('Jugar contra un bot')
    expect(await path(page)).toBe('/jugar')
    await expect(tab(page, 'Pruebas')).toHaveAttribute('aria-current', 'page')
  })

  test('the Menú’s look choices reach the page, hold after a reload, and «arriba» moves the views', async ({
    page,
  }) => {
    const look = () =>
      page.evaluate(() => {
        const root = document.documentElement
        const style = getComputedStyle(root)
        const ms = (value: string) => Math.round(Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000))
        const column = document.querySelector('#root')
        return {
          theme: root.getAttribute('data-theme'),
          motion: root.getAttribute('data-motion'),
          background: column ? getComputedStyle(column).backgroundColor : null,
          // In milliseconds: the build may write 150ms as .15s.
          short: ms(style.getPropertyValue('--dur-1')),
          long: ms(style.getPropertyValue('--dur-3')),
          stored: JSON.parse(localStorage.getItem('tcg.look') ?? 'null') as unknown,
        }
      })
    const choice = (group: string, name: string) =>
      page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })

    await open(page, '/mas')
    // Dark, «Expresivo» and the views in the row until this device says otherwise.
    expect(await look()).toEqual({
      theme: 'dark',
      motion: 'full',
      background: 'rgb(10, 14, 20)',
      short: 140,
      long: 520,
      stored: null,
    })
    await expect(choice('Tema', 'Oscuro')).toBeChecked()
    await expect(choice('Movimiento', 'Expresivo')).toBeChecked()
    await expect(choice('Dónde van las vistas', 'Abajo, en la fila fija')).toBeChecked()

    await choice('Tema', 'Claro').click()
    await choice('Movimiento', 'Sutil').click()
    await choice('Dónde van las vistas', 'Arriba, en pestañas').click()
    const chosen = {
      theme: 'light',
      motion: 'subtle',
      background: 'rgb(241, 238, 232)',
      short: 90,
      long: 150,
      stored: { theme: 'light', motion: 'subtle', views: 'top' },
    }
    expect(await look()).toEqual(chosen)

    await page.reload()
    await ready(page)
    expect(await look()).toEqual(chosen)
    await expect(choice('Tema', 'Claro')).toBeChecked()
    await expect(choice('Movimiento', 'Sutil')).toBeChecked()
    await expect(choice('Dónde van las vistas', 'Arriba, en pestañas')).toBeChecked()

    // «Arriba»: the views are tabs under the title, inside the header, and the row is gone.
    await tab(page, 'Cartas').click()
    await expect(page).toHaveURL(/\/sobres$/)
    await ready(page)
    const views = page.locator('header').getByRole('tablist', { name: 'Vistas de Cartas' })
    await expect(views).toBeVisible()
    await expect(row(page)).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: 'Vistas de Cartas' })).toHaveCount(1)
    const seen = await measure(page)
    const header = present(seen.header, 'header')
    // The band kept free at the top follows the header's real height, which the shell writes on <html>.
    const headerBand = () =>
      page.evaluate(() => ({
        header: document.querySelector('header')?.offsetHeight ?? 0,
        now: document.documentElement.style.getPropertyValue('--header-now'),
        padding: getComputedStyle(document.documentElement).scrollPaddingTop,
      }))
    const tall = await headerBand()
    expect(tall).toEqual({ header: tall.header, now: `${tall.header}px`, padding: `${tall.header + 12}px` })
    expect(tall.header).toBeCloseTo(header.height, 0)
    const list = await views.boundingBox()
    expect(list?.y).toBeGreaterThanOrEqual(HEADER - 4)
    expect((list?.y ?? 0) + (list?.height ?? 0)).toBeLessThanOrEqual(header.bottom)
    expect(header.height).toBeGreaterThan(HEADER + 44)
    expect(seen.scrollWidth).toBeLessThanOrEqual(seen.width)
    // The page starts under the taller header, and the header stays while the page scrolls.
    const first = await page.locator('main > *').first().boundingBox()
    expect(first?.y).toBeGreaterThanOrEqual(header.bottom)
    await page.evaluate(() => window.scrollTo(0, 500))
    await expect.poll(() => scrollY(page)).toBeGreaterThan(200)
    expect((await views.boundingBox())?.y).toBe(list?.y)
    await views.getByRole('tab', { name: 'Colección' }).click()
    await expect(page).toHaveURL(/\/coleccion$/)
    await expect(views.getByRole('tab', { name: 'Colección' })).toHaveAttribute('aria-selected', 'true')
    // On a screen without views the header is short again, and so is the band.
    await tab(page, 'Mazos').click()
    await expect(page).toHaveURL(/\/mazos$/)
    await expect(title(page)).toHaveText('Mazos')
    await ready(page)
    expect(await headerBand()).toEqual({ header: HEADER, now: `${HEADER}px`, padding: `${HEADER + 12}px` })

    // «Ninguno»: nothing animates, and a dialog still opens and closes.
    await open(page, '/mas')
    await choice('Movimiento', 'Ninguno').click()
    expect((await look()).motion).toBe('none')
    expect((await look()).short).toBe(0)
    expect(
      await page.evaluate(() => {
        const screen = document.querySelector('main > *')
        return screen ? getComputedStyle(screen).animationName : null
      }),
    ).toBe('none')
    await bar(page).getByRole('button', { name: 'Buscar' }).click()
    const search = page.getByRole('dialog', { name: 'Buscar' })
    await expect(search).toBeVisible()
    expect(await search.evaluate((dialog) => getComputedStyle(dialog).animationName)).toBe('none')
    await page.keyboard.press('Escape')
    await expect(search).toHaveCount(0)

    // Back to the row.
    await choice('Dónde van las vistas', 'Abajo, en la fila fija').click()
    await choice('Tema', 'Oscuro').click()
    expect((await look()).stored).toEqual({ theme: 'dark', motion: 'none', views: 'bottom' })
    await tab(page, 'Cartas').click()
    await expect(row(page).getByRole('tablist', { name: 'Vistas de Cartas' })).toBeVisible()
  })

  test('a system that asks to reduce motion keeps the app in «Ninguno», whatever was chosen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, '/mas')
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'none')
    const levels = page.getByRole('radiogroup', { name: 'Movimiento' })
    await expect(levels.getByRole('radio', { name: 'Ninguno' })).toBeChecked()
    await expect(page.getByText('tu sistema pide reducirlo: queda en Ninguno')).toBeVisible()
    await expect(levels.getByRole('radio', { name: 'Expresivo' })).toHaveAttribute('aria-disabled', 'true')
    // A tap still reaches it (it is `aria-disabled`, not `disabled`); Playwright would wait for it to be enabled.
    await levels.getByRole('radio', { name: 'Expresivo' }).click({ force: true })
    await expect(page.getByText('Tu sistema pide reducir el movimiento: queda en «Ninguno».')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'none')
    expect(await page.evaluate(() => localStorage.getItem('tcg.look'))).toBeNull()
    // When the system stops asking, the app moves again, without a reload.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
    await expect(levels.getByRole('radio', { name: 'Expresivo' })).toBeChecked()
  })
})

/** The column on a PC: a window with a mouse, where a scrollbar takes room of its own (on a phone it floats). */
test.describe('on a desktop window', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })

  test('a dialog or a sheet moves neither the column nor the bottom zone, and a bottom sheet takes the column', async ({
    page,
  }) => {
    const boxes = () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return rect ? [rect.left, rect.width] : null
        }
        return {
          column: box('#root'),
          zone: box('[data-slot="bottom-zone"]'),
          bar: box('[data-slot="tab-bar"]'),
          // What the scroll lock of a dialog writes on <body> to make up for the scrollbar it hides.
          margin: getComputedStyle(document.body).marginRight,
          // The room kept for the scrollbar whether the page scrolls or not (a headless browser draws none, and
          // still keeps it): how far short of the window the page ends.
          gutter: window.innerWidth - document.body.getBoundingClientRect().right,
        }
      })

    await open(page, '/mazos')
    // A page that scrolls, whatever the three decks take: where the scrollbar is drawn, only then does the scroll
    // lock of a dialog have one to make up for.
    expect(
      await page.evaluate(() => {
        const spacer = document.createElement('div')
        spacer.style.height = '1500px'
        document.querySelector('main')?.append(spacer)
        return document.documentElement.scrollHeight > window.innerHeight
      }),
    ).toBe(true)
    const closed = await boxes()
    expect(closed.gutter, 'the room of the scrollbar is kept').toBeGreaterThan(0)
    expect(closed.column?.[1]).toBe(COLUMN)
    expect(closed.zone).toEqual(closed.column)
    expect(closed.bar).toEqual(closed.column)
    expect(closed.margin).toBe('0px')

    await page.getByRole('button', { name: 'Al azar' }).click()
    const sheet = page.getByRole('dialog', { name: 'Mazo al azar' })
    await expect(sheet).toBeVisible()
    expect(await boxes(), 'with the sheet open').toEqual(closed)
    // Once it has come up: the sheet is as wide as the column, and in its place.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox()
        return box ? [box.x, box.width] : null
      })
      .toEqual(closed.column)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    expect(await boxes(), 'with the sheet closed again').toEqual(closed)

    await page.keyboard.press('/')
    const search = page.getByRole('dialog', { name: 'Buscar' })
    await expect(search.getByRole('searchbox', { name: 'Buscar en toda la app' })).toBeFocused()
    expect(await boxes(), 'with the search open').toEqual(closed)
    // A dialog is the window's, not the column's: centred in it.
    const dialog = await search.boundingBox()
    expect((dialog?.x ?? 0) + (dialog?.width ?? 0) / 2).toBeCloseTo((1280 - closed.gutter) / 2, 0)
    await page.keyboard.press('Escape')
    await expect(search).toBeHidden()
    expect(await boxes(), 'with the search closed again').toEqual(closed)
  })
})

/** Text of a page that has no place to break must not leave the column: on a phone it would widen the window. */
test.describe('a line with no place to break', () => {
  // The answer of the API is rewritten on its way, which a service worker in between would not let through.
  test.use({ serviceWorkers: 'block' })

  // Two engine revisions in a row, as a finding names them when the engine changed between two simulations.
  const LONG = `El resultado cambió entre los motores ${'a'.repeat(40)}/${'b'.repeat(40)}.`

  for (const width of [360, 1280]) {
    test(`a finding of the analysis stays inside the column at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 })
      await page.route('**/api/simulations/analysis*', async (route) => {
        const response = await route.fetch()
        const view = (await response.json()) as { findings: { kind: string; text: string }[] }
        await route.fulfill({ response, json: { ...view, findings: [{ kind: 'bot_change', text: LONG }] } })
      })
      await open(page, '/simulacion/analisis')
      const line = page.getByRole('listitem').filter({ hasText: 'El resultado cambió entre los motores' })
      await expect(line).toBeVisible()
      const seen = await measure(page)
      const column = present(seen.column, 'column')
      // Where the text itself ends, wherever its box does.
      const ink = await line.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getBoundingClientRect().right
      })
      expect(ink, 'the text ends inside the column').toBeLessThanOrEqual(column.right + 0.5)
      expect(seen.width, 'the window keeps its width').toBe(width)
      expect(seen.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(width)
      // And the tab bar is where the column is, on the first screen.
      const tabs = present(seen.bar, 'tab bar')
      expect(tabs.left).toBeCloseTo(column.left, 0)
      expect(tabs.right).toBeCloseTo(column.right, 0)
      expect(tabs.bottom).toBeCloseTo(seen.height, 0)
    })
  }
})
