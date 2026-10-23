import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { JugarPage } from './JugarPage'

// jsdom has no pointer capture, which the Radix select asks for.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const deck = (id: string, name: string) => ({
  id,
  name,
  energies: ['grass'],
  tags: [],
  builtInGame: true,
  variantOfId: null,
  archivedAt: null,
  valid: true,
  errorCount: 0,
  complete: true,
  missingCount: 0,
  cardCount: 20,
  updatedAt: '2026-10-20T12:00:00.000Z',
  revisionNumber: 1,
})

function show() {
  const api = fakeApi({
    'GET /api/decks': { items: [deck('1', 'Mega-Venusaur ex'), deck('2', 'Dedenne ex')] },
    'GET /api/play': { items: [] },
  })
  const router = createMemoryRouter([{ path: '/jugar', element: <JugarPage /> }], { initialEntries: ['/jugar'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return api
}

it('D-029: the bot starts as g2, the one by default, first in the list, and the game asks for it', async () => {
  const api = show()
  const user = userEvent.setup()
  const bot = await screen.findByRole('combobox', { name: 'Bot' })
  expect(bot).toHaveTextContent('Normal, sin trampa (g2: no ve tu mano ni tu mazo)')
  await user.click(bot)
  const options = await screen.findAllByRole('option')
  expect(options[0]).toHaveTextContent(/g2/)
  expect(options.map((option) => option.textContent)).toContain('Clásico (expectiminimax 2: ve tu mano y tu mazo)')
  await user.keyboard('{Escape}')

  await user.click(await screen.findByRole('combobox', { name: 'Tu mazo' }))
  await user.click(await screen.findByRole('option', { name: 'Mega-Venusaur ex' }))
  await user.click(screen.getByRole('tab', { name: 'Mis mazos' }))
  await user.click(screen.getByRole('combobox', { name: 'El mazo del bot' }))
  await user.click(await screen.findByRole('option', { name: 'Dedenne ex' }))
  await user.click(screen.getByRole('button', { name: 'Empezar' }))
  await waitFor(() => expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/play')).toBe(true))
  const post = api.calls.find((call) => call.method === 'POST' && call.path === '/api/play')
  expect(JSON.parse(String(post?.body))).toMatchObject({ human: { deckId: '1' }, rival: { deckId: '2' }, bot: 'g2' })
})

it('another bot can still be chosen (e2, the one by default until 23/10)', async () => {
  const api = show()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('combobox', { name: 'Bot' }))
  await user.click(await screen.findByRole('option', { name: 'Clásico (expectiminimax 2: ve tu mano y tu mazo)' }))
  await user.click(screen.getByRole('combobox', { name: 'Tu mazo' }))
  await user.click(await screen.findByRole('option', { name: 'Mega-Venusaur ex' }))
  await user.click(screen.getByRole('tab', { name: 'Mis mazos' }))
  await user.click(screen.getByRole('combobox', { name: 'El mazo del bot' }))
  await user.click(await screen.findByRole('option', { name: 'Dedenne ex' }))
  await user.click(screen.getByRole('button', { name: 'Empezar' }))
  await waitFor(() => expect(api.calls.some((call) => call.method === 'POST' && call.path === '/api/play')).toBe(true))
  const post = api.calls.find((call) => call.method === 'POST' && call.path === '/api/play')
  expect(JSON.parse(String(post?.body))).toMatchObject({ bot: 'e2' })
})
