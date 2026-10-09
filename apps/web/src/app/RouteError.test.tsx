import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from './Providers'
import { isChunkLoadError, RouteError } from './RouteError'
import { routes } from './routes'

describe('isChunkLoadError', () => {
  it('tells a missing chunk from any other error', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('No se pudo leer el mazo'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('route errors', () => {
  it('shows the error of a screen in Spanish, with a way out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never {
      throw new Error('se rompió')
    }
    const router = createMemoryRouter(
      [{ path: '/', errorElement: <RouteError />, children: [{ index: true, Component: Broken }] }],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('Algo falló en esta pantalla')).toBeInTheDocument()
    expect(screen.getByText('se rompió')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Hoy' })).toHaveAttribute('href', '/partidas')
  })

  it('loads a lazy screen inside the shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: { code: 'offline', message: 'sin API' } }), { status: 503 }),
      ),
    )
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/acerca'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Acerca de' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
