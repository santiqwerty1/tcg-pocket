import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const card = (
  cardId: string,
  nameEs: string,
  owned: number,
  extra: { newCard?: boolean; decks?: string[]; inCatalog?: boolean } = {},
) => ({
  cardId,
  groupId: cardId,
  nameEs,
  inCatalog: extra.inCatalog ?? true,
  owned,
  missing: owned === 0,
  newCard: extra.newCard ?? false,
  decks: extra.decks ?? [],
})

function volume(id: string, cards: ReturnType<typeof card>[], inEvent: boolean, wins: number) {
  const size = cards.length
  const missing = cards.filter((item) => item.missing).length
  const newCards = cards.filter((item) => item.newCard).length
  const deckCards = cards.filter((item) => item.decks.length > 0).length
  const useful = cards.filter((item) => item.missing || item.decks.length > 0).length
  return {
    id,
    series: id.slice(0, 1),
    volume: Number(id.slice(1)),
    cards,
    missing,
    chanceMissing: missing / size,
    chanceNew: newCards / size,
    chanceDecks: deckCards / size,
    chanceUseful: useful / size,
    newCards,
    deckCards,
    reason: deckCards > 0 ? 'decks' : newCards > 0 ? 'new' : missing > 0 ? 'missing' : null,
    winsToComplete: wins,
    couponSavesNow: missing > 0 ? size / missing : null,
    inEvent,
  }
}

const b1 = (decks: string[] = []) =>
  volume(
    'B1',
    [
      card('P-B-2', 'Petilil', 0, { newCard: true }),
      card('P-B-3', 'Froakie', 1),
      card('P-B-4', 'Luxray', 0, { newCard: true }),
      card('P-B-5', 'Pidgey', 0),
      card('P-B-6', 'Mega-Pidgeot ex', 0, { newCard: true, decks }),
    ],
    true,
    10.42,
  )
