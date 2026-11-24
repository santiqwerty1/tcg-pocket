import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const RESULT = {
  q: 'gyarados',
  cards: [
    {
      card: {
        id: 'A1-78',
        nameEs: 'Gyarados',
        nameEn: 'Gyarados',
        expansionId: 'A1',
        number: 78,
        rarity: '◊◊◊',
        cardType: 'pokemon',
        evolutionType: 'stage1',
        ex: false,
        prizePoints: 1,
        imageUrl: null,
        functionalGroupId: 'A1-78',
        stockCardId: 'A1-78',
        isDisplayEdition: true,
      },
      group: {
        id: 'A1-78',
        nameEs: 'Gyarados',
        nameEn: 'Gyarados',
        cardType: 'pokemon',
        displayCardId: 'A1-78',
        editionCount: 1,
      },
    },
  ],
  decks: [],
  archetypes: [{ id: 'gyarados-ex', name: 'Gyarados ex' }],
  matches: [
    {
      id: '12',
      deck: 'Mega-Blaziken ex',
      opponent: 'Gyarados ex',
      result: 'loss',
      playedAt: '2026-10-08T20:00:00.000Z',
      note: '',
    },
  ],
  notes: [],
  events: [],
}

describe('buscador único (Fase 27)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/search')) return new Response(JSON.stringify(RESULT), { status: 200 })
        return new Response(JSON.stringify({ error: { code: 'offline', message: 'sin API' } }), { status: 503 })
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('searches every kind and Enter opens the first result', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.click(screen.getByRole('button', { name: 'Buscar' }))
    await user.type(screen.getByRole('searchbox', { name: 'Buscar en toda la app' }), 'gyarados')
    expect(await screen.findByRole('heading', { name: 'Cartas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Arquetipos' })).toBeInTheDocument()
    expect(screen.getByText('Derrota con Mega-Blaziken ex contra Gyarados ex')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mazos' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(router.state.location.pathname).toBe('/cartas/A1-78')
    // The focus goes to the screen that opened, so the next Tab walks it. The magnifier is the last stop of the
    // document: left there, the next Tab would leave the page.
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('a result opened with a tap leaves the focus on the new screen too, and Escape still returns it to the magnifier', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.keyboard('/')
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar en toda la app' }), 'gyarados')
    await user.click(await screen.findByRole('button', { name: 'Gyarados ex' }))
    // A screen that is loaded when it is opened: the address follows in a moment.
    await waitFor(() => expect(router.state.location.pathname).toBe('/torneos/arquetipos/gyarados-ex'))
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    expect(screen.getByRole('main')).toHaveFocus()

    // Opened again and closed without choosing: back to the magnifier, as before.
    await user.keyboard('/')
    expect(await screen.findByRole('searchbox', { name: 'Buscar en toda la app' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    expect(screen.getByRole('button', { name: 'Buscar' })).toHaveFocus()
  })
})
