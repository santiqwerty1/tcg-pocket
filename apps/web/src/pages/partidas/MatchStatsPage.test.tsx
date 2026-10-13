import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

const rate = (value: number, games: number, ci95: [number, number]) => ({
  source: 'matches',
  value,
  games,
  samples: games,
  sampleKind: 'matches',
  ci95,
  orientative: games < 30,
})

const stats = {
  filters: { deckId: null, mode: null, from: null, to: null },
  overall: { record: { wins: 18, losses: 12, ties: 0 }, rate: rate(60, 30, [42.3, 75.4]) },
  byDeck: [
    {
      deck: { id: '2', name: 'Mega-Blaziken ex', archived: false },
      record: { wins: 18, losses: 12, ties: 0 },
      rate: rate(60, 30, [42.3, 75.4]),
      coinAdjusted: {
        value: 52.5,
        ci95: [36.7, 69.3],
        first: { wins: 15, losses: 5, ties: 0 },
        second: { wins: 3, losses: 7, ties: 0 },
        firstShare: 75,
        secondShare: 30,
        games: 30,
        unknown: 0,
        orientative: false,
        plain: 60,
        text: 'Ajustado por la moneda: 53 % (mitad empezando, 75 % en 20; mitad yendo segundo, 30 % en 10; IC 37–69 %). Sin ajustar: 60 %.',
      },
    },
  ],
  byOpponent: [],
  byWentFirst: [],
  byMode: [],
  byRevision: [],
}

describe('Estadísticas (Fase 44)', () => {
  it('each deck says its share with the coin even with its n and interval', async () => {
    fakeApi({ 'GET /api/matches/stats': stats })
    const router = createMemoryRouter(routes, { initialEntries: ['/partidas/estadisticas'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/con la moneda pareja 52,5 % \(n = 30, IC 36,7–\u206069,3 %\)/)).toBeInTheDocument()
  })
})
