// What a page declares of the fixed row's action (`usePageAction`), inside the real shell: the routes of `frame.ts`
// with pages of the test's own, which ask the API for nothing, so what is seen is the shell's doing.
import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, type RouteObject, RouterProvider, useParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeLook } from '@/lib/look'
import { fakeApi } from '@/test/fakeApi'
import { AppShell } from './AppShell'
import { Providers } from './Providers'
import { type PageActionState, usePageAction, usePageActionHost } from './pageAction'

type Router = ReturnType<typeof createMemoryRouter>

const row = () => document.querySelector('[data-slot="fixed-row"]')
const zone = () => document.querySelector('[data-slot="bottom-zone"]')
const action = () => row()?.querySelector<HTMLElement>('[data-slot="row-action"]') ?? null
const WITH_ROW = 'pb-[calc(var(--bar-h)+var(--row-h)+54px+env(safe-area-inset-bottom))]'
const WITHOUT_ROW = 'pb-[calc(var(--bar-h)+26px+env(safe-area-inset-bottom))]'
const go = (router: Router, to: string) => act(() => router.navigate(to))

/** A page that declares what it is given, and says it is there. */
function Declares({ state, text = 'La página' }: { state: PageActionState | null; text?: string }) {
  usePageAction(state)
  return <p>{text}</p>
}

/** A deck page that hides the action of the first deck only, without being mounted again between decks. */
function Deck() {
  const { deckId } = useParams()
  usePageAction(deckId === '1' ? { hidden: true } : null)
  return <p>Mazo {deckId}</p>
}

/** A page with a handler that changes on every render, and a counter that renders it again. */
function Counting({ seen }: { seen: (count: number) => void }) {
  const [count, setCount] = useState(0)
  usePageAction({ onSelect: () => seen(count) })
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Sumar
    </button>
  )
}

function shell(children: RouteObject[]): RouteObject[] {
  return [{ path: '/', element: <AppShell />, children }]
}

