import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The toast («Deshacer») captures the pointer, which jsdom lacks.
beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => undefined
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.hasPointerCapture ??= () => false
})

const match = (id: string, playedAt: string) => ({
  id,
  deck: { id: '20', name: 'Mega-Steelix ex', archived: false },
  deckRevision: 3,
  result: 'loss',
  opponent: null,
  opponentCards: [{ cardId: 'A1-89', count: 2, nameEs: 'Greninja' }],
  wentFirst: null,
  mode: 'competitive',
  note: '',
  playedAt,
  source: 'ui',
  createdAt: playedAt,
  updatedAt: playedAt,
})

const UNCLASSIFIED = {
  era: 'B4a',
  groups: [
    {
      matches: [match('6', '2026-10-14T18:00:00.000Z'), match('5', '2026-10-13T18:00:00.000Z')],
      cards: [
        { cardId: 'A1-89', count: 2, nameEs: 'Greninja' },
        { cardId: 'B4-38', count: 1, nameEs: 'Suicune ex' },
      ],
      text: '2 Greninja, Suicune ex',
      suggestions: [
        {
          archetypeId: 'suicune-baxcalibur',
          name: 'Suicune ex Baxcalibur',
          share: 8,
          lists: 31,
          fits: 0,
          best: 1,
          seen: 2,
          kind: 'similar',
          text: 'parecido: su lista más cercana tiene 1 de 2',
        },
      ],
    },
  ],
  own: [{ key: 'greninja suicune', label: 'Greninja Suicune', games: 3 }],
}

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/partidas/clasificar'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('clasificar rivales (14/10)', () => {
  it('a group of matches by cards gets an archetype; a rival of my own is renamed in every match', async () => {
    const { calls } = fakeApi({
      'GET /api/matches/unclassified': UNCLASSIFIED,
      'POST /api/matches/classify': (call: { body?: BodyInit | null }) => {
        const body = JSON.parse(String(call.body)) as {
          opponent: string
          matchIds?: string[]
          from?: string
          expect?: string | null
          note?: { from: string; to: string }
        }
        return {
          skipped: [],
          noteMoved: body.from ? { from: body.from, to: body.opponent } : null,
          updated: body.matchIds?.length ?? 3,
          opponent: body.opponent,
          previous: (body.matchIds ?? ['7', '8', '9']).map((id) => ({
            id,
            opponent: body.matchIds ? null : id === '7' ? 'greninja suicune' : 'Greninja Suicune',
          })),
        }
      },
      // Deuda de #114: «Deshacer» in one request; the group's undo finds match 5 edited since (Codex on #114).
      'POST /api/matches/classify/undo': (call: { body?: BodyInit | null }) => {
        const body = JSON.parse(String(call.body)) as { previous: { id: string }[]; note?: unknown }
        const skipped = body.previous.some((row) => row.id === '5') ? ['5'] : []
        return { updated: body.previous.length - skipped.length, noteMoved: body.note ?? null, skipped }
      },
    })
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('2 Greninja, Suicune ex')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Derrota con Mega-Steelix ex/ })).toHaveLength(2)
    expect(screen.getByText('Ninguno encaja del todo; los más parecidos:')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Suicune ex Baxcalibur/ }))
    const posts = () => calls.filter((call) => call.method === 'POST')
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0]?.body))).toEqual({
      matchIds: ['6', '5'],
      opponent: 'Suicune ex Baxcalibur',
      expect: null,
    })
    // «Deshacer»: back to no rival.
    await user.click(await screen.findByRole('button', { name: 'Deshacer' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    // Only the ones that still have the rival given (Codex on #114): match 5 was edited since and stays.
    expect(posts()[1]?.path).toBe('/api/matches/classify/undo')
    expect(JSON.parse(String(posts()[1]?.body))).toEqual({
      previous: [
        { id: '6', opponent: null },
        { id: '5', opponent: null },
      ],
      expect: 'Suicune ex Baxcalibur',
    })
    expect(await screen.findByText('Una partida cambió mientras tanto y la dejé como estaba.')).toBeInTheDocument()

    // Reclassifying: a rival typed before, by its label, in every match.
    // The refetches after classifying and undoing land before the next form is used (a stale input would leave the
    // keys to the focused suggestion button).
    const reads = () => calls.filter((call) => call.method === 'GET' && call.path === '/api/matches/unclassified')
    await waitFor(() => expect(reads().length).toBeGreaterThanOrEqual(3))
    const own = () => screen.getByText('Greninja Suicune').closest('li') as HTMLElement
    await waitFor(() => expect(within(own()).getByRole('textbox')).toBeEnabled())
    // The suggestion clicked first keeps the focus; the keys go to the name box.
    ;(document.activeElement as HTMLElement | null)?.blur()
    within(own()).getByRole('textbox').focus()
    await user.keyboard('Greninja Altaria')
    expect(within(own()).getByRole('textbox')).toHaveValue('Greninja Altaria')
    await user.click(within(own()).getByRole('button', { name: 'Asignar' }))
    // It asks first: every match of the rival changes.
    expect(
      await screen.findByText(/Cambia el rival de 3 partidas, de todas las modalidades y eras/),
    ).toBeInTheDocument()
    expect(posts()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Cambiar' }))
    await waitFor(() => expect(posts()).toHaveLength(3))
    expect(JSON.parse(String(posts()[2]?.body))).toEqual({ from: 'Greninja Suicune', opponent: 'Greninja Altaria' })
    // «Deshacer» the rename: each match gets its rival back, and the note goes with them (Codex on #114).
    const undo = await screen.findAllByRole('button', { name: 'Deshacer' })
    await user.click(undo[undo.length - 1] as HTMLElement)
    // Deuda de #114: two spellings, one request — each match back to its own spelling, and the note with them.
    await waitFor(() => expect(posts()).toHaveLength(4))
    expect(posts()[3]?.path).toBe('/api/matches/classify/undo')
    expect(JSON.parse(String(posts()[3]?.body))).toEqual({
      previous: [
        { id: '7', opponent: 'greninja suicune' },
        { id: '8', opponent: 'Greninja Suicune' },
        { id: '9', opponent: 'Greninja Suicune' },
      ],
      expect: 'Greninja Altaria',
      note: { from: 'Greninja Altaria', to: 'Greninja Suicune' },
    })
  })

  it('nothing to classify says how to get there', async () => {
    fakeApi({ 'GET /api/matches/unclassified': { era: 'B4a', groups: [], own: [] } })
    renderPage()
    expect(await screen.findByText('Nada para clasificar')).toBeInTheDocument()
    expect(screen.queryByText('Tus rivales propios')).not.toBeInTheDocument()
  })
})
