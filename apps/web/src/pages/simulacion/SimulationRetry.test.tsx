import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { jobDetailSchema } from '@/api/schemas'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { SimulationDetailPage } from './SimulationDetailPage'

const failedJob = (status: string) =>
  jobDetailSchema.parse({
    id: 1,
    kind: 'matrix',
    status,
    priority: 0,
    label: 'Calibración m',
    players: ['m', 'm'],
    playersEs: ['m', 'm'],
    gamesPerPair: 10,
    baseSeed: '1',
    engineRev: 'a'.repeat(40),
    replaySample: 0,
    createdAt: '2026-10-10T12:00:00Z',
    startedAt: '2026-10-10T12:00:00Z',
    finishedAt: status === 'failed' ? '2026-10-10T13:00:00Z' : null,
    error: status === 'failed' ? '1 cruces fallaron en el motor; el resto quedó.' : null,
    progress: { totalGames: 20, gamesDone: 10, chunks: { total: 2, done: 1, running: 0, failed: 1 }, etaSeconds: null },
    snapshots: [],
    sideA: [],
    sideB: [],
    rows: [],
    optimize: null,
    consistency: null,
    replays: [],
    chunks: [
      {
        id: 10,
        idx: 0,
        a: null,
        b: null,
        games: 10,
        gamesDone: 10,
        status: 'done',
        seed: '5',
        attempt: 0,
        error: null,
      },
      {
        id: 11,
        idx: 1,
        a: null,
        b: null,
        games: 10,
        gamesDone: 0,
        status: 'failed',
        seed: '6',
        attempt: 3,
        error: 'la partida con semilla 14450885746355706057 falló: Active Pokemon should be there',
      },
    ],
  })

afterEach(() => vi.unstubAllGlobals())

function show() {
  const router = createMemoryRouter([{ path: '/simulacion/:id', element: <SimulationDetailPage /> }], {
    initialEntries: ['/simulacion/1'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it('reintenta solo lo que falló, y avisa que un error de deckgym reportado va a volver', async () => {
  vi.stubGlobal(
    'EventSource',
    class {
      close = vi.fn()
    },
  )
  const api = fakeApi({
    'GET /api/simulations/1': failedJob('failed'),
    'POST /api/simulations/1/retry-failed': failedJob('running'),
  })
  const user = userEvent.setup()
  show()
  const button = await screen.findByRole('button', { name: 'Reintentar lo que falló (1)' })
  expect(screen.getByText(/bcollazo\/deckgym-core#398/)).toBeInTheDocument()
  await user.click(button)
  await user.click(await screen.findByRole('button', { name: 'Reintentar' }))
  expect(api.calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
    '/api/simulations/1/retry-failed',
  ])
})

it('no lo ofrece mientras se juega', async () => {
  vi.stubGlobal(
    'EventSource',
    class {
      close = vi.fn()
    },
  )
  fakeApi({ 'GET /api/simulations/1': failedJob('running') })
  show()
  expect(await screen.findByText('Cruces que fallaron')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Reintentar lo que falló/ })).not.toBeInTheDocument()
})

it('dice por qué no se puede reintentar (otra revisión del motor) y no ofrece el botón', async () => {
  vi.stubGlobal(
    'EventSource',
    class {
      close = vi.fn()
    },
  )
  const blocked = 'Se jugó con la revisión 1 de las partidas y los workers de ahora juegan con otra: repetila entera.'
  fakeApi({ 'GET /api/simulations/1': { ...failedJob('failed'), retryBlocked: blocked } })
  show()
  expect(await screen.findByText(blocked)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Reintentar lo que falló/ })).not.toBeInTheDocument()
})