function renderAt(path: string, table: RouteObject[]): Router {
  const router = createMemoryRouter(table, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

beforeEach(() => {
  // The way to the Menú asks for the alerts: an error is fine.
  fakeApi({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('what a page declares of the action of its route', () => {
  it('a button without a handler is drawn and says it is not available; with one, it calls the newest one', async () => {
    const seen = vi.fn()
    const router = renderAt(
      '/coleccion',
      shell([
        { path: 'coleccion', element: <Declares state={null} />, handle: { title: 'Colección' } },
        { path: 'simulacion', element: <Counting seen={seen} />, handle: { title: 'Simulación' } },
      ]),
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(sync)
    expect(seen).not.toHaveBeenCalled()
    // A route with a link: its handler is not a link's business, the address is.
    await go(router, '/simulacion')
    const plus = screen.getByRole('link', { name: 'Nueva simulación' })
    expect(plus).toHaveAttribute('href', '/simulacion/nueva')
    expect(plus).not.toHaveAttribute('aria-disabled')
  })

  it('a page that declares what it knows but not yet a handler leaves the button unavailable', () => {
    // A label from its data before its handler exists (as «Actualizar el mazo #N» of phase 4 will): drawn, and idle.
    renderAt(
      '/coleccion',
      shell([
        {
          path: 'coleccion',
          element: <Declares state={{ label: 'Sincronizar ya', ariaLabel: 'Sincronizar ya la colección' }} />,
          handle: { title: 'Colección' },
        },
      ]),
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar ya la colección' })
    expect(sync).toHaveTextContent(/^Sincronizar ya$/)
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    expect(sync).toHaveClass('opacity-50')
    expect(sync).not.toHaveAttribute('aria-busy')
  })

  it('a button takes the page’s handler, and the newest one after the page renders again', () => {
    const seen = vi.fn()
    renderAt(
      '/coleccion',
      shell([{ path: 'coleccion', element: <Counting seen={seen} />, handle: { title: 'Colección' } }]),
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).not.toHaveAttribute('aria-disabled')
    fireEvent.click(sync)
    expect(seen).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: 'Sumar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sumar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar la colección' }))
    expect(seen).toHaveBeenLastCalledWith(2)
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('pending: busy, its spinner, what the page says spoken, and taps ignored', () => {
    const select = vi.fn()
    renderAt(
      '/coleccion',
      shell([
        {
          path: 'coleccion',
          element: <Declares state={{ onSelect: select, pending: true, pendingLabel: 'Consultando el tracker…' }} />,
          handle: { title: 'Colección' },
        },
      ]),
    )
    const sync = screen.getByRole('button', { name: 'Sincronizar la colección' })
    expect(sync).toHaveAttribute('aria-busy', 'true')
    expect(sync.querySelector('svg')).toHaveClass('animate-spin')
    expect(row()?.querySelector('[role="status"]')).toHaveTextContent('Consultando el tracker…')
    fireEvent.click(sync)
    expect(select).not.toHaveBeenCalled()
  })

  it('the label and the name the page gives win over the route’s', () => {
    renderAt(
      '/mazos/7',
      shell([
        {
          path: 'mazos/:deckId',
          element: <Declares state={{ label: 'Registrar con el #7', ariaLabel: 'Registrar con el #7 de la lista' }} />,
          handle: { title: 'Mazo', back: '/mazos' },
        },
      ]),
    )
    const link = screen.getByRole('link', { name: 'Registrar con el #7 de la lista' })
    expect(link).toHaveTextContent(/^Registrar con el #7$/)
    expect(link).toHaveAttribute('href', '/partidas?mazo=7')
  })

  it('hidden: no action, no row, and no room kept for one; the room comes back with the action', async () => {
    const router = renderAt(
      '/mazos/1',
      shell([{ path: 'mazos/:deckId', element: <Deck />, handle: { title: 'Mazo', back: '/mazos' } }]),
    )
    expect(screen.getByText('Mazo 1')).toBeInTheDocument()
    expect(row()).toBeNull()
    expect(zone()).not.toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
    // The same page, on another deck: the declaration follows the path.
    await go(router, '/mazos/2')
    expect(screen.getByText('Mazo 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrar partida con este mazo' })).toHaveAttribute(
      'href',
      '/partidas?mazo=2',
    )
    expect(zone()).toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
    await go(router, '/mazos/1')
    expect(row()).toBeNull()
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
  })

  it('the same declaration, by a page that stays mounted from one path to the next, follows it there', async () => {
    const router = renderAt(
      '/mazos/1',
      shell([
        {
          path: 'mazos/:deckId',
          element: <Declares state={{ hidden: true }} />,
          handle: { title: 'Mazo', back: '/mazos' },
        },
      ]),
    )
    expect(row()).toBeNull()
    await go(router, '/mazos/2')
    expect(screen.getByText('La página')).toBeInTheDocument()
    expect(row()).toBeNull()
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
  })

  it('hidden beside views: the views stay in the row, and so does its room', () => {
    renderAt(
      '/coleccion',
      shell([{ path: 'coleccion', element: <Declares state={{ hidden: true }} />, handle: { title: 'Colección' } }]),
    )
    expect(row()).not.toBeNull()
    expect(action()).toBeNull()
    expect(screen.getByRole('tablist', { name: 'Vistas de Cartas' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
    // With the views «arriba» nothing is left for the row.
    act(() => writeLook({ views: 'top' }))
    expect(row()).toBeNull()
    expect(zone()).not.toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
  })

  it('what a page declared leaves with it: the next screen has its route’s action, or none', async () => {
    const router = renderAt(
      '/mazos/3',
      shell([
        {
          path: 'mazos/:deckId',
          element: <Declares state={{ label: 'Lo del mazo', disabled: true }} />,
          handle: { title: 'Mazo', back: '/mazos' },
        },
        { path: 'mazos', element: <Declares state={null} text="La lista" />, handle: { title: 'Mazos' } },
        { path: 'partidas', element: <p>Hoy</p>, handle: { title: 'Hoy' } },
        { path: 'simulacion', element: <p>Simulaciones</p>, handle: { title: 'Simulación' } },
      ]),
    )
    expect(action()).toHaveTextContent(/^Lo del mazo$/)
    expect(action()).toHaveAttribute('aria-disabled', 'true')
    await go(router, '/mazos')
    expect(screen.getByText('La lista')).toBeInTheDocument()
    expect(action()).toHaveTextContent(/^Nuevo mazo$/)
    expect(action()).not.toHaveAttribute('aria-disabled')
    await go(router, '/partidas')
    expect(row()).toBeNull()
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
    await go(router, '/simulacion')
    expect(screen.getByRole('link', { name: 'Nueva simulación' })).not.toHaveAttribute('aria-disabled')
    // Back to the deck: the page declares again, as it did.
    await go(router, '/mazos/3')
    expect(action()).toHaveTextContent(/^Lo del mazo$/)
  })

  it('a part of a page that declared and goes away takes its declaration with it, on the same screen', () => {
    function Part() {
      const [shown, setShown] = useState(true)
      return (
        <>
          {shown ? <Declares state={{ hidden: true }} text="La parte" /> : null}
          <button type="button" onClick={() => setShown(false)}>
            Quitar la parte
          </button>
        </>
      )
    }
    renderAt(
      '/mazos/5',
      shell([{ path: 'mazos/:deckId', element: <Part />, handle: { title: 'Mazo', back: '/mazos' } }]),
    )
    expect(row()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar la parte' }))
    expect(screen.queryByText('La parte')).toBeNull()
    expect(screen.getByRole('link', { name: 'Registrar partida con este mazo' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
  })

  it('a page on a route without an action declares in vain: nothing is drawn', () => {
    renderAt(
      '/partidas',
      shell([
        {
          path: 'partidas',
          element: <Declares state={{ label: 'Algo', onSelect: () => {} }} />,
          handle: { title: 'Hoy' },
        },
      ]),
    )
    expect(row()).toBeNull()
    expect(screen.queryByText('Algo')).toBeNull()
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
  })

  it('outside a shell, a page that declares is drawn as always', () => {
    const router = createMemoryRouter([{ path: '/coleccion', element: <Declares state={{ hidden: true }} /> }], {
      initialEntries: ['/coleccion'],
    })
    render(<RouterProvider router={router} />)
    expect(screen.getByText('La página')).toBeInTheDocument()
  })
})

describe('before the screen is painted', () => {
  // `act` runs the passive effects too, so inside it a layout effect and a passive one look the same. Here the shell
  // renders as in a browser and goes from one screen to the next, and the row is looked at after every task that
  // changed the page: the moments a browser could paint it. What the page declares is in the row from the first.
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

  async function paintsOf(to: string, table: RouteObject[], what: () => string): Promise<string[]> {
    const before = environment.IS_REACT_ACT_ENVIRONMENT
    environment.IS_REACT_ACT_ENVIRONMENT = false
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(what()))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      const router = createMemoryRouter(
        shell([...table, { path: 'sobres', element: <p>La de antes</p>, handle: { title: 'Sobres' } }]),
        { initialEntries: ['/sobres'] },
      )
      root.render(
        <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RouterProvider router={router} />
        </Providers>,
      )
      await waitFor(() => expect(screen.getByText('La de antes')).toBeInTheDocument())
      observer.observe(container, { subtree: true, childList: true, attributes: true, characterData: true })
      void router.navigate(to)
      await waitFor(() => expect(screen.getByText('La página')).toBeInTheDocument())
      // Whatever was still to run after the page came (a passive effect, the update it made) has run.
      await new Promise((resolve) => setTimeout(resolve, 20))
      seen.push(what())
      return seen
    } finally {
      observer.disconnect()
      root.unmount()
      container.remove()
      environment.IS_REACT_ACT_ENVIRONMENT = before
    }
  }

  it('a button the page gives a handler is never drawn unavailable first', async () => {
    const seen = await paintsOf(
      '/coleccion',
      [{ path: 'coleccion', element: <Declares state={{ onSelect: () => {} }} />, handle: { title: 'Colección' } }],
      () => {
        const drawn = action()
        return drawn === null ? 'no action' : drawn.getAttribute('aria-disabled') === 'true' ? 'unavailable' : 'ready'
      },
    )
    expect(seen.at(-1)).toBe('ready')
    expect(seen).not.toContain('unavailable')
  })

  it('an action the page hides is never drawn first, nor the room for it kept', async () => {
    const seen = await paintsOf(
      '/mazos/1',
      [{ path: 'mazos/:deckId', element: <Declares state={{ hidden: true }} />, handle: { title: 'Mazo' } }],
      () => (action() ? 'action' : 'none'),
    )
    expect(seen.at(-1)).toBe('none')
    expect(seen).not.toContain('action')
  })
})

describe('the shell’s side', () => {
  /** The host as the shell holds it, at a path the test moves. */
  function Host({ path, expose }: { path: string; expose: (host: ReturnType<typeof usePageActionHost>) => void }) {
    const host = usePageActionHost(path)
    expose(host)
    return <output aria-label="Declarado">{host.declared?.label ?? 'nada'}</output>
  }

  it('gives a declaration back only on its own path, and only its owner takes it away', () => {
    let host: ReturnType<typeof usePageActionHost> | null = null
    const expose = (value: ReturnType<typeof usePageActionHost>) => {
      host = value
    }
    const view = render(<Host path="/a" expose={expose} />)
    const said = () => screen.getByRole('status', { name: 'Declarado' })
    expect(said()).toHaveTextContent('nada')
    act(() => host?.declare('una', { path: '/a', state: { label: 'De la una' } }))
    expect(said()).toHaveTextContent('De la una')
    // On another path it is not there, even before its page has taken it away.
    view.rerender(<Host path="/b" expose={expose} />)
    expect(said()).toHaveTextContent('nada')
    view.rerender(<Host path="/a" expose={expose} />)
    expect(said()).toHaveTextContent('De la una')
    // A page that leaves after the next one declared does not take the new one away.
    act(() => host?.declare('otra', { path: '/a', state: { label: 'De la otra' } }))
    act(() => host?.declare('una', null))
    expect(said()).toHaveTextContent('De la otra')
    act(() => host?.declare('otra', null))
    expect(said()).toHaveTextContent('nada')
  })
})
