import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

/** PMPT #45 (docs/fase0/limitless), two archetypes, from the API (rounded to one decimal). */
const MATRIX = {
  scope: {
    era: { code: 'B4a', nameEs: 'Ambición del Equipo Rocket', from: '2026-08-27', to: null, current: true },
    format: 'STANDARD',
    minPlayers: 12,
    tournaments: 1,
    lists: 393,
    games: 2190,
    mean: {
      lists: 393,
      record: { wins: 1051, losses: 1119, ties: 20 },
      rate: {
        source: 'tournament',
        value: 48,
        games: 2190,
        samples: 393,
        sampleKind: 'lists',
        ci95: [45.6, 50.4],
        orientative: false,
        designEffect: 1.3,
      },
      share: 100,
    },
    conflicts: [],
    newSetTournaments: [],
    unknownCards: 0,
    attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
  },
  coverage: {
    tournaments: 1,
    tournamentsWithPairings: 1,
    matches: 1006,
    skipped: { byes: 96, doubleLosses: 41, noArchetype: 0 },
  },
  archetypes: [
    {
      archetype: {
        id: 'mega-lucario-ex-b3-lucario-a2',
        name: 'Mega Lucario ex Lucario',
        icons: ['lucario-mega', 'lucario'],
      },
      share: 8.4,
      lists: 33,
      field: {
        record: { wins: 114, losses: 85, ties: 3 },
        rate: {
          source: 'tournament',
          value: 56.4,
          games: 202,
          samples: 202,
          sampleKind: 'matches',
          ci95: [49.5, 63.1],
          orientative: false,
        },
      },
      expected: { value: 56, ci95: [50.9, 61.1], coverage: 30.8, matches: 202, rivals: 58 },
    },
    {
      archetype: {
        id: 'mega-altaria-ex-b1-espeon-b3a',
        name: 'Mega Altaria ex Espeon',
        icons: ['altaria-mega', 'espeon'],
      },
      share: 7.6,
      lists: 30,
      field: {
        record: { wins: 106, losses: 77, ties: 4 },
        rate: {
          source: 'tournament',
          value: 56.7,
          games: 187,
          samples: 187,
          sampleKind: 'matches',
          ci95: [49.5, 63.6],
          orientative: false,
        },
      },
      expected: { value: 57.1, ci95: [51.7, 62.4], coverage: 36.9, matches: 187, rivals: 62 },
    },
  ],
  cells: [],
  attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
}

it('phone review: «Contra el meta» says the interval of what each archetype should get and of its record', async () => {
  fakeApi({ 'GET /api/tournaments/matchups': MATRIX })
  const router = createMemoryRouter(routes, { initialEntries: ['/torneos/matchups'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  expect(await screen.findByText(/58 rivales \(n = 202, IC 50,9–61,1 %\)/)).toBeInTheDocument()
  expect(screen.getByText(/contra todos: 56,4 % \(IC 49,5–63,1 %\)/)).toBeInTheDocument()
})
