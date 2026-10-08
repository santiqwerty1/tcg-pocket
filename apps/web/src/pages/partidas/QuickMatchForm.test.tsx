import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const SUGGESTIONS = {
  decks: [
    {
      id: '7',
      name: 'Zoroark ex / Mega-Absol ex',
      energies: ['darkness'],
      builtInGame: true,
      lastPlayedAt: '2026-10-07T18:00:00.000Z',
      games: 3,
    },
    { id: '2', name: 'Mega-Blaziken ex', energies: ['fire'], builtInGame: true, lastPlayedAt: null, games: 0 },
    { id: '15', name: 'Eevee ex', energies: ['grass'], builtInGame: false, lastPlayedAt: null, games: 0 },
  ],
  lastDeckId: '7',
  lastMode: 'competitive',
  opponents: [
    { key: 'mega blaziken ex', label: 'Mega-Blaziken ex', games: 4, lastPlayedAt: '2026-10-07T18:00:00.000Z' },
    { key: 'gardevoir ex', label: 'Gardevoir ex', games: 1, lastPlayedAt: '2026-10-06T18:00:00.000Z' },
  ],
}

function matchFrom(body: Record<string, unknown>) {
  const deck = SUGGESTIONS.decks.find((d) => d.id === body.deckId) ?? SUGGESTIONS.decks[0]
  return {
    id: '41',
    deck: { id: deck?.id, name: deck?.name, archived: false },
    deckRevision: 1,
    result: body.result,
    opponent: body.opponent ?? null,
    wentFirst: body.wentFirst ?? null,
    mode: body.mode ?? 'casual',
    note: body.note ?? '',
    playedAt: '2026-10-07T19:00:00.000Z',
    source: 'ui',
    createdAt: '2026-10-07T19:00:00.000Z',
    updatedAt: '2026-10-07T19:00:00.000Z',
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('quick-entry sheet (PLAN §7 Fase 2)', () => {
  let posted: Record<string, unknown>[]

  beforeEach(() => {
    posted = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/api/matches/suggestions') return json(SUGGESTIONS)
        if (url.pathname === '/api/matches/luck') {
          return json({
            deck: { id: '7', name: 'Zoroark ex / Mega-Absol ex', archived: false },
            opponent: url.searchParams.get('opponent'),
            record: { wins: 1, losses: 6, ties: 0 },
            expected: { value: 52, kind: 'matchup', label: 'Zoroark contra Gardevoir en torneos', games: 40 },
            check: { games: 7, actual: 14.3, expected: 52, lowerTail: 0.04, upperTail: 0.99, verdict: 'unlucky' },
            streak: null,
            text: 'Vas 1-6 (14,3 %). Es raro.',
          })
        }
        if (url.pathname === '/api/rival-notes') {
          return json({
            items: [
              {
                key: 'gardevoir ex',
                label: 'Gardevoir ex',
                archetypeId: null,
                text: 'Atacar a la Ralts antes de que evolucione.',
                createdAt: '2026-10-07T19:00:00.000Z',
                updatedAt: '2026-10-07T19:00:00.000Z',
              },
            ],
          })
        }
        if (url.pathname === '/api/matches' && method === 'GET') return json({ items: [], total: 0 })
        if (url.pathname === '/api/matches' && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          posted.push(body)
          return json(matchFrom(body), 201)
        }
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

  it('logs a match in four taps from the home screen, with the last deck and mode preselected', async () => {
    const user = userEvent.setup()
    const router = renderAt('/')
    expect(router.state.location.pathname).toBe('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    const deckGroup = within(form).getByRole('group', { name: 'Mazo' })
    expect(within(deckGroup).getByRole('button', { name: /Zoroark ex/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByRole('button', { name: 'Competitiva' })).toHaveAttribute('aria-pressed', 'true')
    const save = within(form).getByRole('button', { name: /Guardar partida/ })
    expect(save).toBeDisabled()

    let taps = 0
    const tap = async (element: HTMLElement) => {
      taps += 1
      await user.click(element)
    }
    await tap(within(form).getByRole('button', { name: 'Victoria' }))
    await tap(within(form).getByRole('button', { name: 'Mega-Blaziken ex' }))
    await tap(within(form).getByRole('button', { name: 'Empecé yo' }))
    await tap(save)

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(taps).toBe(4)
    expect(posted[0]).toEqual({
      deckId: '7',
      result: 'win',
      opponent: 'Mega-Blaziken ex',
      wentFirst: true,
      mode: 'competitive',
    })
    expect(await screen.findByText('Victoria con Zoroark ex / Mega-Absol ex contra Mega-Blaziken ex')).toBeVisible()
    // Ready for the next match: same deck and mode, the rest cleared.
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Victoria' })).not.toHaveAttribute('aria-pressed', 'true'),
    )
    expect(within(form).getByRole('button', { name: 'Empecé yo' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(form).getByLabelText('Rival (arquetipo)')).toHaveValue('')
    expect(within(deckGroup).getByRole('button', { name: /Zoroark ex/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('after a loss, says whether the record against that rival is rare (Fase 13)', async () => {
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Derrota' }))
    await user.click(within(form).getByRole('button', { name: 'Gardevoir ex' }))
    await user.click(within(form).getByRole('button', { name: /Guardar partida/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(await within(form).findByText('Vas 1-6 (14,3 %). Es raro.')).toBeVisible()
    expect(within(form).getByText(/Racha rara/)).toBeVisible()
  })

  it('shows the note about the rival once it is picked (Fase 12)', async () => {
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    expect(within(form).queryByText(/Atacar a la Ralts/)).toBeNull()
    await user.click(within(form).getByRole('button', { name: 'Gardevoir ex' }))
    expect(await within(form).findByText('Atacar a la Ralts antes de que evolucione.')).toBeVisible()
    expect(within(form).getByText('Tu nota contra Gardevoir ex')).toBeVisible()
  })

  it('preselects the deck from ?mazo=, picks another from the full list and filters opponents while typing', async () => {
    const user = userEvent.setup()
    renderAt('/partidas?mazo=2')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    const deckGroup = within(form).getByRole('group', { name: 'Mazo' })
    expect(within(deckGroup).getByRole('button', { name: /Mega-Blaziken ex/ })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(form).getByRole('button', { name: 'Otro mazo…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Elegí el mazo' })
    await user.type(within(sheet).getByLabelText('Buscar mazo'), 'eev')
    await user.click(within(sheet).getByRole('button', { name: /Eevee ex/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(deckGroup).getByRole('button', { name: /Eevee ex/ })).toHaveAttribute('aria-pressed', 'true')

    const opponents = within(form).getByRole('group', { name: 'Rivales anteriores' })
    expect(within(opponents).getAllByRole('button')).toHaveLength(2)
    await user.type(within(form).getByLabelText('Rival (arquetipo)'), 'garde')
    expect(
      within(opponents)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Gardevoir ex'])

    await user.click(within(form).getByRole('button', { name: 'Derrota' }))
    await user.click(within(form).getByRole('button', { name: 'Distendida' }))
    await user.click(within(form).getByRole('button', { name: /Guardar partida/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ deckId: '15', result: 'loss', opponent: 'garde', wentFirst: null, mode: 'casual' })
  })
})
