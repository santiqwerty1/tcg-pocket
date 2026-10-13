import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

const trades = (wants: number) => ({
  byRarity: [],
  untradeable: [],
  rarities: [],
  text: '',
  totals: { wants, gives: 0, spare: 12 },
})

async function open(wants: number) {
  fakeApi({ 'GET /api/trades': trades(wants) })
  const router = createMemoryRouter(routes, { initialEntries: ['/coleccion/intercambio'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

it('phone review: what is missing is what your decks lack (not the collection), in singular too', async () => {
  await open(0)
  expect(await screen.findByText(/A tus mazos les faltan 0 cartas que se pueden intercambiar/)).toBeInTheDocument()
})

it('one card: singular', async () => {
  await open(1)
  expect(await screen.findByText(/A tus mazos les falta 1 carta que se puede intercambiar/)).toBeInTheDocument()
})
