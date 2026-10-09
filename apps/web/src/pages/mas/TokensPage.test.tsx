import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('tokens de API: el permiso del puente del chat (D-021)', () => {
  const created: unknown[] = []
  beforeEach(() => {
    created.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname === '/api/tokens' && init?.method === 'POST') {
          created.push(JSON.parse(String(init.body)))
          return json({ id: '5', token: 'tcg_mcp_secreto' }, 201)
        }
        if (url.pathname === '/api/tokens' || url.pathname === '/api/mcp-audit') return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts without chat:relay, and chat:relay goes alone', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/tokens'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    const relay = await screen.findByRole('checkbox', { name: /chat:relay/ })
    const read = screen.getByRole('checkbox', { name: /mcp:read/ })
    const write = screen.getByRole('checkbox', { name: /mcp:write/ })
    expect(read).toBeChecked()
    expect(write).toBeChecked()
    expect(relay).not.toBeChecked()

    await user.click(relay)
    expect(relay).toBeChecked()
    expect(read).not.toBeChecked()
    expect(write).not.toBeChecked()
    // Checking another one takes chat:relay out.
    await user.click(read)
    expect(read).toBeChecked()
    expect(relay).not.toBeChecked()

    await user.click(relay)
    await user.type(screen.getByPlaceholderText('Claude desde el celu'), 'puente')
    await user.click(screen.getByRole('button', { name: 'Crear token' }))
    expect(await screen.findByText(/tcg_mcp_secreto/)).toBeInTheDocument()
    expect(created).toEqual([{ name: 'puente', kind: 'mcp', scopes: ['chat:relay'] }])
  })
})
