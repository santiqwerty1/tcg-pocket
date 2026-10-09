import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
  })
})
