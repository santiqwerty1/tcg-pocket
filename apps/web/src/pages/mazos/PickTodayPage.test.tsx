import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

const answer = (used: 'tournament' | 'mine') => ({
  sort: 'tournament',
  meta: { era: 'B4a', kind: 'recent', days: 14, lists: 393 },
  weights: {
    asked: used,
    used,
    mine:
      used === 'mine'
        ? {
            text: 'Tu meta (12 partidas contra arquetipos de torneo, 12 efectivas, porque las recientes pesan más; orientativo): Hoopa ex 66,7 % (IC 39,1–86,2 %).',
            enough: true,
            coverage: 86,
            matched: 12,
            effectiveMatches: 12,
            orientative: true,
          }
        : null,
  },
  items: [
    {
      deck: { id: '2', name: 'Mega-Blaziken ex' },
      archetype: { id: 'mega-blaziken-ex-b1', name: 'Mega Blaziken ex', source: 'owner' },
      mine: null,
      tournament: { value: 52.4, ci95: [47.1, 57.7], coverage: 80, matches: 120, rivals: 8 },
      lab: null,
    },
  ],
  note: 'Tres números separados.',
})

describe('¿Qué mazo llevo hoy? with «mi meta» (Fase 44)', () => {
  it('asks for my rivals as weights and says so on each deck', async () => {
    const { calls } = fakeApi({
      'GET /api/decks-today': (call: { query: URLSearchParams }) =>
        answer(call.query.get('meta') === 'mine' ? 'mine' : 'tournament'),
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Torneo hoy')).toBeInTheDocument()
    expect(screen.getByText(/IC 47,1–57,7 %/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Los que me tocan' }))
    expect(await screen.findByText('Torneo, tus rivales')).toBeInTheDocument()
    // Review of #52: still tournament matchups (people), weighed by my rivals, with its interval and «orientativo».
    expect(screen.getByText(/^Torneos \(personas\), pesado por tus 12 rivales de la era/)).toBeInTheDocument()
    expect(screen.getByText(/IC 47,1–57,7 %, orientativo/)).toBeInTheDocument()
    await waitFor(() => expect(calls.at(-1)?.query.get('meta')).toBe('mine'))
    expect(router.state.location.search).toBe('?meta=mio')
  })
})
