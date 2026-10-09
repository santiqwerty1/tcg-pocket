import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const FAILED = {
  at: '2026-10-01T07:30:00.000Z',
  ok: false,
  blobId: '12',
  sizeBytes: 68_711,
  counts: { decks: 40, matches: 31, stock: 2083 },
  differences: ['matches (31 → 30)'],
  ms: 2100,
  error: null,
}

describe('prueba del backup (Fase 35)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname === '/api/backup/drill' && (init?.method ?? 'GET') === 'POST') {
          return json({ drill: { ...FAILED, at: '2026-10-09T05:00:00.000Z', ok: true, differences: [], ms: 1717 } })
        }
        if (url.pathname === '/api/backup/drill') return json({ drill: FAILED })
        if (url.pathname === '/api/backup/blobs') return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the last result and runs it again', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/backup'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Al restaurarla cambió: matches (31 → 30).')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Probar ahora/ }))
    expect(
      await screen.findByText(
        'Copia de 67,1 KB: 40 mazos, 31 partidas y 2.083 cartas de la colección volvieron iguales (1,7 s).',
      ),
    ).toBeInTheDocument()
  })
})
