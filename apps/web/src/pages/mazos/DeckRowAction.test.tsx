// The deck page and the fixed row: «Registrar partida» is the row's (`frame.ts`), a link with its text to Hoy with the
// deck chosen, and a deck that is archived has none. The rest of the page, and what «Rendimiento» asks for, is in
// DeckPerformance.test.tsx and DeckNavigation.test.tsx.
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import deckDetail from '@/api/__fixtures__/deck-detail.json'
import decksList from '@/api/__fixtures__/decks-list.json'
import { deckKeys } from '@/api/decks'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

const WITH_ROW = 'pb-[calc(var(--bar-h)+var(--row-h)+54px+env(safe-area-inset-bottom))]'
const WITHOUT_ROW = 'pb-[calc(var(--bar-h)+26px+env(safe-area-inset-bottom))]'
const ARCHIVED = '2026-11-20T10:00:00.000Z'

const row = () => document.querySelector('[data-slot="fixed-row"]')
const zone = () => document.querySelector('[data-slot="bottom-zone"]')
const register = () => screen.queryByRole('link', { name: 'Registrar partida con este mazo' })

function renderAt(path: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

/** The deck of the fixture as deck 1, archived or not; a PATCH changes it as the API would. */
function deckApi(archivedAt: string | null) {
  let deck = { ...deckDetail, id: '1', name: 'Gardevoir ex', archivedAt }
  return fakeApi({
    'GET /api/decks/1': () => deck,
    'PATCH /api/decks/1': (call: FakeCall) => {
      const patch = JSON.parse(String(call.body)) as { archived?: boolean }
      if (patch.archived !== undefined) deck = { ...deck, archivedAt: patch.archived ? ARCHIVED : null }
      return deck
    },
  })
}

// The menu of the deck captures the pointer, which jsdom lacks.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
})

afterEach(() => vi.unstubAllGlobals())

/** The list of active decks, as the list a deck was opened from leaves it (the archived list asks for it too). */
const ACTIVE = { items: [{ ...decksList.items[0], id: '2', name: 'Otro mazo' }] }

/** A client that already holds `active` as the list of active decks. */
function leftBehind(active: typeof ACTIVE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(deckKeys.list({ archived: false }), active)
  return queryClient
}

describe('«Registrar partida» on a deck', () => {
  it('is the row’s: a link with its text, to Hoy with the deck chosen, and the page leaves room for it', async () => {
    deckApi(null)
    renderAt('/mazos/1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Gardevoir ex' })).toBeInTheDocument()
    const link = register()
    expect(row()).toContainElement(link)
    expect(link).toHaveTextContent(/^Registrar partida$/)
    expect(link).toHaveAttribute('href', '/partidas?mazo=1')
    // Only the row's: the section «Rendimiento» lost its own.
    expect(screen.getAllByRole('link', { name: /Registrar partida/ })).toHaveLength(1)
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Registrar partida/ })).toBeNull()
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
  })

  it('while the deck loads with no list left behind, it is there: the row is known from the path', async () => {
    deckApi(null)
    renderAt('/mazos/1')
    // Before any answer: the row is known from the path.
    expect(register()).toHaveAttribute('href', '/partidas?mazo=1')
    expect(zone()).toHaveAttribute('data-row')
  })

  it('while an archived deck loads, the list of active decks another screen left already hides the row', async () => {
    // Deck 1, archived, is not in it: no row and no room for one from the first frame, and none when it fails.
    fakeApi({ 'GET /api/decks': ACTIVE })
    renderAt('/mazos/1', leftBehind(ACTIVE))
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(row()).toBeNull()
    expect(zone()).not.toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(row()).toBeNull()
  })

  it('while an active deck loads with that list left behind, the row is there, as without a list', () => {
    fakeApi({ 'GET /api/decks': ACTIVE })
    renderAt('/mazos/2', leftBehind(ACTIVE))
    expect(screen.getByRole('link', { name: 'Registrar partida con este mazo' })).toHaveAttribute(
      'href',
      '/partidas?mazo=2',
    )
    expect(zone()).toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
  })

  it('an archived deck has no row, and no room is kept for one; unarchived, the row comes back', async () => {
    const user = userEvent.setup()
    const { calls } = deckApi(ARCHIVED)
    renderAt('/mazos/1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Gardevoir ex' })).toBeInTheDocument()
    await waitFor(() => expect(row()).toBeNull())
    expect(register()).toBeNull()
    expect(zone()).not.toHaveAttribute('data-row')
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)

    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Desarchivar' }))
    await waitFor(() => expect(register()).toHaveAttribute('href', '/partidas?mazo=1'))
    expect(screen.getByRole('main')).toHaveClass(WITH_ROW)
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => JSON.parse(String(call.body)))).toEqual([
      { archived: false },
    ])

    // And archived again, from the same page.
    await user.click(screen.getByRole('button', { name: 'Más acciones' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archivar' }))
    await waitFor(() => expect(row()).toBeNull())
    expect(screen.getByRole('main')).toHaveClass(WITHOUT_ROW)
  })

  it('a deck that fails to load, with no list to say otherwise, keeps the way to Hoy: an error does not hide it', async () => {
    fakeApi({})
    renderAt('/mazos/1')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(register()).toHaveAttribute('href', '/partidas?mazo=1')
  })
})
