import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

const record = (wins: number, losses: number) => ({
  record: { wins, losses, ties: 0 },
  games: wins + losses,
  rate: null,
  text: `${wins}-${losses}`,
})
const RANKS = [
  { code: 'ultra-1', label: 'Ultra Ball 1' },
  { code: 'ultra-2', label: 'Ultra Ball 2' },
  { code: 'ultra-3', label: 'Ultra Ball 3' },
  { code: 'master', label: 'Master Ball' },
]
const change = (id: string, at: string, rank: string, label: string) => ({ id, at, rank, points: null, label })
const SEASON = { code: 'B4bSP', name: 'Temporada B4b SP', startsOn: '2026-10-14', endsOn: '2026-10-28' }
const VIEW = {
  timeZone: 'America/Argentina/Buenos_Aires',
  today: '2026-10-15',
  ranks: RANKS,
  seasons: [{ ...SEASON, ...record(2, 1), current: true, rankLabel: 'Ultra Ball 3' }],
  current: {
    code: 'B4bSP',
    name: 'Temporada B4b SP',
    endsOn: '2026-10-28',
    rank: change('2', '2026-10-15T20:00:00.000Z', 'ultra-3', 'Ultra Ball 3'),
  },
  summary: {
    season: SEASON,
    ...record(2, 1),
    rank: change('2', '2026-10-15T20:00:00.000Z', 'ultra-3', 'Ultra Ball 3'),
    steps: [
      { ...change('1', '2026-10-14T21:10:00.000Z', 'ultra-2', 'Ultra Ball 2'), move: null, decks: [] },
      {
        ...change('2', '2026-10-15T20:00:00.000Z', 'ultra-3', 'Ultra Ball 3'),
        move: 'up',
        decks: [{ deckId: '20', deckName: 'Mega-Steelix ex', ...record(2, 0) }],
      },
    ],
    byRank: [
      { rank: 'ultra-2', label: 'Ultra Ball 2', ...record(2, 0) },
      { rank: 'ultra-3', label: 'Ultra Ball 3', ...record(0, 1) },
    ],
    byDeck: [{ deckId: '20', deckName: 'Mega-Steelix ex', ...record(2, 1) }],
  },
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('temporada de ranked (14/10)', () => {
  it('the season, the rank now, the curve with what it went up with, and the record by rank and deck', async () => {
    const { calls } = fakeApi({
      'GET /api/ranked': VIEW,
      'POST /api/ranked/ranks': change('3', '2026-10-15T22:00:00.000Z', 'master', 'Master Ball, 1.200 puntos'),
    })
    const user = userEvent.setup()
    renderAt('/partidas/temporada')
    expect(await screen.findByRole('heading', { name: 'Temporada B4b SP' })).toBeInTheDocument()
    expect(screen.getByText(/Del 14\/10\/2026 al 28\/10\/2026\. Partidas competitivas: 2-1\./)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Curva de rango de la temporada' })).toBeInTheDocument()
    expect(screen.getByText('Subió con: Mega-Steelix ex 2-0')).toBeInTheDocument()
    expect(screen.getByText('Ultra Ball 2:')).toBeInTheDocument()
    // Noting Master Ball with its points.
    const form = screen.getByRole('form', { name: 'Anotar rango' })
    await user.selectOptions(within(form).getByRole('combobox'), 'master')
    await user.type(within(form).getByRole('textbox'), '1200')
    await user.click(within(form).getByRole('button', { name: 'Anotar' }))
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1))
    expect(JSON.parse(String(calls.find((call) => call.method === 'POST')?.body))).toEqual({
      rank: 'master',
      points: 1200,
    })
  })

  it('without a season for today, it says so', async () => {
    fakeApi({ 'GET /api/ranked': { ...VIEW, seasons: [], current: null, summary: null } })
    renderAt('/partidas/temporada')
    expect(await screen.findByText('No hay temporada de ranked cargada para hoy.')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Anotar rango' })).not.toBeInTheDocument()
  })
})
