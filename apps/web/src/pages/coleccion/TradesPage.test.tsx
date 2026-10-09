import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const give = (cardId: string, nameEs: string, rarity: string, spare: number) => ({
  cardId,
  groupId: cardId,
  nameEs,
  nameEn: nameEs,
  rarity,
  owned: spare + 1,
  spare,
})

const BY_RARITY = [
  { rarity: '◊', wants: [], gives: [give('A1-1', 'Bulbasaur', '◊', 1)] },
  {
    rarity: '◊◊◊◊',
    wants: [
      {
        groupId: 'B4-103',
        nameEs: 'Hoopa ex',
        nameEn: 'Hoopa ex',
        missing: 1,
        decks: ['13. Hoopa ex'],
        options: [
          { cardId: 'B4-103', rarity: '◊◊◊◊' },
          { cardId: 'B4-186', rarity: '☆☆' },
        ],
      },
    ],
    gives: [give('A1-96', 'Pikachu ex', '◊◊◊◊', 2)],
  },
]

describe('lista de intercambio (Fase 31)', () => {
  let asked: string[]

  beforeEach(() => {
    asked = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname === '/api/trades') {
          const rarities = url.searchParams.get('rarities')
          asked.push(rarities ?? '')
          return json({
            byRarity: BY_RARITY,
            untradeable: [],
            rarities: rarities ? rarities.split(',') : ['◊◊◊◊'],
            text: `Intercambio en TCG Pocket (misma rareza)\n\nBusco:\n· ◊◊◊◊ Hoopa ex (B4-103)\n\nDoy:\n· rarezas ${rarities ?? '◊◊◊◊'}`,
            totals: { wants: 1, gives: 2, spare: 3 },
          })
        }
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the rarities with something to ask for, what to give, and rebuilds the text with other rarities', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/coleccion/intercambio'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByRole('link', { name: 'Hoopa ex' }, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText(/B4-103 · para 13\. Hoopa ex/)).toBeInTheDocument()
    expect(screen.queryByText(/B4-186/)).toBeNull()
    expect(screen.getByRole('link', { name: /Pikachu ex/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Bulbasaur/ })).toBeNull()
    const rarities = screen.getByRole('group', { name: 'Rarezas' })
    await user.click(within(rarities).getByRole('button', { name: /^◊1 doy/ }))
    await waitFor(() => expect(asked).toContain('◊◊◊◊,◊'), { timeout: 5000 })
    expect(await screen.findByRole('link', { name: /Bulbasaur/ }, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText(/rarezas ◊◊◊◊,◊/, {}, { timeout: 5000 })).toBeInTheDocument()
  })
})
