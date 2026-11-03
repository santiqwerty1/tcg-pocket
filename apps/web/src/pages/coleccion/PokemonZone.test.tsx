import { gzipSync } from 'node:zlib'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { clearStash, RECEIVE_PATH, readStash, STASH_KEY } from '@/lib/pokemonZone'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY, PREVIEW, SUMMARY } from '@/test/pokemonZone'

/** What the bookmarklet would send (only its shape matters here: the API is faked). */
const PAYLOAD = { v: 1, mine: { player: { accountHash: 'a'.repeat(64) } }, stats: { battles: [] } }
const encoded = (value: unknown) => gzipSync(JSON.stringify(value)).toString('base64url')

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

afterEach(() => {
  clearStash()
  vi.unstubAllGlobals()
})

describe('pokemon-zone: receiving the bookmarklet’s data', () => {
  it('shows what saving changes, saves exactly what came and goes back to the page', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    const { calls } = fakeApi({
      'POST /api/pokemon-zone/preview': PREVIEW,
      'POST /api/pokemon-zone/imports': {
        import: { id: '2', importedAt: SUMMARY.latest.importedAt, syncedAt: SUMMARY.latest.syncedAt },
        duplicate: false,
        applied: { packPoints: 2, packPointsKept: 0, hourglasses: { before: 3, after: 18, game: 18, kept: false } },
      },
      'GET /api/pokemon-zone': SUMMARY,
    })
    const router = open(RECEIVE_PATH)
    expect(await screen.findByText(/cambian 2 expansiones/)).toBeInTheDocument()
    expect(screen.getByText(/20 quedan igual/)).toBeInTheDocument()
    expect(screen.getByText('Sobre Deluxe Mega')).toBeInTheDocument()
    expect(screen.getByText('40 → 0')).toBeInTheDocument()
    expect(screen.getByText(/Relojes de arena de sobre: 3 → 18 \(1 sobre\)/)).toBeInTheDocument()
    expect(screen.getByText(/abriste/)).toHaveTextContent('abriste 5 sobres y obtuviste 1 carta')
    expect(screen.getByText(/2 cupones · Evento botín bis PROMO 2026/)).toBeInTheDocument()
    expect(
      screen.getByText(/«PROMO Reissue Wonder Pick Event 2026» \(nombre del juego en inglés\)/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Competitivas: 47,1 % \(160 V en 340 partidas, IC 41,8–⁠52,4 %\)/)).toBeInTheDocument()
    // Nothing is written before «Guardar».
    expect(calls.filter((call) => call.path === '/api/pokemon-zone/imports')).toHaveLength(0)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion/pokemon-zone'))
    const saved = calls.find((call) => call.method === 'POST' && call.path === '/api/pokemon-zone/imports')
    expect(JSON.parse(String(saved?.body))).toEqual(PAYLOAD)
    const previewed = calls.find((call) => call.path === '/api/pokemon-zone/preview')
    expect(JSON.parse(String(previewed?.body))).toEqual(PAYLOAD)
    expect(readStash()).toBeNull()
    expect(await screen.findByText(/2 importaciones guardadas/)).toBeInTheDocument()
  })

  it('review of pz/import: another account and an older read is one message, not two that contradict', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    fakeApi({ 'POST /api/pokemon-zone/preview': { ...PREVIEW, account: 'other', older: true, since: null } })
    open(RECEIVE_PATH)
    expect(await screen.findByText('Es de otra cuenta y más vieja que la última importación')).toBeInTheDocument()
    expect(screen.getByText('Se guarda en el historial, pero no cambia los ajustes de Sobres.')).toBeInTheDocument()
    expect(screen.queryByText('Es de otra cuenta del juego')).toBeNull()
    expect(screen.queryByText(/pasan a ser los de esta/)).toBeNull()
    expect(screen.getByText('No cambia nada.')).toBeInTheDocument()
    expect(screen.queryByText(/abriste/)).toBeNull()
  })

  it('another account with a newer read says the settings become this one’s', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    fakeApi({ 'POST /api/pokemon-zone/preview': { ...PREVIEW, account: 'other', since: null } })
    open(RECEIVE_PATH)
    expect(await screen.findByText('Es de otra cuenta del juego')).toBeInTheDocument()
    expect(screen.queryByText(/más vieja/)).toBeNull()
  })

  it('review of pz/import: what was changed by hand after the read stays, and the page says so', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    const editedAt = '2026-11-02T15:00:00.000Z'
    fakeApi({
      'POST /api/pokemon-zone/preview': {
        ...PREVIEW,
        packPoints: {
          changes: [],
          unchanged: 20,
          kept: [{ expansionId: 'A1', value: 100, game: 5, nameEs: 'Genes Formidables' }],
          editedAt,
        },
        hourglasses: { before: 6, after: 6, game: 18, kept: true, editedAt },
      },
    })
    open(RECEIVE_PATH)
    const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(editedAt),
    )
    expect(await screen.findByTestId('kept-points')).toHaveTextContent(
      `Los puntos de esta expansión los cambiaste a mano el ${when}, después de la lectura del juego: queda tu valor.`,
    )
    expect(screen.getByTestId('kept-points')).toHaveTextContent('Genes Formidables · A1100 (el juego: 5)')
    expect(screen.getByTestId('kept-hourglasses')).toHaveTextContent(
      `Relojes de arena de sobre: los cambiaste a mano el ${when}, después de la lectura del juego; queda tu valor, 6 (el juego: 18).`,
    )
    // Nothing else changes: no «ya son los del juego» next to a value that is not.
    expect(screen.queryByText('Los puntos de sobre ya son los del juego.')).toBeNull()
  })

  it('a refused payload says why and keeps the data until it is discarded', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    fakeApi({
      'POST /api/pokemon-zone/preview': new Response(
        JSON.stringify({
          error: {
            code: 'validation',
            message: 'Datos inválidos.',
            details: [{ path: 'stats.battles', message: 'Invalid input' }],
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    })
    const router = open(RECEIVE_PATH)
    expect(await screen.findByRole('alert')).toHaveTextContent(/stats\.battles/)
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(readStash()).not.toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion/pokemon-zone'))
    expect(readStash()).toBeNull()
  })

  it('without data, or with data that is not the bookmarklet’s, it says so', async () => {
    fakeApi({})
    open(RECEIVE_PATH)
    expect(await screen.findByText('No llegaron datos')).toBeInTheDocument()
    cleanupAndOpenBroken()
    expect(await screen.findByText(/cortados o no son del marcador/)).toBeInTheDocument()
  })
})

function cleanupAndOpenBroken() {
  document.body.innerHTML = ''
  sessionStorage.setItem(STASH_KEY, 'no-es-del-marcador')
  open(RECEIVE_PATH)
}

describe('pokemon-zone: the page', () => {
  it('shows the bookmarklet for this app, copies it, and the latest import', async () => {
    // userEvent puts its own clipboard in place of the browser's.
    const user = userEvent.setup()
    fakeApi({ 'GET /api/pokemon-zone': SUMMARY })
    open('/coleccion/pokemon-zone')
    const code = await screen.findByTestId('bookmarklet')
    expect(code.textContent).toMatch(/^javascript:void\(async\(\)=>\{const A="http:\/\/localhost(:\d+)?";/)
    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(await navigator.clipboard.readText()).toBe(code.textContent)
    expect(await screen.findByText(/18 \(1 sobre\)/)).toBeInTheDocument()
    expect(screen.getByText('3.000')).toBeInTheDocument()
    expect(screen.getByText(/2 importaciones guardadas/)).toBeInTheDocument()
    const coupons = screen.getByText('Cupones de carta de promoción').parentElement as HTMLElement
    expect(within(coupons).getByText('2 cupones · Evento botín bis PROMO 2026')).toBeInTheDocument()
    expect(screen.queryByText(/datos recibidos sin guardar/)).toBeNull()
  })

  it('points to the data received and not saved', async () => {
    sessionStorage.setItem(STASH_KEY, encoded(PAYLOAD))
    fakeApi({ 'GET /api/pokemon-zone': EMPTY_SUMMARY })
    open('/coleccion/pokemon-zone')
    expect(await screen.findByRole('link', { name: /datos recibidos sin guardar/ })).toHaveAttribute(
      'href',
      RECEIVE_PATH,
    )
    expect(await screen.findByText('Todavía no importaste nada')).toBeInTheDocument()
  })
})
