import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const FAILED = {
  at: '2026-10-09T07:00:05.000Z',
  ok: false,
  key: null,
  error: 'PUT del bucket: 403 AccessDenied',
  kept: null,
}

function stub(enabled: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/backup/offsite' && (init?.method ?? 'GET') === 'POST') {
        return json({
          result: { at: '2026-10-09T18:00:00.000Z', ok: true, key: 'backups/x.json.gz', error: null, kept: 3 },
        })
      }
      if (url.pathname === '/api/backup/offsite') return json({ enabled, last: enabled ? FAILED : null })
      if (url.pathname === '/api/backup/drill') return json({ drill: null })
      if (url.pathname === '/api/backup/blobs') return json({ items: [] })
      return json({ error: { code: 'not_found', message: 'no' } }, 404)
    }),
  )
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/mas/backup'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('copia en la nube (Fase 39)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('not set up yet: says so, without the button', async () => {
    stub(false)
    renderPage()
    expect(await screen.findByText(/Todavía no está configurada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Subir ahora/ })).toBeNull()
  })

  it('shows the last upload (a failure) and uploads again', async () => {
    stub(true)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('PUT del bucket: 403 AccessDenied')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Subir ahora/ }))
    expect(await screen.findByText('3 copias en la nube.')).toBeInTheDocument()
  })
})
