import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('restoring a backup', () => {
  it('previews first and replaces only after confirming', async () => {
    const { calls } = fakeApi({
      'GET /api/backup/blobs': { items: [] },
      'POST /api/backup/import?mode=dry-run': {
        schemaVersion: 7,
        catalogCommit: '3ab58f1cec6a03e3e85455cf7aade3bb8561f92e',
        diff: { decks: { current: 41, incoming: 40 } },
      },
      'POST /api/backup/import?mode=replace': { applied: true, counts: { decks: 40 } },
    })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/backup'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )

    const input = await screen.findByLabelText('Archivo de copia de seguridad')
    await user.upload(input, new File(['{}'], 'tcgpocket-backup-20261009.json.gz', { type: 'application/gzip' }))
    const replace = screen.getByRole('button', { name: 'Reemplazar todo' })
    expect(replace).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Vista previa' }))
    expect(await screen.findByText('Diferencias')).toBeInTheDocument()
    expect(calls.filter((call) => call.path === '/api/backup/import')).toHaveLength(1)

    await user.click(replace)
    const dialog = await screen.findByRole('dialog', { name: '¿Reemplazar todos los datos?' })
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar todo' }))
    await waitFor(() => expect(calls.filter((call) => call.path === '/api/backup/import')).toHaveLength(2))
    expect(await screen.findByText('Copia restaurada')).toBeInTheDocument()
  })
})
