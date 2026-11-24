import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TABS } from '@/app/frame'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { applyLook, LOOK_KEY, readLook } from '@/lib/look'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

const QUERY = { light: '(prefers-color-scheme: light)', reduced: '(prefers-reduced-motion: reduce)' } as const

/** A system the tests can change (the shared setup's `matchMedia` always answers `false`). The listeners are kept
 * per media query, as a browser keeps them: a change is told only to who watches the query that changed. */
const system = { light: false, reduced: false, listeners: new Map<string, Set<() => void>>() }
const matchMedia = (query: string) =>
  ({
    get matches() {
      return (query === QUERY.light && system.light) || (query === QUERY.reduced && system.reduced)
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: () => void) => {
      if (!system.listeners.has(query)) system.listeners.set(query, new Set())
      system.listeners.get(query)?.add(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => system.listeners.get(query)?.delete(listener),
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList

function systemChanges(change: Partial<Pick<typeof system, 'light' | 'reduced'>>) {
  Object.assign(system, change)
  act(() => {
    for (const key of ['light', 'reduced'] as const) {
      if (key in change) for (const listener of system.listeners.get(QUERY[key]) ?? []) listener()
    }
  })
}

type Router = ReturnType<typeof createMemoryRouter>

function renderAt(path = '/mas'): Router {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const stored = () => JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as unknown
const theme = () => document.documentElement.getAttribute('data-theme')
const motion = () => document.documentElement.getAttribute('data-motion')
const main = () => screen.getByRole('main')
const group = (name: string) => within(main()).getByRole('radiogroup', { name })
const radio = (list: string, name: string) => within(group(list)).getByRole('radio', { name })
const radios = (list: string) =>
  within(group(list))
    .getAllByRole('radio')
    .map((item) => `${item.textContent}${item.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)
const hrefs = (root: HTMLElement) =>
  within(root)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'))

// The toast captures the pointer, which jsdom lacks.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
})

beforeEach(() => {
  system.light = false
  system.reduced = false
  vi.stubGlobal('matchMedia', matchMedia)
  // As index.html leaves the page before anything runs.
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.setAttribute('data-motion', 'full')
  fakeApi({})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-motion')
})

/** The 14 destinations «Más» listed (its three groups, in its order). None may lose its visible way in. */
const MAS = [
  '/torneos',
  '/laboratorio',
  '/simulacion',
  '/eventos',
  '/jugar',
  '/mas/notas',
  '/mas/mano',
  '/mas/backup',
  '/mas/catalogo',
  '/coleccion/pokemon-zone',
  '/mas/ajustes',
  '/mas/tokens',
  '/mas/sesion',
  '/mas/acerca',
]

describe('the Menú, where «Más» was', () => {
  it('everything «Más» reached is a link of the Menú, a tab or a view', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { level: 1, name: 'Menú' })).toBeInTheDocument()
    const menu = hrefs(main())
    expect(menu).toEqual([
      '/mas/notas',
      '/mas/mano',
      '/coleccion/pokemon-zone',
      '/mas/ajustes',
      '/mas/backup',
      '/mas/catalogo',
      '/mas/tokens',
      '/mas/sesion',
      '/mas/acerca',
    ])
    // The tabs, as the bar draws them on this very screen, and the views each of them shows at its start.
    const tabs = hrefs(screen.getByRole('navigation', { name: 'Secciones' }))
    expect(tabs).toEqual(['/partidas', '/mazos', '/sobres', '/torneos', '/laboratorio'])
    const views = TABS.flatMap((tab) => (tab.views ?? []).map((view) => view.path))
    expect(views).toEqual(['/sobres', '/coleccion', '/torneos', '/eventos', '/laboratorio', '/simulacion', '/jugar'])

    const reached = new Set([...menu, ...tabs, ...views])
    expect(MAS.filter((href) => !reached.has(href))).toEqual([])
    // The five that left the list are exactly the ones the frame took.
    expect(MAS.filter((href) => !menu.includes(href))).toEqual([
      '/torneos',
      '/laboratorio',
      '/simulacion',
      '/eventos',
      '/jugar',
    ])
    expect(menu.filter((href) => !MAS.includes(href as string))).toEqual([])
    expect([...reached].sort()).toEqual(
      [
        '/coleccion',
        '/coleccion/pokemon-zone',
        '/eventos',
        '/jugar',
        '/laboratorio',
        '/mas/acerca',
        '/mas/ajustes',
        '/mas/backup',
        '/mas/catalogo',
        '/mas/mano',
        '/mas/notas',
        '/mas/sesion',
        '/mas/tokens',
        '/mazos',
        '/partidas',
        '/simulacion',
        '/sobres',
        '/torneos',
      ].sort(),
    )
  })

  it('has its four blocks in order: the notices, the other screens, the look, the settings and system', async () => {
    fakeApi({
      'GET /api/alerts': { items: [{ code: 'a', level: 'info', title: 'Era nueva', detail: 'C1', link: null }] },
    })
    renderAt()
    await within(main()).findByRole('region', { name: 'Avisos' })
    expect(
      within(main())
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual(['Avisos', 'Otras pantallas', 'Aspecto', 'Ajustes y sistema'])
    expect(
      within(main())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Otras pantallas', 'Aspecto', 'Ajustes y sistema'])

    const rows = (name: string) =>
      within(within(main()).getByRole('region', { name }))
        .getAllByRole('link')
        .map((link) => [
          link.getAttribute('href'),
          ...[...link.querySelectorAll('span > span')].map((s) => s.textContent),
        ])
    expect(rows('Otras pantallas')).toEqual([
      ['/mas/notas', 'Notas por rival', 'Cómo jugarle a cada arquetipo'],
      ['/mas/mano', 'Calculadora de mano', 'La chance de tener una carta en la mano inicial y en cada turno'],
      ['/coleccion/pokemon-zone', 'pokemon-zone', 'Puntos de sobre, relojes, cupones y partidas del juego'],
    ])
    expect(rows('Ajustes y sistema')).toEqual([
      [
        '/mas/ajustes',
        'Ajustes de la app',
        'Notificaciones, ptcgpocket.gg, tracker, imágenes en la mesa y quién empezó',
      ],
      ['/mas/backup', 'Copia de seguridad', 'Descargar, restaurar y la copia en la nube'],
      ['/mas/catalogo', 'Catálogo', 'Cartas y expansiones cargadas, y su sincronización'],
      ['/mas/tokens', 'Tokens de API', 'Claude, workers y actividad'],
      ['/mas/sesion', 'Sesión', 'Contraseña y cerrar sesión'],
      ['/mas/acerca', 'Acerca de', 'Versión y licencias'],
    ])
    // A row is at least 56 px high, with its icon and its chevron.
    for (const link of within(within(main()).getByRole('region', { name: 'Ajustes y sistema' })).getAllByRole('link')) {
      expect(link).toHaveClass('min-h-14')
      expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
    }

    // The look: the four settings of the card, and where each is saved.
    const look = within(main()).getByRole('region', { name: 'Aspecto' })
    expect(
      within(look)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Tema', 'Movimiento', 'Dónde van las vistas'])
    expect(within(look).getByRole('switch', { name: /^Miniaturas de cartas/ })).toBeInTheDocument()
    expect(
      within(look).getByText(
        'El tema, el movimiento y las vistas se guardan en este dispositivo; las miniaturas, en el servidor.',
      ),
    ).toBeInTheDocument()
  })

  it('lists every notice: a warning stands out, one with a link is a link, and without notices there is no list', async () => {
    fakeApi({
      'GET /api/alerts': {
        items: [
          {
            code: 'backup_stale',
            level: 'warning',
            title: 'La copia de seguridad está vieja',
            detail: 'La última es de hace 9 días.',
            link: '/mas/backup',
          },
          { code: 'github_check', level: 'info', title: 'No se pudo consultar GitHub', detail: 'Sin red.', link: null },
        ],
      },
    })
    renderAt()
    const list = await within(main()).findByRole('region', { name: 'Avisos' })
    const warning = within(list).getByRole('link', { name: /La copia de seguridad está vieja/ })
    expect(warning).toHaveAttribute('href', '/mas/backup')
    expect(warning).toHaveTextContent('La última es de hace 9 días.')
    expect(warning).toHaveClass('border-warning/60')
    const notice = within(list).getByText('No se pudo consultar GitHub').parentElement as HTMLElement
    expect(notice.tagName).toBe('DIV')
    expect(notice).toHaveTextContent('Sin red.')
    expect(notice).not.toHaveClass('border-warning/60')
    expect(within(list).getAllByRole('link')).toHaveLength(1)
  })

  it('shows no list of notices when there is none', async () => {
    fakeApi({ 'GET /api/alerts': { items: [] } })
    renderAt()
    await within(main()).findByRole('region', { name: 'Aspecto' })
    await waitFor(() => expect(screen.getByRole('link', { name: /Tokens de API/ })).toBeInTheDocument())
    expect(within(main()).queryByRole('region', { name: 'Avisos' })).toBeNull()
  })
})

describe('Menú → Aspecto', () => {
  it('«Tema»: dark until this device says otherwise; a choice reaches the page and this device at once', async () => {
    const user = userEvent.setup()
    renderAt()
    expect(radios('Tema')).toEqual(['Oscuro ✓', 'Claro', 'Sistema'])
    expect(within(main()).getByText('oscuro por defecto')).toBeInTheDocument()
    // Nothing is written before a choice.
    expect(stored()).toBeNull()
    expect(theme()).toBe('dark')

    await user.click(radio('Tema', 'Claro'))
    expect(theme()).toBe('light')
    expect(stored()).toEqual({ theme: 'light' })
    expect(radios('Tema')).toEqual(['Oscuro', 'Claro ✓', 'Sistema'])
    expect(within(main()).getByText('oscuro por defecto')).toBeInTheDocument()

    await user.click(radio('Tema', 'Oscuro'))
    expect(theme()).toBe('dark')
    expect(stored()).toEqual({ theme: 'dark' })
    expect(radios('Tema')).toEqual(['Oscuro ✓', 'Claro', 'Sistema'])
  })

  it('«Sistema» stores the choice, not what it resolves to, and says what the system asks now', async () => {
    const user = userEvent.setup()
    renderAt()
    await user.click(radio('Tema', 'Sistema'))
    expect(stored()).toEqual({ theme: 'system' })
    expect(radios('Tema')).toEqual(['Oscuro', 'Claro', 'Sistema ✓'])
    expect(theme()).toBe('dark')
    expect(within(main()).getByText('sigue al sistema: ahora oscuro')).toBeInTheDocument()
    expect(within(main()).queryByText('oscuro por defecto')).toBeNull()

    systemChanges({ light: true })
    expect(theme()).toBe('light')
    expect(within(main()).getByText('sigue al sistema: ahora claro')).toBeInTheDocument()
    expect(stored()).toEqual({ theme: 'system' })
    // The line that says it is read with the group.
    const fine = within(main()).getByText('sigue al sistema: ahora claro')
    expect(group('Tema')).toHaveAttribute('aria-describedby', fine.id)
  })

  it('«Movimiento»: three levels, the page follows the one chosen', async () => {
    const user = userEvent.setup()
    renderAt()
    expect(radios('Movimiento')).toEqual(['Expresivo ✓', 'Sutil', 'Ninguno'])
    expect(within(main()).getByText('tres niveles')).toBeInTheDocument()
    expect(motion()).toBe('full')
    expect(stored()).toBeNull()

    await user.click(radio('Movimiento', 'Sutil'))
    expect(motion()).toBe('subtle')
    expect(stored()).toEqual({ motion: 'subtle' })
    expect(radios('Movimiento')).toEqual(['Expresivo', 'Sutil ✓', 'Ninguno'])

    await user.click(radio('Movimiento', 'Ninguno'))
    expect(motion()).toBe('none')
    expect(stored()).toEqual({ motion: 'none' })
    expect(radios('Movimiento')).toEqual(['Expresivo', 'Sutil', 'Ninguno ✓'])
    for (const item of within(group('Movimiento')).getAllByRole('radio')) {
      expect(item).not.toHaveAttribute('aria-disabled')
    }

    await user.click(radio('Movimiento', 'Expresivo'))
    expect(motion()).toBe('full')
    expect(stored()).toEqual({ motion: 'full' })
  })

  it('«Dónde van las vistas»: in the fixed row or in tabs under the header, and the frame follows', async () => {
    const user = userEvent.setup()
    const router = renderAt()
    expect(radios('Dónde van las vistas')).toEqual(['Abajo, en la fila fija ✓', 'Arriba, en pestañas'])
    const fine = within(main()).getByText('Las de Cartas, Meta y Pruebas. Abajo: en la fila fija, arriba de la barra.')
    expect(group('Dónde van las vistas')).toHaveAttribute('aria-describedby', fine.id)

    await user.click(radio('Dónde van las vistas', 'Arriba, en pestañas'))
    expect(stored()).toEqual({ views: 'top' })
    expect(readLook().views).toBe('top')
    expect(radios('Dónde van las vistas')).toEqual(['Abajo, en la fila fija', 'Arriba, en pestañas ✓'])
    expect(
      within(main()).getByText('Las de Cartas, Meta y Pruebas. Arriba: pestañas pegadas bajo el encabezado.'),
    ).toBeInTheDocument()

    // On a screen with views they are now in the header.
    await act(() => router.navigate('/sobres'))
    const views = await screen.findByRole('tablist', { name: 'Vistas de Cartas' })
    expect(screen.getByRole('banner')).toContainElement(views)
    expect(document.querySelector('[data-slot="fixed-row"]')).toBeNull()

    await act(() => router.navigate('/mas'))
    await user.click(radio('Dónde van las vistas', 'Abajo, en la fila fija'))
    expect(stored()).toEqual({ views: 'bottom' })
  })

  it('each choice keeps the others, and the keys a later version stored next to them', async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: 'light', density: 'compact', x: { y: 1 } }))
    // As public/look.js does before the app starts.
    applyLook()
    const user = userEvent.setup()
    renderAt()
    expect(radios('Tema')).toEqual(['Oscuro', 'Claro ✓', 'Sistema'])
    expect(theme()).toBe('light')

    await user.click(radio('Movimiento', 'Sutil'))
    expect(stored()).toEqual({ theme: 'light', density: 'compact', x: { y: 1 }, motion: 'subtle' })
    await user.click(radio('Dónde van las vistas', 'Arriba, en pestañas'))
    expect(stored()).toEqual({ theme: 'light', density: 'compact', x: { y: 1 }, motion: 'subtle', views: 'top' })
    await user.click(radio('Tema', 'Sistema'))
    expect(stored()).toEqual({ theme: 'system', density: 'compact', x: { y: 1 }, motion: 'subtle', views: 'top' })
    expect(theme()).toBe('dark')
    expect(motion()).toBe('subtle')
  })

  it('when the system asks to reduce motion it stays in «Ninguno», and choosing another level is refused', async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ motion: 'subtle' }))
    system.reduced = true
    applyLook()
    expect(motion()).toBe('none')
    const user = userEvent.setup()
    renderAt()

    expect(radios('Movimiento')).toEqual(['Expresivo', 'Sutil', 'Ninguno ✓'])
    expect(within(main()).getByText('tu sistema pide reducirlo: queda en Ninguno')).toBeInTheDocument()
    expect(within(main()).queryByText('tres niveles')).toBeNull()
    for (const name of ['Expresivo', 'Sutil']) {
      // Not `disabled`: it stays in reach, so choosing it can say why it is refused.
      expect(radio('Movimiento', name)).toHaveAttribute('aria-disabled', 'true')
      expect(radio('Movimiento', name)).toBeEnabled()
    }
    expect(radio('Movimiento', 'Ninguno')).not.toHaveAttribute('aria-disabled')

    const REFUSED = 'Tu sistema pide reducir el movimiento: queda en «Ninguno».'
    await user.click(radio('Movimiento', 'Expresivo'))
    expect(await screen.findByText(REFUSED)).toBeInTheDocument()
    // Refused again (the arrows move and choose, so a walk across the group passes both): still one toast, not a pile.
    await user.click(radio('Movimiento', 'Sutil'))
    await user.click(radio('Movimiento', 'Expresivo'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getAllByText(REFUSED)).toHaveLength(1)
    expect(radios('Movimiento')).toEqual(['Expresivo', 'Sutil', 'Ninguno ✓'])
    expect(motion()).toBe('none')
    // The stored choice is not overwritten: it comes back when the system stops asking.
    expect(stored()).toEqual({ motion: 'subtle' })
    await user.click(radio('Movimiento', 'Ninguno'))
    expect(stored()).toEqual({ motion: 'subtle' })

    systemChanges({ reduced: false })
    expect(motion()).toBe('subtle')
    expect(radios('Movimiento')).toEqual(['Expresivo', 'Sutil ✓', 'Ninguno'])
    expect(within(main()).getByText('tres niveles')).toBeInTheDocument()
    for (const item of within(group('Movimiento')).getAllByRole('radio')) {
      expect(item).not.toHaveAttribute('aria-disabled')
    }
  })

  it('a group is one stop of the keyboard, and the arrows move and choose, going round', async () => {
    const user = userEvent.setup()
    renderAt()
    // The group is the stop; inside it, the focus goes to the chosen option.
    for (const list of ['Tema', 'Movimiento', 'Dónde van las vistas']) {
      expect(group(list)).toHaveAttribute('tabindex', '0')
      for (const item of within(group(list)).getAllByRole('radio')) expect(item).toHaveAttribute('tabindex', '-1')
    }

    /** Holds the key as a hand does: the group moves the focus right after the key goes down, and chooses then. */
    async function arrow(key: string, lands: HTMLElement) {
      await user.keyboard(`{${key}>}`)
      await waitFor(() => expect(lands).toHaveFocus())
      await user.keyboard(`{/${key}}`)
    }

    within(main())
      .getByRole('link', { name: /pokemon-zone/ })
      .focus()
    await user.tab()
    expect(radio('Tema', 'Oscuro')).toHaveFocus()
    await arrow('ArrowRight', radio('Tema', 'Claro'))
    expect(radios('Tema')).toEqual(['Oscuro', 'Claro ✓', 'Sistema'])
    expect(theme()).toBe('light')
    expect(stored()).toEqual({ theme: 'light' })
    await arrow('ArrowRight', radio('Tema', 'Sistema'))
    expect(stored()).toEqual({ theme: 'system' })
    // Round the end, and back.
    await arrow('ArrowRight', radio('Tema', 'Oscuro'))
    expect(stored()).toEqual({ theme: 'dark' })
    await arrow('ArrowLeft', radio('Tema', 'Sistema'))
    expect(stored()).toEqual({ theme: 'system' })
    await arrow('ArrowUp', radio('Tema', 'Claro'))
    expect(radios('Tema')).toEqual(['Oscuro', 'Claro ✓', 'Sistema'])

    // Tab leaves the group for the next one, at its chosen option.
    await user.tab()
    expect(radio('Movimiento', 'Expresivo')).toHaveFocus()
    await arrow('ArrowLeft', radio('Movimiento', 'Ninguno'))
    expect(motion()).toBe('none')
    await user.tab()
    expect(radio('Dónde van las vistas', 'Abajo, en la fila fija')).toHaveFocus()
    await arrow('ArrowRight', radio('Dónde van las vistas', 'Arriba, en pestañas'))
    expect(stored()).toEqual({ theme: 'light', motion: 'none', views: 'top' })
  })

  describe('«Miniaturas de cartas»', () => {
    /** A server that keeps what it is sent, as the real one does. */
    function server(fail = false) {
      let ui = { thumbnails: false, boardImages: true, askWentFirst: true }
      return fakeApi({
        'GET /api/settings': () => ({ ui }),
        'PUT /api/settings/ui': (call: FakeCall) => {
          if (fail)
            return new Response(JSON.stringify({ error: { code: 'x', message: 'No se pudo' } }), { status: 500 })
          ui = (JSON.parse(String(call.body)) as { value: typeof ui }).value
          return { key: 'ui', value: ui }
        },
      })
    }
    const puts = (calls: FakeCall[]) =>
      calls.filter((call) => call.method === 'PUT').map((call) => [call.path, JSON.parse(String(call.body))])

    it('is the server’s switch, as it was in Ajustes de la app: one PUT with the whole of `ui`', async () => {
      const { calls } = server()
      const user = userEvent.setup()
      renderAt()
      const thumbnails = () => within(main()).getByRole('switch', { name: /^Miniaturas de cartas/ })
      expect(thumbnails().closest('label')).toHaveTextContent(
        'Imágenes chicas del tracker en las listas. Se cargan después del texto y nunca lo frenan.',
      )
      await waitFor(() => expect(calls.some((call) => call.path === '/api/settings')).toBe(true))
      expect(thumbnails()).toHaveAttribute('aria-checked', 'false')

      await user.click(thumbnails())
      expect(await screen.findByText('Miniaturas activadas')).toBeInTheDocument()
      // The other two preferences travel as they are: the server keeps one value under the key.
      expect(puts(calls)).toEqual([
        ['/api/settings/ui', { value: { thumbnails: true, boardImages: true, askWentFirst: true } }],
      ])
      await waitFor(() => expect(thumbnails()).toHaveAttribute('aria-checked', 'true'))
      // It is not a look of this device: nothing of it goes to `tcg.look`.
      expect(stored()).toBeNull()

      await user.click(thumbnails())
      expect(await screen.findByText('Miniaturas desactivadas')).toBeInTheDocument()
      expect(puts(calls)[1]).toEqual([
        '/api/settings/ui',
        { value: { thumbnails: false, boardImages: true, askWentFirst: true } },
      ])
    })

    it('says so when the server refuses', async () => {
      const { calls } = server(true)
      const user = userEvent.setup()
      renderAt()
      const thumbnails = () => within(main()).getByRole('switch', { name: /^Miniaturas de cartas/ })
      await user.click(thumbnails())
      expect(await screen.findByText('No se pudo')).toBeInTheDocument()
      expect(puts(calls)).toHaveLength(1)
      // The server still says «off», and so does the switch once it is asked again.
      await waitFor(() => expect(thumbnails()).toBeEnabled())
      expect(thumbnails()).toHaveAttribute('aria-checked', 'false')
    })
  })
})
