import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeLook } from '@/lib/look'
import { fakeApi } from '@/test/fakeApi'
import { Providers } from './Providers'
import { routes } from './routes'

type Router = ReturnType<typeof createMemoryRouter>

function renderAt(path: string): Router {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const where = (router: Router) => router.state.location.pathname + router.state.location.search
const bar = () => screen.findByRole('navigation', { name: 'Secciones' })
const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('link', { name })
const title = (name: string) => screen.findByRole('heading', { level: 1, name })

/** A navigation made by a page (a link of its own, the deck pager), not by the frame. */
const go = (router: Router, ...args: Parameters<Router['navigate']>) => act(() => router.navigate(...args))

/** With something behind in the history, an unmarked «Volver» is `navigate(-1)`: the mark is what the tests see. */
const somethingBehind = () => vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)

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

describe('the tab bar', () => {
  it('has the five tabs and the search, in order, and nothing called «Más»', async () => {
    const router = renderAt('/')
    // The index still leads to Hoy (logging a match is the most frequent action).
    expect(router.state.location.pathname).toBe('/partidas')
    const nav = await bar()
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Hoy', '/partidas'],
      ['Mazos', '/mazos'],
      ['Cartas', '/sobres'],
      ['Meta', '/torneos'],
      ['Pruebas', '/laboratorio'],
    ])
    const buttons = within(nav).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName('Buscar')
    // The magnifier is the last thing of the bar.
    expect(tab('Pruebas').compareDocumentPosition(buttons[0] as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getAllByRole('button', { name: 'Buscar' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Más' })).toBeNull()
    expect(within(nav).queryByText('Más')).toBeNull()

    expect(tab('Hoy')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hoy')
  })

  it('navigates between tabs and updates the header title', async () => {
    const user = userEvent.setup()
    const router = renderAt('/partidas')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hoy')
    expect(screen.getByRole('heading', { name: 'Nueva partida' })).toBeInTheDocument()

    await user.click(tab('Mazos'))
    expect(router.state.location.pathname).toBe('/mazos')
    expect(router.state.historyAction).toBe('PUSH')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mazos')
    expect(tab('Mazos')).toHaveAttribute('aria-current', 'page')
    expect(tab('Hoy')).not.toHaveAttribute('aria-current')

    await user.click(tab('Meta'))
    expect(await title('Torneos')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/torneos')
    expect(tab('Meta')).toHaveAttribute('aria-current', 'page')
  })

  it.each([
    ['/cartas/B2-113', 'Cartas'],
    ['/sobres/promo', 'Cartas'],
    ['/coleccion/tracker', 'Cartas'],
    ['/torneos/semana', 'Meta'],
    ['/simulacion/3', 'Pruebas'],
    ['/laboratorio', 'Pruebas'],
    ['/jugar/12', 'Pruebas'],
    ['/eventos/1', 'Meta'],
  ])('at %s exactly one tab is the current page: %s', async (path, label) => {
    renderAt(path)
    const nav = await bar()
    const current = nav.querySelectorAll('[aria-current]')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('aria-current', 'page')
    expect(current[0]).toHaveTextContent(label)
    expect(tab(label)).toBe(current[0])
  })

  it.each(['/mas', '/mas/tokens'])('at %s, the Menú, no tab is the current page', async (path) => {
    renderAt(path)
    const nav = await bar()
    expect(nav.querySelectorAll('[aria-current]')).toHaveLength(0)
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
  })
})

describe('each tab remembers where it was', () => {
  it('comes back to the deep screen, marked, and a second tap goes to the start of the tab', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await user.click(tab('Hoy'))
    expect(where(router)).toBe('/partidas')
    expect(tab('Mazos')).toHaveAttribute('href', '/mazos/1')

    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')
    expect(router.state.location.state).toEqual({ tabReturn: true })
    expect(router.state.historyAction).toBe('PUSH')
    // Hoy was left at its start: it comes back to it, unmarked.
    expect(tab('Hoy')).toHaveAttribute('href', '/partidas')

    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos')
    expect(router.state.historyAction).toBe('PUSH')
    expect(router.state.location.state).toBeNull()
  })

  it('a tab that returns to its own start is not marked, even when a «Volver» that went up left it marked', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    somethingBehind()
    // «Volver» goes up to the list, marked; the list is then what Mazos remembers.
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/mazos')
    expect(router.state.location.state).toEqual({ tabReturn: true })

    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos')
    expect(router.state.location.state).toBeNull()
  })

  it('a tap on the lit tab at its start does not navigate: the page goes to the top', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos')
    await bar()
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const { key } = router.state.location
    await user.click(tab('Mazos'))
    expect(router.state.location.key).toBe(key)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })

    // «Ninguno»: at once.
    act(() => writeLook({ motion: 'none' }))
    await user.click(tab('Mazos'))
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
    expect(router.state.location.key).toBe(key)
  })

  it('with a modifier (Ctrl, ⌘) the lit tab at its start is a link like any other: the browser opens it elsewhere', async () => {
    const router = renderAt('/mazos')
    await bar()
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const { key } = router.state.location
    // jsdom would try to load the link: the window stops it, after noting whether the tab had stopped it first.
    const prevented: boolean[] = []
    const noLoad = (event: Event) => {
      prevented.push(event.defaultPrevented)
      event.preventDefault()
    }
    window.addEventListener('click', noLoad)
    fireEvent.click(tab('Mazos'), { ctrlKey: true })
    fireEvent.click(tab('Mazos'), { metaKey: true })
    // A plain click, for contrast: that one is the tab's.
    fireEvent.click(tab('Mazos'))
    window.removeEventListener('click', noLoad)
    expect(prevented).toEqual([false, false, true])
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(router.state.location.key).toBe(key)
  })

  it('at /mazos?armados=1 a tap on «Mazos» keeps the address and the history', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    await bar()
    expect(tab('Mazos')).toHaveAttribute('href', '/mazos?armados=1')
    const { key } = router.state.location
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos?armados=1')
    expect(router.state.location.key).toBe(key)
    expect(router.state.historyAction).toBe('POP')
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('compares the pathname alone: /Mazos/ is the start of Mazos too', async () => {
    const user = userEvent.setup()
    const router = renderAt('/Mazos/')
    await bar()
    expect(tab('Mazos')).toHaveAttribute('aria-current', 'page')
    const { key } = router.state.location
    await user.click(tab('Mazos'))
    expect(router.state.location.key).toBe(key)
  })

  it('from a sibling view the start of the tab takes the place of the entry', async () => {
    const user = userEvent.setup()
    const router = renderAt('/coleccion')
    await bar()
    expect(tab('Cartas')).toHaveAttribute('aria-current', 'page')
    expect(tab('Cartas')).toHaveAttribute('href', '/sobres')
    await user.click(tab('Cartas'))
    expect(where(router)).toBe('/sobres')
    expect(router.state.historyAction).toBe('REPLACE')

    // From a screen that is not a view, it is a step of its own.
    await go(router, '/sobres/promo')
    await title('Sobres de promoción')
    await user.click(tab('Cartas'))
    expect(where(router)).toBe('/sobres')
    expect(router.state.historyAction).toBe('PUSH')
  })

  it('a view is remembered as the place of its tab', async () => {
    const user = userEvent.setup()
    const router = renderAt('/coleccion?vista=edicion')
    await bar()
    await user.click(tab('Hoy'))
    expect(tab('Cartas')).toHaveAttribute('href', '/coleccion?vista=edicion')
    await user.click(tab('Cartas'))
    expect(where(router)).toBe('/coleccion?vista=edicion')
  })

  it('a card is not where Cartas was, and Mazos still returns to the deck it was opened from', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await go(router, '/cartas/B2-113')
    expect(tab('Cartas')).toHaveAttribute('aria-current', 'page')
    await user.click(tab('Hoy'))
    expect(tab('Cartas')).toHaveAttribute('href', '/sobres')
    await user.click(tab('Cartas'))
    expect(where(router)).toBe('/sobres')
    expect(router.state.location.state).toBeNull()
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')
  })

  it('an address no route declares is not remembered', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await go(router, '/mazos/1/x/y')
    await title('No encontrado')
    await user.click(tab('Hoy'))
    expect(tab('Mazos')).toHaveAttribute('href', '/mazos/1')
  })

  it('forgets the orders written in the address: «compartido» and the deck of /partidas?mazo=', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/importar?compartido=1')
    await bar()
    await user.click(tab('Hoy'))
    expect(tab('Mazos')).toHaveAttribute('href', '/mazos/importar')

    await go(router, '/partidas?mazo=3')
    expect(where(router)).toBe('/partidas?mazo=3')
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/importar')
    expect(tab('Hoy')).toHaveAttribute('href', '/partidas')
    await user.click(tab('Hoy'))
    expect(where(router)).toBe('/partidas')
  })

  it('brings back what the screen was opened with (`location.state`)', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos')
    await bar()
    // «Importar como mazo» from a tournament list carries the list in the state.
    await go(router, '/mazos/importar', { state: { text: 'Pikachu ex x2' } })
    await title('Importar mazos')
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/importar')
    expect(router.state.location.state).toEqual({ text: 'Pikachu ex x2', tabReturn: true })

    // The mark is not part of what is remembered: it is put again on each return, never twice.
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(router.state.location.state).toEqual({ text: 'Pikachu ex x2', tabReturn: true })
  })
})

