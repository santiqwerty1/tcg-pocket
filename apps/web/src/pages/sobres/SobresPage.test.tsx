import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const ref = (packId: string, nameEs: string) => ({
  packId,
  nameEs,
  expansionId: packId.split('/')[0],
  expansionNameEs: '',
})

function recommendation(model: 'corrected' | 'tracker') {
  const b4b = model === 'corrected' ? 100 / 70 : 0
  return {
    model,
    alpha: 0.7,
    collection: null,
    onlyAvailable: true,
    goals: { decks: [{ id: '13', name: 'Hoopa ex / Mega-Absol ex', priority: 3 }] },
    rows: [
      {
        ...ref('B4b/deluxepackmega', 'Sobre Deluxe Mega'),
        available: true,
        cardsPerPack: 4,
        wanted: 1,
        probability: b4b,
        expected: b4b / 100,
        expectedValue: (3 * b4b) / 100,
        packsFor50: model === 'corrected' ? 49 : null,
        packsFor90: model === 'corrected' ? 161 : null,
        decks: { probability: b4b, expected: b4b / 100 },
        collection: null,
        otherModel: {
          model: model === 'corrected' ? 'tracker' : 'corrected',
          probability: model === 'corrected' ? 0 : 100 / 70,
          reasons: ['reprints'],
        },
      },
    ],
    missing: [
      {
        groupId: 'B4-103',
        nameEs: 'Hoopa ex',
        missing: 1,
        weight: 3,
        decks: [{ deckId: '13', name: 'Hoopa ex / Mega-Absol ex', priority: 3, need: 2 }],
        cheapest: { cardId: 'B4-103', rarity: '◊◊◊◊', points: 500, verified: false, tradeable: true },
        bestPack: { ...ref('B4b/deluxepackmega', 'Sobre Deluxe Mega'), probability: 100 / 70, packsPerCopy: 70 },
        pointsInPacks: 100,
        advice: 'open',
      },
    ],
    decks: [
      {
        deckId: '13',
        name: 'Hoopa ex / Mega-Absol ex',
        priority: 3,
        missingCopies: 1,
        notInPacks: [],
        bestPacks: [
          {
            ...ref('B4b/deluxepackmega', 'Sobre Deluxe Mega'),
            covered: 1,
            expectedPacks: 70,
            method: 'exact',
            ci95: null,
          },
        ],
      },
    ],
    assumptions: ['Tasas constantes.'],
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Sobres page (Fase 4)', () => {
  let requests: { method: string; path: string; body: unknown }[]

  beforeEach(() => {
    requests = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ method, path: url.pathname, body })
        if (url.pathname === '/api/settings' && method === 'GET') return json({ rarityFilter: null })
        if (url.pathname.startsWith('/api/settings/'))
          return json({ key: url.pathname.split('/').pop(), value: body?.value })
        if (url.pathname === '/api/packs/recommend') return json(recommendation(body?.model ?? 'corrected'))
        if (url.pathname === '/api/packs') return json({ items: [] })
        if (url.pathname === '/api/rarity-rules') return json({ items: [] })
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
  }

  it('shows the best pack, the missing card with its cost and the packs to complete the deck', async () => {
    renderAt('/sobres')
    expect(await screen.findByText('Sobre Deluxe Mega · B4b')).toBeInTheDocument()
    expect(screen.getByText('1,43 %')).toBeInTheDocument()
    expect(screen.getByText(/Modelo tracker: 0 %, porque el tracker no cuenta reimpresiones/)).toBeInTheDocument()
    expect(screen.getByText(/500 puntos \(sin verificar\)/)).toBeInTheDocument()
    expect(screen.getByText(/Sobre Deluxe Mega · B4b: todas en ~\s*70 sobres/)).toBeInTheDocument()
    // The goals come from the decks with a pack priority; the first request carries the saved knobs.
    expect(screen.getByText('Hoopa ex / Mega-Absol ex', { selector: 'span' })).toBeInTheDocument()
    expect(requests.find((r) => r.path === '/api/packs/recommend')?.body).toEqual({
      model: 'corrected',
      alpha: 0.7,
      collection: null,
      onlyAvailable: true,
    })
  })

  it('the tracker switch saves the setting and asks again with the tracker model', async () => {
    const user = userEvent.setup()
    renderAt('/sobres')
    await screen.findByText('1,43 %')
    const goals = screen.getByRole('heading', { name: 'Objetivos' }).closest('section') as HTMLElement
    await user.click(within(goals).getByRole('switch', { name: 'Modelo del tracker' }))
    await waitFor(() =>
      expect(requests.some((r) => r.path === '/api/settings/packModel' && r.method === 'PUT')).toBe(true),
    )
    await waitFor(() =>
      expect(
        requests.some((r) => r.path === '/api/packs/recommend' && (r.body as { model: string }).model === 'tracker'),
      ).toBe(true),
    )
    expect(await screen.findByText('0 %')).toBeInTheDocument()
  })
})
