import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('la mudanza del chat al hub (D-030, T1b)', () => {
  const calls: string[] = []
  let moved: Record<string, { url: string; since: string }> = {}
  let forwarding = true
  beforeEach(() => {
    calls.length = 0
    moved = {}
    forwarding = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (url.pathname.startsWith('/api/chat/moved/') && method === 'PUT') {
          const room = url.pathname.split('/').pop() ?? ''
          const body = JSON.parse(String(init?.body)) as { url: string }
          calls.push(`PUT ${room} ${body.url}`)
          moved[room] = { url: body.url, since: '2026-10-18T09:00:00.000Z' }
          return json({ room, ...moved[room] })
        }
        if (url.pathname.startsWith('/api/chat/moved/') && method === 'DELETE') {
          const room = url.pathname.split('/').pop() ?? ''
          calls.push(`DELETE ${room}`)
          delete moved[room]
          return new Response(null, { status: 204 })
        }
        if (url.pathname === '/api/chat/moved') {
          return json({
            items: [
              { room: 'tcg', label: 'tcg-pocket' },
              { room: 'posta', label: 'Posta' },
            ].map((item) => ({ ...item, url: moved[item.room]?.url ?? null, since: moved[item.room]?.since ?? null })),
            forwarding,
          })
        }
        if (['/api/tokens', '/api/mcp-audit', '/api/chat/participants'].includes(url.pathname))
          return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const page = () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/tokens'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  it('marks a room as moved only after a confirmation that says what is cut, and brings it back the same way', async () => {
    const user = userEvent.setup()
    page()
    const input = await screen.findByRole('textbox', { name: 'URL del hub para «posta»' })
    const row = input.closest('li')
    if (!row) throw new Error('no row')
    expect(within(row).getByText('En tcg-pocket')).toBeInTheDocument()
    // Without a URL there is nothing to mark.
    expect(within(row).getByRole('button', { name: 'Marcar como mudada' })).toBeDisabled()
    await user.type(input, 'https://hub.example.dev')
    await user.click(within(row).getByRole('button', { name: 'Marcar como mudada' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('el puente recibe 410 y se frena')
    expect(calls).toEqual([])
    // Cancelling changes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(calls).toEqual([])
    await user.click(within(row).getByRole('button', { name: 'Marcar como mudada' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Marcar como mudada' }))
    expect(await screen.findByText(/Mudada a https:\/\/hub\.example\.dev/)).toBeInTheDocument()
    expect(calls).toEqual(['PUT posta https://hub.example.dev'])

    await user.click(screen.getByRole('button', { name: 'Volver a tcg-pocket' }))
    const back = await screen.findByRole('dialog')
    expect(back).toHaveTextContent('después de traer lo suyo con chat-import')
    await user.click(within(back).getByRole('button', { name: 'Volver a tcg-pocket' }))
    await vi.waitFor(() => expect(calls).toContain('DELETE posta'))
  })

  it('says when the old connector cannot be forwarded (no HUB_MCP_TOKEN)', async () => {
    forwarding = false
    page()
    expect(await screen.findByText(/Falta HUB_MCP_TOKEN/)).toBeInTheDocument()
  })
})
