import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const card = (cardId: string, nameEs: string, owned: number, extra: { newCard?: boolean; decks?: string[] } = {}) => ({
  cardId,
  groupId: cardId,
  nameEs,
  owned,
  missing: owned === 0,
  newCard: extra.newCard ?? false,
  decks: extra.decks ?? [],
})

function volume(id: string, cards: ReturnType<typeof card>[], inEvent: boolean, wins: number) {
  const missing = cards.filter((item) => item.missing).length
  const useful = cards.filter((item) => item.missing || item.decks.length > 0).length
  return {
    id,
    series: id.slice(0, 1),
    volume: Number(id.slice(1)),
    cards,
    missing,
    chanceMissing: missing / cards.length,
    chanceUseful: useful / cards.length,
    newCards: cards.filter((item) => item.newCard).length,
    deckCards: cards.filter((item) => item.decks.length > 0).length,
    winsToComplete: wins,
    couponSavesNow: missing > 0 ? cards.length / missing : null,
    inEvent,
  }
}

const B1 = volume(
  'B1',
  [
    card('P-B-2', 'Petilil', 0, { newCard: true }),
    card('P-B-3', 'Froakie', 0, { newCard: true }),
    card('P-B-4', 'Luxray', 0, { newCard: true }),
    card('P-B-5', 'Pidgey', 0),
    card('P-B-6', 'Mega-Pidgeot ex', 0, { newCard: true, decks: ['7. Pidgeot'] }),
  ],
  true,
  11.42,
)
const B11 = volume(
  'B11',
  [
    card('P-B-80', 'Mega-Houndoom ex', 0, { newCard: true }),
    card('P-B-81', 'Carvanha', 0, { newCard: true }),
    card('P-B-82', 'Pikachu', 0),
    card('P-B-83', 'Noivern', 0, { newCard: true }),
    card('P-B-84', 'Skitty', 0, { newCard: true }),
  ],
  true,
  11.42,
)
const A7 = volume(
  'A7',
  [
    card('P-A-60', 'Exeggcute', 1),
    card('P-A-61', 'Froakie', 4),
    card('P-A-62', "Farfetch'd", 4),
    card('P-A-63', 'Rayquaza', 2),
    card('P-A-64', 'Rayquaza ex', 0, { newCard: true }),
  ],
  true,
  5,
)
const B12 = volume(
  'B12',
  [
    card('P-B-88', 'Scyther del Team Rocket', 2),
    card('P-B-89', 'Lapras del Team Rocket', 2),
    card('P-B-90', 'Wingull', 5),
    card('P-B-91', 'Wobbuffet del Team Rocket', 4),
    card('P-B-92', 'Marowak', 2),
  ],
  true,
  0,
)
const A1 = volume(
  'A1',
  [
    card('P-A-13', 'Butterfree', 0),
    card('P-A-14', 'Lapras ex', 1),
    card('P-A-15', 'Pikachu', 1),
    card('P-A-16', 'Clefairy', 1),
    card('P-A-17', 'Mankey', 1),
  ],
  false,
  5,
)

const EVENT = {
  id: 'botin-bis-promo-2026',
  nameEs: 'Evento botín bis PROMO 2026',
  from: '2026-10-30T06:00:00Z',
  until: '2026-11-13T06:00:00Z',
  volumes: ['A7', 'B1', 'B11', 'B12'],
}

