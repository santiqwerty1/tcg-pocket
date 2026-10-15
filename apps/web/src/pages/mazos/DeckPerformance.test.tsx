import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { DeckPerformance } from './DeckPerformance'

afterEach(() => vi.unstubAllGlobals())

const TEXT =
  'Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a Mega-Venusaur ex. Probalo con f2.'

const rate = (value: number, games: number) => ({
  source: 'simulation',
  value,
  games,
  samples: games,
  sampleKind: 'simulations',
  ci95: [Math.max(0, value - 3), value + 3],
  orientative: false,
})

const comparison = (blindSpot: { text: string } | null) => ({
  deck: { id: '40', name: 'Mega-Venusaur ex', archived: false },
  columns: [
    {
      source: 'matches',
      label: 'Mis partidas',
      available: false,
      record: null,
      rate: null,
      note: 'Todavía no registraste partidas con este mazo.',
    },
    {
      source: 'tournament',
      label: 'Torneo',
      available: false,
      record: null,
      rate: null,
      note: 'Nadie jugó esta lista.',
    },
    {
      source: 'simulation',
      label: 'Simulación',
      available: true,
      record: { wins: 3, losses: 197, ties: 0 },
      rate: rate(1.5, 200),
      note: 'Bots e2 vs e2.',
      blindSpot,
    },
  ],
})

function show() {
  const router = createMemoryRouter(
    [{ path: '/mazos/:id', element: <DeckPerformance deckId="40" archived={false} /> }],
    { initialEntries: ['/mazos/40'] },
  )
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it('H-055: the simulation column says its «posible punto ciego del bot» across the three columns', async () => {
  fakeApi({ 'GET /api/decks/40/comparison': comparison({ text: TEXT }) })
  show()
  expect(await screen.findByText(TEXT)).toBeInTheDocument()
})

it('H-055: nothing when the simulation has none', async () => {
  fakeApi({ 'GET /api/decks/40/comparison': comparison(null) })
  show()
  expect(await screen.findByText('Bots e2 vs e2.')).toBeInTheDocument()
  expect(screen.queryByText(/^Posible punto ciego del bot/)).not.toBeInTheDocument()
})
