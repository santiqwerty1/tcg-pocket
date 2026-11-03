import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/Providers'
import { fakeApi } from '@/test/fakeApi'
import { EMPTY_SUMMARY, LUCK, SINCE_FIRST, SUMMARY } from '@/test/pokemonZone'
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
  it('pz/luck: the game’s real packs and cards, where they came from, each number said for what it is', async () => {
    open(CSV_LUCK, SUMMARY)
    const cards = await screen.findAllByTestId('game-luck')
    expect(cards).toHaveLength(2)
    const [since, lifetime] = cards as [HTMLElement, HTMLElement]
    expect(since).toHaveTextContent('Desde la importación anterior')
    expect(since).toHaveTextContent('Abriste 5 sobres y obtuviste 20 cartas (del juego).')
    expect(within(since).queryByText(/origen desconocido/)).toBeNull()
    expect(within(since).queryByText(/◊◊◊◊/)).toBeNull()
    // Santi's real import of 3/11.
    expect(lifetime).toHaveTextContent('Abriste 1.309 sobres y obtuviste 7.376 cartas (del juego).')
    const sources = within(lifetime).getByTestId('game-sources')
    expect(sources).toHaveTextContent('Sobres: ~6.163 cartas (estimado: sobres × cartas por sobre).')
    expect(sources).toHaveTextContent('Wonder Pick: 402 (del juego); ninguna cuenta como carta de sobre.')
    expect(sources).toHaveTextContent(
      'De origen desconocido: ~1.214 cartas — 51 intercambios (del juego), 402 de Wonder Pick (Evento bis PROMO 2026: promos y más elecciones Chansey en Wonder Pick), a lo sumo 1 carta asegurada de un sobre de aniversario (★★), ~760 de regalos, premios, canjes de puntos y promos (estimado).',
    )
    // n is the cards with known odds; the verdict only when the unknown ones could not change it, and otherwise when
    // it would be normal.
    const [rare, ex] = within(lifetime).getAllByTestId('game-tier') as [HTMLElement, HTMLElement]
    expect(rare).toHaveTextContent(
      '☆ o más: 348 (del juego, de todas las fuentes). En las 6.162 cartas con probabilidades conocidas (n) se esperaban ~263 (estimado: 4,3 %, con las tasas de los sobres que abriste); de ellas salieron entre 0 y 348.',
    )
    expect(rare).toHaveTextContent(
      'No se puede saber con lo que da el juego: según cuántas de las 1.214 cartas de origen desconocido fueran de estas, da peor de lo normal o mejor de lo normal. Sería normal si entre 54 y 116 lo fueran; con menos, mejor de lo normal; con más, peor.',
    )
    expect(rare).not.toHaveTextContent('pasa 1 de cada')
    expect(ex).toHaveTextContent('◊◊◊◊ (ex): 548 (del juego, de todas las fuentes)')
    expect(ex).toHaveTextContent('se esperaban ~450')
    expect(ex).toHaveTextContent('Sería normal si entre 58 y 138 lo fueran')
    expect(lifetime).toHaveTextContent('Los que más abriste: Sobre Deluxe Mega 372 · Mega-Mewtwo X 52.')
    expect(lifetime).toHaveTextContent('2 sobres de expansiones que el catálogo todavía no tiene no cuentan')
    // With one import, «desde la primera importación» starts with the next one.
    expect(screen.queryByTestId('game-luck-since-first')).toBeNull()
    expect(screen.getByText(/Con la próxima importación empieza «desde la primera importación»/)).toBeInTheDocument()
    // The CSV's view stays, apart, with the expected count as a count (not a percentage).
    expect(screen.getByRole('heading', { name: 'Según tu colección' })).toBeInTheDocument()
    expect(screen.getByText(/se esperaban 1,3, 3,3 % de lo que entró/)).toBeInTheDocument()
  })

  it('pz/luck: «desde la primera importación» says which spans count and gives the verdict, with its tail', async () => {
    open(CSV_LUCK, { ...SUMMARY, luck: { ...LUCK, sinceFirst: SINCE_FIRST } })
    const card = await screen.findByTestId('game-luck-since-first')
    expect(card).toHaveTextContent('Desde la primera importación:')
    const [rare, ex] = within(card).getAllByTestId('since-first-tier') as [HTMLElement, HTMLElement]
    expect(rare).toHaveTextContent('☆ o más: cuentan 2 de 3 períodos entre importaciones.')
    expect(rare).toHaveTextContent('En las 201 cartas con probabilidades conocidas (n) se esperaban ~9')
    expect(rare).toHaveTextContent('de ellas salieron entre 13 y 14.')
    expect(rare).toHaveTextContent('mejor de lo normal (pasa 1 de cada 50)')
    expect(ex).toHaveTextContent('◊◊◊◊ (ex): todavía no cuenta ninguno de 3 períodos entre importaciones.')
    expect(screen.queryByText(/Con la próxima importación empieza/)).toBeNull()
  })

  it('review of #170: a single card of unknown origin is said in the singular', async () => {
    const lifetime = { ...LUCK.lifetime, rare: { ...LUCK.lifetime.rare, unknown: 1, normalIf: { min: 1, max: 1 } } }
    open(CSV_LUCK, { ...SUMMARY, luck: { ...LUCK, lifetime } })
    const cards = await screen.findAllByTestId('game-luck')
    const [rare] = within(cards[1] as HTMLElement).getAllByTestId('game-tier') as [HTMLElement]
    expect(rare).toHaveTextContent(
      'No se puede saber con lo que da el juego: según si la carta de origen desconocido fuera de estas, da peor de lo normal o mejor de lo normal. Sería normal si 1 lo fuera; con menos, mejor de lo normal; con más, peor.',
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
