import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import preview from '@/api/__fixtures__/import-preview.json'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

describe('importing the tracker CSV', () => {
  it('uploads as soon as the file is chosen, shows the diff and applies it', async () => {
    const id = preview.id
    const { calls } = fakeApi({
      'GET /api/collection/imports': { items: [] },
      'POST /api/collection/imports': preview,
      [`GET /api/collection/imports/${id}`]: preview,
      [`POST /api/collection/imports/${id}/apply`]: { applied: true, summary: preview.summary },
    })
    const user = userEvent.setup()
    const router = renderAt('/coleccion/importar')

    const input = await screen.findByLabelText('Archivo CSV')
    await user.upload(input, new File(['Id,CardName,InternalId,NumberOwned\n'], 'export.csv', { type: 'text/csv' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/coleccion/importar/${id}`))
    expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/collection/imports')).toHaveLength(1)
    expect(await screen.findByRole('heading', { name: 'Cambios (4)' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion'))
    expect(calls.some((call) => call.method === 'POST' && call.path === `/api/collection/imports/${id}/apply`)).toBe(
      true,
    )
  })
})
