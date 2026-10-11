import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { MyMetaSection } from './MyMetaSection'

beforeEach(() => {
  localStorage.setItem('tcg.fold.my-meta', '1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

const meta = {
  era: 'B4a',
  from: '2026-09-25T03:00:00.000Z',
  filters: { mode: null, modes: ['competitive', 'casual'], days: null },
  halfLifeDays: 14,
  matches: 14,
  withoutRival: 1,
  matched: 12,
  effectiveMatches: 10.8,
  coverage: 86,
  enough: true,
  orientative: true,
  shares: [
    { archetypeId: 'mega-blaziken-ex-b1', name: 'Mega Blaziken ex', share: 66.7, ci95: [37.8, 86.8], games: 6 },
    { archetypeId: 'hoopa-ex-b2', name: 'Hoopa ex', share: 33.3, ci95: [13.2, 62.2], games: 6 },
  ],
  unmatched: [{ key: 'el de los fantasmas', label: 'el de los fantasmas', games: 2 }],
  text: 'Tu meta (12 partidas contra arquetipos de torneo, 10,8 efectivas, porque las recientes pesan más; orientativo): Mega Blaziken ex 66,7 % (IC 37,8–86,8 %), Hoopa ex 33,3 % (IC 13,2–62,2 %).',
}

function renderSection(element: React.ReactNode) {
  const router = createMemoryRouter([{ path: '/', element }])
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('«Tu meta» (Fase 44)', () => {
  it('each share with its interval, the effective matches and the weighted coverage', async () => {
    fakeApi({ 'GET /api/matches/my-meta': meta })
    renderSection(<MyMetaSection />)
    expect(await screen.findByText(/^Tu meta \(12 partidas/)).toBeInTheDocument()
    expect(screen.getByText(/6 partidas · IC 37,8–86,8 %/)).toBeInTheDocument()
    expect(screen.getByText(/competitiva y distendida/)).toBeInTheDocument()
    expect(screen.getByText(/ponderadas por fecha/)).toBeInTheDocument()
    expect(screen.getByText(/valen como 10,8/)).toBeInTheDocument()
    expect(screen.getByText(/Sin arquetipo: el de los fantasmas \(2\)/)).toBeInTheDocument()
  })

  it('asks for the mode and the days of the screen', async () => {
    const { calls } = fakeApi({ 'GET /api/matches/my-meta': meta })
    renderSection(<MyMetaSection mode="competitive" days={30} />)
    await waitFor(() => expect(calls.find((call) => call.path === '/api/matches/my-meta')).toBeDefined())
    const call = calls.find((item) => item.path === '/api/matches/my-meta')
    expect(call?.query.get('mode')).toBe('competitive')
    expect(call?.query.get('days')).toBe('30')
    expect(await screen.findByText(/en competitiva\./)).toBeInTheDocument()
  })
})
