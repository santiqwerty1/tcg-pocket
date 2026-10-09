import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const row = (wins: number, losses: number, text: string) => ({
  record: { wins, losses, ties: 0 },
  games: wins + losses,
  text,
})

function week(start: string, label: string, previous: string, next: string | null) {
  return {
    week: { start, label, previous, next, current: next === null },
    matches: {
      overall: row(12, 8, '60 % (n = 20, IC 38,7–78,1 %, orientativo)'),
      previousWeek: row(5, 5, '50 % (n = 10)'),
      byDeck: [{ ...row(7, 3, '70 %'), deck: '2. Mega-Blaziken ex', deckId: '2' }],
      bestRival: { ...row(3, 0, '100 %'), label: 'Gyarados ex' },
      worstRival: { ...row(0, 2, '0 %'), label: 'Mega-Absol ex' },
    },
    bot: { games: 2, wins: 1, losses: 1, ties: 0, coachGames: 1, coachAgreement: 64 },
    practice: { situationsTried: 3, situationsSolved: 2, drillsAnswered: 10, drillsCorrect: 8 },
    work: { simulations: 1, lab: 0 },
    imports: 0,
    meta: { rising: [{ name: 'Hoopa ex', delta: 3.2 }], falling: [] },
    headline: '12-8 en partidas (60 %) · 2 contra el bot · 8/10 ejercicios · 2 situaciones resueltas',
    quiet: false,
  }
}

describe('tu semana (Fase 32)', () => {
  let asked: string[]

  beforeEach(() => {
    asked = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname === '/api/weekly') {
          const semana = url.searchParams.get('semana') ?? ''
          asked.push(semana)
          return json(
            semana === '2026-09-28'
              ? week('2026-09-28', '28/9 al 4/10', '2026-09-21', '2026-10-05')
              : week('2026-10-05', '5/10 al 11/10', '2026-09-28', null),
          )
        }
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the week and walks back to the one before', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/partidas/semana'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Esta semana del 5/10 al 11/10')).toBeInTheDocument()
    expect(screen.getByText('12 V · 8 D')).toBeInTheDocument()
    expect(screen.getByText('Gyarados ex (3 V · 0 D)')).toBeInTheDocument()
    expect(screen.getByText('Con el entrenador: 64 % de jugadas como las suyas')).toBeInTheDocument()
    expect(screen.getByText('8 de 10 bien')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Semana siguiente' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }))
    expect(await screen.findByText('Semana del 28/9 al 4/10')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe('?semana=2026-09-28'))
    expect(asked).toEqual(['', '2026-09-28'])
  })
})
