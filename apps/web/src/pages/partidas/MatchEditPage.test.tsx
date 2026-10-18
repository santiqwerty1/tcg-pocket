import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The toast captures the pointer, which jsdom lacks.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
})

const MATCH = {
  id: '6',
  deck: { id: '20', name: 'Mega-Steelix ex', archived: false },
  deckRevision: 3,
  result: 'win',
  opponent: 'Garchomp',
  opponentCards: [],
  wentFirst: null,
  mode: 'competitive',
  note: '',
  playedAt: '2026-10-17T21:00:00.000Z',
  source: 'ui',
  createdAt: '2026-10-17T21:00:00.000Z',
  updatedAt: '2026-10-17T21:00:00.000Z',
}
const SUGGESTIONS = {
  decks: [{ id: '20', name: 'Mega-Steelix ex', energies: ['metal'], builtInGame: true, lastPlayedAt: null, games: 1 }],
  lastDeckId: '20',
  lastMode: 'competitive',
  opponents: [],
}
const RANKED = {
  timeZone: 'America/Argentina/Buenos_Aires',
  today: '2026-10-18',
  ranks: [
    { code: 'ultra-4', label: 'Ultra Ball 4' },
    { code: 'master', label: 'Master Ball' },
  ],
  seasons: [],
  current: null,
  summary: null,
}
const change = (id: string, rank: string, label: string) => ({
  id,
  at: '2026-10-17T20:59:59.999Z',
  rank,
  points: null,
  label,
})

function renderEdit() {
  const router = createMemoryRouter(routes, { initialEntries: ['/partidas/6'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('editar partida: el rango de ranked (18/10)', () => {
  it('a registered competitive match gets the rank it was played at, noted just before it', async () => {
    let noted = false
    const { calls } = fakeApi({
      'GET /api/matches/6': MATCH,
      'GET /api/matches/suggestions': SUGGESTIONS,
      'GET /api/ranked': RANKED,
      'GET /api/ranked/matches/6': () => ({
        matchId: '6',
        competitive: true,
        season: { code: 'B4bSP', name: 'Temporada B4b SP' },
        rank: noted ? change('9', 'master', 'Master Ball') : null,
        next: null,
      }),
      'POST /api/ranked/ranks': () => {
        noted = true
        return change('9', 'master', 'Master Ball')
      },
    })
    const user = userEvent.setup()
    renderEdit()
    const section = (await screen.findByRole('heading', { name: 'Ranked' })).closest('section') as HTMLElement
    expect(within(section).getByText(/Temporada B4b SP: la jugaste en/)).toHaveTextContent('sin rango anotado')
    const picker = within(section).getByRole('group', { name: 'Anotar rango' })
    expect(within(picker).getByText('Rango con que la jugaste')).toBeInTheDocument()
    await user.selectOptions(within(picker).getByRole('combobox'), 'master')
    await user.click(within(picker).getByRole('button', { name: 'Anotar' }))
    const posts = () => calls.filter((call) => call.method === 'POST')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0]?.body))).toEqual({ rank: 'master', beforeMatch: '6' })
    // Only the rank: the match itself is not saved again.
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    await waitFor(() => expect(within(section).getByText(/la jugaste en/)).toHaveTextContent('Master Ball'))
  })

  it('a casual match says nothing of ranked', async () => {
    fakeApi({
      'GET /api/matches/6': { ...MATCH, mode: 'casual' },
      'GET /api/matches/suggestions': SUGGESTIONS,
      'GET /api/ranked': RANKED,
      'GET /api/ranked/matches/6': { matchId: '6', competitive: false, season: null, rank: null, next: null },
    })
    renderEdit()
    expect(await screen.findByRole('button', { name: /Guardar/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ranked' })).not.toBeInTheDocument())
    expect(screen.queryByRole('group', { name: 'Anotar rango' })).not.toBeInTheDocument()
  })
})