const B11 = volume(
  'B11',
  [
    card('P-B-80', 'Mega-Houndoom ex', 0, { newCard: true }),
    card('P-B-81', 'Carvanha', 0, { newCard: true }),
    card('P-B-82', 'Pikachu', 0),
    card('P-B-83', 'Noivern', 0, { newCard: true }),
    card('P-B-84', 'Skitty', 1),
  ],
  true,
  10.42,
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
const COLLECTION_AT = '2026-10-30T15:55:55.985Z'

/** Serves `/api/promo-packs` with `answer` (a function: one answer per call). */
function renderPromo(answer: unknown | (() => unknown), queryClient = client()) {
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

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const advice = async () => (await screen.findByText(/^Conviene ganar/, {}, { timeout: 5000 })).textContent

describe('sobres de promoción', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says which battle to win and why, the ties, what each volume lacks and where a coupon pays', async () => {
    const user = userEvent.setup()
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11, A7, B12, A1],
      best: ['B1', 'B11'],
      pick: 'B11',
      totals: { volumes: 4, cards: 20, missing: 9, winsToComplete: 25.84 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await screen.findByText('Evento botín bis PROMO 2026', {}, { timeout: 5000 })).toBeInTheDocument()
    // The game says «hasta las 02:59»: the minute before `until`.
    expect(screen.getByText(/^Hasta el /).textContent).toContain(
      new Intl.DateTimeFormat('es-AR', { timeStyle: 'short' }).format(new Date('2026-11-13T05:59:00Z')),
    )
    // The drawn one, not the first of the list, and why.
    expect(await advice()).toBe(
      'Conviene ganar B vol. 11: es la que más chance tiene de darte una carta que no tenés en ninguna versión (60 %).',
    )
    expect(screen.getByText(/^Empata en todo: B vol\. 1\. Te sugiero uno al azar/)).toBeInTheDocument()
    expect(screen.getByText(/te faltan 9 cartas de 20: ~26 victorias/)).toBeInTheDocument()

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
    const [first, eleventh, seventh, twelfth] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText('Empata')).toBeInTheDocument()
    expect(within(first).queryByText('Conviene')).toBeNull()
    expect(within(eleventh).getByText('Conviene')).toBeInTheDocument()
    expect(within(seventh).getByText('falta 1 de 5')).toBeInTheDocument()
    expect(
      within(seventh).getByText('nueva en ninguna versión: 20 % · ~5 victorias para completarlo'),
    ).toBeInTheDocument()
    expect(within(seventh).queryByText(/Conviene|Empata/)).toBeNull()
    expect(within(twelfth).getByText('completo')).toBeInTheDocument()
    // A vol. 1 has no battle now: not among the event's volumes.
    expect(within(list).queryByText('A vol. 1')).toBeNull()

    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    expect(within(coupons).getByText(/por una carta de promoción, si la tienda la tiene/)).toBeInTheDocument()
    expect(within(coupons).getByText(/Antes de que termine el evento, canjealos igual\./)).toBeInTheDocument()
    expect(within(coupons).queryByText('Para tus mazos')).toBeNull()
    const [last, withoutBattle] = within(coupons).getAllByRole('list') as [HTMLElement, HTMLElement]
    expect(
      within(last)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['A vol. 7 · Rayquaza ex · ahorra ~5 victorias'])
    expect(
      within(coupons).getByText(/^Sin batalla en este evento \(1 carta\): solo con cupón, si la tienda la tiene\.$/),
    ).toBeInTheDocument()
    expect(within(withoutBattle).getByRole('listitem').textContent).toBe('A vol. 1 · Butterfree')
  })

  it('a card a deck lacks wins and says so; a coupon for it saves every win', async () => {
    const user = userEvent.setup()
    const withDeck = b1(['7. Pidgeot'])
    renderPromo({
      event: EVENT,
      volumes: [withDeck, B11],
      best: ['B1'],
      pick: 'B1',
      totals: { volumes: 2, cards: 10, missing: 7, winsToComplete: 20.84 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await advice()).toBe(
      'Conviene ganar B vol. 1: es la que más chance tiene de darte una carta que le falta a tus mazos (20 %: Mega-Pidgeot ex).',
    )
    expect(screen.queryByText(/^Empata/)).toBeNull()
    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    const [forDecks] = within(coupons).getAllByRole('list') as [HTMLElement]
    expect(within(coupons).getByText('Para tus mazos')).toBeInTheDocument()
    expect(within(forDecks).getByRole('listitem').textContent).toBe(
      'Mega-Pidgeot ex · B vol. 1 · para 7. Pidgeot · ahorra ~5 victorias',
    )
    expect(within(coupons).getByText('A ningún volumen del evento le falta 1 sola carta todavía.')).toBeInTheDocument()
  })

  it('asks again each time the page opens, not on coming back to the window', async () => {
    let draws = 0
    const answer = () => {
      draws += 1
      return {
        event: EVENT,
        volumes: [b1(), B11],
        best: ['B1', 'B11'],
        pick: draws === 1 ? 'B1' : 'B11',
        totals: { volumes: 2, cards: 10, missing: 7, winsToComplete: 20.84 },
        lastImportAt: COLLECTION_AT,
      }
    }
    // Even with a long default staleTime the page asks again.
    const router = renderPromo(
      answer,
      new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } }),
    )
    expect(await advice()).toMatch(/^Conviene ganar B vol\. 1:/)
    // Back from the game: the same suggestion.
    // TanStack Query's focus manager listens to «visibilitychange» on window.
    window.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(draws).toBe(1)
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
    renderPromo({
      event: { ...EVENT, volumes: ['B12'] },
      volumes: [needed],
      best: ['B12'],
      pick: 'B12',
      totals: { volumes: 1, cards: 5, missing: 0, winsToComplete: 0 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await advice()).toBe(
      'Conviene ganar B vol. 12: es la que más chance tiene de darte una carta que le falta a tus mazos (20 %: Scyther del Team Rocket).',
    )
    expect(screen.getByText('faltan copias para tus mazos')).toBeInTheDocument()
    expect(screen.queryByText(/te faltan 0 cartas/)).toBeNull()
    // The coupons still help the deck.
    expect(screen.getByText('Cupones')).toBeInTheDocument()
  })

  it('names the date of the collection without a double period after «p. m.»', async () => {
    renderPromo({
      event: EVENT,
      volumes: [A7],
      best: ['A7'],
      pick: 'A7',
      totals: { volumes: 1, cards: 5, missing: 1, winsToComplete: 5 },
      lastImportAt: '2026-10-30T21:16:00Z',
    })
    const note = await screen.findByText(/abriste sobres de promoción después/, {}, { timeout: 5000 })
    expect(note.textContent).toMatch(/^Colección del .+: si abriste sobres de promoción después, actualizala\.$/)
    expect(note.textContent).not.toContain('..')
  })

  it('without an event there is no battle: no advice, no badges, no coupons, only what is missing', async () => {
    renderPromo({
      event: null,
      volumes: [
        { ...b1(), inEvent: false },
        { ...B12, inEvent: false },
      ],
      best: [],
      pick: null,
      totals: { volumes: 2, cards: 10, missing: 4, winsToComplete: 10.42 },
      lastImportAt: COLLECTION_AT,
    })
    expect(
      await screen.findByText(
        /No hay un evento de sobres de promoción en curso, así que no hay batallas/,
        {},
        {
          timeout: 5000,
        },
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('De los sobres de promoción te faltan 4 cartas de 10.')).toBeInTheDocument()
    expect(screen.queryByText('Qué batalla ganar')).toBeNull()
    expect(screen.queryByText(/Conviene|Empata/)).toBeNull()
    expect(screen.queryByText(/victorias/)).toBeNull()
    expect(screen.queryByText('Cupones')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Volúmenes' })).toBeInTheDocument()
  })

  it('without an event and with every promo, there is nothing missing', async () => {
    renderPromo({
      event: null,
      volumes: [{ ...B12, inEvent: false }],
      best: [],
      pick: null,
      totals: { volumes: 1, cards: 5, missing: 0, winsToComplete: 0 },
      lastImportAt: COLLECTION_AT,
    })
    expect(
      await screen.findByText('Ya tenés todas las promos de los sobres', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('without a collection it asks to import one instead of advising', async () => {
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11],
      best: ['B1', 'B11'],
      pick: 'B1',
      totals: { volumes: 2, cards: 10, missing: 7, winsToComplete: 20.84 },
      lastImportAt: null,
    })
    expect(await screen.findByText('Todavía no hay una colección importada', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/^Conviene ganar/)).toBeNull()
    expect(screen.queryByText('Cupones')).toBeNull()
    expect(screen.getByRole('link', { name: 'Ir a Colección' })).toBeInTheDocument()
  })

  it('a promo the catalog does not know yet shows its id without a link', async () => {
    const future = volume(
      'B13',
      [card('P-B-96', 'Falinks', 1), card('P-B-999', 'P-B-999', 0, { newCard: true, inCatalog: false })],
      true,
      2,
    )
    renderPromo({
      event: { ...EVENT, volumes: ['B13'] },
      volumes: [future],
      best: ['B13'],
      pick: 'B13',
      totals: { volumes: 1, cards: 2, missing: 1, winsToComplete: 2 },
      lastImportAt: COLLECTION_AT,
    })
    expect(
      await screen.findByText('P-B-999 (todavía no está en el catálogo)', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /P-B-999/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Falinks/ })).toBeInTheDocument()
  })
})
