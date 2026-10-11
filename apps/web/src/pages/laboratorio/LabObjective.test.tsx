import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { type FakeCall, fakeApi } from '@/test/fakeApi'
import { LaboratorioPage } from './LaboratorioPage'

// Radix's Select asks for pointer capture, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})
afterEach(() => vi.unstubAllGlobals())

const rival = (archetypeId: string, archetypeName: string, weight: number, listKey: string) => ({
  archetypeId,
  archetypeName,
  share: weight * 40,
  weight,
  listKey,
  listLists: 10,
  listRate: null,
  rank: 0,
  second: false,
  energies: ['fire'],
  cards: [],
})

/** The bank the API answers for each objective (T-017 D4). */
function bank(call: FakeCall) {
  const objective = call.query.get('objective')
  const base = {
    era: 'B4a',
    format: 'STANDARD',
    lists: 393,
    coverage: 40,
    skipped: [],
    engineRev: 'a',
    attribution: 'Limitless',
  }
  if (objective === 'mine') {
    return {
      ...base,
      objective: {
        kind: 'mine',
        labelEs: 'mi meta (4 partidas)',
        halfLifeDays: 14,
        matched: 4,
        unmatched: 1,
        unmatchedNames: ['otro mazo'],
      },
      size: 2,
      rivals: [
        rival('altaria', 'Mega Altaria ex', 0.75, '00000000000001'),
        rival('gyarados', 'Gyarados ex', 0.25, '00000000000002'),
      ],
    }
  }
  if (objective === 'rival') {
    return {
      ...base,
      objective: { kind: 'rival', archetypeId: call.query.get('archetypeId'), labelEs: 'solo Mega Altaria ex' },
      size: 1,
      rivals: [rival('altaria', 'Mega Altaria ex', 1, '00000000000001')],
    }
  }
  return {
    ...base,
    objective: { kind: 'meta', labelEs: 'el meta de los torneos' },
    size: 2,
    rivals: [
      rival('altaria', 'Mega Altaria ex', 0.6, '00000000000001'),
      rival('gyarados', 'Gyarados ex', 0.4, '00000000000002'),
    ],
  }
}

it('T-017 D4: the bank against the meta, «mi meta» or one rival, asked to the API with its objective', async () => {
  const user = userEvent.setup()
  const { calls } = fakeApi({ 'GET /api/lab/bank': bank, 'GET /api/lab/jobs': { items: [] } })
  const router = createMemoryRouter([{ path: '/laboratorio', element: <LaboratorioPage /> }], {
    initialEntries: ['/laboratorio'],
  })
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  expect(await screen.findByText(/Era B4a: 2 arquetipos/)).toBeInTheDocument()

  await user.click(screen.getByRole('combobox', { name: 'Contra qué medir' }))
  await user.click(await screen.findByRole('option', { name: 'Mi meta' }))
  expect(await screen.findByText(/Mi meta en la era B4a: los rivales de 4 partidas/)).toBeInTheDocument()
  expect(screen.getByText(/1 no se cuentan .*\(otro mazo\)/)).toBeInTheDocument()
  expect(calls.some((call) => call.path === '/api/lab/bank' && call.query.get('objective') === 'mine')).toBe(true)

  await user.click(screen.getByRole('combobox', { name: 'Contra qué medir' }))
  await user.click(await screen.findByRole('option', { name: 'Un solo rival' }))
  expect(await screen.findByText(/Contra un solo arquetipo de la era B4a/)).toBeInTheDocument()
  // The first of the era's most played, by default; the size picker goes away (one archetype).
  await waitFor(() =>
    expect(
      calls.some(
        (call) =>
          call.path === '/api/lab/bank' &&
          call.query.get('objective') === 'rival' &&
          call.query.get('archetypeId') === 'altaria',
      ),
    ).toBe(true),
  )
  expect(screen.getByRole('combobox', { name: 'Arquetipo rival' })).toHaveTextContent('Mega Altaria ex')
  expect(screen.queryByRole('combobox', { name: 'Arquetipos del banco' })).not.toBeInTheDocument()
})
