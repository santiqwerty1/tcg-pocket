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
    winsPerCoupon: missing > 0 ? wins / missing : null,
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
  until: '2026-11-13T05:59:59Z',
  volumes: ['A7', 'B1', 'B11', 'B12'],
}

function renderPromo(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/api/promo-packs') return json(body)
      return json({ error: { code: 'not_found', message: 'no' } }, 404)
    }),
  )
  const router = createMemoryRouter(routes, { initialEntries: ['/sobres/promo'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('sobres de promoción', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('says which battle to win, what each volume lacks and where a coupon saves the most', async () => {
    const user = userEvent.setup()
    renderPromo({
      event: EVENT,
      volumes: [B1, B11, A7, B12, A1],
      best: ['B1', 'B11'],
      totals: { volumes: 4, cards: 20, missing: 11, winsToComplete: 27.84 },
      lastImportAt: '2026-10-30T15:55:55.985Z',
    })
    expect(await screen.findByText('Evento botín bis PROMO 2026', {}, { timeout: 5000 })).toBeInTheDocument()
    // «u» before «once».
    expect(screen.getByText('B vol. 1 u 11')).toBeInTheDocument()
    expect(
      screen.getByText(/cada victoria te da seguro una carta que no tenés; 1 carta le falta a tus mazos/),
    ).toBeInTheDocument()
    expect(screen.getByText(/te faltan 11 cartas de 20: ~28 victorias/)).toBeInTheDocument()

    const list = screen.getByRole('heading', { name: 'Volúmenes del evento' }).closest('section') as HTMLElement
    const rows = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement?.parentElement === list)
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'B vol. 1',
      'B vol. 11',
      'A vol. 7',
      'B vol. 12',
    ])
    expect(within(rows[0] as HTMLElement).getByText('Conviene')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).getByText(/falta en 7\. Pidgeot/)).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).getByText('falta 1 de 5')).toBeInTheDocument()
    expect(
      within(rows[2] as HTMLElement).getByText(/~5 victorias para completarlo · cada cupón ahorra ~5 victorias/),
    ).toBeInTheDocument()
    expect(within(rows[2] as HTMLElement).queryByText('Conviene')).toBeNull()
    expect(within(rows[3] as HTMLElement).getByText('completo')).toBeInTheDocument()
    // A vol. 1 has no battle now: not among the event's volumes.
    expect(within(list).queryByText('A vol. 1')).toBeNull()

    await user.click(screen.getByText('Cupones'))
    const coupons = (await screen.findByText(/Las misiones del evento dan cupones/)).parentElement as HTMLElement
    const [ranked, withoutBattle] = within(coupons).getAllByRole('list') as [HTMLElement, HTMLElement]
    const order = within(ranked)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    // Where few are missing first; B vol. 12 (complete) is not there.
    expect(order).toEqual([
      'A vol. 7 · cada cupón ahorra ~5 victorias: Rayquaza ex',
      'B vol. 1 · cada cupón ahorra ~2,3 victorias: Petilil, Froakie, Luxray, Pidgey, Mega-Pidgeot ex',
      'B vol. 11 · cada cupón ahorra ~2,3 victorias: Mega-Houndoom ex, Carvanha, Pikachu, Noivern, Skitty',
    ])
    expect(within(coupons).getByText(/Sin batalla en este evento \(1 carta\)/)).toBeInTheDocument()
    expect(within(withoutBattle).getByRole('listitem').textContent).toBe('A vol. 1 · Butterfree')
  })

  it('names the date of the collection without a double period after «p. m.»', async () => {
    renderPromo({
      event: EVENT,
      volumes: [A7],
      best: ['A7'],
      totals: { volumes: 1, cards: 5, missing: 1, winsToComplete: 5 },
      lastImportAt: '2026-10-30T21:16:00Z',
    })
    const note = await screen.findByText(/abriste sobres de promoción después/, {}, { timeout: 5000 })
    expect(note.textContent).toMatch(/^Colección del .+: si abriste sobres de promoción después, actualizala\.$/)
    expect(note.textContent).not.toContain('..')
  })

  it('without an event and with every promo, there is nothing to win', async () => {
    renderPromo({
      event: null,
      volumes: [{ ...B12, inEvent: false }],
      best: [],
      totals: { volumes: 1, cards: 5, missing: 0, winsToComplete: 0 },
      lastImportAt: null,
    })
    expect(
      await screen.findByText('Ya tenés todas las promos de los sobres', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/No hay un evento de sobres de promoción en curso/)).toBeInTheDocument()
    expect(screen.queryByText('Cupones')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Volúmenes' })).toBeInTheDocument()
  })
})
