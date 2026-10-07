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
    limitedBoost: 2,
    today: '2026-10-07',
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
        limited: {
          until: '2026-10-28',
          daysLeft: 21,
          exclusive: [{ cardId: 'B4b-237', nameEs: 'Bulbasaur', rarity: '◊', holo: true, goal: 'collection' }],
        },
      },
      {
        ...ref('A4b/deluxepack', 'Sobre Deluxe ex'),
        available: false,
        cardsPerPack: 4,
        wanted: 0,
        probability: 0,
        expected: 0,
        expectedValue: 0,
        packsFor50: null,
        packsFor90: null,
        decks: { probability: 0, expected: 0 },
        collection: null,
        otherModel: { model: model === 'corrected' ? 'tracker' : 'corrected', probability: 0, reasons: [] },
        limited: null,
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
        tradeable: true,
        bestPack: {
          ...ref('B4b/deluxepackmega', 'Sobre Deluxe Mega'),
          probability: 100 / 70,
          packsPerCopy: 70,
          limited: true,
        },
        afterLimited: { ...ref('B4/ruleroftheskiespack', 'Sobre Hoopa'), probability: 1.064, packsPerCopy: 94 },
        pointsInPacks: 100,
        advice: 'open',
      },
      {
        groupId: 'P-A-7',
        nameEs: 'Investigación de Profesores',
        missing: 1,
        weight: 1,
        decks: [{ deckId: '13', name: 'Hoopa ex / Mega-Absol ex', priority: 3, need: 2 }],
        cheapest: null,
        tradeable: true,
        bestPack: null,
        afterLimited: null,
        pointsInPacks: null,
        advice: 'trade',
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
            limited: true,
            expectedPacks: 70,
            method: 'exact',
            ci95: null,
          },
        ],
      },
    ],
    collectionOutOfPacks: null,
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
      limitedBoost: 2,
    })
  })

  it('limited time: badge, days left, the versions only it gives, the pack after it ends and «intercambiar»', async () => {
    const user = userEvent.setup()
    renderAt('/sobres')
    expect(await screen.findByText('limitado')).toBeInTheDocument()
    expect(screen.getByText('Hasta el 28/10 · quedan 21 días')).toBeInTheDocument()
    expect(screen.getByText(/Solo de este sobre: 1 carta buscada, pesan ×2/)).toBeInTheDocument()
    expect(screen.getByText(/Bulbasaur ◊ holo/)).toBeInTheDocument()
    expect(screen.getByText('no disponible')).toBeInTheDocument()
    expect(screen.getByText(/Cuando termine: Sobre Hoopa · B4 · 1,06 %/)).toBeInTheDocument()
    expect(screen.getByText('intercambiar')).toBeInTheDocument()
    expect(screen.getByText('No sale de ningún sobre a la venta; se puede intercambiar')).toBeInTheDocument()
    // The weight of the limited packs is saved and asked again.
    expect(screen.getByText(/Sobre Deluxe Mega: hasta el 28\/10 · quedan 21 días/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '×3' }))
    await waitFor(() =>
      expect(requests.some((r) => r.path === '/api/settings/limitedBoost' && r.method === 'PUT')).toBe(true),
    )
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.path === '/api/packs/recommend' && (r.body as { limitedBoost: number }).limitedBoost === 3,
        ),
      ).toBe(true),
    )
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
    await waitFor(() => {
      const row = screen.getByText('Sobre Deluxe Mega · B4b').closest('li') as HTMLElement
      expect(within(row).getByText('0 %')).toBeInTheDocument()
    })
  })
})
