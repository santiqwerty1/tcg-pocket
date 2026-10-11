import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

const rate = (value: number, games: number) => ({
  source: 'tournament',
  value,
  games,
  samples: Math.round(games / 7),
  sampleKind: 'lists',
  ci95: [value - 7, value + 7],
  orientative: false,
})
const record = { wins: 100, losses: 90, ties: 0 }
const scope = {
  era: { code: 'B4a', nameEs: 'Era B4a', from: '2026-08-28', to: null, current: true },
  format: 'STANDARD',
  minPlayers: 12,
  tournaments: 1,
  lists: 393,
  games: 2190,
  mean: { lists: 393, record, rate: rate(47, 2190), share: 100 },
  conflicts: [],
  unknownCards: 0,
  attribution: 'Datos de torneo: Limitless',
}
const list = (key: string, missing: { groupId: string; nameEs: string; need: number; have: number }[]) => ({
  key,
  kind: 'group',
  archetype: { id: 'a', name: 'A', icons: [] },
  cards: [],
  otherKey: null,
  lists: 3,
  record,
  rate: rate(55, 21),
  share: 1,
  missing,
  missingCopies: missing.reduce((sum, item) => sum + item.need - item.have, 0),
})

describe('¿Qué mazo armo después? (Fase 44)', () => {
  it('lists each archetype with what its closest list lacks, its cost and whether I have one', async () => {
    const { calls } = fakeApi({
      'GET /api/decks-next': {
        scope,
        maxMissing: 8,
        rows: [
          {
            archetype: {
              archetype: { id: 'mega-altaria-ex-b1-espeon-b3a', name: 'Mega Altaria ex Espeon', icons: [] },
              lists: 30,
              record,
              rate: rate(55, 210),
              share: 7.6,
            },
            closest: list('0123456789abcd', [{ groupId: 'B1-10', nameEs: 'Swablu', need: 2, have: 0 }]),
            points: 140,
            unpriced: 1,
            tradeable: 2,
            built: false,
          },
          {
            archetype: {
              archetype: { id: 'mega-blaziken-ex-b1', name: 'Mega Blaziken ex', icons: [] },
              lists: 24,
              record,
              rate: rate(42, 170),
              share: 6,
            },
            closest: list('abcdef01234567', []),
            points: 0,
            unpriced: 0,
            tradeable: 0,
            built: true,
          },
        ],
        note: 'Por arquetipo.',
      },
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mazos/despues'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Mega Altaria ex Espeon')).toBeInTheDocument()
    expect(screen.getByText(/Swablu ×2/)).toBeInTheDocument()
    // Review of #52: a copy without a price does not hide the others' points.
    expect(
      screen.getByText(/140 puntos de sobre \+ 1 copia sin precio en puntos · 2 copias intercambiables/),
    ).toBeInTheDocument()
    expect(screen.getByText('ya tenés uno')).toBeInTheDocument()
    expect(screen.getByText('Se arma hoy con tu colección.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(calls.at(-1)?.query.get('maxMissing')).toBe('0'))
  })
})
