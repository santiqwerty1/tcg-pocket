import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY, SUMMARY } from '@/test/pokemonZone'
import { PackLuckSection } from './PackLuckSection'

afterEach(() => {
  vi.unstubAllGlobals()
})

const check = (verdict: string) => ({
  games: 40,
  wins: 2,
  actual: 5,
  expected: 3.3,
  lowerTail: 0.5,
  upperTail: 0.5,
  verdict,
})
const ref = (id: string, appliedAt: string) => ({ id, fileName: `${id}.csv`, appliedAt })
const CSV_LUCK = {
  imports: 2,
  intervals: [
    {
      from: ref('1', '2026-10-06T12:00:00.000Z'),
      to: ref('2', '2026-10-20T12:00:00.000Z'),
      luck: {
        gained: 40,
        byRarity: {},
        rare: { observed: 2, expected: 1.3, expectedShare: 3.3, check: check('normal') },
        ex: { observed: 1, expected: 0.7, expectedShare: 1.7, check: check('normal') },
        packsEstimate: 8,
        ambiguous: 0,
      },
    },
  ],
  overall: null,
}

function open(packLuck: unknown, zone: unknown) {
  fakeApi({ 'GET /api/collection/pack-luck': packLuck, 'GET /api/pokemon-zone': zone })
  const router = createMemoryRouter([{ path: '/', element: <PackLuckSection /> }])
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('suerte de los sobres', () => {
  it('2/11: the game’s real packs and cards, since the previous import and lifetime, each number said for what it is', async () => {
    open(CSV_LUCK, SUMMARY)
    const cards = await screen.findAllByTestId('game-luck')
    expect(cards).toHaveLength(2)
    const [since, lifetime] = cards as [HTMLElement, HTMLElement]
    expect(since).toHaveTextContent('Desde la importación anterior')
    expect(since).toHaveTextContent('Abriste 5 sobres y obtuviste 20 cartas (del juego).')
    expect(within(since).queryByText(/no salieron de esos sobres/)).toBeNull()
    expect(within(since).queryByText(/◊◊◊◊/)).toBeNull()
    expect(lifetime).toHaveTextContent('Abriste 1.226 sobres y obtuviste 6.883 cartas (del juego).')
    expect(lifetime).toHaveTextContent(
      'Unas 1.445 no salieron de esos sobres (estimado: los sobres dan 5.438); Wonder Pick: 387, intercambios: 49 (del juego)',
    )
    // Review of pz/import: n is the packs' cards, and the verdict only when the other cards could not change it.
    const [rare, ex] = within(lifetime).getAllByTestId('game-tier') as [HTMLElement, HTMLElement]
    expect(rare).toHaveTextContent(
      '☆ o más: 314 (del juego, de todas las fuentes). En las 5.438 cartas que dieron los sobres (n) se esperaban ~228 (estimado: 4,2 %, con las tasas de los sobres que abriste); de esos sobres salieron entre 0 y 314.',
    )
    expect(rare).toHaveTextContent(
      'No se puede saber con lo que da el juego: según cuántas de las otras 1.445 cartas (Wonder Pick, intercambios, regalos) fueran de estas, da peor de lo normal o mejor de lo normal.',
    )
    expect(rare).not.toHaveTextContent('pasa 1 de cada')
    expect(ex).toHaveTextContent('◊◊◊◊ (ex): 534 (del juego, de todas las fuentes)')
    expect(ex).toHaveTextContent('se esperaban ~620')
    expect(ex).toHaveTextContent('peor de lo normal (pasa 1 de cada 10000)')
    expect(lifetime).toHaveTextContent('Los que más abriste: Sobre Deluxe Mega 372 · Dual Fusion: Mega Mewtwo X 31.')
    expect(lifetime).toHaveTextContent('64 sobres de expansiones que el catálogo todavía no tiene no cuentan')
    // The CSV's view stays, apart, with the expected count as a count (not a percentage).
    expect(screen.getByRole('heading', { name: 'Según tu colección' })).toBeInTheDocument()
    expect(screen.getByText(/se esperaban 1,3, 3,3 % de lo que entró/)).toBeInTheDocument()
  })

  it('review of #170: a single other card is said in the singular', async () => {
    const lifetime = { ...SUMMARY.luck?.lifetime, otherCards: 1 }
    open(CSV_LUCK, { ...SUMMARY, luck: { ...SUMMARY.luck, lifetime } })
    const cards = await screen.findAllByTestId('game-luck')
    const [rare] = within(cards[1] as HTMLElement).getAllByTestId('game-tier') as [HTMLElement]
    expect(rare).toHaveTextContent(
      'No se puede saber con lo que da el juego: según si la otra carta (Wonder Pick, intercambios, regalos) fuera de estas, da peor de lo normal o mejor de lo normal.',
    )
  })

  it('without an import it points to pokemon-zone', async () => {
    open(CSV_LUCK, EMPTY_SUMMARY)
    expect(await screen.findByRole('link', { name: 'traelos de pokemon-zone' })).toHaveAttribute(
      'href',
      '/coleccion/pokemon-zone',
    )
    expect(screen.queryByTestId('game-luck')).toBeNull()
  })

  it('with the game’s numbers and no CSV luck yet, the section still shows', async () => {
    open(new Response('{}', { status: 503 }), SUMMARY)
    expect(await screen.findAllByTestId('game-luck')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Según tu colección' })).toBeNull()
  })
})
