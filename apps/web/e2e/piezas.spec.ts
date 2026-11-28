/**
 * The pieces of mock-up D (phase 1 «componentes»: seals, marks, small charts, the figure, the block of a source and
 * its legend), measured where jsdom has no boxes: on the built app, in Chromium.
 *
 * First the gallery «Piezas de la interfaz» (Menú → Acerca de), at four widths and in both themes: nothing wider than
 * the window, no text under 13 px, every number of a figure at 14 px or more, the seals at 18 and 16 px, the charts
 * at 12 and 6 px, no error in the console and no request to the API. Each kind of thing measured is counted, so an
 * empty page cannot pass. Then the deck's «Rendimiento», where the three sources are blocks: the answer of the
 * comparison is rewritten on its way (the screens database has no tournaments nor simulations), with data in the
 * three sources, with none, and with a tournament figure that is «orientativo» by its lists.
 *
 * Every number here is invented: none is a result of anybody.
 */
import { expect, type Page, test } from '@playwright/test'
import type { z } from 'zod'
import { archetypesResponseSchema, deckComparisonSchema } from '../src/api/schemas.ts'

const WIDTHS = [360, 375, 412, 1280]
const THEMES = ['dark', 'light'] as const
/** The app is one column: the whole window on a phone, 480 px in the middle of anything wider. */
const COLUMN = 480

const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name })

/** The theme of this device, as the Menú stores it (src/lib/look.ts), set before the page loads. */
async function chooseTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((look) => localStorage.setItem('tcg.look', JSON.stringify(look)), { theme })
}

/** What the page says to the console as an error, and what it asks the API for, from now on. */
function watch(page: Page) {
  const errors: string[] = []
  const asked: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) asked.push(`${request.method()} ${url.pathname}`)
  })
  return { errors, asked }
}

/** The page is drawn with its own fonts: a measure taken before would be of the fallback's. */
async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(() => ({
    loaded: [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family.replace(/"/g, '')),
    loading: [...document.fonts].filter((font) => font.status === 'loading').length,
  }))
  expect(fonts.loading).toBe(0)
  // The two families of the app: the figures are drawn in the first one.
  expect(fonts.loaded).toContain('Barlow Semi Condensed')
  expect(fonts.loaded).toContain('Inter')
}

/**
 * What is measured inside `scope` (a selector): the window, every text, what sticks out, what is cut, what is stuck,
 * and the box of each piece by its slot. Sizes in CSS pixels, rounded to a hundredth.
 */
function measure(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (!root) throw new Error(`nothing matches ${selector}`)
    const round = (value: number) => Math.round(value * 100) / 100
    const px = (element: Element, property: 'fontSize' | 'width' | 'height') =>
      round(Number.parseFloat(getComputedStyle(element)[property]))
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { width: round(rect.width), height: round(rect.height) }
    }
    const all = (query: string) => [...root.querySelectorAll(query)]
    const hidden = (element: Element) => element.closest('.sr-only') !== null

    // Every text that is drawn, with the size of its type.
    const texts: { size: number; text: string }[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? ''
      const parent = node.parentElement
      if (text === '' || !parent || hidden(parent)) continue
      texts.push({ size: px(parent, 'fontSize'), text: text.slice(0, 40) })
    }

    // What sticks out of the scope to either side, what is cut with «…», and what is stuck to the window.
    const limits = root.getBoundingClientRect()
    const out: string[] = []
    const cut: string[] = []
    const stuck: string[] = []
    for (const element of all('*')) {
      if (hidden(element)) continue
      const rect = element.getBoundingClientRect()
      const name = `${element.tagName.toLowerCase()}[${element.getAttribute('data-slot') ?? element.getAttribute('data-part') ?? ''}]`
      if (rect.width > 0 && (rect.right > limits.right + 0.5 || rect.left < limits.left - 0.5)) {
        out.push(`${name} ${round(rect.left)}–${round(rect.right)}`)
      }
      const style = getComputedStyle(element)
      if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth) cut.push(name)
      if (style.position === 'sticky' || style.position === 'fixed') stuck.push(name)
    }

    // The numbers of a figure: all of its text but the letter of its seal.
    const figures = all('[data-slot="figure"]').map((figure) => {
      const sizes: number[] = []
      const inner = document.createTreeWalker(figure, NodeFilter.SHOW_TEXT)
      for (let node = inner.nextNode(); node; node = inner.nextNode()) {
        const parent = node.parentElement
        if (!node.textContent?.trim() || !parent || hidden(parent)) continue
        if (parent.closest('[data-slot="source-seal"]')) continue
        sizes.push(px(parent, 'fontSize'))
      }
      const lead = figure.querySelector('[data-part="value"], [data-part="n"]')
      return {
        size: figure.getAttribute('data-size'),
        empty: figure.hasAttribute('data-empty'),
        sizes,
        lead: lead ? { part: lead.getAttribute('data-part'), size: px(lead, 'fontSize') } : null,
      }
    })

    return {
      window: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      theme: document.documentElement.getAttribute('data-theme'),
      column: round(document.querySelector('#root')?.getBoundingClientRect().width ?? 0),
      texts,
      out,
      cut,
      stuck,
      figures,
      seals: all('[data-slot="source-seal"]').map((seal) => ({ ...box(seal), type: px(seal, 'fontSize') })),
      orientative: all('[data-slot="orientative-mark"]').map(box),
      coverage: all('[data-slot="coverage-mark"]').map(box),
      intervalMarks: all('[data-slot="interval-mark"]').map(box),
      barMarks: all('[data-slot="bar-mark"]').map(box),
      recordBars: all('[data-slot="record-bar"]').map(box),
      intervalBars: all('[data-slot="interval-bar"] > [data-part="bar"]').map(box),
      blocks: all('[data-slot="source-block"]').map((block) => {
        // What a part of the block writes itself, by the size of its type: not the letter of its seal.
        const sizes = (part: string) => {
          const found: number[] = []
          for (const own of block.querySelectorAll(`:scope > [data-part="${part}"]`)) {
            const inner = document.createTreeWalker(own, NodeFilter.SHOW_TEXT)
            for (let node = inner.nextNode(); node; node = inner.nextNode()) {
              const parent = node.parentElement
              if (!node.textContent?.trim() || !parent || hidden(parent)) continue
              if (parent.closest('[data-slot="source-seal"]')) continue
              found.push(px(parent, 'fontSize'))
            }
          }
          return found
        }
        const head = block.querySelector(':scope > [data-part="head"]')
        const name = head?.firstElementChild?.lastElementChild
        const value = head?.querySelector(':scope > [data-part="value"], :scope > [data-slot="no-data"]')
        return {
          source: block.getAttribute('data-source'),
          size: block.getAttribute('data-size'),
          // The name beside its seal, and the line it is written on; the value at the right of the head.
          name: name
            ? {
                ...box(name),
                line: round(Number.parseFloat(getComputedStyle(name).lineHeight)),
                text: name.textContent ?? '',
              }
            : null,
          valueRight: value ? round(value.getBoundingClientRect().right) : null,
          headRight: head ? round(head.getBoundingClientRect().right) : null,
          value: block.querySelector(':scope > [data-part="head"] [data-part="value"]')
            ? px(block.querySelector(':scope > [data-part="head"] [data-part="value"]') as Element, 'fontSize')
            : null,
          // The lines under its bar (n, interval, record) and the two ends of the scale of a lane.
          lines: sizes('figures'),
          ends: sizes('chart'),
          // All it writes of its own, and not what it holds of others (`more`): its name, its numbers, its words.
          written: ['head', 'chart', 'figures', 'warning', 'unavailable', 'note'].flatMap(sizes),
        }
      }),
      legends: all('[data-slot="source-legend"]').length,
      // Each chart of a state that names the tick of the middle: where its tick is, and where its point is.
      middleTicks: all('[data-state*="marca del medio"]').flatMap((state) =>
        [...state.querySelectorAll('[data-slot="interval-mark"], [data-slot="interval-bar"] > [data-part="bar"]')].map(
          (chart) => {
            const edges = (part: string) => {
              const found = chart.querySelector(`:scope > [data-part="${part}"]`)
              if (!found) return null
              const rect = found.getBoundingClientRect()
              return { left: round(rect.left), right: round(rect.right), height: round(rect.height) }
            }
            return { state: state.getAttribute('data-state'), tick: edges('tick'), point: edges('point') }
          },
        ),
      ),
      // What a finger could tap outside the drawings of the row, and the controls inside them, which take none.
      tappable: all('a, button, input, select, textarea, [role="button"], [tabindex]').filter(
        (element) => element.closest('[inert]') === null,
      ).length,
      drawnControls: all('[inert] :is(a, button, [tabindex])').length,
      rowDrawings: all('[data-drawing="fixed-row"]').map((drawing) => {
        const edges = drawing.getBoundingClientRect()
        const action = drawing.querySelector('[data-slot="row-action"]')?.getBoundingClientRect()
        const views = [...drawing.querySelectorAll('[data-drawing="view"]')].map((view) => view.getBoundingClientRect())
        return {
          ...box(drawing),
          inert: (drawing as HTMLElement).inert,
          // Everything inside its box (5 px of padding and 1 of edge), and no view under the action.
          inside:
            action !== undefined &&
            [action, ...views].every((part) => part.left >= edges.left + 5.5 && part.right <= edges.right - 5.5),
          apart: views.every((view) => action !== undefined && view.right <= action.left + 0.5),
        }
      }),
      rowActions: all('[data-slot="row-action"]').map((element) => {
        const icon = element.querySelector('svg')
        return {
          ...box(element),
          layout: element.getAttribute('data-layout'),
          text: (element as HTMLElement).innerText.trim(),
          spills: element.scrollWidth - element.clientWidth,
          // On how many lines its text is written: a text that keeps it is on one.
          lines: (() => {
            const written = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
            if (!written) return 0
            const range = document.createRange()
            range.selectNodeContents(written)
            return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
          })(),
          // By its own size: a spinning icon's box grows with the turn.
          icon: icon ? { width: px(icon, 'width'), height: px(icon, 'height') } : null,
          spinning: icon ? getComputedStyle(icon).animationName !== 'none' : false,
          type: px(element, 'fontSize'),
          inert: element.closest('[inert]') !== null,
        }
      }),
      rowViews: all('[data-drawing="view"]').map((view) => ({ ...box(view), type: px(view, 'fontSize') })),
    }
  }, scope)
}

