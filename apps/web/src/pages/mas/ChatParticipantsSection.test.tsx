import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('participantes del chat entre sesiones (D-021)', () => {
  const calls: string[] = []
  let list: { name: string; channel: string; createdAt: string }[] = []
  beforeEach(() => {
    calls.length = 0
    list = [
      { name: 'Santi', channel: 'owner', createdAt: '2026-10-09T18:00:00.000Z' },
      { name: 'Nube-2', channel: 'connector', createdAt: '2026-10-09T18:00:00.000Z' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/api/chat/participants' && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as { name: string; channel: string }
          calls.push(`PUT ${body.name} ${body.channel}`)
          const row = { ...body, createdAt: '2026-10-09T19:00:00.000Z' }
          list = [...list.filter((item) => item.name.toLowerCase() !== body.name.toLowerCase()), row]
          return json(row)
        }
        if (url.pathname.startsWith('/api/chat/participants/') && method === 'DELETE') {
          const name = decodeURIComponent(url.pathname.split('/').pop() ?? '')
          calls.push(`DELETE ${name}`)
          list = list.filter((item) => item.name !== name)
          return new Response(null, { status: 204 })
        }
        if (url.pathname === '/api/chat/participants') return json({ items: list })
        if (url.pathname === '/api/tokens' || url.pathname === '/api/mcp-audit') return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists who takes part, adds a session and takes one out', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/tokens'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Nube-2')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Canal de Santi' })).toHaveTextContent('Santi (app o puente)')

    await user.type(screen.getByRole('textbox', { name: 'Nombre de la sesión' }), 'Nube-3')
    await user.click(screen.getByRole('button', { name: 'Sumar' }))
    expect(await screen.findByText('Nube-3')).toBeInTheDocument()
    expect(calls).toContain('PUT Nube-3 connector')

    const row = screen.getByText('Nube-2').closest('li')
    if (!row) throw new Error('no row')
    await user.click(within(row).getByRole('button', { name: 'Quitar' }))
    expect(calls).toContain('DELETE Nube-2')
  })
})