describe('«Volver» on a screen a tab came back to', () => {
  const back = () => screen.getByRole('button', { name: 'Volver' })

  it('goes up to the parent in the entry’s place, not back to the other tab', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')
    somethingBehind()
    await user.click(back())
    expect(where(router)).toBe('/mazos')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('an entry reached from its own parent goes back to it, as the phone’s «atrás»', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    await bar()
    await go(router, '/mazos/1?armados=1')
    somethingBehind()
    await user.click(back())
    expect(where(router)).toBe('/mazos?armados=1')
    expect(router.state.historyAction).toBe('POP')
  })

  it('keeps going up, two levels, and never lands in the other tab', async () => {
    const user = userEvent.setup()
    const router = renderAt('/jugar/situaciones/3-83')
    await title('Situación')
    await user.click(tab('Hoy'))
    await user.click(tab('Pruebas'))
    expect(where(router)).toBe('/jugar/situaciones/3-83')
    await title('Situación')
    somethingBehind()

    await user.click(back())
    expect(await title('Situaciones para resolver')).toBeInTheDocument()
    expect(where(router)).toBe('/jugar/situaciones')
    expect(router.state.historyAction).toBe('REPLACE')

    await user.click(back())
    expect(await title('Jugar contra un bot')).toBeInTheDocument()
    expect(where(router)).toBe('/jugar')
    expect(router.state.historyAction).toBe('REPLACE')
    // A start of the tab: nothing above it.
    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull()
  })

  it('opens the parent with the query string it was last seen with', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    await bar()
    await go(router, '/mazos/1?armados=1')
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1?armados=1')
    somethingBehind()
    await user.click(back())
    expect(where(router)).toBe('/mazos?armados=1')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('a page that replaces its own entry (the deck pager) keeps the mark', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    await go(router, '/mazos/3', { replace: true })
    expect(where(router)).toBe('/mazos/3')
    expect(router.state.location.state).toBeNull()
    somethingBehind()
    await user.click(back())
    expect(where(router)).toBe('/mazos')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  /** The API of the edit page of match 6; `calls` tells when it was saved. */
  function matchSix() {
    const match = {
      id: '6',
      deck: { id: '20', name: 'Mega-Steelix ex', archived: false },
      deckRevision: 3,
      result: 'win',
      opponent: 'Garchomp',
      opponentCards: [],
      wentFirst: null,
      mode: 'casual',
      note: '',
      playedAt: '2026-10-17T21:00:00.000Z',
      source: 'ui',
      createdAt: '2026-10-17T21:00:00.000Z',
      updatedAt: '2026-10-17T21:00:00.000Z',
    }
    return fakeApi({
      'GET /api/matches/6': match,
      'PATCH /api/matches/6': match,
      'GET /api/matches/suggestions': {
        decks: [
          { id: '20', name: 'Mega-Steelix ex', energies: ['metal'], builtInGame: true, lastPlayedAt: null, games: 1 },
        ],
        lastDeckId: '20',
        lastMode: 'casual',
        opponents: [],
      },
    })
  }

  it('the edit page of a match opened cold, saved, leaves for Hoy in its own entry’s place', async () => {
    const { calls } = matchSix()
    const user = userEvent.setup()
    const router = renderAt('/partidas/6')
    // Nothing behind, and no mark: only the page's own `replace` keeps «atrás» from returning to the form.
    expect(window.history.length).toBe(1)
    await user.click(await screen.findByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    await waitFor(() => expect(where(router)).toBe('/partidas'))
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('the edit page of a match reached by a tab’s memory, saved, lands on Hoy', async () => {
    const { calls } = matchSix()
    const user = userEvent.setup()
    const router = renderAt('/partidas/6')
    await screen.findByRole('button', { name: /Guardar/ })
    await user.click(tab('Mazos'))
    await user.click(tab('Hoy'))
    expect(where(router)).toBe('/partidas/6')
    somethingBehind()

    await user.click(await screen.findByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    await waitFor(() => expect(where(router)).toBe('/partidas'))
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('the scroll of a place a tab comes back to', () => {
  let y = 0
  let height = 5000
  const scrollBy = (value: number) => {
    y = value
    fireEvent.scroll(window)
  }
  /** Lets the frames a waiting restore tries again on go by. */
  const frames = (count = 3) =>
    new Promise<void>((resolve) => {
      const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
      step(count)
    })

  beforeEach(() => {
    y = 0
    // jsdom has no layout: a page tall enough for any scroll the tests ask for, unless a test shortens it.
    height = 5000
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'scrollY')
    Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  })

  it('a deep page left at 350 is put back at 350', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    const scrollTo = vi.spyOn(window, 'scrollTo')
    scrollBy(350)
    // The router opens the next screen at the top.
    y = 0
    await user.click(tab('Hoy'))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0)

    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 350)
  })

  it('a start left at 420 and opened again at the top is not scrolled back', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos')
    await bar()
    scrollBy(420)
    y = 0
    await go(router, '/mazos/1')
    // The lit tab leads to its start, which opens at the top: no scroll event says so.
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos')
    await user.click(tab('Hoy'))

    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos')
    expect(scrollTo.mock.calls).toEqual([[0, 0]])
  })

  it('«Volver» going up puts the parent back where it was', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos')
    await bar()
    scrollBy(420)
    y = 0
    await go(router, '/mazos/1')
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')

    const scrollTo = vi.spyOn(window, 'scrollTo')
    somethingBehind()
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/mazos')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 420)
  })

  it('the scroll of a place with a query string comes back too', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos?armados=1')
    await bar()
    scrollBy(420)
    y = 0
    await go(router, '/mazos/1?armados=1')
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1?armados=1')

    const scrollTo = vi.spyOn(window, 'scrollTo')
    somethingBehind()
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(where(router)).toBe('/mazos?armados=1')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 420)
  })

  it('a place whose page is not tall enough yet is put back as soon as it grows', async () => {
    height = 100
    const user = userEvent.setup()
    renderAt('/mazos/1')
    await bar()
    scrollBy(350)
    y = 0
    await user.click(tab('Hoy'))
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(tab('Mazos'))
    expect(scrollTo.mock.calls).toEqual([[0, 0]])
    height = 5000
    await frames()
    expect(scrollTo).toHaveBeenLastCalledWith(0, 350)
  })

  it.each(['touchStart', 'wheel', 'keyDown', 'pointerDown'] as const)(
    'a place that waits for its page to grow is let go as soon as the user touches the page (%s)',
    async (touch) => {
      height = 100
      const user = userEvent.setup()
      const router = renderAt('/mazos/1')
      await bar()
      scrollBy(350)
      y = 0
      await user.click(tab('Hoy'))
      const scrollTo = vi.spyOn(window, 'scrollTo')
      await user.click(tab('Mazos'))
      expect(where(router)).toBe('/mazos/1')
      fireEvent[touch](window)
      // The page grows right after: a wait still running would now jump to 350, under the finger.
      height = 5000
      await frames()
      expect(scrollTo.mock.calls.filter(([, top]) => top === 350)).toEqual([])
    },
  )

  it('and is let go after 600 ms: a page that grows later stays where it is', async () => {
    height = 100
    const user = userEvent.setup()
    renderAt('/mazos/1')
    await bar()
    scrollBy(350)
    y = 0
    await user.click(tab('Hoy'))
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(tab('Mazos'))
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 700)
    await frames()
    height = 5000
    await frames()
    expect(scrollTo.mock.calls.filter(([, top]) => top === 350)).toEqual([])
  })

  it('what scrolls while a place is being put back is not taken for the user’s', async () => {
    // A page that is not tall enough yet: the scroll waits, frame by frame.
    height = 100
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await bar()
    scrollBy(350)
    y = 0
    await user.click(tab('Hoy'))
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(tab('Mazos'))
    expect(where(router)).toBe('/mazos/1')
    expect(scrollTo.mock.calls).toEqual([[0, 0]])
    // The browser moves the page as it grows: not a place the user chose.
    scrollBy(7)

    // The user touches the page: the wait is over, and from then on the scroll is theirs.
    fireEvent.pointerDown(window)
    y = 0
    await user.click(tab('Hoy'))
    height = 5000
    await user.click(tab('Mazos'))
    expect(scrollTo.mock.calls.filter(([, top]) => top !== 0)).toEqual([])

    scrollBy(40)
    y = 0
    await user.click(tab('Hoy'))
    await user.click(tab('Mazos'))
    expect(scrollTo).toHaveBeenLastCalledWith(0, 40)
  })

  it('a tap that opens the tab in another window (Ctrl) asks for nothing here', async () => {
    // jsdom would try to load the link; the tap itself still reaches the tab.
    const noLoad = (event: Event) => event.preventDefault()
    window.addEventListener('click', noLoad)
    const router = renderAt('/partidas')
    await bar()
    scrollBy(300)
    y = 0
    await go(router, '/mazos')
    const { key } = router.state.location
    fireEvent.click(tab('Hoy'), { ctrlKey: true })
    window.removeEventListener('click', noLoad)
    expect(router.state.location.key).toBe(key)

    // A link of the page then leads to Hoy: it opens at the top, as any new screen.
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await go(router, '/partidas')
    expect(scrollTo.mock.calls).toEqual([[0, 0]])
  })
})

describe('the search, from the bar', () => {
  it.each(['/mas', '/partidas/historial'])(
    'at %s «/» opens it and Escape gives the focus to the magnifier',
    async (path) => {
      const user = userEvent.setup()
      renderAt(path)
      await bar()
      expect(screen.queryByRole('searchbox')).toBeNull()
      await user.keyboard('/')
      expect(await screen.findByRole('searchbox', { name: 'Buscar en toda la app' })).toHaveFocus()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
      expect(screen.getByRole('button', { name: 'Buscar' })).toHaveFocus()
    },
  )
})
