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

describe('¿Qué mazo llevo hoy? and «orientativo» (phone review)', () => {
  it('under 30 games, my matches and the tournament number say «orientativo»', async () => {
    const few = answer('tournament')
    fakeApi({
      'GET /api/decks-today': {
        ...few,
        items: [
          {
            ...few.items[0],
            tournament: { value: 39.2, ci95: [21.8, 56.5], coverage: 0, matches: 9, rivals: 5 },
            mine: {
              record: { wins: 6, losses: 5, ties: 1 },
              rate: {
                source: 'matches',
                value: 50,
                games: 12,
                samples: 12,
                sampleKind: 'matches',
                ci95: [25.4, 74.6],
                orientative: true,
              },
            },
          },
        ],
      },
    })
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/IC 21,8–\u206056,5 %, orientativo/)).toBeInTheDocument()
    expect(screen.getByText(/IC 25,4–\u206074,6 %, orientativo/)).toBeInTheDocument()
  })

  it('the window says its dates, up to the newest tournament loaded, and that it is old', async () => {
    fakeApi({
      'GET /api/decks-today': {
        ...answer('tournament'),
        meta: {
          era: 'B4a',
          kind: 'recent',
          days: 14,
          lists: 393,
          from: '2026-08-23T16:00:00.000Z',
          to: '2026-09-05T16:00:00.000Z',
        },
      },
    })
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(
      await screen.findByText(
        /Meta: del 23\/8\/2026 al 5\/9\/2026 de B4a, hasta el último torneo cargado \(393 listas\)/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/^El último torneo cargado es del 5\/9\/2026/)).toBeInTheDocument()
  })

  it('with 30 games or more, no «orientativo»', async () => {
    fakeApi({ 'GET /api/decks-today': answer('tournament') })
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/IC 47,1–\u206057,7 %/)).toBeInTheDocument()
    expect(screen.queryByText(/orientativo/)).not.toBeInTheDocument()
  })
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
    expect(screen.getByText(/IC 47,1–\u206057,7 %/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Los que me tocan' }))
    expect(await screen.findByText('Torneo, tus rivales')).toBeInTheDocument()
    // Review of #52: still tournament matchups (people), weighed by my rivals, with its interval and «orientativo».
    expect(screen.getByText(/^Torneos \(personas\), pesado por tus 12 rivales de la era/)).toBeInTheDocument()
    expect(screen.getByText(/IC 47,1–\u206057,7 %, orientativo/)).toBeInTheDocument()
    await waitFor(() => expect(calls.at(-1)?.query.get('meta')).toBe('mine'))
    expect(router.state.location.search).toBe('?meta=mio')
  })
})

describe('¿Qué mazo llevo hoy? and «Actualizar todos» (14/10)', () => {
  const rows = (labDue: number) => {
    const base = answer('tournament')
    const deck = base.items[0] as (typeof base.items)[number]
    return {
      ...base,
      labDue,
      items: [
        {
          ...deck,
          lab: {
            value: 48.2,
            ci95: [44.1, 52.3],
            games: 1500,
            text: '48,2 % contra el meta',
            jobId: 12,
            era: 'B4',
            stale: true,
            finishedAt: '2026-09-20T15:00:00.000Z',
          },
          labRunning: null,
        },
        {
          ...deck,
          deck: { id: '3', name: 'Hoopa ex' },
          lab: null,
          labOthers: [{ bot: 'e3', value: 45.1, ci95: [41.0, 49.2], games: 1500, jobId: 48 }],
          labRunning: { jobId: 40, status: 'running', gamesDone: 350, totalGames: 1000 },
        },
      ],
    }
  }

  it('an old score says its era, a test playing says how far; the button asks first and then queues', async () => {
    const refresh = (dryRun: boolean) => ({
      era: 'B4a',
      queued: ['2'],
      jobs: dryRun ? [] : [41],
      fresh: 0,
      running: 1,
      sameList: 0,
      notSimulable: [],
      games: 1500,
      estimatedSeconds: dryRun ? 600 : 0,
    })
    const { calls } = fakeApi({
      'GET /api/decks-today': rows(1),
      'POST /api/decks-today/refresh': (call: { body?: BodyInit | null }) =>
        refresh(JSON.parse(String(call.body)).dryRun === true),
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/viejo: de la era B4, del /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'probando… 35\u00a0%' })).toHaveAttribute('href', '/laboratorio/40')
    // Another bot's score goes apart, with its job.
    expect(screen.getByText(/con e3: 45,1/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#48' })).toHaveAttribute('href', '/laboratorio/48')
    expect(screen.getByText('Un mazo sin puntaje del Laboratorio de esta era.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actualizar todos' }))
    expect(await screen.findByText(/^Un mazo contra el meta de B4a: 1\.500 partidas, ~10 min/)).toBeInTheDocument()
    expect(screen.getByText('1 ya en prueba.')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Probar' }))
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2))
    expect(JSON.parse(String(calls.filter((call) => call.method === 'POST')[1]?.body))).toEqual({ dryRun: false })
  })

  it('no button when every deck has a score of this era or is under test', async () => {
    fakeApi({ 'GET /api/decks-today': rows(0) })
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/viejo: de la era B4/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Actualizar todos' })).not.toBeInTheDocument()
  })
})

describe('¿Qué mazo llevo hoy? and «posible punto ciego del bot» (H-055)', () => {
  it('says it under the Laboratorio line of its deck, and only there', async () => {
    const base = answer('tournament')
    const deck = base.items[0] as (typeof base.items)[number]
    const lab = {
      value: 1.4,
      ci95: [0.5, 4],
      games: 1500,
      text: '1,4 % contra el meta',
      jobId: 41,
      era: 'B4a',
      bot: 'e2',
      stale: false,
      finishedAt: '2026-10-14T15:00:00.000Z',
    }
    const text =
      'Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a Mega-Venusaur ex. Probalo con f2.'
    fakeApi({
      'GET /api/decks-today': {
        ...base,
        items: [
          { ...deck, deck: { id: '40', name: 'Mega-Venusaur ex' }, lab, blindSpot: { text } },
          { ...deck, deck: { id: '2', name: 'Mega-Blaziken ex' }, lab: { ...lab, value: 51.1, jobId: 42 } },
        ],
      },
    })
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/hoy'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    const warning = await screen.findByText(text)
    expect(warning.closest('li')).toHaveTextContent('Mega-Venusaur ex')
    expect(warning.closest('li')).not.toHaveTextContent('Mega-Blaziken ex')
    expect(screen.getAllByText(/^Posible punto ciego del bot/)).toHaveLength(1)
  })
})
