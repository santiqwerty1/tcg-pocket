import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { type FakeCall, fakeApi } from '@/test/fakeApi'
import { EventPage } from './EventPage'
import { EventsPage } from './EventsPage'

afterEach(() => vi.unstubAllGlobals())

const edition = (id: string, nameEs: string, rarity: string) => ({
  id,
  nameEs,
  nameEn: nameEs,
  expansionId: id.slice(0, id.lastIndexOf('-')),
  number: Number(id.slice(id.lastIndexOf('-') + 1)),
  rarity,
  cardType: 'trainer',
  evolutionType: 'item',
  ex: false,
  prizePoints: 1,
  functionalGroupId: id,
  stockCardId: id,
  isDisplayEdition: true,
})
const CATALOG = new Map(
  [edition('P-A-1', 'Poción', 'P'), edition('A2b-111', 'Poké Ball', 'Crown Rare')].map((card) => [card.id, card]),
)

function batch(call: FakeCall) {
  const ids = (call.query.get('ids') ?? '').split(',')
  return { items: ids.flatMap((id) => CATALOG.get(id) ?? []) }
}

it('Fase 16: the editions allowed outside the expansions, typed as codes, with their names, sent with the rules', async () => {
  const user = userEvent.setup()
  const { calls } = fakeApi({
    'GET /api/events': { items: [] },
    'GET /api/expansions': {
      items: [
        { id: 'C1', nameEn: 'Dual Fusion', nameEs: 'Fusión Dual' },
        { id: 'P-A', nameEn: 'Promo-A', nameEs: 'Promo-A' },
        { id: 'A2b', nameEn: 'Shining Revelry', nameEs: 'Festival Brillante' },
      ],
    },
    'GET /api/cards/batch': batch,
    'POST /api/events': (call: FakeCall) => ({
      id: '2',
      name: 'Partidas limitadas',
      startsOn: null,
      endsOn: null,
      rules: (JSON.parse(String(call.body)) as { rules: unknown }).rules,
      rulesEs: [],
      notes: '',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
    }),
  })
  const router = createMemoryRouter(
    [
      { path: '/eventos', element: <EventsPage /> },
      { path: '/eventos/:id', element: <p>Evento guardado</p> },
    ],
    { initialEntries: ['/eventos'] },
  )
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  await user.click(await screen.findByRole('button', { name: 'Nuevo' }))
  await user.type(screen.getByLabelText('Nombre'), 'Partidas limitadas')
  await user.click(screen.getByText('Solo estas expansiones'))
  await user.click(await screen.findByRole('button', { name: 'C1' }))

  // Lower case and leading zeros are written as the catalog does; a word and an unknown code say why.
  const field = screen.getByRole('textbox', { name: 'Ediciones permitidas aparte' })
  await user.type(field, 'p-a-001, A2b-111 P-C-99 Poké')
  const read = await screen.findByRole('list', { name: 'Ediciones leídas' })
  expect(await within(read).findByText(/Poción/)).toBeInTheDocument()
  expect(within(read).getByText(/Poké Ball/)).toBeInTheDocument()
  expect(within(read).getByText(/Crown Rare/)).toBeInTheDocument()
  expect(within(read).getByText('P-A-1')).toBeInTheDocument()
  expect(await within(read).findByText(/no está en el catálogo/)).toBeInTheDocument()
  expect(within(read).getByText(/no es un código de carta/)).toBeInTheDocument()
  expect(screen.queryByText(/Necesitan una regla de rarezas o de expansiones/)).not.toBeInTheDocument()

  await user.clear(field)
  await user.type(field, 'p-a-001, A2b-111')
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(await screen.findByText('Evento guardado')).toBeInTheDocument()
  const posted = calls.find((call) => call.method === 'POST' && call.path === '/api/events')
  expect(JSON.parse(String(posted?.body))).toMatchObject({
    name: 'Partidas limitadas',
    rules: { expansions: ['C1'], allow: ['P-A-1', 'A2b-111'] },
  })
  // The names were looked up once the typing stopped, in batches of known-looking codes only.
  await waitFor(() =>
    expect(
      calls
        .filter((call) => call.path === '/api/cards/batch')
        .every((call) => !(call.query.get('ids') ?? '').includes('Poké')),
    ).toBe(true),
  )
})

