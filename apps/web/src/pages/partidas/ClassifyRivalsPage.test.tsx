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

const match = (id: string, playedAt: string) => ({
  id,
  deck: { id: '20', name: 'Mega-Steelix ex', archived: false },
  deckRevision: 3,
  result: 'loss',
  opponent: null,
  opponentCards: [{ cardId: 'A1-89', count: 2, nameEs: 'Greninja' }],
  wentFirst: null,
  mode: 'competitive',
  note: '',
  playedAt,
  source: 'ui',
  createdAt: playedAt,
  updatedAt: playedAt,
})

const UNCLASSIFIED = {
  era: 'B4a',
  groups: [
    {
      matches: [match('6', '2026-10-14T18:00:00.000Z'), match('5', '2026-10-13T18:00:00.000Z')],
      cards: [
        { cardId: 'A1-89', count: 2, nameEs: 'Greninja' },
        { cardId: 'B4-38', count: 1, nameEs: 'Suicune ex' },
      ],
      text: '2 Greninja, Suicune ex',
      suggestions: [
        {
          archetypeId: 'suicune-baxcalibur',
          name: 'Suicune ex Baxcalibur',
          share: 8,
          lists: 31,
          fits: 0,
          best: 1,
          seen: 2,
          kind: 'similar',
          text: 'parecido: su lista más cercana tiene 1 de 2',
        },
      ],
    },
  ],
  own: [{ key: 'greninja suicune', label: 'Greninja Suicune', games: 3 }],
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/partidas/clasificar'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('clasificar rivales (14/10)', () => {
  it('a group of matches by cards gets an archetype; a rival of my own is renamed in every match', async () => {
    const { calls } = fakeApi({
      'GET /api/matches/unclassified': UNCLASSIFIED,
      'POST /api/matches/classify': (call: { body?: BodyInit | null }) => {
        const body = JSON.parse(String(call.body)) as { opponent: string; matchIds?: string[] }
        return { updated: body.matchIds?.length ?? 3, opponent: body.opponent }
      },
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('2 Greninja, Suicune ex')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Derrota con Mega-Steelix ex/ })).toHaveLength(2)
    expect(screen.getByText('Ninguno encaja del todo; los más parecidos:')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Suicune ex Baxcalibur/ }))
    const posts = () => calls.filter((call) => call.method === 'POST')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0]?.body))).toEqual({ matchIds: ['6', '5'], opponent: 'Suicune ex Baxcalibur' })

    // Reclassifying: a rival typed before, by its label, in every match.
    const own = screen.getByText('Greninja Suicune').closest('li') as HTMLElement
    await user.type(within(own).getByRole('textbox'), 'Greninja Altaria')
    await user.click(within(own).getByRole('button', { name: 'Asignar' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(JSON.parse(String(posts()[1]?.body))).toEqual({ from: 'Greninja Suicune', opponent: 'Greninja Altaria' })
  })

  it('nothing to classify says how to get there', async () => {
    fakeApi({ 'GET /api/matches/unclassified': { era: 'B4a', groups: [], own: [] } })
    renderPage()
    expect(await screen.findByText('Nada para clasificar')).toBeInTheDocument()
    expect(screen.queryByText('Tus rivales propios')).not.toBeInTheDocument()
  })
})
