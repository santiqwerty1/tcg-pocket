import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { formatDeadline } from '@/lib/packs'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const card = (cardId: string, nameEs: string, decks: string[] = [], owned = 0) => ({
  cardId,
  groupId: cardId,
  nameEs,
  owned,
  decks,
  newEdition: owned === 0,
  belowGoal: owned < 1,
})

/** A pack as the API gives it: the counts from its cards, the shares in percent. */
function pack(packId: string, nameEs: string, cards: ReturnType<typeof card>[], limited = null as unknown) {
  const size = cards.length
  const forDecks = cards.filter((item) => item.decks.length > 0).length
  const newEditions = cards.filter((item) => item.newEdition).length
  const belowGoal = cards.filter((item) => item.belowGoal).length
  return {
    packId,
    nameEs,
    expansionId: packId.split('/')[0],
    expansionNameEs: '',
    size,
    forDecks,
    newEditions,
    belowGoal,
    chanceDecks: (forDecks / size) * 100,
    chanceNew: (newEditions / size) * 100,
    chanceBelowGoal: (belowGoal / size) * 100,
    cards,
    limited,
  }
}

const filler = (prefix: string, count: number, owned = 0) =>
  Array.from({ length: count }, (_, i) => card(`${prefix}-${200 + i}`, `Carta ${prefix} ${i + 1}`, [], owned))

/** Santi's 3/11 numbers: Mega-Mewtwo X first with 4 of 15 for the decks, Suicune second with 3 of 12. */
const MEWTWO = pack('C1/megamewtwoxpack', 'Mega-Mewtwo X', [
  card('C1-158', 'Mew ex', ['3 Mew ex']),
  card('C1-176', 'Mew ex', ['3 Mew ex']),
  card('C1-163', 'Giratina ex', ['3 Mew ex', '8 Giratina']),
  card('C1-181', 'Giratina ex', ['3 Mew ex', '8 Giratina']),
  ...filler('C1', 7),
  ...filler('C1x', 4, 1),
])
const SUICUNE = pack('A4a/suicunepack', 'Suicune', [
  card('A4a-79', 'Entei ex', ['5 Bestias']),
  card('A4a-87', 'Entei ex', ['5 Bestias']),
  card('A4a-80', 'Suicune ex', ['5 Bestias']),
  ...filler('A4a', 9),
])
const CHARIZARD = pack('A1/charizardpack', 'Charizard', filler('A1', 10))
const B4 = pack('B4/ruleroftheskiespack', 'Sobre Hoopa', [...filler('B4', 20), ...filler('B4x', 2, 1)])

function view(overrides: Record<string, unknown> = {}) {
  return {
    rarity: '☆☆',
    today: '2026-11-03',
    deckTarget: 'saved',
    goalCopies: 1,
    goals: [{ id: '3', name: '3 Mew ex', priority: 2, target: 'saved' }],
    lastImportAt: '2026-11-03T02:00:00.000Z',
    packs: [MEWTWO, SUICUNE, CHARIZARD, B4],
    best: ['C1/megamewtwoxpack'],
    coupons: {
      importedAt: '2026-11-03T03:00:00.000Z',
      syncedAt: '2026-11-03T02:43:00.000Z',
      items: [
        {
          key: 'TICKET_2610000_EV_02',
          name: '1 ★★ Card Guaranteed Booster Pack Exchange Tickets',
          count: 1,
          nameEs: 'Cupón del 2.º aniversario',
          until: '2026-12-15T07:00:00Z',
          expired: false,
        },
      ],
    },
    known: [{ key: 'TICKET_2610000_EV_02', nameEs: 'Cupón del 2.º aniversario', until: '2026-12-15T07:00:00Z' }],
    ...overrides,
  }
}

function recommendation() {
  return {
    model: 'corrected',
    alpha: 0.7,
    collection: null,
    onlyAvailable: true,
    limitedBoost: 3,
    today: '2026-11-03',
    goals: { decks: [] },
    rows: [],
    missing: [],
    decks: [],
    collectionOutOfPacks: null,
    assumptions: [],
  }
}

