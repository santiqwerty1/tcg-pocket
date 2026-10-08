import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import deckDetail from '@/api/__fixtures__/deck-detail.json'
import decksList from '@/api/__fixtures__/decks-list.json'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const base = decksList.items[0]
const NAMES: Record<string, string> = { '1': 'Gardevoir ex', '2': 'Hoopa ex', '3': 'Zoroark ex', '4': 'Eevee ex' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('deck list «armado» checkbox and ← → between decks (pedido del 8/10/2026)', () => {
  let built: Record<string, boolean>
  let patches: { id: string; body: unknown }[]

  const summary = (id: string) => ({ ...base, id, name: NAMES[id], builtInGame: built[id] ?? false, tags: [] })

  beforeEach(() => {
    built = { '1': true, '2': false, '3': true, '4': true }
    patches = []
    vi.stubGlobal('scrollTo', vi.fn())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/api/decks' && method === 'GET') return json({ items: Object.keys(NAMES).map(summary) })
        const match = /^\/api\/decks\/(\d+)$/.exec(url.pathname)
        if (match?.[1]) {
          const id = match[1]
          if (method === 'PATCH') {
            const body = JSON.parse(String(init?.body)) as { builtInGame?: boolean }
            patches.push({ id, body })
            if (body.builtInGame !== undefined) built[id] = body.builtInGame
          }
          return json({ ...deckDetail, ...summary(id) })
        }
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  const where = (router: ReturnType<typeof renderAt>) => router.state.location.pathname + router.state.location.search

  it('marks and unmarks a deck as built from the list', async () => {
    const user = userEvent.setup()
    renderAt('/mazos')
    const hoopa = await screen.findByRole('checkbox', { name: 'Armado en el juego: Hoopa ex' })
    expect(hoopa).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Armado en el juego: Gardevoir ex' })).toBeChecked()

    await user.click(hoopa)
    await waitFor(() => expect(patches).toEqual([{ id: '2', body: { builtInGame: true } }]))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Armado en el juego: Hoopa ex' })).toBeChecked())

    // The whole cell is the target, not only the small box.
    await user.click(
      within(screen.getByRole('checkbox', { name: /Gardevoir ex/ }).closest('label') as HTMLElement).getByText(
        'armado',
      ),
    )
    await waitFor(() => expect(patches.at(-1)).toEqual({ id: '1', body: { builtInGame: false } }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Gardevoir ex/ })).not.toBeChecked())
  })

  it('keeps the filters in the URL and in the links to each deck', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos')
    await screen.findByRole('checkbox', { name: /Hoopa ex/ })
    await user.click(screen.getByRole('switch', { name: 'Solo en el juego' }))
    expect(where(router)).toBe('/mazos?armados=1')
    await waitFor(() => expect(screen.queryByText('Hoopa ex')).toBeNull())
    expect(screen.getByRole('link', { name: /Zoroark ex/ })).toHaveAttribute('href', '/mazos/3?armados=1')
  })

  it('steps through the list it was opened from with the arrow keys and the header buttons', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1?armados=1')
    const pager = await screen.findByRole('navigation', { name: 'Otros mazos' })
    expect(within(pager).getByText('1/3')).toBeVisible()
    expect(within(pager).getByRole('button', { name: 'Mazo anterior: no hay' })).toBeDisabled()

    await user.keyboard('{ArrowRight}')
    expect(where(router)).toBe('/mazos/3?armados=1') // Hoopa ex (2) is not built
    await user.keyboard('{ArrowLeft}')
    expect(where(router)).toBe('/mazos/1?armados=1')
    await user.keyboard('{ArrowLeft}')
    expect(where(router)).toBe('/mazos/1?armados=1')

    await user.click(await within(pager).findByRole('link', { name: 'Mazo siguiente: #3 Zoroark ex' }))
    expect(where(router)).toBe('/mazos/3?armados=1')
    await user.click(await within(pager).findByRole('link', { name: 'Mazo siguiente: #4 Eevee ex' }))
    expect(where(router)).toBe('/mazos/4?armados=1')
    expect(await screen.findByRole('heading', { level: 2, name: /Eevee ex/ })).toBeVisible()
    expect(within(pager).getByText('3/3')).toBeVisible()
    expect(within(pager).getByRole('button', { name: 'Mazo siguiente: no hay' })).toBeDisabled()
  })

  it('without filters goes through every active deck', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await screen.findByRole('navigation', { name: 'Otros mazos' })
    await user.keyboard('{ArrowRight}')
    expect(where(router)).toBe('/mazos/2')
  })

  it('leaves the arrows alone while typing, inside menus and with modifiers', async () => {
    const user = userEvent.setup()
    const router = renderAt('/mazos/1')
    await screen.findByRole('navigation', { name: 'Otros mazos' })

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(where(router)).toBe('/mazos/1')

    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    await user.keyboard('{ArrowRight}')
    expect(where(router)).toBe('/mazos/1')
    input.remove()

    await user.click(await screen.findByRole('button', { name: 'Más acciones' }))
    await screen.findByRole('menu')
    await user.keyboard('{ArrowRight}')
    expect(where(router)).toBe('/mazos/1')
  })
})
