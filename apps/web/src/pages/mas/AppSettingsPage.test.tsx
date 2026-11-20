import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { applyLook, LOOK_KEY } from '@/lib/look'
import { fakeApi } from '@/test/fakeApi'

function renderSettings() {
  fakeApi({ 'GET /api/settings': {} })
  const router = createMemoryRouter(routes, { initialEntries: ['/mas/ajustes'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

const stored = () => JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as unknown

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

describe('Ajustes de la app → Interfaz → Tema', () => {
  it('offers the three themes, says which one is chosen, and «Claro» reaches the page and this device', async () => {
    const user = userEvent.setup()
    renderSettings()
    const group = await screen.findByRole('group', { name: 'Tema' })
    const choice = (name: string) => within(group).getByRole('button', { name })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Oscuro', 'Claro', 'Sistema'])
    // Dark until this device says otherwise; nothing is written before a choice.
    expect(choice('Oscuro')).toHaveAttribute('aria-pressed', 'true')
    expect(choice('Claro')).toHaveAttribute('aria-pressed', 'false')
    expect(choice('Sistema')).toHaveAttribute('aria-pressed', 'false')
    expect(stored()).toBeNull()
    expect(screen.getByText('Se guarda en este dispositivo.')).toBeInTheDocument()

    await user.click(choice('Claro'))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(stored()).toEqual({ theme: 'light' })
    expect(choice('Claro')).toHaveAttribute('aria-pressed', 'true')
    expect(choice('Oscuro')).toHaveAttribute('aria-pressed', 'false')
    expect(choice('Sistema')).toHaveAttribute('aria-pressed', 'false')

    await user.click(choice('Oscuro'))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(stored()).toEqual({ theme: 'dark' })
    expect(choice('Oscuro')).toHaveAttribute('aria-pressed', 'true')
  })

  it('«Sistema» stores the choice, not what it resolves to', async () => {
    const user = userEvent.setup()
    renderSettings()
    const group = await screen.findByRole('group', { name: 'Tema' })
    await user.click(within(group).getByRole('button', { name: 'Sistema' }))
    expect(stored()).toEqual({ theme: 'system' })
    expect(within(group).getByRole('button', { name: 'Sistema' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Oscuro' })).toHaveAttribute('aria-pressed', 'false')
    // The test setup's system never asks for light.
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('opens on the stored choice and keeps what a later version stored next to it', async () => {
    localStorage.setItem(LOOK_KEY, JSON.stringify({ theme: 'light', motion: 'none' }))
    // As public/look.js does before the app starts.
    applyLook()
    const user = userEvent.setup()
    renderSettings()
    const group = await screen.findByRole('group', { name: 'Tema' })
    expect(within(group).getByRole('button', { name: 'Claro' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    await user.click(within(group).getByRole('button', { name: 'Sistema' }))
    expect(stored()).toEqual({ theme: 'system', motion: 'none' })
  })

  it('says where each preference is saved, and no longer that the theme follows the system', async () => {
    renderSettings()
    await screen.findByRole('group', { name: 'Tema' })
    expect(screen.getByText(/se guardan en el servidor/)).toHaveTextContent(
      'Los tres interruptores de arriba se guardan en el servidor (clave ui); el tema, en este dispositivo.',
    )
    expect(screen.queryByText(/sigue al sistema/)).toBeNull()
    // The three switches of the section are still there, after the theme.
    for (const name of [/Miniaturas de cartas/, /Imágenes en la mesa/, /Pedir siempre quién empezó/]) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument()
    }
  })
})
