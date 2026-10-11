import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    await user.click(await screen.findByRole('button', { name: 'Sincronizar con el tracker' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/coleccion/importar/${preview.id}`))
    expect(await screen.findByText(/Bajan más del 10 %/)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Cambios (4)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
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
