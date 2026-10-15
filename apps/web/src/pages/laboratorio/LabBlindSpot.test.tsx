import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { LabJobPage } from './LabJobPage'

afterEach(() => vi.unstubAllGlobals())

const TEXT =
  'Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a Mega-Venusaur ex. Probalo con f2.'

const deck = (snapshot: number, label: string, botBlindSpot?: { text: string }) => ({
  snapshot,
  label,
  deckId: String(snapshot),
  role: 'deck',
  round: null,
  search: {
    score: { value: 1.4, ci95: [0.5, 4], se: 1, games: 600, rivals: 3, coverage: 1 },
    text: '1,4 % contra el meta',
  },
  confirm: null,
  perRival: [],
  changes: null,
  // An API from before H-055 leaves it out: the page still reads the list.
  ...(botBlindSpot ? { botBlindSpot } : {}),
  novelty: {
    kind: 'played',
    label: 'jugada en torneo',
    swaps: 0,
    closestArchetype: null,
    closestLists: 1,
    nearbyLists: 1,
    nearbyEntries: 1,
  },
  cards: [],
  energies: ['grass'],
  simulable: true,
})

/** A test against the meta (Laboratorio) of two lists: deck 40, with a blind spot of e2, and one without. */
const job = {
  job: {
    id: 41,
    kind: 'compare',
    status: 'done',
    label: 'Contra el meta B4a: Mega-Venusaur ex',
    players: ['e2', 'e2'],
    playersEs: ['expectiminimax, profundidad 2', 'expectiminimax, profundidad 2'],
    gamesPerPair: 200,
    baseSeed: '9300',
    engineRev: '018b419',
    replaySample: 0,
    createdAt: '2026-10-14T00:00:00.000Z',
    startedAt: null,
    finishedAt: '2026-10-14T01:00:00.000Z',
    error: null,
    progress: {
      totalGames: 1200,
      gamesDone: 1200,
      chunks: { total: 6, done: 6, running: 0, failed: 0 },
      etaSeconds: null,
    },
    lab: 'test',
  },
  mode: 'test',
  era: 'B4a',
  format: 'STANDARD',
  size: 3,
  rivals: [],
  decks: [deck(40, 'Mega-Venusaur ex', { text: TEXT }), deck(2, 'Mega-Blaziken ex')],
  explore: null,
  note: 'Juegan bots.',
}

it('H-055: a list says its «posible punto ciego del bot» under its score, and only that list', async () => {
  fakeApi({ 'GET /api/lab/jobs/41': job, 'GET /api/lab/jobs': { items: [] } })
  const router = createMemoryRouter([{ path: '/laboratorio/:id', element: <LabJobPage /> }], {
    initialEntries: ['/laboratorio/41'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  const warning = await screen.findByText(TEXT)
  expect(warning.closest('li')).toHaveTextContent('Mega-Venusaur ex')
  expect(screen.getAllByText(/^Posible punto ciego del bot/)).toHaveLength(1)
  expect(screen.getByText('Mega-Blaziken ex')).toBeInTheDocument()
})
