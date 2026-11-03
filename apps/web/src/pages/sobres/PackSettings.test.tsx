import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { type FakeCall, fakeApi } from '@/test/fakeApi'
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

  it('review of pz/import: an import while Ajustes is open does not get its old value written back', async () => {
    let points: Record<string, number> = { B4b: 40 }
    const { calls } = fakeApi({
      'GET /api/packs': { items: [PACK] },
      'GET /api/rarity-rules': { items: [] },
      'GET /api/settings': () => ({ packPoints: points, hourglasses: 0 }),
      'GET /api/pokemon-zone': EMPTY_SUMMARY,
      'PATCH /api/settings/packPoints': (call: FakeCall) => ({
        key: 'packPoints',
        value: (JSON.parse(String(call.body)) as { changes: unknown }).changes,
      }),
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createMemoryRouter([{ path: '/', element: <PackSettings /> }])
    render(
      <Providers queryClient={client}>
        <RouterProvider router={router} />
      </Providers>,
    )
    const user = userEvent.setup()
    expect(await screen.findByLabelText('Puntos guardados de Sobre Deluxe Mega')).toHaveValue('40')
    // An import lands: the game has 0 points of B4b now.
    points = {}
    await client.invalidateQueries({ queryKey: ['settings'] })
    await waitFor(() => expect(screen.getByLabelText('Puntos guardados de Sobre Deluxe Mega')).toHaveValue(''))
    // Going through the row and leaving it writes nothing.
    await user.click(screen.getByLabelText('Puntos guardados de Sobre Deluxe Mega'))
    await user.tab()
    expect(calls.filter((call) => call.method === 'PUT' || call.method === 'PATCH')).toEqual([])
  })

  it('review of #170: a screen opened before an import sends only the row edited there', async () => {
    // What this screen read: A1 10 and B4b 40. An import from the phone then wrote A1 100 (not refetched here).
    const server: Record<string, number> = { A1: 10, B4b: 40 }
    const { calls } = fakeApi({
      'GET /api/packs': { items: [PACK] },
      'GET /api/rarity-rules': { items: [] },
      'GET /api/settings': () => ({ packPoints: { ...server }, hourglasses: 0 }),
      'GET /api/pokemon-zone': EMPTY_SUMMARY,
      'PATCH /api/settings/packPoints': (call: FakeCall) => {
        const { changes } = JSON.parse(String(call.body)) as { changes: Record<string, number> }
        Object.assign(server, changes)
        return { key: 'packPoints', value: { ...server } }
      },
    })
    const router = createMemoryRouter([{ path: '/', element: <PackSettings /> }])
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    const user = userEvent.setup()
    const row = await screen.findByLabelText('Puntos guardados de Sobre Deluxe Mega')
    expect(row).toHaveValue('40')
    server.A1 = 100
    await user.clear(row)
    await user.type(row, '55')
    await user.tab()
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    const sent = calls.filter((call) => call.method === 'PATCH' || call.method === 'PUT')
    expect(sent.map((call) => [call.method, JSON.parse(String(call.body))])).toEqual([
      ['PATCH', { changes: { B4b: 55 } }],
    ])
    // The import's A1 stays.
    expect(server).toEqual({ A1: 100, B4b: 55 })
  })

  it('Codex on #170: a change by hand here says so right away, without reloading', async () => {
    // The server's view: what the import wrote until a PUT changes each setting.
    const edited = { packPoints: false, hourglasses: false }
    const settings: Record<string, unknown> = { packPoints: { A1: 5, C1: 310 }, hourglasses: 18 }
    fakeApi({
      'GET /api/packs': { items: [PACK] },
      'GET /api/rarity-rules': { items: [] },
      'GET /api/settings': () => settings,
      'PUT /api/settings/hourglasses': (call: FakeCall) => {
        edited.hourglasses = true
        settings.hourglasses = (JSON.parse(String(call.body)) as { value: number }).value
        return { key: 'hourglasses', value: settings.hourglasses }
      },
      'PATCH /api/settings/packPoints': (call: FakeCall) => {
        edited.packPoints = true
        const { changes } = JSON.parse(String(call.body)) as { changes: Record<string, number> }
        settings.packPoints = { ...(settings.packPoints as Record<string, number>), ...changes }
        return { key: 'packPoints', value: settings.packPoints }
      },
      'GET /api/pokemon-zone': () => ({
        ...SUMMARY,
        settings: {
          packPoints: edited.packPoints ? 'edited' : 'imported',
          hourglasses: edited.hourglasses ? 'edited' : 'imported',
        },
      }),
    })
    const router = createMemoryRouter([{ path: '/', element: <PackSettings /> }])
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    const user = userEvent.setup()
    expect(await screen.findByTestId('pokemon-zone-hourglasses')).toHaveTextContent('Los relojes son los del juego')
    const hourglasses = await screen.findByLabelText('Relojes de arena de sobre')
    await user.clear(hourglasses)
    await user.type(hourglasses, '25')
    await user.tab()
    await waitFor(() =>
      expect(screen.getByTestId('pokemon-zone-hourglasses')).toHaveTextContent('después los cambiaste a mano'),
    )
    expect(screen.getByTestId('pokemon-zone-packPoints')).toHaveTextContent('Los puntos son los del juego')
    const points = await screen.findByLabelText('Puntos guardados de Sobre Deluxe Mega')
    await user.type(points, '40')
    await user.tab()
    await waitFor(() =>
      expect(screen.getByTestId('pokemon-zone-packPoints')).toHaveTextContent('después los cambiaste a mano'),
    )
  })

  it('before any import it says they can come from the game', async () => {
    open(EMPTY_SUMMARY)
    expect(await screen.findAllByRole('link', { name: 'pokemon-zone' })).toHaveLength(2)
    expect(screen.queryByTestId('pokemon-zone-packPoints')).toBeNull()
  })
})