/** How many of each piece the gallery draws (the same numbers as src/pages/mas/PiecesPage.test.tsx). */
const DRAWN = {
  sections: 9,
  notices: 10,
  seals18: 40,
  seals16: 20,
  orientative: 16,
  coverage: 4,
  intervalMarks: 7,
  barMarks: 3,
  recordBars6: 2,
  recordBars12: 2,
  intervalBars: 19,
  figures: 18,
  rowBlocks: 13,
  laneBlocks: 7,
  legends: 6,
  middleTicks: 3,
  rowDrawings: 6,
  rowActions: 6,
  rowViews: 9,
}
/** The ring of the surface around the point of a chart, which is drawn over the tick (MiniCharts, IntervalBar). */
const RING = 2
/** The size of what leads a figure, by the size of the figure: the percentage, or the n of a table sorted by n. */
const LEAD = { cell: 17, header: 15, hero: 22, score: 28 } as const

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`«Piezas de la interfaz» at ${width} px, ${theme}: every piece at its size, nothing cut, nothing asked`, async ({
      page,
    }) => {
      const { errors, asked } = watch(page)
      await chooseTheme(page, theme)
      await page.setViewportSize({ width, height: 780 })
      await page.goto('/mas/piezas')
      await expect(title(page, 'Piezas de la interfaz')).toBeVisible()
      await expect(page.locator('main [data-section]')).toHaveCount(DRAWN.sections)
      await page.waitForLoadState('networkidle')
      await fontsReady(page)

      const seen = await measure(page, 'main')
      expect(seen.theme).toBe(theme)
      // A phone widens its window to fit a page that overflows: the window itself has to be the one asked for.
      expect(seen.window).toBe(width)
      expect(seen.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(width)
      expect(seen.column).toBeCloseTo(Math.min(width, COLUMN), 0)
      expect(seen.out, 'nothing sticks out of the page').toEqual([])
      expect(seen.cut, 'no text is cut with «…»').toEqual([])
      expect(seen.stuck, 'nothing is stuck to the window').toEqual([])

      // Its notice of test data: on top, and in each section.
      await expect(page.getByText('Datos de prueba: ninguna cifra de esta página es tuya')).toHaveCount(DRAWN.notices)
      for (const section of await page.locator('main [data-section]').all()) {
        await expect(section.getByText('Datos de prueba: ninguna cifra de esta página es tuya')).toHaveCount(1)
      }

      // No text under 13 px, of the hundreds the page writes.
      expect(seen.texts.length).toBeGreaterThan(300)
      expect(seen.texts.filter((item) => item.size < 13)).toEqual([])

      // The figures: every number at 14 px or more; what leads at the size of its place, what follows at 14 px.
      expect(seen.figures).toHaveLength(DRAWN.figures)
      // The four sizes, the states of a cell, the hero of «un decimal como mucho», and the two cells of the legend
      // that says «orientativo» once.
      expect(seen.figures.map((figure) => figure.size)).toEqual([
        'cell',
        'header',
        'hero',
        'score',
        ...Array(DRAWN.figures - 7).fill('cell'),
        'hero',
        'cell',
        'cell',
      ])
      for (const figure of seen.figures) {
        expect(figure.sizes.length).toBeGreaterThan(0)
        expect(Math.min(...figure.sizes), JSON.stringify(figure)).toBeGreaterThanOrEqual(14)
        if (figure.empty) continue
        expect(figure.lead?.size, JSON.stringify(figure)).toBe(LEAD[figure.size as keyof typeof LEAD])
        expect(figure.sizes.filter((size) => size === 14).length, JSON.stringify(figure)).toBeGreaterThan(0)
      }
      expect(seen.figures.filter((figure) => figure.empty)).toHaveLength(2)
      expect(seen.figures.filter((figure) => figure.lead?.part === 'n')).toHaveLength(1)

      // The seals: 18 × 18 beside a name or a figure, 16 × 16 in a cell; the letter at 13 px.
      const seals = (size: number) => seen.seals.filter((seal) => seal.width === size && seal.height === size)
      expect(seals(18)).toHaveLength(DRAWN.seals18)
      expect(seals(16)).toHaveLength(DRAWN.seals16)
      expect(seen.seals).toHaveLength(DRAWN.seals18 + DRAWN.seals16)
      expect(new Set(seen.seals.map((seal) => seal.type))).toEqual(new Set([13]))

      // The marks: a 9 px circle and a 10 × 9 px triangle.
      expect(seen.orientative).toEqual(Array(DRAWN.orientative).fill({ width: 9, height: 9 }))
      expect(seen.coverage).toEqual(Array(DRAWN.coverage).fill({ width: 10, height: 9 }))

      // The charts: the point with its interval 12 px tall, the bar against a maximum 6 px, a record 6 or 12 px.
      expect(seen.intervalMarks.map((mark) => mark.height)).toEqual(Array(DRAWN.intervalMarks).fill(12))
      expect(seen.barMarks.map((bar) => bar.height)).toEqual(Array(DRAWN.barMarks).fill(6))
      expect(seen.recordBars.map((bar) => bar.height).sort((a, b) => a - b)).toEqual([
        ...Array(DRAWN.recordBars6).fill(6),
        ...Array(DRAWN.recordBars12).fill(12),
      ])
      expect(seen.intervalBars.map((bar) => bar.height)).toEqual(Array(DRAWN.intervalBars).fill(12))
      // None is drawn with no room: a chart as wide as nothing would pass every check above.
      for (const chart of [...seen.intervalMarks, ...seen.barMarks, ...seen.recordBars, ...seen.intervalBars]) {
        expect(chart.width).toBeGreaterThanOrEqual(100)
      }

      // The blocks: the percentage at 16 px in a row and 28 px in a lane, «sin datos» where there is none.
      const blocks = (size: string) => seen.blocks.filter((block) => block.size === size)
      expect(blocks('row')).toHaveLength(DRAWN.rowBlocks)
      expect(blocks('lane')).toHaveLength(DRAWN.laneBlocks)
      expect(new Set(blocks('row').map((block) => block.value))).toEqual(new Set([16, null]))
      expect(new Set(blocks('lane').map((block) => block.value))).toEqual(new Set([28, null]))
      expect(seen.blocks.filter((block) => block.value === null)).toHaveLength(2 + 3)
      // Everything a block writes of its own is data, at 14 px or more: its n, its interval and its record under
      // the bar (measured apart: every block with a number has them), and the two ends of the scale of a lane.
      for (const block of seen.blocks) {
        expect(block.written.length, JSON.stringify(block)).toBeGreaterThan(0)
        expect(Math.min(...block.written), JSON.stringify(block)).toBeGreaterThanOrEqual(14)
        if (block.value === null) continue
        expect(block.lines.length, JSON.stringify(block)).toBeGreaterThan(0)
        expect(new Set(block.lines), JSON.stringify(block)).toEqual(new Set([14]))
        expect(block.ends, JSON.stringify(block)).toEqual(block.size === 'lane' ? [14, 14] : [])
      }
      // The head of a row: the value always at the right edge, beside the name or under it; and the name is never
      // squeezed into what a long n leaves (on one line, or with a line of its own).
      for (const block of blocks('row')) {
        expect(block.valueRight, JSON.stringify(block)).toBeCloseTo(block.headRight ?? 0, 0)
        const name = block.name
        if (!name) throw new Error(`a block with no name: ${JSON.stringify(block)}`)
        const oneLine = name.height < name.line * 1.5
        expect(oneLine || name.width >= 120, JSON.stringify(block)).toBe(true)
      }
      const popular = blocks('row').find((block) => block.name?.text === 'Su arquetipo en torneos')
      expect(popular?.name?.height ?? 0, JSON.stringify(popular)).toBeLessThan((popular?.name?.line ?? 0) * 1.5)
      expect(seen.legends).toBe(DRAWN.legends)

      // A state that names the tick of the middle shows it: two small charts and one large bar, each with its tick
      // clear of the point and of its ring, by a pixel at least. The point is drawn over the tick, so a figure close
      // to 50 % would hide the very mark the state is there to show.
      expect(seen.middleTicks).toHaveLength(DRAWN.middleTicks)
      for (const chart of seen.middleTicks) {
        const { tick, point } = chart
        if (!tick || !point) throw new Error(`a chart with no tick or no point: ${JSON.stringify(chart)}`)
        expect(tick.height, JSON.stringify(chart)).toBeGreaterThanOrEqual(10)
        const clear = tick.right <= point.left - RING - 1 || tick.left >= point.right + RING + 1
        expect(clear, JSON.stringify(chart)).toBe(true)
      }

      // A name longer than a line is whole, on more than one line.
      const long = page
        .locator('[data-state^="Nombre largo"] [data-slot="source-block"] [data-part="head"] > span')
        .first()
      await expect(long).toContainText('Mega-Gardevoir ex / Gallade con Dedenne ex y Caramelo Raro')
      expect((await long.boundingBox())?.height ?? 0).toBeGreaterThan(30)

      // The action of the row, in each of its looks: 48 px tall, the «+» 48 × 48, «Sincronizar» whole beside two
      // views, a full one as wide as its row lets it; its text at 17 px and the views at 15.
      expect(seen.rowDrawings).toHaveLength(DRAWN.rowDrawings)
      for (const drawing of seen.rowDrawings) {
        expect(drawing, JSON.stringify(drawing)).toMatchObject({ height: 60, inert: true, inside: true, apart: true })
        // As wide as the frame's row at this width: 12 px from each side of the column.
        expect(drawing.width, JSON.stringify(drawing)).toBeCloseTo(Math.min(width, COLUMN) - 24, 0)
      }
      expect(seen.rowActions.map((item) => item.layout)).toEqual(['full', 'icon', 'text', 'text', 'text', 'full'])
      for (const item of seen.rowActions) {
        expect(item.height, JSON.stringify(item)).toBe(48)
        expect(item.spills, JSON.stringify(item)).toBeLessThanOrEqual(0)
        expect(item.inert, JSON.stringify(item)).toBe(true)
        expect(item.type, JSON.stringify(item)).toBe(17)
      }
      const [full, plus, sync, working, idle, update] = seen.rowActions
      expect(plus).toMatchObject({ width: 48, text: '', lines: 0, icon: { width: 24, height: 24 } })
      for (const item of [full, sync, working, idle, update]) expect(item?.lines, JSON.stringify(item)).toBe(1)
      for (const item of [sync, working, idle]) {
        expect(item?.text).toBe('Sincronizar')
        expect(item?.width ?? 0).toBeGreaterThan(120)
        expect(item?.icon).toMatchObject({ width: 20, height: 20 })
      }
      expect(working?.spinning).toBe(true)
      expect(sync?.spinning).toBe(false)
      expect(full?.text).toBe('Registrar partida')
      expect(full?.width ?? 0).toBeCloseTo((seen.rowDrawings[0]?.width ?? 0) - 12, 0)
      expect(update).toMatchObject({ text: 'Actualizar el mazo #1', icon: null })
      expect(idle?.text).toBe('Sincronizar')
      expect(seen.rowViews).toHaveLength(DRAWN.rowViews)
      for (const view of seen.rowViews) {
        expect(view.height, JSON.stringify(view)).toBe(48)
        expect(view.width, JSON.stringify(view)).toBeGreaterThanOrEqual(60)
        expect(view.type, JSON.stringify(view)).toBe(15)
      }

      // It is a page to look at: nothing in it to tap, so nothing smaller than a finger. The drawings of the row hold
      // the row's own controls, which take neither a tap nor the focus.
      expect(seen.tappable).toBe(0)
      expect(seen.drawnControls).toBe(DRAWN.rowActions)

      // Point 6: test data, and the frame asks for nothing on a page of the Menú.
      expect(asked).toEqual([])
      expect(errors).toEqual([])
    })
  }
}

