import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const CURRENT = '3ab58f1cec6a03e3e85455cf7aade3bb8561f92e'
const NEWEST = 'b'.repeat(40)

const PREVIEW = {
  trackerCommit: NEWEST,
  engineRev: '33ff2a5942dd4ce09d1ebc3041ffe48f604409e6',
  current: CURRENT,
  counts: { cards: 4437 },
  diff: {
    added: 120,
    removed: 1,
    internalIdChanged: 0,
    stockChanged: 0,
    groupChanged: 0,
    nameChanged: 2,
    expansionsAdded: 1,
    expansionsRemoved: 0,
  },
  diffEmpty: false,
  expansionsAdded: [{ id: 'B5', nameEn: 'New Set', nameEs: 'Set nuevo', cards: 120 }],
  removed: [{ cardId: 'B4b-424', nameEs: 'Carta que sale' }],
  remap: { needsReview: false, empty: false, notes: [] },
  engine: { engineRev: '33ff2a5942dd4ce09d1ebc3041ffe48f604409e6', plays: 0, incomplete: 0, unknown: 120 },
  destructive: true,
  older: false,
  baseline: `${CURRENT}@7`,
  warnings: [],
}

describe('día de expansión (Fase 40)', () => {
  const sent: { url: string; body: unknown }[] = []
  beforeEach(() => {
    sent.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        const method = init?.method ?? 'GET'
        if (method !== 'GET') sent.push({ url: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (url.pathname === '/api/catalog/status') {
          return json({
            trackerCommit: CURRENT,
            engineRev: PREVIEW.engineRev,
            syncedAt: '2026-10-08T10:00:00.000Z',
            counts: { cards: 4317, groups: 2319, stockUnits: 3866, expansions: 30, packs: 50 },
            lastSync: null,
          })
        }
        if (url.pathname === '/api/catalog/latest') {
          return json({
            current: CURRENT,
            latest: { sha: NEWEST, date: '2026-10-29T12:00:00Z', message: 'Add B5' },
            comparison: { status: 'ahead', aheadBy: 3, behindBy: 0 },
            error: null,
          })
        }
        if (url.pathname === '/api/catalog/preview') return json(PREVIEW)
        if (url.pathname === '/api/catalog/sync') return json({ syncId: 9 }, 202)
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the same cards but another commit: «Aplicar» is still there (images, missions or packs may change)', async () => {
    const same = {
      ...PREVIEW,
      diff: { ...PREVIEW.diff, added: 0, removed: 0, nameChanged: 0, expansionsAdded: 0 },
      diffEmpty: true,
      expansionsAdded: [],
      removed: [],
      destructive: false,
    }
    const original = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/catalog/preview') return json(same)
      return (original as (input: unknown, init?: RequestInit) => Promise<Response>)(input, init)
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/catalogo'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.click(await screen.findByRole('button', { name: /Buscar novedades/ }))
    await user.click(await screen.findByRole('button', { name: /Actualizar al último del tracker/ }))
    expect(await screen.findByText(/las cartas no cambian, pero puede traer/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Aplicar$/ }))
    expect(sent.at(-1)).toEqual({
      url: '/api/catalog/sync',
      body: { commit: NEWEST, engineRev: PREVIEW.engineRev, confirm: false, baseline: `${CURRENT}@7` },
    })
  })

  it('C1: a field the catalog does not read, type changes and the build warnings are shown, and applying asks first', async () => {
    const unknown = {
      ...PREVIEW,
      diff: { ...PREVIEW.diff, removed: 0, typesChanged: 3 },
      removed: [],
      destructive: true,
      unknownFields: [{ field: 'energy2', cards: 3 }],
      warnings: [
        "cards.json has a field the catalog does not read: 'energy2' (3 cards)",
        'Expansion C1 has no cards in cards.json',
      ],
    }
    const original = vi.mocked(fetch).getMockImplementation()
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/catalog/preview') return json(unknown)
      return (original as (input: unknown, init?: RequestInit) => Promise<Response>)(input, init)
    })
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/catalogo'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.click(await screen.findByRole('button', { name: /Buscar novedades/ }))
    await user.click(await screen.findByRole('button', { name: /Actualizar al último del tracker/ }))
    expect(
      await screen.findByText(/El tracker trae un campo que el catálogo no lee: energy2 \(3 cartas\)/),
    ).toBeInTheDocument()
    expect(screen.getByText(/· 3 cambian de tipo/)).toBeInTheDocument()
    // The other build warnings, as they come; the unknown field only once, in Spanish.
    expect(screen.getByText('Expansion C1 has no cards in cards.json')).toBeInTheDocument()
    expect(screen.queryByText(/does not read/)).not.toBeInTheDocument()
    expect(screen.getByText(/una carta podría entrar con datos de menos\./)).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /^Aplicar$/ })
    expect(apply).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Entiendo, aplicarla igual/ }))
    await user.click(apply)
    expect(sent.at(-1)).toMatchObject({ url: '/api/catalog/sync', body: { confirm: true } })
  })

  it('looks for news, shows what changes and applies only after confirming what leaves', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/catalogo'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    await user.click(await screen.findByRole('button', { name: /Buscar novedades/ }))
    expect(await screen.findByText(/3 commits más nuevos que el cargado/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Actualizar al último del tracker/ }))
    expect(await screen.findByText(/Set nuevo/)).toBeInTheDocument()
    expect(screen.getByText(/El motor juega 0 de las 120 cartas nuevas; 120 no las conoce todavía/)).toBeInTheDocument()
    expect(screen.getByText(/Salen: Carta que sale/)).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /^Aplicar$/ })
    expect(apply).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Entiendo, aplicarla igual/ }))
    await user.click(apply)
    expect(sent.at(-1)).toEqual({
      url: '/api/catalog/sync',
      body: { commit: NEWEST, engineRev: PREVIEW.engineRev, confirm: true, baseline: `${CURRENT}@7` },
    })
  })
})
