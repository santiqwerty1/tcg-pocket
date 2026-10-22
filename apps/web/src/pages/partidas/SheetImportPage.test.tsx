import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SheetImportPreview, SheetImportRow } from '@/api/sheetImport'
import { Providers } from '@/app/Providers'
import { routes } from '@/app/routes'
import { type FakeCall, fakeApi } from '@/test/fakeApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** T-022, «Importar desde la hoja»: synthetic previews with the API's shape (nothing from the real sheet). */
const TEXT = 'Código,Salida,Resultado,Mazo (automático),Fecha\nM08,Primero,Victoria,mawile,19/10/2026 21:40\n'

const counts = (overrides: Partial<SheetImportPreview['counts']> = {}): SheetImportPreview['counts'] => ({
  rows: 3,
  new: 0,
  inApp: 1,
  duplicate: 0,
  possibleDuplicate: 0,
  picked: 0,
  unmapped: 0,
  errors: 0,
  warnings: 0,
  write: 0,
  ranks: 0,
  ...overrides,
})

const row = (overrides: Partial<SheetImportRow> & Pick<SheetImportRow, 'row' | 'status'>): SheetImportRow => ({
  code: 'M08',
  deckName: 'mawile',
  deck: null,
  result: 'win',
  wentFirst: true,
  playedAt: '2026-10-20T00:40:00.000Z',
  dateText: '19/10/2026 21:40',
  opponent: 'Hoopa ex / Mega-Absol ex',
  note: '',
  rank: null,
  matchId: null,
  duplicateOf: null,
  write: false,
  errors: [],
  warnings: [],
  ...overrides,
})

const DECKS = [
  { id: '3', name: 'Mega-Mawile ex', archived: false },
  { id: '7', name: 'Butterfree / Mega-Sceptile ex', archived: false },
]

/** The preview before choosing decks: M08 waits for one, with a suggestion. */
const UNMAPPED: SheetImportPreview = {
  delimiter: 'comma',
  headerRow: 4,
  firstRow: 5,
  error: null,
  mode: 'competitive',
  maxNew: 500,
  tooMany: false,
  counts: counts({ unmapped: 2, warnings: 1 }),
  codes: [
    {
      code: 'M08',
      names: ['mawile'],
      rows: 2,
      deckId: null,
      source: null,
      suggestion: { deckId: '3', reason: 'por el nombre «mawile»' },
    },
  ],
  decks: DECKS,
  rows: [
    row({ row: 5, status: 'in_app', matchId: '6' }),
    row({ row: 6, status: 'unmapped', errors: ['Elegí el mazo de M08.'] }),
    row({
      row: 7,
      status: 'unmapped',
      errors: ['Elegí el mazo de M08.'],
      wentFirst: null,
      warnings: ['Sin «Salida»: el orden de turno queda sin anotar.'],
    }),
  ],
  columnK: { firstRow: 5, text: '6\n\n' },
  fingerprint: 'f-unmapped',
  orphans: [],
}

