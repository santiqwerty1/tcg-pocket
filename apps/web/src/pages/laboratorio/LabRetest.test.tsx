import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { LabJobPage } from './LabJobPage'

afterEach(() => vi.unstubAllGlobals())

/** A test against the meta played with e2, the bot by default until 23/10/2026 (D-029). */
const job = (players: [string, string]) => ({
  job: {
    id: 52,
    kind: 'compare',
    status: 'done',
    label: 'Contra el meta B4a: Mega-Blaziken ex',
    players,
    playersEs: players,
    gamesPerPair: 100,
    baseSeed: '7',
    engineRev: 'c87bad0',
    replaySample: 0,
    createdAt: '2026-10-20T00:00:00.000Z',
    startedAt: null,
    finishedAt: '2026-10-20T01:00:00.000Z',
    error: null,
    progress: {
      totalGames: 300,
      gamesDone: 300,
      chunks: { total: 3, done: 3, running: 0, failed: 0 },
      etaSeconds: null,
    },
    lab: 'test',
  },
  mode: 'test',
  era: 'B4a',
  format: 'STANDARD',
  size: 3,
  rivals: [],
  decks: [
    {
      snapshot: 2,
      label: 'Mega-Blaziken ex',
      deckId: null,
      role: 'deck',
      round: null,
      search: {
        score: { value: 51, ci95: [45, 57], se: 3, games: 300, rivals: 3, coverage: 1 },
        text: '51 % contra el meta',
      },
      confirm: null,
      perRival: [],
      changes: null,
      novelty: {
        kind: 'played',
        label: 'jugada en torneo',
        swaps: 0,
        closestArchetype: null,
        closestLists: 1,
        nearbyLists: 1,
        nearbyEntries: 1,
      },
      cards: [{ cardId: 'B1-36', count: 2, nameEs: 'Mega-Blaziken ex' }],
      energies: ['fire'],
      simulable: true,
    },
  ],
  explore: null,
  note: 'Juegan bots.',
})

it.each([[['e2', 'e2'] as [string, string]], [['g2', 'g2'] as [string, string]]])(
  '«Probar con 200 partidas» plays with the job’s own bots (%j), so the number compares with its own (D-029)',
  async (players) => {
    const api = fakeApi({ 'GET /api/lab/jobs/52': job(players), 'GET /api/lab/jobs': { items: [] } })
    const user = userEvent.setup()
    const router = createMemoryRouter([{ path: '/laboratorio/:id', element: <LabJobPage /> }], {
      initialEntries: ['/laboratorio/52'],
    })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.click(await screen.findByRole('button', { name: 'Probar con 200 partidas' }))
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/lab/test')).toBe(true),
    )
    const post = api.calls.find((call) => call.method === 'POST' && call.path === '/api/lab/test')
    expect(JSON.parse(String(post?.body))).toMatchObject({ gamesPerRival: 200, size: 3, era: 'B4a', players })
  },
)
