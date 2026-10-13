import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

/** PMPT #45 (docs/fase0/limitless, 5/9/2026) from the API, one archetype, rounded to one decimal. */
const TRENDS = {
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
      },
      share: 100,
    },
    conflicts: [],
    newSetTournaments: [],
    unknownCards: 0,
    attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
  },
  days: 7,
  now: { from: '2026-08-30T16:00:00.000Z', to: '2026-09-06T16:00:00.000Z', tournaments: 1, lists: 393 },
  before: { from: '2026-08-23T16:00:00.000Z', to: '2026-08-30T16:00:00.000Z', tournaments: 0, lists: 0 },
  archetypes: [
    {
      now: { lists: 33, share: 8.4 },
      before: { lists: 0, share: 0 },
      delta: 8.4,
      p: 1,
      clear: false,
      archetype: {
        id: 'mega-lucario-ex-b3-lucario-a2',
        name: 'Mega Lucario ex Lucario',
        icons: ['lucario-mega', 'lucario'],
      },
      record: { wins: 124, losses: 98, ties: 3 },
      rate: {
        source: 'tournament',
        value: 55.1,
        games: 225,
        samples: 33,
        sampleKind: 'lists',
        ci95: [47, 63],
        orientative: false,
        designEffect: 1.6,
      },
      isNew: false,
    },
  ],
  cards: [],
  attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
}

function open(trends: unknown) {
  fakeApi({ 'GET /api/tournaments/trends': trends })
  const router = createMemoryRouter(routes, { initialEntries: ['/torneos/semana'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it('phone review: «gana» with its n and interval, the window up to the newest tournament, and old data said', async () => {
  open(TRENDS)
  expect(
    await screen.findByText(/gana 55,1 % en esos días \(n = 225 en 33 listas, IC 47,0–\u206063,0 %\)/),
  ).toBeInTheDocument()
  expect(screen.getByText(/30\/8\/2026 – 6\/9\/2026, hasta el último torneo cargado/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Lo más jugado en esos días' })).toBeInTheDocument()
  expect(screen.getByText(/^El último torneo cargado es del 5\/9\/2026, hace \d+ días/)).toBeInTheDocument()
})

it('with a window before: points up and down, counts with their separator and «%» with its number', async () => {
  const archetype = TRENDS.archetypes[0] as (typeof TRENDS.archetypes)[number]
  open({
    ...TRENDS,
    now: { ...TRENDS.now, lists: 2190 },
    before: { ...TRENDS.before, tournaments: 3, lists: 1250 },
    archetypes: [
      { ...archetype, now: { lists: 1234, share: 11.6 }, before: { lists: 100, share: 8 }, delta: 3.6, clear: true },
      {
        ...archetype,
        archetype: { ...archetype.archetype, id: 'otro', name: 'Otro' },
        now: { lists: 10, share: 0.5 },
        before: { lists: 50, share: 3 },
        delta: -2.5,
      },
    ],
  })
  expect(await screen.findByText('+3,6 pts')).toBeInTheDocument()
  expect(screen.getByText('−2,5 pts')).toBeInTheDocument()
  expect(screen.getByText(/2\.190 listas\. Antes .*: 3 torneos, 1\.250 listas\./)).toBeInTheDocument()
  // The raw text: Testing Library's queries read a no-break space as a plain one, so they cannot see «8 %» break.
  const detail = screen.getByText(/^11,6 % \(1\.234\) · antes 8 % \(100\) · cambio claro/)
  expect(detail.textContent).toContain('11,6\u00a0% (1.234) · antes 8\u00a0% (100) · cambio claro')
  expect(detail.textContent).toContain('IC\u00a047,0–\u206063,0\u00a0%')
  expect(detail.textContent).not.toMatch(/\d %/)
})

it('review of #87: a closed era is old on purpose: no warning', async () => {
  open({ ...TRENDS, scope: { ...TRENDS.scope, era: { ...TRENDS.scope.era, to: '2026-09-30', current: false } } })
  expect(await screen.findByText(/hasta el último torneo cargado/)).toBeInTheDocument()
  expect(screen.queryByText(/El último torneo cargado es del/)).not.toBeInTheDocument()
})

it('under 30 lists the rate says «orientativo»; a fresh window says nothing of old data', async () => {
  const day = 86_400_000
  const now = Date.now()
  const archetype = TRENDS.archetypes[0] as (typeof TRENDS.archetypes)[number]
  open({
    ...TRENDS,
    now: { ...TRENDS.now, from: new Date(now - 6 * day).toISOString(), to: new Date(now + day).toISOString() },
    archetypes: [{ ...archetype, rate: { ...archetype.rate, samples: 12, orientative: true } }],
  })
  expect(await screen.findByText(/n = 225 en 12 listas, IC 47,0–\u206063,0 %, orientativo\)/)).toBeInTheDocument()
  expect(screen.queryByText(/El último torneo cargado/)).not.toBeInTheDocument()
})
