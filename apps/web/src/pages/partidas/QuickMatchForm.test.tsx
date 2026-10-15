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
  let suggested: string[]
  /** The suggestions of these cards wait for the gate and then fail. */
  let failing: { cards: string; gate: Promise<void> } | null
  let ranks: Record<string, unknown>[]

  beforeEach(() => {
    posted = []
    suggested = []
    failing = null
    ranks = []
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
        if (url.pathname === '/api/cards') {
          return json({
            items: [
              {
                card: {
                  id: 'A1-89',
                  nameEs: 'Greninja',
                  nameEn: 'Greninja',
                  expansionId: 'A1',
                  number: 89,
                  rarity: '◊◊◊',
                  cardType: 'pokemon',
                  evolutionType: 'stage2',
                  ex: false,
                  prizePoints: 1,
                  functionalGroupId: 'A1-89',
                  stockCardId: 'A1-89',
                  isDisplayEdition: true,
                },
                group: {
                  id: 'A1-89',
                  nameEs: 'Greninja',
                  nameEn: 'Greninja',
                  cardType: 'pokemon',
                  displayCardId: 'A1-89',
                  editionCount: 1,
                },
              },
            ],
          })
        }
        if (url.pathname === '/api/matches/rival-suggestions') {
          suggested.push(url.searchParams.get('cards') ?? '')
          if (failing && failing.cards === url.searchParams.get('cards')) {
            await failing.gate
            return json({ error: { code: 'unavailable', message: 'sin datos' } }, 503)
          }
          return json({
            era: 'B4a',
            lists: 393,
            suggestions: [
              {
                archetypeId: 'greninja-altaria',
                name: 'Greninja Altaria',
                share: 3.1,
                lists: 12,
                fits: 50,
                best: 1,
                seen: 1,
                kind: 'fits',
                text: 'el 50 % de sus listas tiene esas cartas (12 listas)',
              },
            ],
          })
        }
        if (url.pathname === '/api/ranked') {
          return json({
            timeZone: 'America/Argentina/Buenos_Aires',
            today: '2026-10-15',
            ranks: [
              { code: 'ultra-1', label: 'Ultra Ball 1' },
              { code: 'ultra-2', label: 'Ultra Ball 2' },
              { code: 'ultra-3', label: 'Ultra Ball 3' },
            ],
            seasons: [],
            current: {
              code: 'B4bSP',
              name: 'Temporada B4b SP',
              endsOn: '2026-10-28',
              rank: { id: '1', at: '2026-10-14T21:10:00.000Z', rank: 'ultra-2', points: null, label: 'Ultra Ball 2' },
            },
            summary: null,
          })
        }
        if (url.pathname === '/api/ranked/ranks' && method === 'POST') {
          ranks.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
          return json(
            { id: '2', at: '2026-10-15T20:00:00.000Z', rank: 'ultra-3', points: null, label: 'Ultra Ball 3' },
            201,
          )
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

  it('14/10: the cards seen of the rival, two copies, an archetype they suggest; they travel with the match', async () => {
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Cartas que vi' }))
    await user.type(within(form).getByRole('searchbox', { name: 'Buscar carta' }), 'Gren')
    await user.click(await within(form).findByRole('button', { name: /Greninja/ }))
    await user.click(within(form).getByRole('button', { name: /Greninja: una copia/ }))
    expect(within(form).getByRole('button', { name: /Greninja: dos copias/ })).toBeInTheDocument()
    // No rival typed: the archetypes the cards suggest; one tap fills the rival.
    await user.click(await within(form).findByRole('button', { name: /Greninja Altaria/ }))
    expect(within(form).getByLabelText('Rival (arquetipo)')).toHaveValue('Greninja Altaria')
    expect(suggested.at(-1)).toBe('A1-89x2')
    await user.click(within(form).getByRole('button', { name: 'Victoria' }))
    await user.click(within(form).getByRole('button', { name: /Guardar partida/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ opponent: 'Greninja Altaria', opponentCards: [{ cardId: 'A1-89', count: 2 }] })
    // The next match starts without them.
    await waitFor(() => expect(within(form).queryByRole('button', { name: /Greninja: dos copias/ })).toBeNull())
  })

  it('Codex on #114: the suggestions of the cards before are not offered while the new ones load, nor if they fail', async () => {
    let release = () => {}
    failing = { cards: 'A1-89x2', gate: new Promise<void>((resolve) => (release = resolve)) }
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Cartas que vi' }))
    await user.type(within(form).getByRole('searchbox', { name: 'Buscar carta' }), 'Gren')
    await user.click(await within(form).findByRole('button', { name: /Greninja/ }))
    expect(await within(form).findByRole('button', { name: /Greninja Altaria/ })).toBeInTheDocument()
    // Two copies now: while their suggestions load, the ones for one copy are gone…
    await user.click(within(form).getByRole('button', { name: /Greninja: una copia/ }))
    await waitFor(() => expect(suggested.at(-1)).toBe('A1-89x2'))
    expect(within(form).queryByRole('button', { name: /Greninja Altaria/ })).toBeNull()
    // …and they do not come back when that request fails.
    release()
    await waitFor(() => expect(within(form).queryByText(/Ninguna lista de la era/)).toBeNull())
    expect(within(form).queryByRole('button', { name: /Greninja Altaria/ })).toBeNull()
  })

  it('14/10: after a competitive win, «¿Cambiaste de rango?» notes the next rank in one tap', async () => {
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Victoria' }))
    await user.click(within(form).getByRole('button', { name: /Guardar partida/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    const ask = await within(form).findByRole('group', { name: '¿Cambiaste de rango?' })
    expect(within(ask).getByText('¿Cambiaste de rango? Estás en Ultra Ball 2.')).toBeInTheDocument()
    await user.click(within(ask).getByRole('button', { name: 'Subí a Ultra Ball 3' }))
    await waitFor(() => expect(ranks).toEqual([{ rank: 'ultra-3' }]))
    await waitFor(() => expect(within(form).queryByRole('group', { name: '¿Cambiaste de rango?' })).toBeNull())
  })

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
      clientRef: expect.stringMatching(/^[0-9a-f-]{36}$/),
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

  it('does not save the match over a rival note being edited (Fase 41)', async () => {
    const user = userEvent.setup()
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Victoria' }))
    await user.click(within(form).getByRole('button', { name: 'Gardevoir ex' }))
    await user.click(await within(form).findByRole('button', { name: 'Editar nota' }))
    expect(within(form).getByRole('button', { name: /Guardar partida/ })).toBeDisabled()
    expect(within(form).getByText(/Guardá o cancelá la nota del rival/)).toBeVisible()
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
    expect(within(form).getByRole('button', { name: /Guardar partida/ })).toBeEnabled()
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
    expect(posted[0]).toEqual({
      deckId: '15',
      result: 'loss',
      opponent: 'garde',
      wentFirst: null,
      mode: 'casual',
      clientRef: expect.any(String),
    })
  })

  it('without signal keeps the match on the phone and sends it once the signal is back (Fase 28)', async () => {
    const user = userEvent.setup()
    const online = vi.mocked(fetch).getMockImplementation()
    let signal = false
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (!signal && String(input).startsWith('/api/matches') && init?.method === 'POST') {
        throw new TypeError('Failed to fetch')
      }
      return (online as typeof fetch)(input, init)
    })
    renderAt('/partidas')
    const form = await screen.findByRole('form', { name: 'Nueva partida' })
    await user.click(within(form).getByRole('button', { name: 'Victoria' }))
    await user.click(within(form).getByRole('button', { name: 'Gardevoir ex' }))
    await user.click(within(form).getByRole('button', { name: /Guardar partida/ }))

    expect(await screen.findByText('Sin enviar (1)')).toBeVisible()
    expect(screen.getByText('Sin señal: quedó en el celu y se envía sola cuando vuelva.')).toBeVisible()
    expect(screen.getAllByText('Victoria con Zoroark ex / Mega-Absol ex contra Gardevoir ex').length).toBeGreaterThan(0)
    expect(within(form).getByRole('button', { name: 'Victoria' })).not.toHaveAttribute('aria-pressed', 'true')
    expect(posted).toHaveLength(0)

    signal = true
    await user.click(screen.getByRole('button', { name: /Enviar ahora/ }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({
      deckId: '7',
      result: 'win',
      opponent: 'Gardevoir ex',
      wentFirst: null,
      mode: 'competitive',
      clientRef: expect.any(String),
      playedAgoMs: expect.any(Number),
    })
    await waitFor(() => expect(screen.queryByText('Sin enviar (1)')).toBeNull())
    expect(await screen.findByText('Se envió la partida guardada sin señal')).toBeVisible()
    expect(localStorage.getItem('tcg.pending-matches')).toBeNull()
  })
})
