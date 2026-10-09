import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { argsSummary } from './ClaudeActivitySection'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const DELETED = {
  id: '9',
  at: '2026-10-09T18:00:00.000Z',
  token: { id: '2', name: 'claude' },
  client: 'Claude-User',
  tool: 'matches_delete',
  title: 'Borrar una partida',
  args: { id: '31' },
  ok: true,
  error: null,
  ms: 12,
  undo: { kind: 'match_delete', label: 'Victoria con 7. Zoroark ex contra Mega-Blaziken (2026-10-09)' },
  undoneAt: null,
}
const FAILED = {
  ...DELETED,
  id: '8',
  tool: 'matches_log',
  title: 'Registrar una partida',
  args: { deck: 'mazo 999', result: 'win' },
  ok: false,
  error: 'Mazo «mazo 999» no encontrado.',
  undo: null,
}

describe('actividad de Claude (Fase 43)', () => {
  const calls: string[] = []
  beforeEach(() => {
    calls.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
        if (url.pathname === '/api/mcp-audit/9/undo') {
          return json({ ...DELETED, undo: null, undoneAt: '2026-10-09T18:05:00.000Z' })
        }
        if (url.pathname === '/api/mcp-audit') return json({ items: [DELETED, FAILED] })
        if (url.pathname === '/api/tokens') {
          return json({
            items: [
              {
                id: '2',
                name: 'claude',
                kind: 'mcp',
                scopes: ['mcp:read', 'mcp:write'],
                prefix: 'tcg_mcp_AbCdEf',
                createdAt: '2026-10-07T10:00:00.000Z',
                lastUsedAt: '2026-10-09T18:00:00.000Z',
                expiresAt: null,
                revokedAt: null,
                clients: [{ client: 'Claude-User', firstSeenAt: '2026-10-07T10:05:00.000Z' }],
              },
            ],
          })
        }
        return json({ error: { code: 'not_found', message: 'no' } }, 404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists what Claude wrote, with the failures, and undoes a deleted match', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/mas/tokens'] })
    render(
      <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </Providers>,
    )
    expect(await screen.findByText('Borrar una partida')).toBeInTheDocument()
    expect(screen.getByText('Mazo «mazo 999» no encontrado.')).toBeInTheDocument()
    expect(screen.getByText('falló')).toBeInTheDocument()
    expect(screen.getByText(/Cliente: Claude-User/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Deshacer/ }))
    expect(await screen.findByText('Listo: quedó como antes')).toBeInTheDocument()
    expect(calls).toContain('POST /api/mcp-audit/9/undo')
  })

  it('summarizes the arguments without long texts', () => {
    expect(argsSummary({ deck: '7', result: 'win', wentFirst: true })).toBe('deck: 7 · result: win · wentFirst: true')
    expect(argsSummary({ text: 'x'.repeat(100), cards: [1, 2] })).toBe(`text: ${'x'.repeat(40)}… · cards: 2 elementos`)
    expect(argsSummary(null)).toBe('')
  })
})
