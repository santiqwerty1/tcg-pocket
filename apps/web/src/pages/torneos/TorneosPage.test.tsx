import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const era = { code: 'B4a', nameEs: 'Ambición del Team Rocket', from: '2026-08-27', to: null, current: true }
const rate = (value: number, games: number, samples: number) => ({
  source: 'tournament',
  value,
  games,
  samples,
  sampleKind: 'lists',
  ci95: [value - 5, value + 5],
  orientative: samples < 30,
})
const scope = {
  era,
  format: 'STANDARD',
  minPlayers: 12,
  tournaments: 154,
  lists: 12_223,
  games: 60_000,
  mean: {
    lists: 12_223,
    record: { wins: 28_020, losses: 30_000, ties: 1980 },
    rate: rate(46.7, 60_000, 12_223),
    share: 100,
  },
  conflicts: [],
  unknownCards: 0,
  attribution: 'Datos de torneo: Limitless (play.limitlesstcg.com)',
}
const cards = [
  {
    groupId: 'B4a-10',
    cardId: 'B4a-10',
    nameEs: 'Mega-Blaziken ex',
    nameEn: 'Mega Blaziken ex',
    set: 'B4a',
    number: '10',
    count: 2,
    cardType: 'pokemon',
  },
  {
    groupId: 'P-A-7',
    cardId: 'P-A-7',
    nameEs: 'Investigación de Profesores',
    nameEn: "Professor's Research",
    set: 'P-A',
    number: '7',
    count: 2,
    cardType: 'trainer',
  },
]
const list = {
  key: '00aabbccddeeff',
  kind: 'group',
  archetype: { id: 'mega-blaziken-ex-b4a', name: 'Mega Blaziken ex', icons: [] },
  cards,
  otherKey: '11aabbccddeeff',
  lists: 40,
  record: { wins: 137, losses: 120, ties: 11 },
  rate: rate(51.1, 268, 40),
  share: 0.3,
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Torneos (Fase 5)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        const path = url.pathname
        if (path === '/api/tournaments/status') {
          return json({
            currentEra: era,
            eras: [era],
            newEra: { lastRelease: 'B4b', releaseDate: '2026-09-30', days: 8, likely: false },
            minPlayers: 12,
            sync: {
              enabled: true,
              running: false,
              progress: null,
              lastRun: null,
              callsInWindow: 0,
              counts: { listed: 0, complete: 154, incomplete: 0, excluded: 60, failed: 0 },
              newestTournament: '2026-10-06T09:00:00.000Z',
            },
          })
        }
        if (path === '/api/tournaments/archetypes') {
          return json({
            scope,
            rows: [
              {
                archetype: list.archetype,
                lists: 268,
                record: { wins: 600, losses: 650, ties: 30 },
                rate: rate(46.9, 1280, 268),
                share: 2.2,
              },
              {
                archetype: { id: 'rare', name: 'Rareza', icons: [] },
                lists: 9,
                record: { wins: 20, losses: 25, ties: 0 },
                rate: rate(44.4, 45, 9),
                share: 0.1,
              },
            ],
          })
        }
        if (path === '/api/tournaments/buildable') {
          return json({
            scope,
            buildable: [{ ...list, missing: [], missingCopies: 0 }],
            near: [
              {
                ...list,
                key: '22aabbccddeeff',
                missing: [{ groupId: 'B4a-10', nameEs: 'Mega-Blaziken ex', need: 2, have: 1 }],
                missingCopies: 1,
              },
            ],
          })
        }
        if (path === `/api/tournaments/lists/${list.key}`) {
          return json({
            scope,
            list: { ...list, missing: [], missingCopies: 0 },
            energies: ['Fire'],
            text: "2 Mega Blaziken ex B4a 10\r\n\r\n2 Professor's Research P-A 7\r\n\r\nEnergy: Fire",
            entries: [
              {
                tournamentId: 't1',
                tournamentName: 'PMPT #45',
                date: '2026-09-05T16:00:00.000Z',
                playerName: 'ash',
                placing: 3,
                record: { wins: 5, losses: 2, ties: 0 },
              },
            ],
          })
        }
        if (path === '/api/decks/import') return json({ drafts: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderAt(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>,
    )
    return router
  }

  it('archetypes of the era with n, the era mean and «orientativo»; Limitless is credited', async () => {
    renderAt('/torneos')
    expect(await screen.findByText('Mega Blaziken ex')).toBeInTheDocument()
    expect(screen.getByText(/154 torneos · 12\.223 listas/)).toBeInTheDocument()
    expect(screen.getByText('46,7 %')).toBeInTheDocument()
    expect(screen.getByText(/Cuenta empates y abandonos/)).toBeInTheDocument()
    expect(screen.getAllByText('orientativo')).toHaveLength(1)
    expect(screen.getAllByText(/Limitless/).length).toBeGreaterThan(0)
  })

  it('«Puedo armar» lists what the collection covers and what is one copy away', async () => {
    const user = userEvent.setup()
    renderAt('/torneos')
    await screen.findByText('Mega Blaziken ex')
    await user.click(screen.getByRole('tab', { name: 'Armables' }))
    expect(await screen.findByText('Las podés armar hoy (1)')).toBeInTheDocument()
    expect(screen.getByText(/falta 1 Mega-Blaziken ex/)).toBeInTheDocument()
  })

  it('a list can be imported as a deck: the importer opens with its Limitless text', async () => {
    const user = userEvent.setup()
    const router = renderAt(`/torneos/listas/${list.key}`)
    expect(await screen.findByText('La podés armar con tu colección.')).toBeInTheDocument()
    expect(screen.getByText('Investigación de Profesores')).toBeInTheDocument()
    expect(screen.getByText(/ash · puesto 3/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Importar como mazo' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/mazos/importar'))
    expect((await screen.findByRole('textbox')) as HTMLTextAreaElement).toHaveValue(
      "2 Mega Blaziken ex B4a 10\n\n2 Professor's Research P-A 7\n\nEnergy: Fire",
    )
  })
})
