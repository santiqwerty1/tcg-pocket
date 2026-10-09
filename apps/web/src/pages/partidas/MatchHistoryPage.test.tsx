import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('match history from a stats row', () => {
  it('shows exactly the matches the row counted: that rival, modality and period', async () => {
    const { calls } = fakeApi({ 'GET /api/matches': { items: [], total: 0 } })
    const router = createMemoryRouter(routes, {
      initialEntries: ['/partidas/historial?rival=Hoopa%20ex&exacto=1&modalidad=competitive&periodo=30'],
    })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/Como en las estadísticas: Competitiva · últimos 30 días/)).toBeInTheDocument()
    await waitFor(() => expect(calls.some((call) => call.path === '/api/matches')).toBe(true))
    const query = calls.filter((call) => call.path === '/api/matches').at(-1)?.query
    expect(query?.get('opponent')).toBe('Hoopa ex')
    expect(query?.get('opponentMatch')).toBe('exact')
    expect(query?.get('mode')).toBe('competitive')
    expect(query?.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
