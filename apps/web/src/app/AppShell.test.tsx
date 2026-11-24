import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, type RouteObject, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeLook } from '@/lib/look'
import { queueMatch } from '@/lib/offlineMatches'
import { fakeApi } from '@/test/fakeApi'
import { AppShell, HeaderActions, usePageTitle } from './AppShell'
import { Providers } from './Providers'
import { routes } from './routes'

type Router = ReturnType<typeof createMemoryRouter>

function renderAt(path: string, table: RouteObject[] = routes): Router {
  const router = createMemoryRouter(table, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const where = (router: Router) => router.state.location.pathname + router.state.location.search
const title = (name: string) => screen.findByRole('heading', { level: 1, name })
const banner = () => screen.getByRole('banner')
const row = () => document.querySelector('[data-slot="fixed-row"]')
const MENU = 'Menú: aspecto, ajustes y sistema'
const go = (router: Router, ...args: Parameters<Router['navigate']>) => act(() => router.navigate(...args))

/** A page that names itself and puts a control of its own in the header, as the deck page does. */
function Named() {
  usePageTitle('Gardevoir ex')
  return (
    <>
      <HeaderActions>
        <button type="button">Otro mazo</button>
      </HeaderActions>
      <p>La lista</p>
      <Link to="/quieta">A la otra</Link>
    </>
  )
}

/** The shell around two screens that ask the API for nothing. */
const QUIET: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'quieta', element: <p>Nada que pedir</p>, handle: { title: 'Quieta' } },
      { path: 'nombrada', element: <Named />, handle: { title: 'Mazo', back: '/quieta' } },
    ],
  },
]

// The toast captures the pointer, which jsdom lacks.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
})