describe('Sobres → Cupón ★★ (3/11/2026)', () => {
  let requests: string[]
  let answer: ReturnType<typeof view>
  let settings: Record<string, unknown>

  beforeEach(() => {
    localStorage.clear()
    requests = []
    answer = view()
    settings = { rarityFilter: null }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        requests.push(`${method} ${url.pathname}${url.search}`)
        if (url.pathname === '/api/settings' && method === 'GET') return json(settings)
        if (url.pathname.startsWith('/api/settings/')) {
          const body = init?.body ? JSON.parse(String(init.body)) : undefined
          return json({ key: url.pathname.split('/').pop(), value: body?.value })
        }
        if (url.pathname === '/api/packs/star-coupon') return json(answer)
        if (url.pathname === '/api/packs/recommend') return json(recommendation())
        if (url.pathname === '/api/packs') return json({ items: [] })
        if (url.pathname === '/api/rarity-rules') return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderSobres() {
    const router = createMemoryRouter(routes, { initialEntries: ['/sobres'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <Providers queryClient={queryClient}>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  const starRequests = () => requests.filter((request) => request.includes('/api/packs/star-coupon'))

  async function open() {
    const user = userEvent.setup()
    renderSobres()
    await user.click(await screen.findByText('Cupón ★★: qué sobre conviene'))
    await screen.findByTestId('star-coupons')
    return user
  }

  it('asks only when it opens, with the page’s knobs', async () => {
    const user = userEvent.setup()
    renderSobres()
    const title = await screen.findByText('Cupón ★★: qué sobre conviene')
    await screen.findByRole('heading', { name: 'Objetivos' })
    expect(starRequests()).toEqual([])
    await user.click(title)
    await screen.findByTestId('star-coupons')
    expect(starRequests()).toEqual(['GET /api/packs/star-coupon?deckTarget=saved&copies=1'])
  })

  it('the best pack with why, both shares per pack, the cards for the decks and the new ones; «Ver todos»', async () => {
    const user = await open()
    const pick = screen.getByText(
      (_, element) => element?.tagName === 'P' && /^Conviene /.test(element.textContent ?? ''),
    )
    expect(pick).toHaveTextContent('Conviene Mega-Mewtwo X · C1: de sus 15 ★★, 4 les sirven a tus mazos (26,7 %).')
    const rows = screen.getAllByTestId('star-coupon-pack')
    expect(rows).toHaveLength(3)
    const first = within(rows[0] as HTMLElement)
    expect(first.getByText('Conviene')).toBeInTheDocument()
    expect(first.getByText('26,7 %')).toBeInTheDocument()
    expect(first.getByTestId('star-coupon-line')).toHaveTextContent('15 ★★ · 4 para mazos · 11 nuevas (73,3 %)')
    expect(first.getByText('C1-158')).toBeInTheDocument()
    expect(first.getAllByText(/falta en 3 Mew ex, 8 Giratina/)).toHaveLength(2)
    const second = within(rows[1] as HTMLElement)
    expect(second.getByText('Suicune · A4a')).toBeInTheDocument()
    expect(second.getByText('25 %')).toBeInTheDocument()
    expect(second.getByTestId('star-coupon-line')).toHaveTextContent('12 ★★ · 3 para mazos · 12 nuevas (100 %)')
    expect(second.queryByText('Conviene')).toBeNull()
    // The fourth pack after «Ver todos».
    expect(screen.queryByText('Sobre Hoopa · B4')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver todos (4)' }))
    expect(screen.getAllByTestId('star-coupon-pack')).toHaveLength(4)
    expect(screen.getByText('Sobre Hoopa · B4')).toBeInTheDocument()
    // The coupon and its deadline, in Buenos Aires; the assumption.
    expect(screen.getByText('1 cupón ★★')).toBeInTheDocument()
    expect(screen.getByText(/Cupón del 2\.º aniversario, hasta el 15\/12, 03:59/)).toBeInTheDocument()
    expect(screen.getByText(/todas las ★★ de un sobre con la misma chance/)).toBeInTheDocument()
  })

  it('ties: «Empata con …»; without deck goals, it says the order comes from the new editions', async () => {
    answer = view({
      goals: [],
      packs: [
        pack('A1/charizardpack', 'Charizard', filler('A1', 10)),
        pack('A1/pikachupack', 'Pikachu', filler('A1p', 10)),
        B4,
      ],
      best: ['A1/charizardpack', 'A1/pikachupack'],
    })
    await open()
    expect(screen.getByText(/es el sobre con más ediciones que no tenés \(10 de 10, 100 %\)/)).toBeInTheDocument()
    expect(screen.getByText('Empata con Pikachu · A1.')).toBeInTheDocument()
    const rows = screen.getAllByTestId('star-coupon-pack')
    expect(within(rows[1] as HTMLElement).getByText('Empata')).toBeInTheDocument()
    expect(screen.getByText(/Ningún mazo tiene prioridad de sobres/)).toBeInTheDocument()
  })

  it('coupons: unknown with an older bookmarklet, a link without imports; the anniversary’s deadline anyway', async () => {
    answer = view({ coupons: { importedAt: 'x', syncedAt: '2026-11-02T02:43:00.000Z', items: null } })
    await open()
    expect(screen.getByText(/es de un marcador anterior/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Copiá el marcador nuevo' })).toHaveAttribute(
      'href',
      '/coleccion/pokemon-zone',
    )
    expect(screen.getByText('Cupón del 2.º aniversario: hasta el 15/12, 03:59.')).toBeInTheDocument()
  })

  it('without imports: how to bring them', async () => {
    answer = view({ coupons: null })
    await open()
    expect(screen.getByRole('link', { name: 'traelos del juego con pokemon-zone' })).toBeInTheDocument()
    expect(screen.getByText('Cupón del 2.º aniversario: hasta el 15/12, 03:59.')).toBeInTheDocument()
  })

  it('none, or only an expired one: «No tenés cupones ★★», with the deadline apart', async () => {
    answer = view({
      coupons: {
        importedAt: 'x',
        syncedAt: '2026-12-15T08:00:00.000Z',
        items: [
          {
            key: 'TICKET_2610000_EV_02',
            name: '1 ★★ Card Guaranteed Booster Pack Exchange Tickets',
            count: 1,
            nameEs: 'Cupón del 2.º aniversario',
            until: '2026-12-15T07:00:00Z',
            expired: true,
          },
        ],
      },
    })
    vi.useFakeTimers({ now: new Date('2026-12-16T12:00:00Z'), toFake: ['Date'] })
    try {
      await open()
      expect(screen.getByText('No tenés cupones ★★.')).toBeInTheDocument()
      expect(screen.queryByText(/cupón ★★$/)).toBeNull()
      expect(screen.getByText('Cupón del 2.º aniversario: venció el 15/12, 03:59.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows «Apuntar a la versión de torneo» and «Copias por edición» before they are saved', async () => {
    settings = { rarityFilter: { rarities: [], copies: 1 } }
    const user = await open()
    expect(starRequests()).toEqual(['GET /api/packs/star-coupon?deckTarget=saved&copies=1'])
    await user.click(screen.getByRole('switch', { name: /Apuntar a la versión de torneo/ }))
    await waitFor(() => expect(starRequests()).toContain('GET /api/packs/star-coupon?deckTarget=tournament&copies=1'))
    await user.click(screen.getByRole('button', { name: 'Tener 2' }))
    await waitFor(() => expect(starRequests()).toContain('GET /api/packs/star-coupon?deckTarget=tournament&copies=2'))
  })
})

describe('formatDeadline', () => {
  it('says the minute before, in Buenos Aires, with the year only when it is another one', () => {
    const now = new Date('2026-11-03T12:00:00Z')
    expect(formatDeadline('2026-12-15T07:00:00Z', now)).toBe('15/12, 03:59')
    expect(formatDeadline('2027-01-02T03:00:00Z', now)).toBe('01/01/2027, 23:59')
  })
})
