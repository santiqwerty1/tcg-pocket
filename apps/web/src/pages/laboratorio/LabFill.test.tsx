import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { LabJobPage } from './LabJobPage'

afterEach(() => vi.unstubAllGlobals())

const round = (index: number, extra: Record<string, unknown>) => ({
  index,
  kind: 'search',
  incumbent: 1,
  candidates: [],
  accepted: null,
  screened: null,
  decided: true,
  ...extra,
})

/** A search that ran the probe round, the fill round (T-017 C8) and the verification of its three best. */
const job = {
  job: {
    id: 7,
    kind: 'compare',
    status: 'running',
    label: 'Búsqueda: mazo 2',
    players: ['e2', 'e2'],
    playersEs: ['expectiminimax, profundidad 2', 'expectiminimax, profundidad 2'],
    gamesPerPair: 10,
    baseSeed: '9995',
    engineRev: '33ff2a5',
    replaySample: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: {
      totalGames: 100,
      gamesDone: 50,
      chunks: { total: 10, done: 5, running: 0, failed: 0 },
      etaSeconds: null,
    },
    lab: 'explore',
  },
  mode: 'explore',
  era: 'B4a',
  format: 'STANDARD',
  size: 3,
  rivals: [],
  decks: [],
  explore: {
    config: {
      gamesPerRival: 10,
      variantsPerRound: 2,
      maxRounds: 2,
      patience: 3,
      confirmGames: 0,
      pool: 'all',
      acceptZ: 1,
      verifyGames: 10,
      probe: true,
      fill: true,
    },
    poolEs: 'cualquier carta',
    phase: 'search',
    stopReason: null,
    stopReasonEs: null,
    base: 1,
    best: 1,
    roundsDone: 1,
    rounds: [
      round(0, { candidates: [2, 3, 4], probe: true }),
      round(1, {
        candidates: [10, 11, 12, 13],
        screened: 10,
        fill: [
          { cardId: 'B1-44', nameEs: 'Heatmor', count: 1 },
          { cardId: 'B1-219', nameEs: 'Casco Dentado', count: 1 },
        ],
      }),
      round(2, { kind: 'verify', candidates: [10, 11, 12], decided: false }),
    ],
    locked: [],
  },
  note: 'Juegan bots.',
}

it('T-017 C8: the fill round and the verification of its three best, in words', async () => {
  fakeApi({ 'GET /api/lab/jobs/7': job, 'GET /api/lab/jobs': { items: [] } })
  const router = createMemoryRouter([{ path: '/laboratorio/:id', element: <LabJobPage /> }], {
    initialEntries: ['/laboratorio/7'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  expect(await screen.findByText('Ronda de prueba')).toBeInTheDocument()
  expect(screen.getByText('Ronda 1 (a fondo)')).toBeInTheDocument()
  expect(
    screen.getByText(
      /10 y las que le siguen le ganaron a la mejor en los lugares de Heatmor y Casco Dentado: se verifican/,
    ),
  ).toBeInTheDocument()
  expect(screen.getByText(/las 3 mejores \(10, 11, 12\) contra la mejor, con partidas nuevas/)).toBeInTheDocument()
})