/** With M08 → Mega-Mawile ex: one new, one possible repeat. */
function mapped(include: number[]): SheetImportPreview {
  const picked = include.includes(7)
  return {
    ...UNMAPPED,
    counts: counts({
      new: 1,
      possibleDuplicate: 1,
      picked: picked ? 1 : 0,
      write: picked ? 2 : 1,
      ranks: 1,
      warnings: 1,
    }),
    codes: [{ ...(UNMAPPED.codes[0] as SheetImportPreview['codes'][number]), deckId: '3', source: 'chosen' }],
    rows: [
      row({ row: 5, status: 'in_app', matchId: '6' }),
      row({
        row: 6,
        status: 'new',
        deck: { id: '3', name: 'Mega-Mawile ex' },
        write: true,
        note: 'Me sacó "Hoopa", después Absol.',
        rank: {
          label: 'Master Ball',
          action: 'note',
          text: 'Se anota Master Ball para esta partida y las siguientes.',
        },
      }),
      row({
        row: 7,
        status: 'possible_duplicate',
        deck: { id: '3', name: 'Mega-Mawile ex' },
        wentFirst: null,
        write: picked,
        duplicateOf: { id: '30', text: 'n.º 30, Victoria del 19/10 21:35' },
        warnings: ['Sin «Salida»: el orden de turno queda sin anotar.'],
      }),
    ],
    fingerprint: picked ? 'f-picked' : 'f-mapped',
  }
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

const bodyOf = (call: FakeCall | undefined) => JSON.parse(String(call?.body)) as Record<string, unknown>

describe('importar desde la hoja (T-022)', () => {
  function previewAnswer(call: FakeCall) {
    const body = bodyOf(call) as { deckMap: Record<string, string | null>; include: number[] }
    return body.deckMap.M08 ? mapped(body.include) : UNMAPPED
  }

  it('pasted cells: the preview, the suggested deck, picking a possible repeat, importing and the numbers for K', async () => {
    const { calls } = fakeApi({
      'POST /api/matches/import/preview': previewAnswer,
      'POST /api/matches/import': {
        imported: [
          { row: 6, matchId: '32' },
          { row: 7, matchId: '33' },
        ],
        ranks: 1,
        counts: counts({ new: 1, write: 2 }),
        columnK: { firstRow: 5, text: '6\n32\n33' },
      },
    })
    const user = userEvent.setup()
    renderAt('/partidas/importar')
    const pasted = await screen.findByRole('textbox', { name: 'Celdas pegadas de la hoja' })
    fireEvent.change(pasted, { target: { value: TEXT } })
    await user.click(screen.getByRole('button', { name: 'Ver la vista previa' }))
    expect(
      await screen.findByText(/3 filas con datos \(separadas por comas, encabezados en la fila 4\)/u),
    ).toBeInTheDocument()
    const previews = () => calls.filter((call) => call.path === '/api/matches/import/preview')
    expect(bodyOf(previews()[0])).toEqual({ text: TEXT, deckMap: {}, mode: 'competitive', include: [] })
    // Nothing can be imported while a code has no deck.
    expect(screen.getByText('Elegí el mazo de M08 para seguir.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faltan mazos por elegir' })).toBeDisabled()
    // Those rows import once their deck is chosen: no numbers for K yet.
    expect(screen.queryByRole('textbox', { name: 'Números para la columna K' })).not.toBeInTheDocument()
    expect(screen.getByText(/sugerido por el nombre «mawile»/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Usar los sugeridos' }))
    await waitFor(() => expect(previews()).toHaveLength(2))
    expect(bodyOf(previews()[1])).toMatchObject({ deckMap: { M08: '3' }, include: [] })
    expect(await screen.findByRole('button', { name: 'Importar 1 partida' })).toBeEnabled()
    expect(screen.getByText('Rango: Master Ball (se anota)')).toBeInTheDocument()
    expect(screen.getAllByText('Sin «Salida»: el orden de turno queda sin anotar.')).toHaveLength(1)

    // The possible repeat goes in only when picked: another preview, with its row.
    await user.click(screen.getByRole('checkbox', { name: /Importarla igual \(se parece a la n\.º 30/u }))
    await waitFor(() => expect(previews()).toHaveLength(3))
    expect(bodyOf(previews()[2])).toMatchObject({ deckMap: { M08: '3' }, include: [7] })
    await user.click(await screen.findByRole('button', { name: 'Importar 2 partidas' }))

    const applied = calls.find((call) => call.path === '/api/matches/import')
    expect(bodyOf(applied)).toEqual({
      text: TEXT,
      deckMap: { M08: '3' },
      mode: 'competitive',
      include: [7],
      fingerprint: 'f-picked',
    })
    const done = await screen.findByRole('heading', { name: 'Listo' })
    // The preview goes: its rows are no longer new.
    expect(screen.queryByRole('heading', { name: 'Vista previa' })).not.toBeInTheDocument()
    const section = done.closest('section') as HTMLElement
    expect(within(section).getByText('Importé 2 partidas y anoté 1 rango.')).toBeInTheDocument()
    expect(within(section).getByText('Fila 6 → n.º 32')).toBeInTheDocument()
    expect(within(section).getByText('Fila 7 → n.º 33')).toBeInTheDocument()
    expect(within(section).getByRole('textbox', { name: 'Números para la columna K' })).toHaveValue('6\n32\n33')
    expect(within(section).getByText(/Pegalo en la columna K desde la fila 5 \(celda K5\)/u)).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Copiar los números' }))
    // userEvent's clipboard stands in for the phone's.
    expect(await navigator.clipboard.readText()).toBe('6\n32\n33')
  })

  it('the exported CSV goes up at once; another mode for every match; a 409 shows the new preview', async () => {
    let applies = 0
    const { calls } = fakeApi({
      'POST /api/matches/import/preview': (call: FakeCall) => ({ ...previewAnswer(call), mode: bodyOf(call).mode }),
      'POST /api/matches/import': () => {
        applies += 1
        return new Response(
          JSON.stringify({ error: { code: 'import_changed', message: 'Algo cambió desde la vista previa.' } }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        )
      },
    })
    const user = userEvent.setup()
    renderAt('/partidas/importar')
    const input = await screen.findByLabelText('Archivo CSV de la hoja')
    await user.upload(input, new File([TEXT], 'Partidas.csv', { type: 'text/csv' }))
    const previews = () => calls.filter((call) => call.path === '/api/matches/import/preview')
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(bodyOf(previews()[0])).toMatchObject({ text: TEXT })
    expect(await screen.findByText('Partidas.csv')).toBeInTheDocument()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Mazo de M08' }), '3')
    await waitFor(() => expect(previews()).toHaveLength(2))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Modalidad de todas las partidas' }), 'casual')
    await waitFor(() => expect(previews()).toHaveLength(3))
    expect(bodyOf(previews()[2])).toMatchObject({ deckMap: { M08: '3' }, mode: 'casual' })
    await user.click(await screen.findByRole('button', { name: 'Importar 1 partida' }))
    await waitFor(() => expect(applies).toBe(1))
    // The same choices are previewed again.
    await waitFor(() => expect(previews()).toHaveLength(4))
    expect(bodyOf(previews()[3])).toEqual(bodyOf(previews()[2]))
    expect(screen.queryByRole('heading', { name: 'Listo' })).not.toBeInTheDocument()
  })

  it('nothing new: the numbers for column K are offered from the preview; a text without headers says so', async () => {
    fakeApi({
      'POST /api/matches/import/preview': (call: FakeCall) =>
        String(bodyOf(call).text).startsWith('Código')
          ? {
              ...UNMAPPED,
              counts: counts({ rows: 2, inApp: 1, duplicate: 1 }),
              codes: [],
              rows: [
                row({ row: 5, status: 'in_app', matchId: '6' }),
                row({ row: 6, status: 'duplicate', matchId: '40' }),
              ],
              columnK: { firstRow: 5, text: '6\n40' },
            }
          : {
              ...UNMAPPED,
              error: 'No encontré la fila de encabezados («Código», «Resultado», «Fecha»…).',
              rows: [],
              codes: [],
            },
    })
    const user = userEvent.setup()
    renderAt('/partidas/importar')
    const pasted = await screen.findByRole('textbox', { name: 'Celdas pegadas de la hoja' })
    fireEvent.change(pasted, { target: { value: TEXT } })
    await user.click(screen.getByRole('button', { name: 'Ver la vista previa' }))
    expect(await screen.findByRole('button', { name: 'No hay partidas para importar' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Números para la columna K' })).toHaveValue('6\n40')
    fireEvent.change(pasted, { target: { value: 'M08\tPrimero' } })
    await user.click(screen.getByRole('button', { name: 'Ver la vista previa' }))
    expect(await screen.findByText(/No encontré la fila de encabezados/u)).toBeInTheDocument()
  })

  it('review: an imported match no row is now is named; a failed preview puts the choices back', async () => {
    let fail = false
    fakeApi({
      'POST /api/matches/import/preview': (call: FakeCall) =>
        fail
          ? new Response(
              JSON.stringify({ error: { code: 'internal_error', message: 'Error interno del servidor.' } }),
              {
                status: 500,
                headers: { 'content-type': 'application/json' },
              },
            )
          : { ...previewAnswer(call), orphans: [{ id: '40', text: 'n.º 40, Victoria del 19/10 21:40' }] },
    })
    const user = userEvent.setup()
    renderAt('/partidas/importar')
    const pasted = await screen.findByRole('textbox', { name: 'Celdas pegadas de la hoja' })
    fireEvent.change(pasted, { target: { value: TEXT } })
    await user.click(screen.getByRole('button', { name: 'Ver la vista previa' }))
    expect(
      await screen.findByText(/^Una partida importada de la hoja ya no coincide con ninguna fila/u),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'n.º 40, Victoria del 19/10 21:40' })).toHaveAttribute(
      'href',
      '/partidas/40',
    )
    fail = true
    const mode = screen.getByRole('combobox', { name: 'Modalidad de todas las partidas' })
    await user.selectOptions(mode, 'casual')
    // «Importar» would send the preview shown: the select says what that one was asked with.
    await waitFor(() => expect(mode).toHaveValue('competitive'))
  })

  it('is reached from «Hoy»', async () => {
    fakeApi({})
    renderAt('/partidas')
    expect(await screen.findByRole('link', { name: 'Importar desde la hoja' })).toHaveAttribute(
      'href',
      '/partidas/importar',
    )
  })
})
