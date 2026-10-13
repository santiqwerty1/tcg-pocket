import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Radix's Select asks for pointer capture, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

describe('participantes del chat entre sesiones (D-021)', () => {
  const calls: string[] = []
  let list: { name: string; channel: string; rooms: string[]; createdAt: string }[] = []
  beforeEach(() => {
    calls.length = 0
    list = [
      { name: 'Santi', channel: 'owner', rooms: ['tcg', 'posta'], createdAt: '2026-10-09T18:00:00.000Z' },
      { name: 'Nube-2', channel: 'connector', rooms: ['tcg'], createdAt: '2026-10-09T18:00:00.000Z' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/api/chat/participants' && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as { name: string; channel: string; rooms?: string[] }
          calls.push(`PUT ${body.name} ${body.channel}${body.rooms ? ` ${body.rooms.join(',')}` : ''}`)
          const before = list.find((item) => item.name.toLowerCase() === body.name.toLowerCase())
          const row = { ...body, rooms: body.rooms ?? before?.rooms ?? ['tcg'], createdAt: '2026-10-09T19:00:00.000Z' }
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
    // Santi is always there and always himself: no channel change, no «Quitar».
    const santi = screen.getByRole('combobox', { name: 'Canal de Santi' })
    expect(santi).toHaveTextContent('Santi (app o puente)')
    expect(santi).toBeDisabled()
    const santiRow = screen.getByText('Santi').closest('li')
    if (!santiRow) throw new Error('no row')
    expect(within(santiRow).getByRole('button', { name: 'Quitar' })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: 'Nombre de la sesión' }), 'Nube-3')
    await user.click(screen.getByRole('button', { name: 'Sumar' }))
    expect(await screen.findByText('Nube-3')).toBeInTheDocument()
    expect(calls).toContain('PUT Nube-3 connector tcg')

    const row = screen.getByText('Nube-2').closest('li')
    if (!row) throw new Error('no row')
    await user.click(within(row).getByRole('button', { name: 'Quitar' }))
    expect(calls).toContain('DELETE Nube-2')
  })

  it('rooms (13/10/2026): each session in one or more, the main one first; Santi in all of them', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/tokens'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Nube-2')).toBeInTheDocument()
    // Santi: both rooms, fixed.
    for (const room of ['tcg-pocket', 'Posta']) {
      const box = screen.getByRole('checkbox', { name: `Santi en la sala ${room}` })
      expect(box).toBeChecked()
      expect(box).toBeDisabled()
    }
    // Its only room cannot be taken away; another one is added after it (the main one stays).
    expect(screen.getByRole('checkbox', { name: 'Nube-2 en la sala tcg-pocket' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Nube-2 en la sala Posta' }))
    expect(calls).toContain('PUT Nube-2 connector tcg,posta')
    // With two rooms it says which one is the main one, and it can change.
    const main = await screen.findByRole('combobox', { name: 'Sala principal de Nube-2' })
    expect(main).toHaveTextContent('Principal: tcg-pocket')
    await user.click(main)
    await user.click(await screen.findByRole('option', { name: 'Principal: Posta' }))
    expect(calls).toContain('PUT Nube-2 connector posta,tcg')
    // A new session goes in the room chosen.
    await user.type(screen.getByRole('textbox', { name: 'Nombre de la sesión' }), 'Codex-P')
    await user.click(screen.getByRole('combobox', { name: 'Sala de la sesión nueva' }))
    await user.click(await screen.findByRole('option', { name: 'Sala: Posta' }))
    await user.click(screen.getByRole('button', { name: 'Sumar' }))
    expect(await screen.findByText('Codex-P')).toBeInTheDocument()
    expect(calls).toContain('PUT Codex-P connector posta')
  })
})
