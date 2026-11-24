import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { LOOK_KEY } from '@/lib/look'
import { fakeApi } from '@/test/fakeApi'

function renderSettings() {
  fakeApi({ 'GET /api/settings': {} })
  const router = createMemoryRouter(routes, { initialEntries: ['/mas/ajustes'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-motion')
})

// The theme's own tests moved with it: pages/mas/MenuPage.test.tsx.
describe('Ajustes de la app → Interfaz', () => {
  it('keeps the two switches the server saves, and no longer has the theme or the thumbnails', async () => {
    renderSettings()
    const section = (await screen.findByRole('heading', { level: 2, name: 'Interfaz' })).closest(
      'section',
    ) as HTMLElement
    expect(
      within(section)
        .getAllByRole('switch')
        .map((item) => item.closest('label')?.querySelector('span > span')?.textContent),
    ).toEqual(['Imágenes en la mesa', 'Pedir siempre quién empezó'])
    expect(screen.queryByRole('switch', { name: /Miniaturas de cartas/ })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Tema' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Tema' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Oscuro' })).toBeNull()
    // The closing note counts what is left, and no longer speaks of the theme.
    expect(within(section).getByText(/se guardan en el servidor/)).toHaveTextContent(
      'Los dos interruptores de arriba se guardan en el servidor (clave ui).',
    )
    expect(within(section).queryByText(/en este dispositivo/)).toBeNull()
    expect(screen.queryByText(/sigue al sistema/)).toBeNull()
  })

  it('says where the theme, the motion and the thumbnails went, and the link leads there', async () => {
    const user = userEvent.setup()
    const router = renderSettings()
    const pointer = await screen.findByText(/están en/)
    expect(pointer).toHaveTextContent('El tema, el movimiento y las miniaturas están en Menú → Aspecto.')
    const link = within(pointer).getByRole('link', { name: 'Menú → Aspecto' })
    expect(link).toHaveAttribute('href', '/mas')

    await user.click(link)
    expect(router.state.location.pathname).toBe('/mas')
    expect(await screen.findByRole('heading', { level: 1, name: 'Menú' })).toBeInTheDocument()
    // One place only: the theme is chosen there, and it reaches the page and this device.
    const theme = screen.getByRole('radiogroup', { name: 'Tema' })
    expect(screen.getByRole('switch', { name: /Miniaturas de cartas/ })).toBeInTheDocument()
    await user.click(within(theme).getByRole('radio', { name: 'Claro' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null')).toEqual({ theme: 'light' })
  })
})