/** Serves `/api/promo-packs` with `answer` (a function: one answer per call). */
function renderPromo(answer: unknown | (() => unknown), queryClient = new QueryClient()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/promo-packs') return json(typeof answer === 'function' ? answer() : answer)
      return json({ error: { code: 'not_found', message: 'no' } }, 404)
    }),
  )
  const router = createMemoryRouter(routes, { initialEntries: ['/sobres/promo'] })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('sobres de promoción', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says which battle to win (the drawn one), the ties, what each volume lacks and where a coupon pays', async () => {
    const user = userEvent.setup()
    renderPromo(
      {
        event: EVENT,
        volumes: [B1, B11, A7, B12, A1],
        best: ['B1', 'B11'],
        pick: 'B11',
        totals: { volumes: 4, cards: 20, missing: 11, winsToComplete: 27.84 },
        lastImportAt: '2026-10-30T15:55:55.985Z',
      },
      client(),
    )
    expect(await screen.findByText('Evento botín bis PROMO 2026', {}, { timeout: 5000 })).toBeInTheDocument()
    // The game says «hasta las 02:59»: the minute before `until`.
    expect(screen.getByText(/^Hasta el /).textContent).toContain(
      new Intl.DateTimeFormat('es-AR', { timeStyle: 'short' }).format(new Date('2026-11-13T05:59:00Z')),
    )
    // The drawn one, not the first of the list.
    expect(screen.getByText(/^Conviene ganar/).textContent).toBe(
      'Conviene ganar B vol. 11: cada victoria te da seguro una carta que te falta; 4 cartas no las tenés en ninguna versión.',
    )
    expect(screen.getByText(/^Empata con la misma chance: B vol\. 1\. Te sugiero uno al azar/)).toBeInTheDocument()
    expect(screen.getByText(/te faltan 11 cartas de 20: ~28 victorias/)).toBeInTheDocument()

    const list = screen.getByRole('heading', { name: 'Volúmenes del evento' }).closest('section') as HTMLElement
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement?.parentElement === list) as HTMLElement[]
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'B vol. 1',
      'B vol. 11',
      'A vol. 7',
      'B vol. 12',
    ])
    const [b1, b11, a7, b12] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    expect(within(b1).getByText('Empata')).toBeInTheDocument()
    expect(within(b1).queryByText('Conviene')).toBeNull()
    expect(within(b1).getByText(/falta en 7\. Pidgeot/)).toBeInTheDocument()
    expect(within(b11).getByText('Conviene')).toBeInTheDocument()
    expect(within(a7).getByText('falta 1 de 5')).toBeInTheDocument()
    expect(within(a7).getByText('~5 victorias para completarlo')).toBeInTheDocument()
    expect(within(a7).queryByText(/Conviene|Empata/)).toBeNull()
    expect(within(b12).getByText('completo')).toBeInTheDocument()
    // A vol. 1 has no battle now: not among the event's volumes.
    expect(within(list).queryByText('A vol. 1')).toBeNull()

    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    expect(within(coupons).getByText(/Así que ganá hasta que te falte 1 y canjeá esa/)).toBeInTheDocument()
    const [now, withoutBattle] = within(coupons).getAllByRole('list') as [HTMLElement, HTMLElement]
    // Only the volume with one card missing: a coupon there saves every win.
    expect(
      within(now)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['A vol. 7 · Rayquaza ex · ahorra ~5 victorias'])
    expect(
      within(coupons).getByText(/^Sin batalla en este evento \(1 carta\): solo con cupón, si la tienda la tiene\.$/),
    ).toBeInTheDocument()
    expect(within(withoutBattle).getByRole('listitem').textContent).toBe('A vol. 1 · Butterfree')
  })

  it('asks again each time the page opens, so another tied volume can come up', async () => {
    let draws = 0
    const answer = () => {
      draws += 1
      return {
        event: EVENT,
        volumes: [B1, B11],
        best: ['B1', 'B11'],
        pick: draws === 1 ? 'B1' : 'B11',
        totals: { volumes: 2, cards: 10, missing: 10, winsToComplete: 22.84 },
        lastImportAt: null,
      }
    }
    // Even with a long default staleTime the page asks again.
    const router = renderPromo(
      answer,
      new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }),
    )
    const advice = await screen.findByText(/^Conviene ganar/, {}, { timeout: 5000 })
    expect(advice.textContent).toMatch(/^Conviene ganar B vol\. 1:/)
    await router.navigate('/sobres')
    // Out of the page for real (the navigation is a transition), then back.
    await vi.waitFor(() => expect(screen.queryByText(/^Conviene ganar/)).toBeNull(), { timeout: 5000 })
    await router.navigate('/sobres/promo')
    await vi.waitFor(
      () => expect(screen.getByText(/^Conviene ganar/).textContent).toMatch(/^Conviene ganar B vol\. 11:/),
      { timeout: 5000 },
    )
    expect(draws).toBe(2)
  })

  it('a complete volume a deck still needs copies of says so, and the totals line goes away', async () => {
    const needed = volume(
      'B12',
      [
        card('P-B-88', 'Scyther del Team Rocket', 1, { decks: ['12. Team Rocket'] }),
        card('P-B-89', 'Lapras del Team Rocket', 2),
        card('P-B-90', 'Wingull', 5),
        card('P-B-91', 'Wobbuffet del Team Rocket', 4),
        card('P-B-92', 'Marowak', 2),
      ],
      true,
      0,
    )
    renderPromo(
      {
        event: { ...EVENT, volumes: ['B12'] },
        volumes: [needed],
        best: ['B12'],
        pick: 'B12',
        totals: { volumes: 1, cards: 5, missing: 0, winsToComplete: 0 },
        lastImportAt: null,
      },
      client(),
    )
    const advice = await screen.findByText(/^Conviene ganar/, {}, { timeout: 5000 })
    expect(advice.textContent).toBe(
      'Conviene ganar B vol. 12: 20 % de que una victoria te dé una carta que te falta; a tus mazos les falta 1 carta de este volumen.',
    )
    expect(screen.getByText('faltan copias para tus mazos')).toBeInTheDocument()
    expect(screen.queryByText(/te faltan 0 cartas/)).toBeNull()
    expect(screen.queryByText('Cupones')).toBeNull()
  })

  it('names the date of the collection without a double period after «p. m.»', async () => {
    renderPromo(
      {
        event: EVENT,
        volumes: [A7],
        best: ['A7'],
        pick: 'A7',
        totals: { volumes: 1, cards: 5, missing: 1, winsToComplete: 5 },
        lastImportAt: '2026-10-30T21:16:00Z',
      },
      client(),
    )
    const note = await screen.findByText(/abriste sobres de promoción después/, {}, { timeout: 5000 })
    expect(note.textContent).toMatch(/^Colección del .+: si abriste sobres de promoción después, actualizala\.$/)
    expect(note.textContent).not.toContain('..')
  })

  it('without an event and with every promo, there is nothing to win', async () => {
    renderPromo(
      {
        event: null,
        volumes: [{ ...B12, inEvent: false }],
        best: [],
        pick: null,
        totals: { volumes: 1, cards: 5, missing: 0, winsToComplete: 0 },
        lastImportAt: null,
      },
      client(),
    )
    expect(
      await screen.findByText('Ya tenés todas las promos de los sobres', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/No hay un evento de sobres de promoción en curso/)).toBeInTheDocument()
    expect(screen.queryByText('Cupones')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Volúmenes' })).toBeInTheDocument()
  })
})
