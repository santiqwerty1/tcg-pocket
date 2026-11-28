// Simulación inside the shell: «Nueva» is the «+» of the fixed row (`frame.ts`), not a button of the page. The page
// keeps its other ways (Calibración, Análisis, and «Nueva simulación» of the empty list), and asks for what it asked.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type JobsResponse, jobsResponseSchema } from '@/api/schemas'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

const ENGINE = {
  engineRev: 'a'.repeat(40),
  cards: 10,
  incomplete: 0,
  source: 'worker',
  workers: [],
  bots: [{ code: 'g2', label: 'expectiminimax sin trampa, profundidad 2' }],
}

const jobs = (count: number, archived = 0): JobsResponse =>
  jobsResponseSchema.parse({
    items: Array.from({ length: count }, (_, at) => ({
      id: at + 1,
      kind: 'compare',
      status: 'done',
      label: `Prueba ${at + 1}`,
      players: ['g2', 'g2'],
      playersEs: ['g2', 'g2'],
      gamesPerPair: 100,
      baseSeed: '1',
      engineRev: 'a'.repeat(40),
      replaySample: 0,
      createdAt: '2026-11-20T12:00:00Z',
      startedAt: '2026-11-20T12:00:00Z',
      finishedAt: '2026-11-20T12:10:00Z',
      error: null,
      progress: {
        totalGames: 100,
        gamesDone: 100,
        chunks: { total: 1, done: 1, running: 0, failed: 0 },
        etaSeconds: null,
      },
    })),
    counts: { archived, cancelled: 0, done: count },
  })

const row = () => document.querySelector('[data-slot="fixed-row"]') as HTMLElement
const requests = (calls: FakeCall[]) =>
  [...new Set(calls.map((call) => `${call.method} ${call.path}${call.query.size > 0 ? `?${call.query}` : ''}`))].sort()

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

afterEach(() => vi.unstubAllGlobals())

describe('Simulación and its «+»', () => {
  it('the «+» of the row is the only way to a new simulation on a list with jobs, and the page asks for the same', async () => {
    const { calls } = fakeApi({ 'GET /api/simulations': jobs(2), 'GET /api/simulations/engine': ENGINE })
    renderAt('/simulacion')
    expect(await screen.findByText('Prueba 2')).toBeInTheDocument()
    const plus = screen.getByRole('link', { name: 'Nueva simulación' })
    expect(row()).toContainElement(plus)
    expect(plus).toHaveAttribute('href', '/simulacion/nueva')
    expect(document.querySelectorAll('a[href="/simulacion/nueva"]')).toHaveLength(1)
    // What the header of the list keeps.
    const main = screen.getByRole('main')
    expect(within(main).getByRole('link', { name: 'Calibración' })).toHaveAttribute('href', '/simulacion/calibracion')
    expect(within(main).getByRole('link', { name: 'Análisis' })).toHaveAttribute('href', '/simulacion/analisis')
    expect(within(main).queryByRole('link', { name: /^Nueva/ })).toBeNull()
    // The row asks for nothing: the list, the engine, and the alerts of the way to the Menú.
    expect(requests(calls)).toEqual(['GET /api/alerts', 'GET /api/simulations', 'GET /api/simulations/engine'])
  })

  it('an empty list keeps its own «Nueva simulación», beside the row’s', async () => {
    fakeApi({ 'GET /api/simulations': jobs(0), 'GET /api/simulations/engine': ENGINE })
    renderAt('/simulacion')
    expect(await screen.findByText('Sin simulaciones todavía')).toBeInTheDocument()
    const own = within(screen.getByRole('main')).getByRole('link', { name: 'Nueva simulación' })
    expect(own).toHaveAttribute('href', '/simulacion/nueva')
    expect(screen.getAllByRole('link', { name: 'Nueva simulación' })).toHaveLength(2)
    expect(row()).toContainElement(screen.getAllByRole('link', { name: 'Nueva simulación' })[1] as HTMLElement)
  })

  it('the archived list keeps the «+» at hand, and «Volver» to the list', async () => {
    const user = userEvent.setup()
    fakeApi({
      'GET /api/simulations': jobs(1, 1),
      'GET /api/simulations?archived=true': jobs(1),
      'GET /api/simulations/engine': ENGINE,
    })
    renderAt('/simulacion')
    await user.click(await screen.findByRole('button', { name: 'Ver archivadas (1)' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Simulaciones archivadas' })).toBeInTheDocument()
    expect(within(row()).getByRole('link', { name: 'Nueva simulación' })).toHaveAttribute('href', '/simulacion/nueva')
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Simulaciones' })).toBeInTheDocument())
  })
})