it('editing an event: the field starts with its allowed editions, and saving sends what was changed', async () => {
  const user = userEvent.setup()
  const rules = { expansions: ['C1'], allow: ['P-A-1', 'A2b-111'] }
  const { calls } = fakeApi({
    'GET /api/events/2': {
      id: '2',
      name: 'Partidas limitadas de Fusión Dual',
      startsOn: '2026-11-18',
      endsOn: '2026-12-02',
      rules,
      rulesEs: ['Solo cartas de Fusión Dual.', 'Además, estas ediciones: Poción (P-A-1), Poké Ball (A2b-111).'],
      notes: '',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
      decks: [],
      lists: [],
      era: 'C1',
    },
    'GET /api/expansions': {
      items: [
        { id: 'C1', nameEn: 'Dual Fusion', nameEs: 'Fusión Dual' },
        { id: 'P-A', nameEn: 'Promo-A', nameEs: 'Promo-A' },
        { id: 'A2b', nameEn: 'Shining Revelry', nameEs: 'Festival Brillante' },
      ],
    },
    'GET /api/cards/batch': batch,
    'PATCH /api/events/2': (call: FakeCall) => ({
      id: '2',
      name: 'Partidas limitadas de Fusión Dual',
      startsOn: '2026-11-18',
      endsOn: '2026-12-02',
      rules: (JSON.parse(String(call.body)) as { rules: unknown }).rules,
      rulesEs: [],
      notes: '',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
    }),
  })
  const router = createMemoryRouter([{ path: '/eventos/:id', element: <EventPage /> }], {
    initialEntries: ['/eventos/2'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  expect(await screen.findByText(/Además, estas ediciones: Poción \(P-A-1\)/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reglas' }))
  const field = screen.getByRole('textbox', { name: 'Ediciones permitidas aparte' })
  expect(field).toHaveValue('P-A-1, A2b-111')
  expect(await within(screen.getByRole('list', { name: 'Ediciones leídas' })).findByText(/Poción/)).toBeInTheDocument()
  await user.type(field, ', P-A-008')
  await user.click(screen.getByRole('button', { name: 'Guardar reglas' }))
  await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
  const patched = calls.find((call) => call.method === 'PATCH')
  expect(JSON.parse(String(patched?.body))).toEqual({
    rules: { expansions: ['C1'], allow: ['P-A-1', 'A2b-111', 'P-A-8'] },
  })
})

it('without an expansion or rarity rule, the allowed editions say they cannot be saved; clearing the field drops them', async () => {
  const user = userEvent.setup()
  const { calls } = fakeApi({
    'GET /api/events': { items: [] },
    'GET /api/expansions': { items: [{ id: 'P-A', nameEn: 'Promo-A', nameEs: 'Promo-A' }] },
    'GET /api/cards/batch': batch,
  })
  const router = createMemoryRouter([{ path: '/eventos', element: <EventsPage /> }], { initialEntries: ['/eventos'] })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  await user.click(await screen.findByRole('button', { name: 'Nuevo' }))
  await user.type(screen.getByLabelText('Nombre'), 'Sin expansiones')
  const field = screen.getByRole('textbox', { name: 'Ediciones permitidas aparte' })
  await user.type(field, 'P-A-1')
  expect(screen.getByText(/Necesitan una regla de rarezas o de expansiones/)).toBeInTheDocument()
  await user.clear(field)
  expect(screen.queryByText(/Necesitan una regla de rarezas o de expansiones/)).not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Ediciones leídas' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
  const posted = calls.find((call) => call.method === 'POST')
  expect(JSON.parse(String(posted?.body)).rules).toEqual({})
})
