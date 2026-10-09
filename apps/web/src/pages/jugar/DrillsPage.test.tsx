import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const STATS = {
  today: { answered: 2, correct: 1 },
  streak: 0,
  byKind: { draw: { answered: 2, correct: 1 }, ko: { answered: 0, correct: 0 } },
}

describe('ejercicios de cálculo (Fase 30)', () => {
  let answers: Record<string, unknown>[]

  beforeEach(() => {
    answers = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname === '/api/drills/stats') return json(STATS)
        if (url.pathname === '/api/drills') {
          return json({
            kind: url.searchParams.get('kind'),
            seed: Number(url.searchParams.get('seed')),
            prompt:
              '¿Qué probabilidad hay de tener al menos una copia de Caramelo Raro al empezar tu turno 2 (después de robar)?',
            facts: ['Mazo 2. Mega-Blaziken ex: 20 cartas, 3 Pokémon Básicos.', '2 copias de Caramelo Raro.'],
            choices: ['22 %', '37 %', '52 %', '67 %'],
            deckId: '2',
            deck: '2. Mega-Blaziken ex',
          })
        }
        if (url.pathname === '/api/drills/answer') {
          answers.push(JSON.parse(String(init?.body)))
          return json({
            correct: false,
            answer: 1,
            explanation: 'Es 37 %. Cuenta rápida: 1 − P(ninguna en 7 de 20) = 37 %.',
            stats: { ...STATS, today: { answered: 3, correct: 1 } },
          })
        }
        if (url.pathname === '/api/decks') return json({ items: [] })
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks, grades with the explanation, updates the tally and gives another one', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/jugar/ejercicios'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText(/al menos una copia de Caramelo Raro/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cómo vas')).toHaveTextContent('Hoy 1 de 2')
    await user.click(screen.getByRole('button', { name: '52 %' }))
    await waitFor(() => expect(answers).toHaveLength(1))
    expect(answers[0]).toMatchObject({ kind: 'draw', deckId: '2', choice: 2 })
    expect(await screen.findByText(/Es 37 %/)).toBeVisible()
    expect(screen.getByLabelText('Cómo vas')).toHaveTextContent('Hoy 1 de 3')
    expect(screen.getByRole('button', { name: '37 %' })).toHaveClass('text-success')
    const seed = answers[0]?.seed
    await user.click(screen.getByRole('button', { name: /Otra/ }))
    await waitFor(() => expect(screen.queryByText(/Es 37 %/)).toBeNull())
    await user.click(await screen.findByRole('button', { name: '22 %' }))
    await waitFor(() => expect(answers).toHaveLength(2))
    expect(answers[1]?.seed).not.toBe(seed)
  })
})