test('the drawings of the row’s action take neither a tap nor the focus, and the Menú’s page has no row', async ({
  page,
}) => {
  const { errors, asked } = watch(page)
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/mas/piezas')
  await expect(page.locator('main [data-section]')).toHaveCount(DRAWN.sections)
  const section = page.locator('main [data-section="accion-de-la-fila"]')
  // A tap on the «+» and on «Sincronizar», by their place on the screen: nothing happens, nothing is asked.
  for (const layout of ['icon', 'text']) {
    const drawn = section.locator(`[data-slot="row-action"][data-layout="${layout}"]`).first()
    await drawn.scrollIntoViewIfNeeded()
    const box = await drawn.boundingBox()
    if (!box) throw new Error(`no ${layout} action drawn`)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(new URL(page.url()).pathname + new URL(page.url()).hash, layout).toBe('/mas/piezas')
    // Nor can it take the focus.
    expect(
      await drawn.evaluate((element) => {
        ;(element as HTMLElement).focus()
        return document.activeElement === element
      }),
    ).toBe(false)
  }
  // Pictures, named in the words beside them (`inert` keeps them out of a screen reader's way too).
  expect(
    await section
      .locator('[data-drawing="fixed-row"]')
      .evaluateAll((drawings) => drawings.map((d) => (d as HTMLElement).inert)),
  ).toEqual(Array(DRAWN.rowDrawings).fill(true))
  await expect(
    section.getByText('Un enlace, con su nombre para el lector y para el puntero: «Nueva simulación».'),
  ).toBeVisible()
  // The row of the frame is not on a page of the Menú, and the gallery does not draw a second one.
  await expect(page.locator('[data-slot="fixed-row"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})

for (const width of [320, 360]) {
  test(`the drawings of the row at ${width} px are the row: the same views, as wide, beside the same action`, async ({
    page,
  }) => {
    // The views of a drawing are only a picture of them (no tabs), so they take the row's face from its classes.
    await page.setViewportSize({ width, height: 780 })
    const views = (scope: string) =>
      page.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].map((view) => {
            const style = getComputedStyle(view)
            return {
              text: view.textContent,
              family: style.fontFamily.split(',')[0]?.replace(/"/g, ''),
              weight: style.fontWeight,
              width: Math.round(view.getBoundingClientRect().width * 10) / 10,
            }
          }),
        scope,
      )
    const real: Record<string, Awaited<ReturnType<typeof views>>> = {}
    for (const to of ['/simulacion', '/coleccion']) {
      await page.goto(to)
      await expect(page.locator('[data-slot="fixed-row"] [data-slot="row-action"]')).toBeVisible()
      await fontsReady(page)
      real[to] = await views('[data-slot="fixed-row"] [role="tab"]')
    }
    await page.goto('/mas/piezas')
    await expect(page.locator('main [data-section]')).toHaveCount(DRAWN.sections)
    await fontsReady(page)
    const drawn = (layout: string) =>
      views(
        `main [data-drawing="fixed-row"]:has(> [data-slot="row-action"][data-layout="${layout}"]) [data-drawing="view"]`,
      )
    expect(real['/simulacion']).toHaveLength(3)
    expect(real['/coleccion']).toHaveLength(2)
    for (const view of real['/simulacion'] ?? []) expect(view.family).toBe('Barlow Semi Condensed')
    expect(await drawn('icon')).toEqual(real['/simulacion'])
    // The first of the three drawings beside two views is «Sincronizar» as the row has it.
    expect((await drawn('text')).slice(0, 2)).toEqual(real['/coleccion'])
    // And nothing of the section is wider than the window.
    const section = await page.evaluate(() => {
      const found = document.querySelector('main [data-section="accion-de-la-fila"]')
      return {
        scrollWidth: document.documentElement.scrollWidth,
        out: [...(found?.querySelectorAll('*') ?? [])].filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.right > window.innerWidth + 0.5
        }).length,
      }
    })
    expect(section).toEqual({ scrollWidth: width, out: 0 })
  })
}

test('a block holds what it is given: a line that does not wrap inside it cannot push its percentage out', async ({
  page,
}) => {
  // Seen on the deck's page while the blocks were adopted: a list that cuts its names on one line made the block
  // wider than its card, which hid the percentage. The gallery's own blocks hold nothing of the kind, so here one is
  // put inside a block of each size, as wide as three phones.
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/mas/piezas')
  await expect(page.locator('main [data-section]')).toHaveCount(DRAWN.sections)
  await fontsReady(page)
  for (const size of ['row', 'lane']) {
    const probe = page.locator(`main [data-slot="source-block"][data-size="${size}"]:has([data-part="value"])`).first()
    const boxes = () =>
      probe.evaluate((block) => {
        const value = block.querySelector(':scope > [data-part="head"] [data-part="value"]')
        if (!value) throw new Error('the block has no percentage')
        const main = document.querySelector('main')
        return {
          width: block.getBoundingClientRect().width,
          valueRight: value.getBoundingClientRect().right,
          limit: main?.getBoundingClientRect().right ?? 0,
          scrollWidth: document.documentElement.scrollWidth,
        }
      })
    const before = await boxes()
    await probe.evaluate((block) => {
      const more = document.createElement('div')
      more.setAttribute('data-part', 'more')
      const line = document.createElement('span')
      line.textContent = 'Arquetipo: Mega-Gardevoir ex / Gallade con Dedenne ex y Caramelo Raro, '.repeat(3)
      line.style.cssText = 'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
      more.append(line)
      block.append(more)
    })
    const after = await boxes()
    expect(after.width, size).toBeCloseTo(before.width, 1)
    expect(after.valueRight, size).toBeCloseTo(before.valueRight, 1)
    expect(after.valueRight, size).toBeLessThanOrEqual(after.limit)
    expect(after.scrollWidth, size).toBeLessThanOrEqual(360)
    // And the line itself was really wider than the block: it is the block that held it.
    const line = await probe.locator(':scope > [data-part="more"] > span').evaluate((element) => ({
      needs: element.scrollWidth,
      has: element.clientWidth,
    }))
    expect(line.needs, size).toBeGreaterThan(900)
    expect(line.has, size).toBeLessThanOrEqual(Math.ceil(before.width))
  }
})

test('where the system forces its colours every chart, seal and mark keeps its shape, in edges it paints', async ({
  page,
}) => {
  // The system drops every fill, gradient and shadow, and paints the edges in its colour of text: each piece draws
  // with edges there, and writes no colour for it (as the button of the login).
  const { errors } = watch(page)
  await page.setViewportSize({ width: 360, height: 780 })
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/mas/piezas')
  await expect(page.locator('main [data-section]')).toHaveCount(DRAWN.sections)
  await fontsReady(page)
  const seen = await page.evaluate(() => {
    const transparent = (colour: string) => colour === 'transparent' || /^rgba\(.*,\s*0\)$/.test(colour)
    /** What is painted behind an element: the first background around it that is not clear. */
    const behind = (element: Element) => {
      for (let at = element.parentElement; at; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor
        if (!transparent(colour)) return colour
      }
      return getComputedStyle(document.documentElement).backgroundColor
    }
    const SIDES = ['top', 'right', 'bottom', 'left'] as const
    /** The thickest edge of an element, and whether it is drawn in another colour than what is behind it. */
    const edge = (element: Element) => {
      const style = getComputedStyle(element)
      const widths = SIDES.map((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)))
      const side = SIDES[widths.indexOf(Math.max(...widths))] ?? 'top'
      return {
        width: Math.max(...widths),
        style: style.getPropertyValue(`border-${side}-style`),
        seen: style.getPropertyValue(`border-${side}-color`) !== behind(element),
      }
    }
    const name = (element: Element) =>
      `${element.parentElement?.closest('[data-slot]')?.getAttribute('data-slot')} ${element.getAttribute('data-part') ?? element.getAttribute('data-tone') ?? element.getAttribute('data-slot')}`
    const drawn = [
      ...document.querySelectorAll(
        [
          'main [data-slot="interval-mark"] > i',
          'main [data-slot="interval-bar"] > [data-part="bar"] > i',
          'main [data-slot="bar-mark"]',
          'main [data-slot="bar-mark"] > i',
          'main [data-slot="record-bar"] > i',
          'main [data-slot="record-bar"]:empty',
        ].join(', '),
      ),
    ]
    const seals = [...document.querySelectorAll('main [data-slot="source-seal"]')].map((seal) => ({
      letter: seal.textContent,
      ...edge(seal),
    }))
    const orientative = [...document.querySelectorAll('main [data-slot="orientative-mark"]')].map((mark) => {
      const style = getComputedStyle(mark)
      return { left: Number.parseFloat(style.borderLeftWidth), right: Number.parseFloat(style.borderRightWidth) }
    })
    const coverage = [...document.querySelectorAll('main [data-slot="coverage-mark"]')].map((mark) => ({
      clip: getComputedStyle(mark).clipPath,
      width: mark.getBoundingClientRect().width,
      height: mark.getBoundingClientRect().height,
    }))
    return {
      forced: matchMedia('(forced-colors: active)').matches,
      // The action of the row: its fill was its only edge.
      actions: [...document.querySelectorAll('main [data-slot="row-action"]')].map((action) => edge(action)),
      parts: drawn.map((element) => ({ name: name(element), ...edge(element) })),
      seals,
      orientative,
      coverage,
    }
  })
  expect(seen.forced).toBe(true)
  expect(seen.actions).toHaveLength(DRAWN.rowActions)
  for (const action of seen.actions)
    expect(action, JSON.stringify(action)).toMatchObject({ style: 'solid', seen: true })
  for (const action of seen.actions) expect(action.width, JSON.stringify(action)).toBeGreaterThanOrEqual(1)
  // Every part of every chart has an edge of 1 px or more, in a colour that is not the one behind it.
  expect(seen.parts.filter((part) => part.width < 1 || !part.seen || part.style === 'none')).toEqual([])
  // All of them are there: the point of each chart with a figure, and the empty track of «sin datos».
  const count = (name: string) => seen.parts.filter((part) => part.name.endsWith(` ${name}`)).length
  expect(count('point')).toBe(DRAWN.intervalMarks - 1 + DRAWN.intervalBars)
  expect(seen.parts.filter((part) => part.name === 'interval-mark track' && part.style === 'dashed')).toHaveLength(1)
  expect(count('fill')).toBe(DRAWN.barMarks)
  expect(seen.parts.length).toBeGreaterThan(100)
  // The seals keep three shapes: M a double edge, T a single one, B dashed.
  expect(seen.seals).toHaveLength(DRAWN.seals18 + DRAWN.seals16)
  for (const seal of seen.seals) {
    expect(seal.seen, JSON.stringify(seal)).toBe(true)
    if (seal.letter === 'M') expect(seal, JSON.stringify(seal)).toMatchObject({ style: 'double' })
    if (seal.letter === 'M') expect(seal.width).toBeGreaterThanOrEqual(3)
    if (seal.letter === 'T') expect(seal, JSON.stringify(seal)).toMatchObject({ style: 'solid' })
    if (seal.letter === 'B') expect(seal, JSON.stringify(seal)).toMatchObject({ style: 'dashed' })
    if (seal.letter !== 'M') expect(seal.width).toBeGreaterThanOrEqual(1)
  }
  expect(new Set(seen.seals.map((seal) => seal.letter))).toEqual(new Set(['M', 'T', 'B']))
  // ◐ is half filled by its left edge, and ▲ is cut to a triangle in its 10 × 9 box.
  expect(seen.orientative).toHaveLength(DRAWN.orientative)
  for (const mark of seen.orientative) expect(mark.left).toBeGreaterThan(mark.right + 2)
  expect(seen.coverage).toHaveLength(DRAWN.coverage)
  for (const mark of seen.coverage) {
    expect(mark).toMatchObject({ width: 10, height: 9 })
    expect(mark.clip).toMatch(/^polygon\(/)
  }
  expect(errors).toEqual([])
})

test('«Acerca de» leads to the gallery by a row tall enough to tap, and «Volver» comes back', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/mas/acerca')
  const link = page.getByRole('link', { name: /^Piezas de la interfaz/ })
  await expect(link).toContainText('Cómo se ven los componentes nuevos, con datos de prueba')
  const box = await link.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(300)
  await link.click()
  await expect(page).toHaveURL(/\/mas\/piezas$/)
  await expect(title(page, 'Piezas de la interfaz')).toBeVisible()
  // The Menú is not a tab: none is lit on its pages.
  await expect(page.getByRole('navigation', { name: 'Secciones' }).locator('[aria-current="page"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Volver' }).click()
  await expect(page).toHaveURL(/\/mas\/acerca$/)
  await expect(title(page, 'Acerca de')).toBeVisible()
})

