import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { destinationFor, NAV_DESTINATIONS } from './BottomNav'
import { Providers } from './Providers'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

describe('destinationFor', () => {
  it('maps card and group pages to Colección', () => {
    expect(destinationFor('/cartas/B2-113')?.label).toBe('Colección')
    expect(destinationFor('/grupos/B3b-64')?.label).toBe('Colección')
    expect(destinationFor('/mazos/abc/editar')?.label).toBe('Mazos')
    expect(destinationFor('/mas/tokens')?.label).toBe('Más')
    // Fase 41: the screens opened from «Más» keep it lit.
    for (const path of ['/torneos/semana', '/simulacion/3', '/laboratorio', '/jugar/12', '/eventos/1']) {
      expect(destinationFor(path)?.label).toBe('Más')
    }
    expect(destinationFor('/nada')).toBeUndefined()
  })
})

describe('bottom navigation', () => {
  beforeEach(() => {
    // Pages fetch on mount; the API is not there in tests and the error state is fine.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: { code: 'offline', message: 'sin API' } }), { status: 503 }),
      ),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has the five destinations in order', () => {
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual(['Hoy', 'Mazos', 'Colección', 'Sobres', 'Más'])
  })

  it('redirects / to Hoy (the quick-entry sheet, Fase 26) and marks the active tab', async () => {
    const router = renderAt('/')
    expect(router.state.location.pathname).toBe('/partidas')
    const nav = await screen.findByRole('navigation', { name: 'Secciones' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hoy' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hoy')
  })

  it('navigates between destinations and updates the header title', async () => {
    const user = userEvent.setup()
    const router = renderAt('/partidas')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hoy')
    expect(screen.getByRole('heading', { name: 'Nueva partida' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Mazos' }))
    expect(router.state.location.pathname).toBe('/mazos')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mazos')
    expect(screen.getByRole('link', { name: 'Mazos' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'Más' }))
    expect(router.state.location.pathname).toBe('/mas')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Más')
    expect(screen.getByRole('link', { name: /Tokens de API/ })).toHaveAttribute('href', '/mas/tokens')
  })
})
