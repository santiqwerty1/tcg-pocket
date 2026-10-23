import { focusManager, QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import summary from '@/api/__fixtures__/collection-summary.json'
import fixture from '@/api/__fixtures__/import-preview.json'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

// T-020: the ptcgpocket.gg link in the settings, the sync from Collection and «Tracker al día».
afterEach(() => vi.unstubAllGlobals())

const TOKEN = 'webToken_0123456789abcd'
const LINK = `https://api.dotgg.gg/cgfw/exportcollection?game=pokepocket&token=${TOKEN}`
const status = {
  configured: false,
  link: null,
  unreadable: false,
  enabled: false,
  lastAppliedAt: null,
  lastCheckedAt: null,
  lastAttemptAt: null,
  result: null,
  error: null,
  previewId: null,
}
const trackerStatus = {
  friendId: '5080397634069511',
  enabled: true,
  lastAttemptAt: null,
  lastAppliedAt: null,
  result: null,
  error: null,
  previewId: null,
}
const preview = {
  ...fixture,
  id: '41',
  source: 'dotgg',
  fileName: 'ptcgpocket.gg (juego)',
  bom: false,
  dotgg: {
    increased: 2,
    decreased: 2,
    removedCopies: 3,
    currentCopies: 100,
    requiresReview: true,
    reviewReasons: ['Es la primera sincronización con ptcgpocket.gg: revisá los cambios antes de aplicarlos.'],
    unmatched: [{ line: 9, set: 'C9', number: 4, name: 'Future Card', copies: 2 }],
    renamed: [{ line: 3, cardId: 'B4b-372', name: 'Charizard ex', catalogName: 'Small Balloon', copies: 1 }],
    missingExpansions: [],
  },
  unknownIds: ['C9-4'],
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

describe('ptcgpocket.gg settings', () => {
  it('sends the pasted link once, shows it masked, never renders it, and keeps the daily sync off by default', async () => {
    let current: Record<string, unknown> = { ...status }
    const { calls } = fakeApi({
      'GET /api/settings': {},
      'GET /api/collection/tracker-sync/status': trackerStatus,
      'GET /api/collection/dotgg/status': () => current,
      'PUT /api/collection/dotgg/link': (call: FakeCall) => {
        expect(JSON.parse(call.body as string)).toEqual({ url: LINK })
        current = { ...current, configured: true, link: '…/exportcollection?…token=••••abcd' }
        return current
      },
      'PUT /api/settings/dotggAutoSync': (call: FakeCall) => {
        const value = JSON.parse(call.body as string).value
        current = { ...current, enabled: value }
        return { key: 'dotggAutoSync', value }
      },
      'DELETE /api/collection/dotgg/link': () => {
        current = { ...status }
        return current
      },
    })
    const user = userEvent.setup()
    renderAt('/mas/ajustes')
    const input = await screen.findByLabelText('Link de exportación')
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByText(/Permanent export link/)).toBeInTheDocument()
    const auto = screen.getByRole('switch', { name: 'Sincronizar automáticamente una vez por día' })
    expect(auto).not.toBeChecked()
    expect(auto).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar link' })).toBeDisabled()
    await user.type(input, LINK)
    await user.click(screen.getByRole('button', { name: 'Guardar link' }))
    expect(await screen.findByText('…/exportcollection?…token=••••abcd')).toBeInTheDocument()
    expect(screen.getByLabelText('Cambiar el link')).toHaveValue('')
    expect(document.body.innerHTML).not.toContain(TOKEN)
    expect(calls.filter((c) => c.path === '/api/collection/dotgg/link')).toHaveLength(1)
    // The tracker only gets compared now.
    expect(screen.getByText(/su sincronización automática queda en/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Sincronizar automáticamente una vez por día' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/api/settings/dotggAutoSync')).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Quitar link' }))
    const dialog = await screen.findByRole('dialog')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Quitar link' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(await screen.findByLabelText('Link de exportación')).toBeInTheDocument()
  })

  it('shows the last error and the last preview', async () => {
    fakeApi({
      'GET /api/settings': {},
      'GET /api/collection/tracker-sync/status': trackerStatus,
      'GET /api/collection/dotgg/status': {
        ...status,
        configured: true,
        link: '…/exportcollection?…token=••••abcd',
        result: 'error',
        error: 'ptcgpocket.gg no reconoce el link (HTTP 404)',
        previewId: '41',
      },
    })
    renderAt('/mas/ajustes')
    expect(await screen.findByText('ptcgpocket.gg no reconoce el link (HTTP 404)')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Ver última vista previa' })[0]).toHaveAttribute(
      'href',
      '/coleccion/importar/41',
    )
  })
})

describe('a stored link that cannot be opened', () => {
  const unreadable = { ...status, unreadable: true }

  it('Collection syncs with the game (which says why) and points to the settings, not to the tracker', async () => {
    fakeApi({
      'GET /api/collection/summary': summary,
      'GET /api/collection/dotgg/status': unreadable,
    })
    renderAt('/coleccion')
    expect(await screen.findByText('El link de ptcgpocket.gg guardado no se puede leer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /no se puede leer/ })).toHaveAttribute('href', '/mas/ajustes')
    expect(screen.getByRole('button', { name: 'Sincronizar con el juego' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sincronizar con el tracker' })).not.toBeInTheDocument()
  })

  it('the settings say the tracker stays paused and offer to remove it', async () => {
    fakeApi({
      'GET /api/settings': {},
      'GET /api/collection/tracker-sync/status': trackerStatus,
      'GET /api/collection/dotgg/status': unreadable,
    })
    renderAt('/mas/ajustes')
    expect(await screen.findByText(/el tracker sigue en pausa hasta que lo pegues de nuevo/)).toBeInTheDocument()
    expect(screen.getByText(/El link guardado no se puede leer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar link' })).toBeInTheDocument()
    expect(screen.queryByText(/La colección viene de ptcgpocket.gg: el tracker no la cambia/)).not.toBeInTheDocument()
  })
})

describe('sync with the game', () => {
  it('syncs from Collection, shows the review and the cards the catalog lacks, and applies through its endpoint', async () => {
    const { calls } = fakeApi({
      'GET /api/collection/summary': { ...summary, lastImportAt: new Date().toISOString() },
      'GET /api/collection/dotgg/status': { ...status, configured: true, link: '…token=••••abcd' },
      'POST /api/collection/dotgg/preview': preview,
      'GET /api/collection/imports/41': preview,
      'POST /api/collection/dotgg/apply': { applied: true, summary: preview.summary },
    })
    const user = userEvent.setup()
    const router = renderAt('/coleccion')
    expect(await screen.findByRole('link', { name: /Tracker al día/ })).toHaveAttribute('href', '/coleccion/tracker')
    expect(screen.queryByRole('button', { name: 'Sincronizar con el tracker' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sincronizar con el juego' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion/importar/41'))
    expect(await screen.findByText(/primera sincronización/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cartas que el catálogo no tiene (1)' })).toBeInTheDocument()
    expect(screen.getByText('Future Card')).toBeInTheDocument()
    expect(screen.getByText('C9-4')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Cartas con otro nombre (1)' })).toBeInTheDocument()
    expect(screen.getByText('Charizard ex')).toBeInTheDocument()
    expect(screen.getByText(/en el catálogo: Small Balloon/)).toBeInTheDocument()
    expect(screen.queryByText('Filas')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Ids desconocidos/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Bajan 3 copias de las 100 actuales/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/collection/dotgg/apply')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar cambios' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/coleccion'))
    const applied = calls.find((c) => c.path === '/api/collection/dotgg/apply')
    expect(JSON.parse(applied?.body as string)).toEqual({ id: '41' })
    expect(calls.some((c) => c.path.startsWith('/api/collection/tracker-sync'))).toBe(false)
    expect(calls.some((c) => c.path === '/api/collection/imports/41/apply')).toBe(false)
  })

  it('without the link, Collection keeps the tracker button', async () => {
    fakeApi({
      'GET /api/collection/summary': summary,
      'GET /api/collection/dotgg/status': status,
    })
    renderAt('/coleccion')
    expect(await screen.findByRole('button', { name: 'Sincronizar con el tracker' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Tracker al día/ })).not.toBeInTheDocument()
  })
})

describe('Tracker al día', () => {
  const gap = {
    checkedAt: '2026-10-22T18:00:00.000Z',
    summary: {
      cards: 3,
      cardsMissing: 1,
      copiesMissing: 2,
      cardsExtra: 1,
      copiesExtra: 1,
      cardsCollected: 1,
      trackerCopies: 5043,
      gameCopies: 5044,
    },
    rows: [
      {
        stockCardId: 'A1-1',
        cardIds: ['A1-1', 'A4b-1'],
        nameEs: 'Bulbasaur',
        expansionId: 'A1',
        rarity: '◊',
        tracker: 1,
        game: 3,
        delta: 2,
        trackerCollected: true,
        collected: true,
      },
      {
        stockCardId: 'B1a-28',
        cardIds: ['B1a-28'],
        nameEs: 'Helioptile',
        expansionId: 'B1a',
        rarity: '◊',
        tracker: 0,
        game: 0,
        delta: 0,
        trackerCollected: true,
        collected: false,
      },
      {
        stockCardId: 'B4b-372',
        cardIds: ['B4b-372'],
        nameEs: 'Globito',
        expansionId: 'B4b',
        rarity: '◊◊',
        tracker: 3,
        game: 2,
        delta: -1,
        trackerCollected: true,
        collected: true,
      },
    ],
    unmatchedGame: [{ line: 4, set: 'C9', number: 1, name: 'Future Card', copies: 1 }],
    unknownTracker: [],
    warnings: ['ptcgpocket.gg trae 1 carta que el catálogo no tiene: no se comparan (sincronizá el catálogo).'],
    trackerFile: {
      fileName: 'tcg-pocket-para-el-tracker.csv',
      rows: 3,
      content:
        '﻿Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected\nA1-1,Bulbasaur,65600,3,A1,mewtwopack,◊,TRUE',
    },
    catalogCommit: 'abc',
  }

  it('shows the totals and the cards that differ, explains the two steps and downloads the file as given', async () => {
    fakeApi({ 'GET /api/collection/tracker-gap': gap })
    const blobs: Blob[] = []
    const { createObjectURL, revokeObjectURL } = URL
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      blobs.push(blob as Blob)
      return 'blob:x'
    }
    URL.revokeObjectURL = () => undefined
    onTestFinished(() => {
      URL.createObjectURL = createObjectURL
      URL.revokeObjectURL = revokeObjectURL
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderAt('/coleccion/tracker')
    expect(await screen.findByText('Le faltan al tracker')).toBeInTheDocument()
    expect(screen.getByText('2 copias')).toBeInTheDocument()
    expect(screen.getAllByText('en 1 carta')).toHaveLength(2)
    expect(screen.getByText('5.044')).toBeInTheDocument()
    expect(screen.getByText('tracker 1 → juego 3')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('tracker 3 → juego 2')).toBeInTheDocument()
    expect(screen.getByText(gap.warnings[0] as string)).toBeInTheDocument()
    expect(screen.getByText('Future Card')).toBeInTheDocument()
    // Registered in the tracker with 0 copies and 0 in the game: the file takes the registration off (Santi, 22/10).
    expect(screen.getByText('tracker 0 → juego 0')).toBeInTheDocument()
    expect(screen.getByText('deja de estar registrada')).toBeInTheDocument()
    expect(screen.getByText('1 solo cambia el registro')).toBeInTheDocument()
    expect(screen.getByText(/con 0, deja de estarlo/)).toBeInTheDocument()
    expect(screen.getByText(/las 3 cartas que cambian/)).toBeInTheDocument()
    expect(screen.getByText(/pestaña Import/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archivo para el tracker' }))
    expect(click).toHaveBeenCalled()
    expect(blobs).toHaveLength(1)
    // The bytes as the API wrote them, BOM included (text() would drop it while decoding).
    const bytes = new Uint8Array(await (blobs[0] as Blob).arrayBuffer())
    expect([...bytes]).toEqual([...new TextEncoder().encode(gap.trackerFile.content)])
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    click.mockRestore()
  })

  it('compares again when the app gets the focus back and every time the screen opens (back from the tracker)', async () => {
    const { calls } = fakeApi({ 'GET /api/collection/tracker-gap': gap })
    const reads = () => calls.filter((call) => call.path === '/api/collection/tracker-gap').length
    const router = renderAt('/coleccion/tracker')
    expect(await screen.findByText('tracker 1 → juego 3')).toBeInTheDocument()
    expect(reads()).toBe(1)
    onTestFinished(() => focusManager.setFocused(undefined))
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(reads()).toBe(2))
    await act(() => router.navigate('/coleccion'))
    await act(() => router.navigate('/coleccion/tracker'))
    await waitFor(() => expect(reads()).toBe(3))
  })

  it('does not call it up to date when cards were left out of the comparison', async () => {
    fakeApi({
      'GET /api/collection/tracker-gap': {
        ...gap,
        summary: {
          ...gap.summary,
          cards: 0,
          cardsMissing: 0,
          copiesMissing: 0,
          cardsExtra: 0,
          copiesExtra: 0,
          cardsCollected: 0,
        },
        rows: [],
        notCompared: 2,
        complete: false,
        trackerFile: null,
      },
    })
    renderAt('/coleccion/tracker')
    expect(
      await screen.findByText(
        'Lo que se pudo comparar está al día, pero 2 cartas quedaron afuera de la comparación: mirá los avisos.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/El tracker está al día con el juego/)).not.toBeInTheDocument()
  })

  it('says which expansions the file zeroes because the game has none left there (S-E)', async () => {
    fakeApi({
      'GET /api/collection/tracker-gap': {
        ...gap,
        emptyExpansions: [
          { expansionId: 'A2', nameEs: 'Expansión Uno', cards: 2 },
          { expansionId: 'B4b', nameEs: 'Expansión Dos', cards: 1 },
        ],
      },
    })
    renderAt('/coleccion/tracker')
    expect(
      await screen.findByText(
        /De Expansión Uno y Expansión Dos no te queda en el juego ninguna de las cartas que tiene el tracker: ptcgpocket\.gg ya trajo esas expansiones/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/así que el archivo las pone en 0\./)).toBeInTheDocument()
  })

  it('does not promise a file that could not be made (Codex on #153)', async () => {
    fakeApi({
      'GET /api/collection/tracker-gap': {
        ...gap,
        emptyExpansions: [{ expansionId: 'B4b', nameEs: 'Expansión Dos', cards: 1 }],
        trackerFile: null,
      },
    })
    renderAt('/coleccion/tracker')
    expect(
      await screen.findByText(/De Expansión Dos no te queda en el juego .* la colección de la app está en 0 ahí\.$/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/el archivo las pone en 0/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archivo para el tracker' })).not.toBeInTheDocument()
  })

  it('says when the tracker is up to date and offers no file', async () => {
    fakeApi({
      'GET /api/collection/tracker-gap': {
        ...gap,
        summary: {
          ...gap.summary,
          cards: 0,
          cardsMissing: 0,
          copiesMissing: 0,
          cardsExtra: 0,
          copiesExtra: 0,
          cardsCollected: 0,
        },
        rows: [],
        warnings: [],
        unmatchedGame: [],
        trackerFile: null,
      },
    })
    renderAt('/coleccion/tracker')
    expect(await screen.findByText(/El tracker está al día con el juego/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archivo para el tracker' })).not.toBeInTheDocument()
  })

  it('points to the settings when the link or the friend id is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'dotgg_not_configured', message: 'Pegá el link de exportación…' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    renderAt('/coleccion/tracker')
    expect(await screen.findByText('Pegá el link de exportación…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir a Más → Ajustes de la app' })).toHaveAttribute('href', '/mas/ajustes')
  })
})
