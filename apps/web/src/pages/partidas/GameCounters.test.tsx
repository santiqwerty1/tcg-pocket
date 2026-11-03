import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY, SUMMARY } from '@/test/pokemonZone'

afterEach(() => {
  vi.unstubAllGlobals()
})

const stats = {
  filters: { deckId: null, mode: null, from: null, to: null },
  overall: {
    record: { wins: 1, losses: 0, ties: 0 },
    rate: {
      source: 'matches',
      value: 100,
      games: 1,
      samples: 1,
      sampleKind: 'matches',
      ci95: [20.7, 100],
      orientative: true,
    },
  },
  byDeck: [],
  byOpponent: [],
  byWentFirst: [],
  byMode: [],
  byRevision: [],
}

function open(summary: unknown) {
  fakeApi({ 'GET /api/matches/stats': stats, 'GET /api/pokemon-zone': summary })
  const router = createMemoryRouter(routes, { initialEntries: ['/partidas/estadisticas'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

/** When pokemon-zone read the game, as the page writes it. */
const READ = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
  new Date(SUMMARY.latest.syncedAt),
)

describe('Estadísticas: según el juego (2/11)', () => {
  it('the game’s counters next to the matches logged, and what was not logged between the two imports', async () => {
    open(SUMMARY)
    const section = (await screen.findByRole('heading', { name: 'Según el juego' })).closest('section') as HTMLElement
    const ranked = within(section).getByText('Competitivas').closest('li') as HTMLElement
    expect(ranked).toHaveTextContent('47,1 % (160 V en 340 partidas, IC 41,8–⁠52,4 %)')
    expect(ranked).toHaveTextContent('430 puntos ganados')
    // Review of pz/import: up to the read, like the game's counters.
    expect(ranked).toHaveTextContent(`En la app, hasta el ${READ}: 1 competitiva registrada`)
    const versus = within(section)
      .getByText(/^Versus/)
      .closest('li') as HTMLElement
    expect(versus).toHaveTextContent(`En la app, hasta el ${READ}: 1 partida registrada (la primera, del`)
    // Few battles: «orientativo», as every rate under 30.
    expect(within(section).getByText('Mazos de alquiler').closest('li')).toHaveTextContent('orientativo')
    const window = within(section).getByTestId('game-window')
    expect(window).toHaveTextContent('jugaste 3 competitivas y registraste 1: te faltan 2.')
    expect(window).toHaveTextContent('jugaste 4 partidas contra personas y registraste 4: están todas.')
    // The game's numbers never add up with the logged ones.
    expect(section).toHaveTextContent('aparte de tus partidas registradas (no se suman)')
  })

  it('one missing match is said in singular', async () => {
    const one = structuredClone(SUMMARY)
    one.battles.window.comparison = [{ kind: 'ranked', game: 2, logged: 1, notLogged: 1 }]
    open(one)
    expect(await screen.findByTestId('game-window')).toHaveTextContent(
      'jugaste 2 competitivas y registraste 1: te falta 1.',
    )
  })

  it('with a single import it says when there will be a comparison', async () => {
    const lonely = structuredClone(SUMMARY) as unknown as { battles: { window: unknown } }
    lonely.battles.window = null
    open(lonely)
    expect(await screen.findByText(/Con la próxima importación te digo cuántas partidas jugaste/)).toBeInTheDocument()
  })

  it('before any import it points to pokemon-zone', async () => {
    open(EMPTY_SUMMARY)
    expect(await screen.findByRole('link', { name: 'traelas de pokemon-zone' })).toHaveAttribute(
      'href',
      '/coleccion/pokemon-zone',
    )
  })
})
