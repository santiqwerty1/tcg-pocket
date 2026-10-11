import { QueryClient } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { jobDetailSchema } from '@/api/schemas'
import { Providers } from '@/app/Providers'
import { type FakeCall, fakeApi } from '@/test/fakeApi'
import { SimulacionPage } from './SimulacionPage'
import { SimulationDetailPage } from './SimulationDetailPage'

const job = () =>
  jobDetailSchema.parse({
    id: 1,
    kind: 'matrix',
    status: 'queued',
    priority: 0,
    label: 'Calibración e2',
    players: ['e2', 'e2'],
    playersEs: ['e2', 'e2'],
    gamesPerPair: 10,
    baseSeed: '1',
    engineRev: 'a'.repeat(40),
    replaySample: 0,
    createdAt: '2026-10-10T12:00:00Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: { totalGames: 10, gamesDone: 0, chunks: { total: 1, done: 0, running: 0, failed: 0 }, etaSeconds: null },
    snapshots: [],
    sideA: [],
    sideB: [],
    rows: [],
    optimize: null,
    consistency: null,
    replays: [],
    chunks: [],
  })

afterEach(() => vi.unstubAllGlobals())

function show(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/simulacion', element: <SimulacionPage /> },
      { path: '/simulacion/:id', element: <SimulationDetailPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it.each(['/simulacion', '/simulacion/1'])('adelanta y vuelve a normal desde %s', async (path) => {
  const current = job()
  const sources: { onmessage?: (event: { data: string }) => void }[] = []
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage?: (event: { data: string }) => void
      close = vi.fn()
      constructor() {
        sources.push(this)
      }
    },
  )
  const api = fakeApi({
    'GET /api/simulations': () => ({ items: [current] }),
    'GET /api/simulations/1': () => current,
    'POST /api/simulations/1/priority': (call: FakeCall) => {
      current.priority = JSON.parse(String(call.body)).priority
      return current
    },
  })
  const user = userEvent.setup()
  show(path)
  const button = await screen.findByRole('button', { name: 'Adelantar #1' })
  expect(button).toHaveAttribute(
    'title',
    'Adelantar ordena dentro de cada clase. Las simulaciones grandes adelantadas van antes que las demás grandes; las pruebas del laboratorio y la consistencia siempre van primero.',
  )
  // A prior SSE frame used to override the refetch after changing priority in the detail.
  act(() => sources[0]?.onmessage?.({ data: JSON.stringify(current) }))
  await user.click(button)
  expect(await screen.findByText('Adelantada')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Volver a normal #1' }))
  expect(await screen.findByRole('button', { name: 'Adelantar #1' })).toBeInTheDocument()
  expect(screen.queryByText('Adelantada')).not.toBeInTheDocument()
  expect(api.calls.filter((call) => call.method === 'POST').map((call) => JSON.parse(String(call.body)))).toEqual([
    { priority: 1 },
    { priority: 0 },
  ])
})

it.each(['/simulacion', '/simulacion/1'])('no ofrece adelantar una terminada desde %s', async (path) => {
  const current = { ...job(), status: 'done', priority: 1 }
  fakeApi({
    'GET /api/simulations': { items: [current] },
    'GET /api/simulations/1': current,
  })
  show(path)
  expect(await screen.findByText('Adelantada')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Adelantar|Volver a normal/ })).not.toBeInTheDocument()
})

it('la lista ordena adelantadas por prioridad, chunks restantes, antigüedad e id', async () => {
  const base = job()
  const make = (id: number, priority: number, total: number, done = 0, createdAt = base.createdAt) => ({
    ...base,
    id,
    priority,
    label: `Calibración ${id}`,
    createdAt,
    progress: { ...base.progress, chunks: { total, done, running: 0, failed: 0 } },
  })
  fakeApi({
    'GET /api/simulations': {
      items: [
        make(5, 0, 1),
        make(4, 1, 1, 0, '2026-10-10T13:00:00Z'),
        make(1, 1, 3),
        make(6, 1, 2, 1),
        make(2, 1, 1),
        make(3, 2, 5),
      ],
    },
  })
  show('/simulacion')
  await screen.findByText('Calibración 1')
  expect(
    screen
      .getAllByRole('button', { name: /Volver a normal|Adelantar/ })
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual([
    'Volver a normal #3',
    'Volver a normal #2',
    'Volver a normal #6',
    'Volver a normal #4',
    'Volver a normal #1',
    'Adelantar #5',
  ])
})