// ---------- The deck's «Rendimiento» ----------

type Comparison = z.input<typeof deckComparisonSchema>
type Column = Comparison['columns'][number]
type Row = NonNullable<Column['rows']>[number]

const SCOPE = 'Era C1 (Fusión Dual), 13 torneos, media 49\u00a0%. Datos de torneo: Limitless (play.limitlesstcg.com).'
const BLIND_SPOT =
  'Posible punto ciego del bot: g2 casi nunca juega Caramelo Raro en el turno 2, así que el mazo llega tarde a su Fase 2. Probalo con otro bot.'

const MINE: Column = {
  source: 'matches',
  label: 'Mis partidas',
  available: true,
  record: { wins: 24, losses: 22, ties: 1 },
  rate: {
    source: 'matches',
    value: (24 / 47) * 100,
    games: 47,
    samples: 47,
    sampleKind: 'matches',
    ci95: [37.2, 64.7],
    orientative: false,
  },
  note: 'Partidas registradas en la app, todas las modalidades.',
}
const EXACT: Row = {
  label: 'Lista exacta',
  record: { wins: 1, losses: 7, ties: 0 },
  rate: {
    source: 'tournament',
    value: 12.5,
    games: 8,
    samples: 2,
    sampleKind: 'lists',
    ci95: [2.2, 47.1],
    orientative: true,
  },
}
/** 70 games, more than 30, and still «orientativo»: they were played in 14 lists. */
const ARCHETYPE: Row = {
  label: 'Arquetipo: Mega-Gardevoir ex / Gallade con Dedenne ex',
  record: { wins: 25, losses: 45, ties: 0 },
  rate: {
    source: 'tournament',
    value: (25 / 70) * 100,
    games: 70,
    samples: 14,
    sampleKind: 'lists',
    ci95: [25.5, 47.4],
    orientative: true,
  },
  note: 'Sugerido por las listas más parecidas (2 cambios).',
}
const tournament = (...rows: Row[]): Column => ({
  source: 'tournament',
  label: 'Torneo',
  available: true,
  record: rows[0]?.record ?? null,
  rate: rows[0]?.rate ?? null,
  note: SCOPE,
  rows,
})
const BOTS: Column = {
  source: 'simulation',
  label: 'Simulación',
  available: true,
  record: { wins: 7095, losses: 7004, ties: 80 },
  rate: {
    source: 'simulation',
    value: (7095 / 14179) * 100,
    games: 14179,
    samples: 14179,
    sampleKind: 'simulations',
    ci95: [49.2, 50.9],
    orientative: false,
  },
  note: 'Bots g2 vs g2, 5 simulaciones, motor 0a1b2c3. El porcentaje depende del bot.',
  blindSpot: { text: BLIND_SPOT },
}
const NONE: Column[] = [
  {
    source: 'matches',
    label: 'Mis partidas',
    available: true,
    record: { wins: 0, losses: 0, ties: 0 },
    rate: null,
    note: 'Todavía no registraste partidas con este mazo.',
  },
  {
    source: 'tournament',
    label: 'Torneo',
    available: false,
    record: null,
    rate: null,
    note: 'Todavía no hay datos de torneo sincronizados.',
  },
  {
    source: 'simulation',
    label: 'Simulación',
    available: false,
    record: null,
    rate: null,
    note: 'Todavía no se simuló la lista actual de este mazo (Pruebas → Simulación).',
  },
]

