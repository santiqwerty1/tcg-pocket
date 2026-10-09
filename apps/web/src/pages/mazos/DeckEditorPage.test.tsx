import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import search from '@/api/__fixtures__/cards-search.json'
import deck from '@/api/__fixtures__/deck-detail.json'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('deck editor', () => {
  it('builds a deck from the search, validates it live and saves it', async () => {
    const { calls } = fakeApi({
      'GET /api/decks': { items: [] },
      'GET /api/cards': search,
      'POST /api/decks/validate': { draft: null, validation: deck.validation, completeness: deck.completeness },
      'POST /api/decks': deck,
      [`GET /api/decks/${deck.id}`]: deck,
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/nuevo'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )

    await user.type(await screen.findByLabelText('Nombre'), 'Mawile de prueba')
    await user.click(screen.getByRole('button', { name: 'Metal' }))
    await user.type(screen.getByRole('searchbox', { name: 'Buscar carta' }), 'mawile')
    const results = await screen.findByRole('list', { name: 'Resultados' })
    await user.click(await within(results).findByRole('button', { name: /B2-113/ }))
    await user.click(within(results).getByRole('button', { name: /B2-113/ }))

    // Two copies of the edition picked, and the live validation ran against the API.
    expect(screen.getByText('2/20')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((call) => call.path === '/api/decks/validate')).toBe(true))
    expect(await screen.findByText('El mazo cumple las reglas del juego.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/mazos/${deck.id}`))
    const saved = calls.find((call) => call.method === 'POST' && call.path === '/api/decks')
    expect(JSON.parse(String(saved?.body))).toMatchObject({
      name: 'Mawile de prueba',
      energies: ['metal'],
      cards: [{ cardId: 'B2-113', count: 2 }],
    })
  })
})
