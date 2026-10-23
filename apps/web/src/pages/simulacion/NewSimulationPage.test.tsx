import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { NewSimulationPage } from './NewSimulationPage'

// jsdom has no pointer capture, which the Radix select asks for.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('D-029: both sides start with g2, the bot by default, and the estimate is asked with it', async () => {
  const api = fakeApi({
    'GET /api/simulations/engine': {
      engineRev: 'a'.repeat(40),
      cards: 10,
      incomplete: 0,
      source: 'worker',
      workers: [],
      bots: [
        { code: 'e2', label: 'expectiminimax, profundidad 2' },
        { code: 'g2', label: 'expectiminimax sin trampa, profundidad 2' },
      ],
    },
  })
  const router = createMemoryRouter([{ path: '/simulacion/nueva', element: <NewSimulationPage /> }], {
    initialEntries: ['/simulacion/nueva?a=d:7&a=d:8'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  for (const side of ['A', 'B']) {
    expect(await screen.findByRole('combobox', { name: `Bot del lado ${side}` })).toHaveTextContent(
      'expectiminimax sin trampa, profundidad 2 (por defecto)',
    )
  }
  // The server's estimate (dryRun and the screen's «Tiempo estimado») takes the cost of the bots sent.
  await waitFor(
    () =>
      expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/simulations/preview')).toBe(true),
    { timeout: 3000 },
  )
  const preview = api.calls.find((call) => call.method === 'POST' && call.path === '/api/simulations/preview')
  expect(JSON.parse(String(preview?.body))).toMatchObject({ kind: 'matrix', players: ['g2', 'g2'] })
})