/** The archetypes of the era, as `GET /api/tournaments/archetypes` gives them: with them the deck can choose its own. */
const NO_GAMES = { lists: 0, record: { wins: 0, losses: 0, ties: 0 }, rate: null, share: 0 }
const ERA = archetypesResponseSchema.parse({
  scope: {
    era: { code: 'C1', nameEs: 'Fusión Dual', from: '2026-10-29', to: null, current: true },
    format: 'STANDARD',
    minPlayers: 50,
    tournaments: 13,
    lists: 900,
    games: 5000,
    mean: NO_GAMES,
    conflicts: [],
    unknownCards: 0,
    attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
  },
  rows: [
    {
      ...NO_GAMES,
      lists: 14,
      archetype: { id: 'mega-gardevoir-ex-gallade', name: 'Mega-Gardevoir ex / Gallade', icons: [] },
    },
    { ...NO_GAMES, lists: 1203, archetype: { id: 'gyarados-ex', name: 'Gyarados ex', icons: [] } },
  ],
})

const REGION = '[aria-label="Tres fuentes, nunca mezcladas"]'

/**
 * Opens deck 1 with these columns as the answer of its comparison. They go through the schema the web reads the
 * answer with first: a fixture that the screen could not read fails here, not as an empty section.
 */
async function openDeck(page: Page, columns: Column[], { archetypes = false } = {}) {
  await page.route('**/api/decks/1/comparison*', async (route) => {
    const response = await route.fetch()
    const real = (await response.json()) as Comparison
    const body = { deck: real.deck, columns }
    deckComparisonSchema.parse(body)
    await route.fulfill({ response, json: body })
  })
  // The screens database has no tournaments: with them, the block of the tournament offers the deck's archetype.
  if (archetypes) await page.route('**/api/tournaments/archetypes', (route) => route.fulfill({ json: ERA }))
  await page.goto('/mazos/1')
  await expect(page.getByRole('heading', { level: 2, name: 'Rendimiento' })).toBeVisible()
  await expect(page.locator(REGION)).toBeVisible()
  await page.waitForLoadState('networkidle')
  await fontsReady(page)
}

