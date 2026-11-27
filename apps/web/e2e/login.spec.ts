/**
 * The login page is served by the API, outside the app, and wears the app's palette and the theme chosen on this
 * device (`localStorage['tcg.look']`, which a logout keeps): dark by default, light or the system's when the Menú says
 * so. Checked on the real page, without the session. No login is attempted here: the endpoint counts every attempt, so
 * the one request the form's script sends is answered by the test.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

interface Palette {
  theme: 'dark' | 'light'
  /** --background-outer: what surrounds the column on a wide window. */
  outer: string
  /** --background: the page, and the colour of the browser's bars. */
  background: string
  themeColor: string
  destructive: string
  ring: string
}

const DARK: Palette = {
  theme: 'dark',
  outer: 'rgb(5, 8, 12)',
  background: 'rgb(10, 14, 20)',
  themeColor: '#0a0e14',
  destructive: 'rgb(255, 123, 114)',
  ring: 'rgb(63, 214, 198)',
}
const LIGHT: Palette = {
  theme: 'light',
  outer: 'rgb(228, 224, 215)',
  background: 'rgb(241, 238, 232)',
  themeColor: '#f1eee8',
  destructive: 'rgb(192, 39, 31)',
  ring: 'rgb(15, 118, 110)',
}

interface Watched {
  themeWhenBodyCame?: string | null
}

// The theme the page had when its <body> arrived, before anything of it could be painted: a script that set it later
// (at the end of the body, or deferred) would leave a first paint in the other theme.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    new MutationObserver((_records, observer) => {
      if (!document.body) return
      ;(window as Watched).themeWhenBodyCame = document.documentElement.getAttribute('data-theme')
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true })
  })
})

/** What the Menú would have stored on this device, there before the page's own scripts run. */
async function chosen(context: BrowserContext, look: { theme: 'dark' | 'light' | 'system' }) {
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('tcg.look', value)
    } catch {
      // A document without storage (the blank page a tab starts at).
    }
  }, JSON.stringify(look))
}

const look = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    whenBodyCame: (window as Watched).themeWhenBodyCame,
    scheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    schemeOfThePage: getComputedStyle(document.documentElement).colorScheme,
    around: getComputedStyle(document.documentElement).backgroundColor,
    background: getComputedStyle(document.body).backgroundColor,
  }))

const lookOf = ({ theme, themeColor, outer, background }: Palette) => ({
  theme,
  whenBodyCame: theme,
  scheme: theme,
  themeColor,
  schemeOfThePage: theme,
  around: outer,
  background,
})

async function open(page: Page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'TCG Pocket' })).toBeVisible()
}

