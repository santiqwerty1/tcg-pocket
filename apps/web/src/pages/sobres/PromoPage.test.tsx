import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Copies of each print the goal asks for. */
const GOAL = 2

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
  needed: Math.max(0, GOAL - owned),
  missing: owned < GOAL,
  newCard: extra.newCard ?? false,
  decks: extra.decks ?? [],
})

/** `wins` and `coupon` as @tcg/domain's winsToComplete and couponSavesNow give them for these cards. */
function volume(id: string, cards: ReturnType<typeof card>[], inEvent: boolean, wins: number, coupon = 1) {
  const size = cards.length
  const missing = cards.filter((item) => item.missing).length
  const copiesMissing = cards.reduce((sum, item) => sum + item.needed, 0)
  const newCards = cards.filter((item) => item.newCard).length
  const deckCards = cards.filter((item) => item.decks.length > 0).length
  const useful = cards.filter((item) => item.missing || item.decks.length > 0).length
  return {
    id,
    series: id.slice(0, 1),
    volume: Number(id.slice(1)),
    cards,
    missing,
    copiesMissing,
    chanceMissing: missing / size,
    chanceNew: newCards / size,
    chanceDecks: deckCards / size,
    chanceUseful: useful / size,
    newCards,
    deckCards,
    reason: deckCards > 0 ? 'decks' : newCards > 0 ? 'new' : missing > 0 ? 'missing' : null,
    winsToComplete: wins,
    couponSavesNow: copiesMissing > 0 ? coupon : null,
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
    18.04,
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
  18.04,
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
  11.25,
  3.75,
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
  until: '2026-11-13T07:00:00Z',
  volumes: ['A7', 'B1', 'B11', 'B12'],
}
const COLLECTION_AT = '2026-10-30T15:55:55.985Z'

/** Serves `/api/promo-packs` with `answer` (a function: one answer per call). */
function renderPromo(answer: unknown | (() => unknown), queryClient = client()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/promo-packs') {
        return json({ goal: GOAL, ...((typeof answer === 'function' ? answer() : answer) as object) })
      }
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
      totals: { volumes: 4, cards: 20, missing: 12, copiesMissing: 21, winsToComplete: 47.33 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await screen.findByText('Evento botín bis PROMO 2026', {}, { timeout: 5000 })).toBeInTheDocument()
    // The news says «hasta las 06:59 UTC» (03:59 in Buenos Aires): the minute before `until` (pz/luck).
    expect(screen.getByText(/^Hasta el /).textContent).toContain(
      new Intl.DateTimeFormat('es-AR', { timeStyle: 'short' }).format(new Date('2026-11-13T06:59:00Z')),
    )
    // The drawn one, not the first of the list, and why.
    expect(await advice()).toBe(
      'Conviene ganar B vol. 11: es la que más chance tiene de darte una carta que no tenés en ninguna versión (60 %).',
    )
    expect(screen.getByText(/^Empata en todo: B vol\. 1\. Te sugiero uno al azar/)).toBeInTheDocument()
    expect(
      screen.getByText(/te faltan 21 copias para tener 2 de cada una de sus 20 cartas: ~47 victorias sin cupones/),
    ).toBeInTheDocument()

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
    // The goal is two of each: a second Exeggcute and two Rayquaza ex.
    expect(within(seventh).getByText('faltan 3 copias de 10')).toBeInTheDocument()
    expect(
      within(seventh)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Exeggcute 1/2', '✓ Froakie', "✓ Farfetch'd", '✓ Rayquaza', 'Rayquaza ex nueva'])
    // The headline is the chance of the tier that decides the order, labelled; the others go below.
    const headline = (row: HTMLElement) => row.querySelector('.ml-auto')?.textContent
    expect(headline(seventh)).toBe('20\u00a0% nueva')
    expect(within(seventh).getByText('copia que te falta: 40 % · ~11 victorias para completarlo')).toBeInTheDocument()
    expect(headline(first)).toBe('60\u00a0% nueva')
    expect(within(first).getByText('copia que te falta: 100 % · ~18 victorias para completarlo')).toBeInTheDocument()
    expect(headline(twelfth)).toBe('0\u00a0%')
    expect(within(seventh).queryByText(/Conviene|Empata/)).toBeNull()
    expect(within(twelfth).getByText('completo')).toBeInTheDocument()
    // A vol. 1 has no battle now: not among the event's volumes.
    expect(within(list).queryByText('A vol. 1')).toBeNull()

    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    expect(within(coupons).getByText(/por una carta de promoción, si la tienda la tiene/)).toBeInTheDocument()
    expect(within(coupons).getByText(/Antes de que termine el evento, canjealos igual\./)).toBeInTheDocument()
    expect(within(coupons).queryByText('Para tus mazos')).toBeNull()
    expect(within(coupons).getByText(/Si vas a completar un volumen \(2 de cada carta\)/)).toBeInTheDocument()
    expect(
      within(coupons).getByText('A ningún volumen del evento le queda una sola carta por sacar todavía.'),
    ).toBeInTheDocument()
    const [withoutBattle] = within(coupons).getAllByRole('list') as [HTMLElement]
    expect(
      within(coupons).getByText(/^Sin batalla en este evento \(6 copias\): solo con cupón, si la tienda las tiene\.$/),
    ).toBeInTheDocument()
    expect(within(withoutBattle).getByRole('listitem').textContent).toBe(
      'A vol. 1 · Butterfree ×2, Lapras ex, Pikachu, Clefairy, Mankey',
    )
  })

  it('2/11: the coupons Santi has, from pokemon-zone: this event’s, and other events’ apart', async () => {
    const user = userEvent.setup()
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11, A7, B12, A1],
      best: ['B1', 'B11'],
      pick: 'B11',
      totals: { volumes: 4, cards: 20, missing: 12, copiesMissing: 21, winsToComplete: 47.33 },
      lastImportAt: COLLECTION_AT,
      coupons: {
        importedAt: '2026-11-02T03:00:00.000Z',
        syncedAt: '2026-11-02T02:43:29.379Z',
        items: [
          {
            key: 'TICKET_2610000_EV_03',
            event: 'PROMO Reissue Drop Event 2026',
            count: 2,
            eventId: 'botin-bis-promo-2026',
            nameEs: 'Evento botín bis PROMO 2026',
            active: true,
          },
          {
            key: 'TICKET_2610000_EV_04',
            event: 'PROMO Reissue Wonder Pick Event 2026',
            count: 1,
            eventId: null,
            nameEs: null,
            active: false,
          },
        ],
      },
    })
    await user.click(await screen.findByText('Cupones', {}, { timeout: 5000 }))
    const own = await screen.findByTestId('own-coupons')
    expect(own).toHaveTextContent('De este evento tenés 2 cupones.')
    expect(
      within(own).getByText('1 cupón de «PROMO Reissue Wonder Pick Event 2026» (nombre del juego en inglés)'),
    ).toBeInTheDocument()
    expect(within(own).getByText(/^Según pokemon-zone \(datos del juego del /)).toHaveTextContent(
      new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date('2026-11-02T02:43:29.379Z'),
      ),
    )
  })

  it('2/11: without an import it says where the coupons come from; with them, a complete event still lists them', async () => {
    const user = userEvent.setup()
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11, A7, B12, A1],
      best: ['B1', 'B11'],
      pick: 'B11',
      totals: { volumes: 4, cards: 20, missing: 12, copiesMissing: 21, winsToComplete: 47.33 },
      lastImportAt: COLLECTION_AT,
      coupons: null,
    })
    await user.click(await screen.findByText('Cupones', {}, { timeout: 5000 }))
    expect(await screen.findByRole('link', { name: 'traelos del juego con pokemon-zone' })).toHaveAttribute(
      'href',
      '/coleccion/pokemon-zone',
    )
    expect(screen.queryByTestId('own-coupons')).toBeNull()
    cleanup()
    vi.unstubAllGlobals()
    renderPromo({
      event: { ...EVENT, volumes: ['B12'] },
      volumes: [B12],
      best: [],
      pick: null,
      totals: { volumes: 1, cards: 5, missing: 0, copiesMissing: 0, winsToComplete: 0 },
      lastImportAt: COLLECTION_AT,
      coupons: {
        importedAt: '2026-11-02T03:00:00.000Z',
        syncedAt: '2026-11-02T02:43:29.379Z',
        items: [
          {
            key: 'TICKET_2610000_EV_03',
            event: 'PROMO Reissue Drop Event 2026',
            count: 1,
            eventId: 'botin-bis-promo-2026',
            nameEs: 'Evento botín bis PROMO 2026',
            active: true,
          },
        ],
      },
    })
    await user.click(await screen.findByText('Cupones', {}, { timeout: 5000 }))
    expect(await screen.findByTestId('own-coupons')).toHaveTextContent('De este evento tenés 1 cupón.')
  })

  it('pz/luck: both halves of «Evento bis PROMO 2026» on, each count said apart', async () => {
    const user = userEvent.setup()
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11, A7, B12, A1],
      best: ['B1', 'B11'],
      pick: 'B11',
      totals: { volumes: 4, cards: 20, missing: 12, copiesMissing: 21, winsToComplete: 47.33 },
      lastImportAt: COLLECTION_AT,
      coupons: {
        importedAt: '2026-11-03T17:46:00.000Z',
        syncedAt: '2026-11-03T17:45:10.000Z',
        items: [
          {
            key: 'TICKET_2610000_EV_04',
            event: 'PROMO Reissue Wonder Pick Event 2026',
            count: 2,
            eventId: 'eleccion-magica-bis-promo-2026',
            nameEs: 'Evento elección mágica bis PROMO 2026',
            active: true,
            until: '2026-11-13T07:00:00Z',
          },
          {
            key: 'TICKET_2610000_EV_03',
            event: 'PROMO Reissue Drop Event 2026',
            count: 1,
            eventId: 'botin-bis-promo-2026',
            nameEs: 'Evento botín bis PROMO 2026',
            active: true,
            until: '2026-11-13T07:00:00Z',
          },
        ],
      },
    })
    await user.click(await screen.findByText('Cupones', {}, { timeout: 5000 }))
    const own = await screen.findByTestId('own-coupons')
    expect(own).toHaveTextContent(
      'Del evento en curso tenés 2 cupones del Evento elección mágica bis PROMO 2026 y 1 cupón del Evento botín bis PROMO 2026.',
    )
    expect(own).not.toHaveTextContent('3 cupones')
  })

  it('a card a deck lacks wins and says so; a coupon for it saves every win', async () => {
    const user = userEvent.setup()
    const withDeck = b1(['7. Pidgeot'])
    renderPromo({
      event: EVENT,
      volumes: [withDeck, B11],
      best: ['B1'],
      pick: 'B1',
      totals: { volumes: 2, cards: 10, missing: 10, copiesMissing: 18, winsToComplete: 36.08 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await advice()).toBe(
      'Conviene ganar B vol. 1: es la que más chance tiene de darte una carta que le falta a tus mazos (20 %: Mega-Pidgeot ex).',
    )
    expect(screen.queryByText(/^Empata/)).toBeNull()
    // A deck's card decides: 20 % «para mazos» on top, though every print lacks copies.
    const list = screen.getByRole('heading', { name: 'Volúmenes del evento' }).closest('section') as HTMLElement
    const row = within(list).getByText('B vol. 1').closest('li') as HTMLElement
    expect(row.querySelector('.ml-auto')?.textContent).toBe('20\u00a0% para mazos')
    expect(
      within(row).getByText(
        'nueva en ninguna versión: 60 % · copia que te falta: 100 % · ~18 victorias para completarlo',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    const [forDecks] = within(coupons).getAllByRole('list') as [HTMLElement]
    expect(within(coupons).getByText('Para tus mazos')).toBeInTheDocument()
    expect(within(forDecks).getByRole('listitem').textContent).toBe(
      'Mega-Pidgeot ex · B vol. 1 · para 7. Pidgeot · ahorra ~5 victorias',
    )
    expect(
      within(coupons).getByText('A ningún volumen del evento le queda una sola carta por sacar todavía.'),
    ).toBeInTheDocument()
  })

  it('a volume with one card left goes under the coupons: each coupon saves every win, for both copies too', async () => {
    const user = userEvent.setup()
    const almost = volume(
      'A7',
      [
        card('P-A-60', 'Exeggcute', 2),
        card('P-A-61', 'Froakie', 4),
        card('P-A-62', "Farfetch'd", 4),
        card('P-A-63', 'Rayquaza', 2),
        card('P-A-64', 'Rayquaza ex', 1),
      ],
      true,
      5,
    )
    // One card left too, but both of its copies: each coupon still saves every win.
    const bothShort = volume(
      'B12',
      [
        card('P-B-88', 'Scyther del Team Rocket', 0),
        card('P-B-89', 'Lapras del Team Rocket', 2),
        card('P-B-90', 'Wingull', 5),
        card('P-B-91', 'Wobbuffet del Team Rocket', 4),
        card('P-B-92', 'Marowak', 2),
      ],
      true,
      10,
      5,
    )
    renderPromo({
      event: { ...EVENT, volumes: ['A7', 'B12'] },
      volumes: [almost, bothShort],
      best: ['A7', 'B12'],
      pick: 'A7',
      totals: { volumes: 2, cards: 10, missing: 2, copiesMissing: 3, winsToComplete: 15 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await advice()).toBe(
      'Conviene ganar A vol. 7: es la que más chance tiene de darte una edición de la que tenés menos de 2 copias (20 %).',
    )
    expect(screen.getByText('falta 1 copia de 10')).toBeInTheDocument()
    expect(screen.getByText('faltan 2 copias de 10')).toBeInTheDocument()
    expect(screen.getByText('Scyther del Team Rocket').closest('li')?.textContent).toBe('Scyther del Team Rocket')
    expect(
      screen.getByText(/te faltan 3 copias para tener 2 de cada una de sus 10 cartas: ~15 victorias sin cupones/),
    ).toBeInTheDocument()
    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    expect(within(coupons).getByText('Última carta de un volumen')).toBeInTheDocument()
    const [last] = within(coupons).getAllByRole('list') as [HTMLElement]
    expect(
      within(last)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'A vol. 7 · Rayquaza ex · ahorra ~5 victorias',
      'B vol. 12 · Scyther del Team Rocket ×2 · ahorra ~5 victorias cada cupón',
    ])
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
        totals: { volumes: 2, cards: 10, missing: 10, copiesMissing: 18, winsToComplete: 36.08 },
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
        // Two copies, but an adjustment leaves the deck short.
        card('P-B-88', 'Scyther del Team Rocket', 2, { decks: ['12. Team Rocket'] }),
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
      totals: { volumes: 1, cards: 5, missing: 0, copiesMissing: 0, winsToComplete: 0 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await advice()).toBe(
      'Conviene ganar B vol. 12: es la que más chance tiene de darte una carta que le falta a tus mazos (20 %: Scyther del Team Rocket).',
    )
    expect(screen.getByText('faltan copias para tus mazos')).toBeInTheDocument()
    expect(screen.queryByText(/te faltan 0 copias/)).toBeNull()
    // The coupons still help the deck.
    expect(screen.getByText('Cupones')).toBeInTheDocument()
  })

  it('names the date of the collection without a double period after «p. m.»', async () => {
    renderPromo({
      event: EVENT,
      volumes: [A7],
      best: ['A7'],
      pick: 'A7',
      totals: { volumes: 1, cards: 5, missing: 2, copiesMissing: 3, winsToComplete: 11.25 },
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
      totals: { volumes: 2, cards: 10, missing: 5, copiesMissing: 9, winsToComplete: 18.04 },
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
    expect(
      screen.getByText('De los sobres de promoción te faltan 9 copias para tener 2 de cada una de sus 10 cartas.'),
    ).toBeInTheDocument()
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
      totals: { volumes: 1, cards: 5, missing: 0, copiesMissing: 0, winsToComplete: 0 },
      lastImportAt: COLLECTION_AT,
    })
    expect(await screen.findByText('Ya tenés 2 de cada promo de los sobres', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('without a collection it asks to import one instead of advising', async () => {
    renderPromo({
      event: EVENT,
      volumes: [b1(), B11],
      best: ['B1', 'B11'],
      pick: 'B1',
      totals: { volumes: 2, cards: 10, missing: 10, copiesMissing: 18, winsToComplete: 36.08 },
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
      4.5,
    )
    renderPromo({
      event: { ...EVENT, volumes: ['B13'] },
      volumes: [future],
      best: ['B13'],
      pick: 'B13',
      totals: { volumes: 1, cards: 2, missing: 2, copiesMissing: 3, winsToComplete: 4.5 },
      lastImportAt: COLLECTION_AT,
    })
    expect(
      await screen.findByText('P-B-999 (todavía no está en el catálogo)', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /P-B-999/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Falinks/ })).toBeInTheDocument()
  })
})