const region = (page: Page) => page.locator(REGION)
const block = (page: Page, source: Column['source']) =>
  region(page).locator(`[data-slot="source-block"][data-source="${source}"]`)

for (const theme of THEMES) {
  test(`«Rendimiento», ${theme}: the three sources of a deck are three blocks under their seals, with one legend`, async ({
    page,
  }) => {
    const { errors } = watch(page)
    await chooseTheme(page, theme)
    await page.setViewportSize({ width: 360, height: 780 })
    await openDeck(page, [MINE, tournament(EXACT, ARCHETYPE), BOTS], { archetypes: true })

    // One block for each source, in order, and each percentage with its n, its interval and its record beside it.
    await expect(region(page).locator('[data-slot="source-block"]')).toHaveCount(3)
    await expect(block(page, 'matches')).toContainText('Mis partidas51,1\u00a0%')
    await expect(block(page, 'matches')).toContainText('n = 47\u00a0· 24 V · 22 D · 1 E')
    await expect(block(page, 'matches')).toContainText('IC\u00a037,2–\u206064,7\u00a0%')
    await expect(block(page, 'tournament')).toContainText('Torneo12,5\u00a0%')
    await expect(block(page, 'tournament')).toContainText('n = 8 en 2 listas\u00a0· 1 V · 7 D')
    await expect(block(page, 'simulation')).toContainText('Simulación50\u00a0%')
    await expect(block(page, 'simulation')).toContainText('n = 14.179\u00a0· 7.095 V · 7.004 D · 80 E')
    // H-055: the warning of the bots is inside their block, and the note of each source in a paragraph of its own.
    await expect(block(page, 'simulation').locator('p[data-part="warning"]')).toHaveText(BLIND_SPOT)
    await expect(block(page, 'matches').locator('p[data-part="note"]')).toHaveText(MINE.note)
    await expect(block(page, 'tournament').locator('p[data-part="note"]')).toHaveText(SCOPE)
    await expect(block(page, 'simulation').locator('p[data-part="note"]')).toHaveText(BOTS.note)

    // The detail of the tournament is inside its block, and the name of an archetype is whole.
    const detail = block(page, 'tournament').locator('[data-part="more"]')
    await expect(detail.getByRole('heading', { level: 3, name: 'Torneo, en detalle' })).toBeVisible()
    await expect(detail.getByRole('listitem')).toHaveCount(2)
    const name = detail.getByText(ARCHETYPE.label)
    await expect(name).toBeVisible()
    expect((await name.boundingBox())?.height ?? 0).toBeGreaterThan(30)
    // So is what the select of the archetype says, on a second line: its text ends inside its box, which a finger
    // can tap.
    const select = detail.getByRole('combobox', { name: 'Arquetipo del mazo en torneos' })
    await expect(select).toHaveText('Arquetipo: sugerido por las listas más parecidas')
    const said = await select.evaluate((element) => {
      const value = element.querySelector('[data-slot="select-value"]')
      if (!value) throw new Error('the select shows no value')
      const range = document.createRange()
      range.selectNodeContents(value)
      const text = range.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const inner = value.getBoundingClientRect()
      return {
        height: box.height,
        lines: Math.round(text.height / Number.parseFloat(getComputedStyle(value).lineHeight)),
        inside: text.left >= inner.left - 0.5 && text.right <= inner.right + 0.5 && text.bottom <= box.bottom + 0.5,
        hidden: value.scrollWidth - value.clientWidth,
      }
    })
    expect(said.height).toBeGreaterThanOrEqual(44)
    expect(said.lines).toBeGreaterThanOrEqual(2)
    expect(said.inside).toBe(true)
    expect(said.hidden).toBeLessThanOrEqual(0)

    const seen = await measure(page, REGION)
    expect(seen.theme).toBe(theme)
    expect(seen.window).toBe(360)
    expect(seen.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(360)
    // Nothing leaves the card: the percentage and the two ends of its scale stay in sight.
    expect(seen.out, 'nothing sticks out of the card').toEqual([])
    expect(seen.cut, 'no text is cut with «…»').toEqual([])
    expect(seen.stuck).toEqual([])
    expect(seen.texts.length).toBeGreaterThan(30)
    expect(seen.texts.filter((item) => item.size < 13)).toEqual([])
    // Three blocks at the size of a page, 28 px; a seal for each and three more in the legend, 18 px each.
    expect(seen.blocks.map(({ source, size, value }) => ({ source, size, value }))).toEqual([
      { source: 'matches', size: 'lane', value: 28 },
      { source: 'tournament', size: 'lane', value: 28 },
      { source: 'simulation', size: 'lane', value: 28 },
    ])
    // The n, the interval and the record of each source, and the two ends of its scale: data, at 14 px.
    for (const item of seen.blocks) {
      expect(item.lines.length, JSON.stringify(item)).toBeGreaterThanOrEqual(2)
      expect(new Set(item.lines), JSON.stringify(item)).toEqual(new Set([14]))
      expect(item.ends, JSON.stringify(item)).toEqual([14, 14])
      expect(Math.min(...item.written), JSON.stringify(item)).toBeGreaterThanOrEqual(14)
    }
    expect(seen.seals.map((seal) => `${seal.width}×${seal.height}`)).toEqual(Array(6).fill('18×18'))
    expect(seen.intervalBars.map((bar) => bar.height)).toEqual([12, 12, 12])
    for (const bar of seen.intervalBars) expect(bar.width).toBeGreaterThan(200)
    expect(seen.legends).toBe(1)
    // What each source says of its number is running text at 14 px: the 11 px notes are gone.
    for (const note of await region(page).locator('p[data-part="note"], p[data-part="warning"]').all()) {
      expect(await note.evaluate((element) => getComputedStyle(element).fontSize)).toBe('14px')
    }

    // One legend: the three seals, what «orientativo» counted here (lists) and which interval is written.
    const legend = region(page).locator('[data-slot="source-legend"]')
    await expect(legend).toHaveText(
      'Mmis partidasTtorneosBbotsorientativo: menos de 30 listasIC: intervalo de confianza del 95\u00a0%',
    )
    // The page as a whole still fits the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    expect(errors).toEqual([])
  })
}

for (const width of [360, 412]) {
  test(`«Rendimiento» at ${width} px without data: «sin datos» in each source, never a zero`, async ({ page }) => {
    const { errors } = watch(page)
    await page.setViewportSize({ width, height: 780 })
    await openDeck(page, NONE)

    await expect(region(page).locator('[data-slot="source-block"]')).toHaveCount(3)
    await expect(region(page).locator('[data-slot="no-data"]')).toHaveText(['sin datos', 'sin datos', 'sin datos'])
    // No percentage at all, so no «0 %»; and no chart of a number that is not there.
    expect(await region(page).innerText()).not.toMatch(/\d\s*%/)
    await expect(region(page).locator('[data-slot="interval-bar"]')).toHaveCount(0)
    // Own matches are a source with nothing to count yet; the other two have no source, and say why in their box.
    await expect(block(page, 'matches').locator('p[data-part="note"]')).toHaveText(NONE[0]?.note ?? '')
    for (const [source, at] of [
      ['tournament', 1],
      ['simulation', 2],
    ] as const) {
      await expect(block(page, source)).toHaveAttribute('data-unavailable', '')
      await expect(block(page, source).locator('p[data-part="unavailable"]')).toHaveText(NONE[at]?.note ?? '')
      expect(await block(page, source).evaluate((element) => getComputedStyle(element).borderTopStyle)).toBe('dashed')
    }
    expect(await block(page, 'matches').evaluate((element) => getComputedStyle(element).borderTopStyle)).not.toBe(
      'dashed',
    )
    // The seals are still explained; nothing is «orientativo» and no interval is written.
    await expect(region(page).locator('[data-slot="source-legend"]')).toHaveText('Mmis partidasTtorneosBbots')

    const seen = await measure(page, REGION)
    expect(seen.window).toBe(width)
    expect(seen.scrollWidth).toBeLessThanOrEqual(width)
    expect(seen.out).toEqual([])
    expect(seen.cut).toEqual([])
    expect(seen.texts.filter((item) => item.size < 13)).toEqual([])
    expect(seen.blocks.map((item) => item.value)).toEqual([null, null, null])
    expect(seen.seals).toHaveLength(6)
    expect(errors).toEqual([])
  })
}

test('«Rendimiento»: the way to the deck’s archetype, inside the block of the tournament, is tall enough to tap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  // The deck as the page reads it, with an archetype of the era chosen: nothing is written to the database.
  await page.route('**/api/decks/1', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const deck = (await response.json()) as Record<string, unknown>
    await route.fulfill({ response, json: { ...deck, tournamentArchetypeId: 'gyarados-ex' } })
  })
  await openDeck(page, [MINE, tournament(EXACT, ARCHETYPE), BOTS], { archetypes: true })
  const link = block(page, 'tournament').getByRole('link', { name: 'Ver el arquetipo en Torneos' })
  await expect(link).toHaveAttribute('href', '/torneos/arquetipos/gyarados-ex')
  // Everything to tap in the block: the link and the select of the archetype, 44 px or more each.
  const targets = await block(page, 'tournament').locator('a, button, [role="combobox"]').all()
  expect(targets).toHaveLength(2)
  for (const target of targets) {
    const box = await target.boundingBox()
    expect(box?.height ?? 0, await target.innerText()).toBeGreaterThanOrEqual(44)
  }
  // The words of the link are in the middle of its height, where a finger lands.
  const words = await link.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const text = range.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    return { above: text.top - box.top, below: box.bottom - text.bottom }
  })
  expect(Math.abs(words.above - words.below)).toBeLessThanOrEqual(1)
})

