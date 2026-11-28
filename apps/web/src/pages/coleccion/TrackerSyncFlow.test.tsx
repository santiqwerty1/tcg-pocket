import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import summary from '@/api/__fixtures__/collection-summary.json'
import fixture from '@/api/__fixtures__/import-preview.json'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

afterEach(() => vi.unstubAllGlobals())
const preview = {
  ...fixture,
  source: 'tracker',
  fileName: 'Tracker 5080397634069511',
  tracker: {
    friendId: '5080397634069511',
    baseline: 'saved',
    increased: 2,
    decreased: 2,
    removedCopies: 20,
    currentCopies: 100,
    requiresReview: true,
  },
}
const status = {
  friendId: '5080397634069511',
  enabled: false,
  lastAttemptAt: null,
  lastAppliedAt: null,
  result: null,
  error: null,
  previewId: null,
}
function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers queryClient={client}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}
describe('tracker sync screen', () => {
  it('opens the stored diff from Collection and applies that id through the tracker endpoint', async () => {
    const { calls } = fakeApi({
      'GET /api/collection/summary': { ...summary, lastImportAt: new Date().toISOString() },
      'POST /api/collection/tracker-sync/preview': preview,
      [`GET /api/collection/imports/${preview.id}`]: preview,
      'POST /api/collection/tracker-sync/apply': { applied: true, summary: preview.summary },
    })
    const user = userEvent.setup()
    const router = renderAt('/coleccion')
    await user.click(await screen.findByRole('button', { name: 'Sincronizar la colección con el tracker' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/coleccion/importar/${preview.id}`))
    expect(await screen.findByText(/Bajan más del 10 %/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Cambios (4)' })).toBeInTheDocument()
    expect(screen.queryByText('Filas')).not.toBeInTheDocument()
    expect(screen.queryByText('Suma ingenua')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retirar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Bajan 20 copias de las 100 actuales/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/collection/tracker-sync/apply')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar cambios' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion'))
    const applied = calls.find((c) => c.path === '/api/collection/tracker-sync/apply')
    expect(JSON.parse(applied?.body as string)).toEqual({ id: preview.id })
    expect(calls.filter((c) => c.path === '/api/collection/tracker-sync/preview')).toHaveLength(1)
  })
  it('saves friend_id, keeps automatic off by default, and displays sync errors and its last preview in settings', async () => {
    let current = { ...status, result: 'error', error: 'El tracker rechazó la clave pública', previewId: preview.id }
    const { calls } = fakeApi({
      'GET /api/settings': {},
      'GET /api/collection/tracker-sync/status': () => current,
      'PUT /api/settings/trackerFriendId': (call: FakeCall) => {
        const value = JSON.parse(call.body as string).value
        current = { ...current, friendId: value }
        return { key: 'trackerFriendId', value }
      },
      'PUT /api/settings/trackerAutoSync': (call: FakeCall) => {
        const value = JSON.parse(call.body as string).value
        current = { ...current, enabled: value }
        return { key: 'trackerAutoSync', value }
      },
    })
    const user = userEvent.setup()
    renderAt('/mas/ajustes')
    const input = await screen.findByLabelText('friend_id público (16 dígitos)')
    expect(input).toHaveValue(status.friendId)
    expect(screen.getByRole('switch', { name: 'Sincronizar automáticamente cada 6 horas' })).not.toBeChecked()
    expect(screen.getByText(current.error)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver última vista previa' })).toHaveAttribute(
      'href',
      `/coleccion/importar/${preview.id}`,
    )
    await user.clear(input)
    await user.type(input, '1111222233334444')
    await user.click(screen.getByRole('button', { name: 'Guardar friend_id' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/settings/trackerFriendId')).toBe(true))
    await user.click(screen.getByRole('switch', { name: 'Sincronizar automáticamente cada 6 horas' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/settings/trackerAutoSync')).toBe(true))
  })
})

describe('«Sincronizar», in the fixed row', () => {
  // The toast captures the pointer, which jsdom lacks.
  beforeAll(() => {
    Element.prototype.setPointerCapture ??= () => undefined
    Element.prototype.releasePointerCapture ??= () => undefined
    Element.prototype.hasPointerCapture ??= () => false
  })

  const PREVIEW = '/api/collection/tracker-sync/preview'
  const row = () => document.querySelector('[data-slot="fixed-row"]') as HTMLElement

  it('asks for the preview only when tapped, once while it is on its way, saying so, and then opens it', async () => {
    const { calls, fetchMock } = fakeApi({
      'GET /api/collection/summary': { ...summary, lastImportAt: new Date().toISOString() },
      'POST /api/collection/tracker-sync/preview': preview,
      [`GET /api/collection/imports/${preview.id}`]: preview,
    })
    // The preview waits until the test lets it go; everything else answers at once.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let asked = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(PREVIEW)) {
        asked += 1
        await held
      }
      return fetchMock(input, init)
    })
    const user = userEvent.setup()
    const router = renderAt('/coleccion')
    const sync = await screen.findByRole('button', { name: 'Sincronizar la colección con el tracker' })
    expect(row()).toContainElement(sync)
    expect(sync).toHaveTextContent(/^Sincronizar$/)
    // The page's own button is gone: this is the only way to sync from here.
    expect(screen.getAllByRole('button', { name: /^Sincronizar/ })).toEqual([sync])
    // Nothing is asked before the tap.
    expect(asked).toBe(0)

    await user.click(sync)
    await waitFor(() => expect(sync).toHaveAttribute('aria-busy', 'true'))
    expect(sync).toHaveAttribute('aria-disabled', 'true')
    expect(sync.querySelector('svg')).toHaveClass('animate-spin')
    expect(within(row()).getByRole('status')).toHaveTextContent('Consultando el tracker…')
    // A second tap while it works asks for nothing.
    await user.click(sync)
    expect(asked).toBe(1)

    release()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/coleccion/importar/${preview.id}`))
    expect(calls.filter((call) => call.path === PREVIEW)).toHaveLength(1)
    expect(calls.find((call) => call.path === PREVIEW)?.method).toBe('POST')
    // The preview page keeps its own bar («Aplicar», «Descartar»): no row of the frame there.
    expect(await screen.findByRole('heading', { name: 'Cambios (4)' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="fixed-row"]')).toBeNull()
  })

  it('an error is a toast with what the API says, and the button can be tapped again', async () => {
    const { calls } = fakeApi({
      'GET /api/collection/summary': summary,
      'POST /api/collection/tracker-sync/preview': () =>
        new Response(JSON.stringify({ error: { code: 'tracker_down', message: 'El tracker no responde' } }), {
          status: 502,
        }),
    })
    const user = userEvent.setup()
    const router = renderAt('/coleccion')
    const sync = await screen.findByRole('button', { name: 'Sincronizar la colección con el tracker' })
    await user.click(sync)
    expect(await screen.findByText('El tracker no responde')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/coleccion')
    await waitFor(() => expect(sync).not.toHaveAttribute('aria-busy'))
    expect(sync).not.toHaveAttribute('aria-disabled')
    expect(within(row()).getByRole('status')).toHaveTextContent('')
    await user.click(sync)
    await waitFor(() => expect(calls.filter((call) => call.path === PREVIEW)).toHaveLength(2))
  })
})
