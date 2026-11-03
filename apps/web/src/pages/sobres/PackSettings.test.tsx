import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY, SUMMARY } from '@/test/pokemonZone'
import { PackSettings } from './PackSettings'

afterEach(() => {
  vi.unstubAllGlobals()
})

const PACK = {
  id: 'B4b/deluxepackmega',
  expansionId: 'B4b',
  expansionNameEs: 'Sobre Deluxe Mega',
  name: 'deluxepackmega',
  nameEs: 'Sobre Deluxe Mega',
  available: true,
  limited: false,
  limitedUntil: null,
  cardsPerPack: 4,
  cardCount: 300,
  containsShinies: true,
  containsBabies: false,
  inTrackerOverview: true,
}

function open(zone: unknown) {
  fakeApi({
    'GET /api/packs': { items: [PACK] },
    'GET /api/rarity-rules': { items: [] },
    'GET /api/settings': { packPoints: { A1: 5, C1: 310 }, hourglasses: 30 },
    'GET /api/pokemon-zone': zone,
  })
  const router = createMemoryRouter([{ path: '/', element: <PackSettings /> }])
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

const READ = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
  new Date('2026-11-02T02:43:29.379Z'),
)

describe('Sobres → Ajustes: what came from pokemon-zone (2/11)', () => {
  it('says the points are the game’s, and that the hourglasses were changed by hand afterwards', async () => {
    open(SUMMARY)
    expect(await screen.findByTestId('pokemon-zone-packPoints')).toHaveTextContent(
      `Los puntos son los del juego, según pokemon-zone (datos del ${READ}).`,
    )
    expect(screen.getByTestId('pokemon-zone-hourglasses')).toHaveTextContent(
      `Los relojes se trajeron del juego con pokemon-zone (datos del ${READ}); después los cambiaste a mano.`,
    )
  })

  it('before any import it says they can come from the game', async () => {
    open(EMPTY_SUMMARY)
    expect(await screen.findAllByRole('link', { name: 'pokemon-zone' })).toHaveLength(2)
    expect(screen.queryByTestId('pokemon-zone-packPoints')).toBeNull()
  })
})