test('«Rendimiento»: a tournament figure with 70 games in 14 lists is «orientativo», and says «listas»', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await openDeck(page, [MINE, tournament(ARCHETYPE), NONE[2] as Column])

  const tournaments = block(page, 'tournament')
  await expect(tournaments).toContainText('35,7\u00a0%')
  await expect(tournaments).toContainText('n = 70 en 14 listas')
  // In words, in the block, with its mark drawn 9 px wide before them (decoration: the words say it); and in the
  // key of the legend.
  await expect(tournaments.locator(':scope > [data-part="figures"]')).toContainText('orientativo: menos de 30 listas')
  const mark = tournaments.locator(':scope > [data-part="figures"] [data-slot="orientative-mark"]')
  await expect(mark).toHaveAttribute('aria-hidden', 'true')
  await expect(tournaments.locator(':scope > [data-part="figures"] [data-slot="mark-words"]')).toHaveText(
    'orientativo: menos de 30 listas',
  )
  expect(await mark.boundingBox()).toMatchObject({ width: 9, height: 9 })
  const legend = region(page).locator('[data-slot="source-legend"]')
  await expect(legend.locator('[data-key="orientative"]')).toHaveText('orientativo: menos de 30 listas')
  // Own matches have 47: nothing here is «orientativo» by matches, and nothing says so, not even a name that is
  // not drawn.
  expect(await region(page).innerText()).not.toMatch(/menos de 30 partidas/)
  expect(await region(page).evaluate((element) => element.outerHTML)).not.toMatch(/menos de 30 partidas/)
  // The source with no number keeps «sin datos» beside the two that have one.
  await expect(block(page, 'simulation').locator('[data-slot="no-data"]')).toHaveText('sin datos')

  const seen = await measure(page, REGION)
  expect(seen.scrollWidth).toBeLessThanOrEqual(375)
  expect(seen.out).toEqual([])
  // The mark of the block and the one of the legend's key, each 9 px.
  expect(seen.orientative).toEqual([
    { width: 9, height: 9 },
    { width: 9, height: 9 },
  ])
})
