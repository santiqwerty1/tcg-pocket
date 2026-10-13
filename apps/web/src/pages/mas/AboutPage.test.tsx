import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AboutPage } from './AboutPage'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const MANIFEST = {
  engineRev: '33ff2a5'.padEnd(40, '0'),
  gamesRev: 1,
  version: '0.1.0',
  build: '0123456789ab',
  js: 'engine-0123456789ab.js',
  wasm: 'engine-0123456789ab_bg.wasm',
  sources: 'engine-src-0.1.0.tar.gz',
}

function renderAbout(manifest: unknown) {
  // jsdom has no Web Worker: this browser «can run» the engine.
  vi.stubGlobal('Worker', class {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      if (url.pathname === '/engine/manifest.json') return manifest ? json(manifest) : json({}, 404)
      return json({ status: 'ok', version: '1.0.0', catalogCommit: null, engineRev: MANIFEST.engineRev })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AboutPage />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

it('offers the source of the browser engine it serves (AGPL-3.0, review of #86)', async () => {
  renderAbout(MANIFEST)
  const link = await screen.findByRole('link', { name: 'engine-src-0.1.0.tar.gz' })
  expect(link.getAttribute('href')).toBe('/engine/engine-src-0.1.0.tar.gz')
  expect(screen.getByText(/en WebAssembly/)).toBeTruthy()
  expect(screen.queryByText(/no se\s+distribuye/)).toBeNull()
})

it('points at the repository when this installation has no engine for the browser', async () => {
  renderAbout(null)
  expect((await screen.findByRole('link', { name: 'repositorio' })).getAttribute('href')).toBe(
    'https://github.com/santiqwerty1/tcg-pocket',
  )
  expect(screen.queryByRole('link', { name: /engine-src/ })).toBeNull()
})