test('is dark by default, also on a light system: it fits a phone, shows the focus and nothing is refused', async ({
  page,
}) => {
  // A script the CSP refuses is an error in the console; one that throws is a page error.
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  await page.emulateMedia({ colorScheme: 'light' })
  await open(page)
  expect(await look(page)).toEqual(lookOf(DARK))

  // The first field takes the focus, with the ring (checked by its longhands: Chromium 1.65 orders the `outline`
  // shorthand differently); with the keyboard the button shows it too, apart from its fill.
  await expect(page.getByLabel('Correo')).toBeFocused()
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-color', DARK.ring)
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-style', 'solid')
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-width', '2px')
  await expect(page.getByLabel('Correo')).toHaveCSS('border-color', DARK.ring)
  for (let stop = 0; stop < 3; stop++) await page.keyboard.press('Tab')
  const enter = page.getByRole('button', { name: 'Entrar' })
  await expect(enter).toBeFocused()
  await expect(enter).toHaveCSS('outline-color', DARK.ring)
  await expect(enter).toHaveCSS('outline-style', 'solid')
  await expect(enter).toHaveCSS('outline-width', '2px')
  await expect(enter).toHaveCSS('outline-offset', '2px')

  // Where the system forces its colours the fill of the button is gone: an edge of another colour keeps its shape.
  await expect(enter).toHaveCSS('border-top-width', '0px')
  await page.emulateMedia({ forcedColors: 'active' })
  await expect(enter).toHaveCSS('border-top-width', '1px')
  const forced = await enter.evaluate((button) => ({
    edge: getComputedStyle(button).borderTopColor,
    behind: getComputedStyle(button.closest('main') ?? button).backgroundColor,
  }))
  expect(forced.edge).not.toBe(forced.behind)
  await page.emulateMedia({ forcedColors: 'none' })

  for (const width of [320, 412, 1280]) {
    await page.setViewportSize({ width, height: 640 })
    const seen = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      card: document.querySelector('main')?.getBoundingClientRect().toJSON() as DOMRect,
      smallest: Math.min(
        ...[...document.querySelectorAll('h1, p, label, input, button')].map((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      ),
      fields: [...document.querySelectorAll('input, button')].map((element) => element.getBoundingClientRect().height),
    }))
    expect(seen.width, `${width}: the window keeps its width`).toBe(width)
    expect(seen.scrollWidth, `${width}: no sideways scroll`).toBeLessThanOrEqual(width)
    expect(seen.card.left, `${width}: the card in the window`).toBeGreaterThanOrEqual(0)
    expect(seen.card.right, `${width}: the card in the window`).toBeLessThanOrEqual(width)
    expect(seen.smallest, `${width}: nothing under 13 px`).toBeGreaterThanOrEqual(13)
    for (const height of seen.fields) expect(height, `${width}: fields and button`).toBeGreaterThanOrEqual(44)
  }

  // Wider than the app's column, the page stands in that column (30rem), as the app does.
  expect(await page.evaluate(() => document.body.getBoundingClientRect().width)).toBe(480)

  // A phone on its side: the card is taller than the window, and the page scrolls to all of it.
  await page.setViewportSize({ width: 640, height: 320 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const sideways = await page.evaluate(() => ({
    top: document.querySelector('main')?.getBoundingClientRect().top ?? -1,
    bottom: document.querySelector('main')?.getBoundingClientRect().bottom ?? 0,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sideways.top).toBeGreaterThanOrEqual(0)
  expect(sideways.bottom).toBeGreaterThan(320)
  expect(sideways.scrollHeight).toBeGreaterThanOrEqual(sideways.bottom)
  expect(sideways.scrollWidth).toBeLessThanOrEqual(640)

  expect(problems).toEqual([])
})

test('is light from the first paint when «Claro» is chosen on this device, also on a dark system', async ({
  context,
  page,
}) => {
  await chosen(context, { theme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await open(page)
  expect(await look(page)).toEqual(lookOf(LIGHT))
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-color', LIGHT.ring)
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-style', 'solid')
  await expect(page.getByLabel('Correo')).toHaveCSS('outline-width', '2px')
})

test('follows the system when «Sistema» is chosen, in both directions', async ({ context, page }) => {
  await chosen(context, { theme: 'system' })
  await page.emulateMedia({ colorScheme: 'light' })
  await open(page)
  expect(await look(page)).toEqual(lookOf(LIGHT))

  // The page resolves the theme when it loads.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'TCG Pocket' })).toBeVisible()
  expect(await look(page)).toEqual(lookOf(DARK))
})

for (const palette of [DARK, LIGHT]) {
  test(`shows what the server answers in the destructive colour of the ${palette.theme} theme`, async ({
    context,
    page,
  }) => {
    await chosen(context, { theme: palette.theme })
    const posted: unknown[] = []
    await page.route('**/api/auth/login', async (route) => {
      posted.push(route.request().postDataJSON())
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'invalid_credentials', message: 'Credenciales inválidas.' } }),
      })
    })
    await open(page)
    const alert = page.getByRole('alert')
    await expect(alert).toBeHidden()

    await page.getByLabel('Correo').fill('alguien@pantallas.test')
    await page.getByLabel('Contraseña').fill('no-es-la-clave')
    await page.getByRole('button', { name: 'Entrar' }).click()

    await expect(alert).toBeVisible()
    await expect(alert).toHaveText('Credenciales inválidas.')
    await expect(alert).toHaveCSS('color', palette.destructive)
    await expect(alert).toHaveCSS('border-top-color', palette.destructive)
    // Still on the page, ready for another try, and the form asked once.
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
    expect(new URL(page.url()).pathname).toBe('/login')
    expect(posted).toEqual([{ email: 'alguien@pantallas.test', password: 'no-es-la-clave', totp: '' }])
    expect((await look(page)).theme).toBe(palette.theme)
  })
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('is dark, and «Entrar» keeps what was typed out of the address', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await open(page)
    // No script set the attribute: `:root` alone is the dark theme.
    expect(await page.locator('html').getAttribute('data-theme')).toBeNull()
    await expect(page.locator('body')).toHaveCSS('background-color', DARK.background)

    await page.getByLabel('Correo').fill('alguien@pantallas.test')
    await page.getByLabel('Contraseña').fill('no-es-la-clave')
    const sent = page.waitForRequest((request) => request.isNavigationRequest())
    await page.getByRole('button', { name: 'Entrar' }).click()
    // The form posts to its own address (a form without a method would be sent with GET, the password in the
    // address). Nothing answers a POST there without the session: this is not a login attempt.
    const request = await sent
    expect(request.method()).toBe('POST')
    expect(request.url()).toBe(new URL('/login', page.url()).href)
    await page.waitForLoadState()
    expect(new URL(page.url()).search).toBe('')
  })
})