beforeEach(() => {
  // Pages fetch on mount; the API is not there in tests and the error state is fine.
  fakeApi({})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the header', () => {
  it('a root has one h1, in the header, with D’s root look, and names the browser tab', async () => {
    renderAt('/partidas')
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Hoy')
    expect(banner()).toContainElement(headings[0] as HTMLElement)
    expect(headings[0]).toHaveClass('truncate', 'text-2xl', 'font-bold')
    await waitFor(() => expect(document.title).toBe('Hoy · TCG Pocket'))
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull()
  })

  it('an inner page has one h1 too, as it was, next to «Volver»', async () => {
    renderAt('/partidas/historial')
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Historial de partidas')
    expect(headings[0]).toHaveClass('truncate', 'text-lg', 'font-semibold')
    await waitFor(() => expect(document.title).toBe('Historial de partidas · TCG Pocket'))
    expect(within(banner()).getByRole('button', { name: 'Volver' })).toBeInTheDocument()
  })

  it('a page can name itself and put its own control in the header; both go away with it', async () => {
    const user = userEvent.setup()
    renderAt('/nombrada', QUIET)
    expect(await title('Gardevoir ex')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    await waitFor(() => expect(document.title).toBe('Gardevoir ex · TCG Pocket'))
    // The page's control sits between the title and the way to the Menú.
    const own = within(banner()).getByRole('button', { name: 'Otro mazo' })
    const menu = within(banner()).getByRole('link', { name: MENU })
    expect(screen.getByRole('heading', { level: 1 }).compareDocumentPosition(own)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(own.compareDocumentPosition(menu)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(screen.getByRole('link', { name: 'A la otra' }))
    expect(await title('Quieta')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Quieta · TCG Pocket'))
    expect(screen.queryByRole('button', { name: 'Otro mazo' })).toBeNull()
  })

  it.each([
    '/partidas',
    '/mazos',
    '/sobres',
    '/coleccion',
    '/torneos',
    '/eventos',
    '/laboratorio',
    '/simulacion',
    '/jugar',
  ])('%s is a root: no «Volver»', async (path) => {
    renderAt(path)
    await screen.findByRole('navigation', { name: 'Secciones' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('text-2xl')
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull()
  })

  it('«Volver» on the first screen of a visit goes up, and up again, without leaving the app', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mas/backup')
    expect(await title('Copia de seguridad')).toBeInTheDocument()
    expect(window.history.length).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(await title('Menú')).toBeInTheDocument()
    expect(where(router)).toBe('/mas')
    expect(router.state.historyAction).toBe('PUSH')

    // The Menú was not reached from Hoy: its «Volver» goes up as well, in its own place.
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(await title('Hoy')).toBeInTheDocument()
    expect(where(router)).toBe('/partidas')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('with react-router’s own entry behind, «Volver» goes back; on its first entry it never leaves the app', async () => {
    const user = userEvent.setup()
    // A browser tab that showed something else before: the history is long, but the app's first entry is this one.
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(7)
    const state = vi.spyOn(window.history, 'state', 'get').mockReturnValue({ idx: 0 })
    const router = renderAt('/partidas/historial')
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/partidas')
    expect(router.state.historyAction).toBe('PUSH')

    await go(router, '/partidas/estadisticas')
    state.mockReturnValue({ idx: 2 })
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/partidas')
    expect(router.state.historyAction).toBe('POP')
  })
})

describe('the way to the Menú', () => {
  it.each(['/partidas', '/mazos/1', '/sobres/promo', '/torneos', '/jugar/situaciones', '/nada'])(
    'is in the header at %s',
    async (path) => {
      renderAt(path)
      await screen.findByRole('navigation', { name: 'Secciones' })
      expect(within(banner()).getByRole('link', { name: MENU })).toHaveAttribute('href', '/mas')
      expect(screen.getAllByRole('link', { name: /^Menú/ })).toHaveLength(1)
    },
  )

  it.each(['/mas', '/mas/tokens', '/mas/backup'])('is not at %s, the Menú itself', async (path) => {
    renderAt(path)
    await screen.findByRole('navigation', { name: 'Secciones' })
    expect(screen.queryByRole('link', { name: /^Menú/ })).toBeNull()
    expect(within(banner()).getByRole('button', { name: 'Volver' })).toBeInTheDocument()
  })

  it('opens the Menú, whose «Volver» returns to the screen it was opened from', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    await user.click(within(banner()).getByRole('link', { name: MENU }))
    expect(await title('Menú')).toBeInTheDocument()
    expect(where(router)).toBe('/mas')
    expect(screen.getByRole('link', { name: /Tokens de API/ })).toHaveAttribute('href', '/mas/tokens')
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2)
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/mazos?armados=1')
    expect(router.state.historyAction).toBe('POP')
  })

  const alert = (level: 'info' | 'warning', code: string) => ({ code, level, title: code, detail: '', link: null })

  it.each([
    ['two warnings and a notice', [alert('warning', 'a'), alert('info', 'b'), alert('warning', 'c')], ' · 2 avisos'],
    ['one warning', [alert('warning', 'a')], ' · 1 aviso'],
    ['only notices', [alert('info', 'a'), alert('info', 'b')], ''],
    ['nothing', [], ''],
  ])('says how many warnings wait: %s', async (_name, items, suffix) => {
    fakeApi({ 'GET /api/alerts': { items } })
    renderAt('/quieta', QUIET)
    const link = await within(banner()).findByRole('link', { name: `${MENU}${suffix}` })
    expect(link).toHaveAttribute('href', '/mas')
    // The dot is what a sighted person gets of the same count.
    expect(link.querySelectorAll('span.bg-warning')).toHaveLength(suffix === '' ? 0 : 1)
  })
})

describe('the frame around the page', () => {
  it('starts with a skip link that moves the focus to the page and leaves the address alone', async () => {
    const user = userEvent.setup()
    const router = renderAt('/partidas/historial')
    const { key } = router.state.location
    await user.tab()
    const skip = screen.getByRole('link', { name: 'Saltar al contenido' })
    expect(skip).toHaveFocus()
    // First in the document too, before the header.
    expect(skip.compareDocumentPosition(banner())).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    expect(fireEvent.click(skip)).toBe(false)
    const main = screen.getByRole('main')
    expect(main).toHaveFocus()
    expect(main).toHaveAttribute('id', 'principal')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(router.state.location.key).toBe(key)
    expect(router.state.location.hash).toBe('')
  })

  it('isolates the page’s own layers, and comes before the fixed row and the bar in the document', async () => {
    renderAt('/mazos')
    const main = screen.getByRole('main')
    expect(main).toHaveClass('isolate')
    const zone = document.querySelector('[data-slot="bottom-zone"]') as HTMLElement
    expect(main.compareDocumentPosition(zone)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(banner().compareDocumentPosition(main)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(zone).toContainElement(row() as HTMLElement)
    expect(zone).toContainElement(screen.getByRole('navigation', { name: 'Secciones' }))
    // The row first, then the tabs.
    expect((row() as HTMLElement).compareDocumentPosition(screen.getByRole('navigation', { name: 'Secciones' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('says it has no signal in the header, and shows a toast', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt('/quieta', QUIET)
    expect(
      within(banner()).getByText('Sin señal: las partidas que guardes quedan en el celu y se envían solas.'),
    ).toBeInTheDocument()
    act(() => {
      toast.success('Quedó guardado')
    })
    expect(await screen.findByText('Quedó guardado')).toBeInTheDocument()
  })

  it('going from a root to an inner page and back does not start the sender of waiting matches again', async () => {
    const { calls } = fakeApi({})
    const sends = () => calls.filter((call) => call.method === 'POST' && call.path === '/api/matches').length
    queueMatch({
      clientRef: 'a1b2c3d4-0000-4000-8000-000000000001',
      body: { deckId: '7', result: 'win', opponent: null, wentFirst: null, mode: 'casual' },
      label: 'Victoria con Zoroark ex',
      savedAt: Date.now(),
    })
    const router = renderAt('/partidas')
    await waitFor(() => expect(sends()).toBe(1))

    await go(router, '/partidas/historial')
    expect(await title('Historial de partidas')).toBeInTheDocument()
    await go(router, '/partidas')
    expect(await title('Hoy')).toBeInTheDocument()
    await go(router, '/mas')
    expect(await title('Menú')).toBeInTheDocument()
    // The API answered 503: the match still waits, and nobody tried again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sends()).toBe(1)
  })

  it('names the landmark of the toasts in Spanish, as its other landmarks', async () => {
    renderAt('/quieta', QUIET)
    // sonner adds its shortcut to the name.
    expect(screen.getByRole('region', { name: /^Notificaciones\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Notifications/ })).toBeNull()
  })

  it('the alerts are asked by the way to the Menú: on a page of the Menú the frame asks for nothing', async () => {
    const table: RouteObject[] = [
      {
        path: '/',
        element: <AppShell />,
        children: [{ path: 'mas/quieta', element: <p>Nada que pedir</p>, handle: { title: 'Quieta', back: '/mas' } }],
      },
    ]
    const { calls } = fakeApi({})
    renderAt('/mas/quieta', table)
    await screen.findByRole('navigation', { name: 'Secciones' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([])
  })

  it('asks the API for nothing but the alerts', async () => {
    const { calls } = fakeApi({})
    const router = renderAt('/quieta', QUIET)
    await waitFor(() => expect(calls).toHaveLength(1))
    await go(router, '/nombrada')
    expect(await title('Gardevoir ex')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/alerts'])
  })
})

describe('the fixed row', () => {
  const views = (name: string) => screen.getByRole('tablist', { name })
  const view = (list: string, name: string) => within(views(list)).getByRole('tab', { name })

  it('on /sobres holds the views of Cartas, and a view takes the place of the history entry', async () => {
    const user = userEvent.setup()
    const router = renderAt('/sobres')
    expect(row()).toContainElement(views('Vistas de Cartas'))
    expect(
      within(views('Vistas de Cartas'))
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Sobres', 'Colección'])
    const sobres = view('Vistas de Cartas', 'Sobres')
    expect(sobres).toHaveAttribute('aria-selected', 'true')
    expect(sobres).toHaveAttribute('tabindex', '0')
    expect(sobres).toHaveAttribute('aria-controls', 'principal')
    expect(sobres).toHaveAttribute('id', 'vista-sobres')
    const coleccion = view('Vistas de Cartas', 'Colección')
    expect(coleccion).toHaveAttribute('aria-selected', 'false')
    expect(coleccion).toHaveAttribute('tabindex', '-1')
    expect(coleccion).toHaveAttribute('href', '/coleccion')

    await user.click(coleccion)
    expect(where(router)).toBe('/coleccion')
    expect(router.state.historyAction).toBe('REPLACE')
    // The same tab, not a new one: whoever had the focus on it keeps it.
    expect(view('Vistas de Cartas', 'Colección')).toBe(coleccion)
    expect(coleccion).toHaveAttribute('aria-selected', 'true')
    expect(coleccion).toHaveAttribute('tabindex', '0')
    expect(sobres).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Colección')
  })

  it('the arrows, Home and End move, open and keep the focus on the chosen view; Space and Enter open', async () => {
    const user = userEvent.setup()
    const router = renderAt('/laboratorio')
    await title('Laboratorio de mazos')
    const list = 'Vistas de Pruebas'
    view(list, 'Laboratorio').focus()

    await user.keyboard('{ArrowRight}')
    expect(view(list, 'Simulación')).toHaveFocus()
    await waitFor(() => expect(where(router)).toBe('/simulacion'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(view(list, 'Simulación')).toHaveFocus()
    // The router's state changes before React draws the row again: wait for the screen, not for the address.
    await waitFor(() => expect(view(list, 'Simulación')).toHaveAttribute('aria-selected', 'true'))

    await user.keyboard('{End}')
    expect(view(list, 'Practicar')).toHaveFocus()
    await waitFor(() => expect(where(router)).toBe('/jugar'))
    // Round the end.
    await user.keyboard('{ArrowRight}')
    expect(view(list, 'Laboratorio')).toHaveFocus()
    await waitFor(() => expect(where(router)).toBe('/laboratorio'))
    await user.keyboard('{ArrowLeft}')
    expect(view(list, 'Practicar')).toHaveFocus()
    await waitFor(() => expect(where(router)).toBe('/jugar'))
    await user.keyboard('{Home}')
    expect(view(list, 'Laboratorio')).toHaveFocus()
    await waitFor(() => expect(where(router)).toBe('/laboratorio'))
    expect(router.state.historyAction).toBe('REPLACE')

    // Space on a tab that is not the selected one (an anchor does not click on Space by itself).
    view(list, 'Simulación').focus()
    await user.keyboard(' ')
    await waitFor(() => expect(where(router)).toBe('/simulacion'))
    expect(router.state.historyAction).toBe('REPLACE')
    view(list, 'Practicar').focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(where(router)).toBe('/jugar'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(await title('Jugar contra un bot')).toBeInTheDocument()

    // With a modifier the key belongs to the browser (Alt + ← is «atrás»).
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(where(router)).toBe('/jugar')
  })

  it('the selected view does not navigate: its filters stay in the address', async () => {
    const user = userEvent.setup()
    const router = renderAt('/coleccion?vista=edicion')
    const { key } = router.state.location
    const coleccion = view('Vistas de Cartas', 'Colección')
    expect(coleccion).toHaveAttribute('href', '/coleccion?vista=edicion')
    await user.click(coleccion)
    expect(where(router)).toBe('/coleccion?vista=edicion')
    expect(router.state.location.key).toBe(key)
    coleccion.focus()
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(router.state.location.key).toBe(key)
  })

  it.each([
    ['/torneos', 'Vistas de Meta', ['Torneos', 'Eventos'], 'Torneos'],
    ['/eventos', 'Vistas de Meta', ['Torneos', 'Eventos'], 'Eventos'],
    ['/simulacion', 'Vistas de Pruebas', ['Laboratorio', 'Simulación', 'Practicar'], 'Simulación'],
    ['/jugar', 'Vistas de Pruebas', ['Laboratorio', 'Simulación', 'Practicar'], 'Practicar'],
  ])('at %s shows «%s»', async (path, list, names, selected) => {
    renderAt(path)
    await screen.findByRole('navigation', { name: 'Secciones' })
    expect(row()).toContainElement(views(list))
    const tabs = within(views(list)).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(names)
    expect(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.textContent)).toEqual([
      selected,
    ])
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('on /mazos carries «Nuevo mazo», the only link with that name on the screen', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    const links = screen.getAllByRole('link', { name: 'Nuevo mazo' })
    expect(links).toHaveLength(1)
    expect(row()).toContainElement(links[0] as HTMLElement)
    expect(links[0]).toHaveAttribute('href', '/mazos/nuevo')
    // With its text: no views to make room for.
    expect(links[0]).toHaveTextContent('Nuevo mazo')
    expect(links[0]).not.toHaveAttribute('aria-label')
    expect(screen.queryByRole('tablist', { name: /^Vistas/ })).toBeNull()
    await user.click(links[0] as HTMLElement)
    expect(where(router)).toBe('/mazos/nuevo')
    expect(router.state.historyAction).toBe('PUSH')
    expect(row()).toBeNull()
  })

  it.each(['/mas', '/mazos/1', '/partidas', '/sobres/promo', '/coleccion/importar', '/torneos/semana'])(
    'is not drawn at %s, and the page ends right above the bar',
    async (path) => {
      renderAt(path)
      await screen.findByRole('navigation', { name: 'Secciones' })
      expect(row()).toBeNull()
      expect(screen.queryByRole('tablist', { name: /^Vistas/ })).toBeNull()
      expect(document.querySelector('[data-slot="bottom-zone"]')).not.toHaveAttribute('data-row')
      expect(screen.getByRole('main')).toHaveClass('pb-[calc(var(--bar-h)+26px+env(safe-area-inset-bottom))]')
    },
  )

  it('where it is drawn, the page leaves room for it', async () => {
    renderAt('/sobres')
    expect(row()).not.toBeNull()
    expect(document.querySelector('[data-slot="bottom-zone"]')).toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(
      'pb-[calc(var(--bar-h)+var(--row-h)+54px+env(safe-area-inset-bottom))]',
    )
  })

  it('with the views «arriba» they are tabs inside the header, and the row is left to the action', async () => {
    const user = userEvent.setup()
    writeLook({ views: 'top' })
    const router = renderAt('/sobres')
    const list = views('Vistas de Cartas')
    expect(banner()).toContainElement(list)
    expect(row()).toBeNull()
    expect(screen.getAllByRole('tablist', { name: /^Vistas/ })).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveClass('pb-[calc(var(--bar-h)+26px+env(safe-area-inset-bottom))]')
    // Under the title row, before the offline line would go.
    expect(screen.getByRole('heading', { level: 1 }).compareDocumentPosition(list)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )

    await user.click(view('Vistas de Cartas', 'Colección'))
    expect(where(router)).toBe('/coleccion')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(banner()).toContainElement(views('Vistas de Cartas'))

    // The choice is taken at once, without a reload.
    act(() => writeLook({ views: 'bottom' }))
    expect(row()).toContainElement(views('Vistas de Cartas'))
    expect(banner()).not.toContainElement(views('Vistas de Cartas'))

    // A screen without views keeps its action in the row.
    act(() => writeLook({ views: 'top' }))
    await go(router, '/mazos')
    expect(row()).toContainElement(screen.getByRole('link', { name: 'Nuevo mazo' }))
  })
})
