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
  it('pz/luck: the game’s packs and cards, where they came from, each number said for what it is', async () => {
    open(CSV_LUCK, SUMMARY)
    const cards = await screen.findAllByTestId('game-luck')
    expect(cards).toHaveLength(2)
    const [since, lifetime] = cards as [HTMLElement, HTMLElement]
    expect(since).toHaveTextContent('Desde la importación anterior')
    expect(since).toHaveTextContent('Abriste 5 sobres y obtuviste 20 cartas (del juego).')
    expect(within(since).queryByText(/origen desconocido/)).toBeNull()
    expect(within(since).queryByText(/◊◊◊◊/)).toBeNull()
    // A made-up lifetime read inside «Evento bis PROMO 2026».
    expect(lifetime).toHaveTextContent('Abriste 1.246 sobres y obtuviste 7.138 cartas (del juego).')
    const sources = within(lifetime).getByTestId('game-sources')
    expect(sources).toHaveTextContent('Sobres: ~5.909 cartas (estimado: sobres × cartas por sobre).')
    expect(sources).toHaveTextContent('Wonder Pick: 388 (del juego); ninguna cuenta como carta de sobre.')
    expect(sources).toHaveTextContent(
      'De origen desconocido: ~1.230 cartas — 48 intercambios (del juego), 388 de Wonder Pick (Evento bis PROMO 2026: promos y más elecciones Chansey en Wonder Pick), a lo sumo 1 carta asegurada de un sobre de aniversario (★★), ~793 de regalos, premios, canjes de puntos y promos (estimado).',
    )
    // n is the packs' cards; the verdict only when the unknown ones could not change it, and otherwise when it would
    // be normal.
    const [rare, ex] = within(lifetime).getAllByTestId('game-tier') as [HTMLElement, HTMLElement]
    expect(rare).toHaveTextContent(
      '☆ o más: 297 (del juego, de todas las fuentes). En las 5.908 cartas de los sobres (n) se esperaban ~253 (estimado: 4,3 %, con las tasas de los sobres que abriste); de ellas salieron entre 0 y 297.',
    )
    expect(rare).toHaveTextContent(
      'No se puede saber con lo que da el juego: según cuántas de las 1.230 cartas de origen desconocido fueran de estas, da peor de lo normal o mejor de lo normal. Sería normal si entre 30 y 90 lo fueran; con menos, mejor de lo normal; con más, peor.',
    )
    expect(rare).not.toHaveTextContent('pasa 1 de cada')
    expect(ex).toHaveTextContent('◊◊◊◊ (ex): 545 (del juego, de todas las fuentes)')
    expect(ex).toHaveTextContent('se esperaban ~424')
    expect(ex).toHaveTextContent('Sería normal si entre 98 y 175 lo fueran')
    expect(lifetime).toHaveTextContent('Los que más abriste: Sobre Deluxe Mega 360 · Mega-Mewtwo X 48.')
    expect(lifetime).toHaveTextContent('2 sobres de expansiones que el catálogo todavía no tiene no cuentan')
    // Review of #172: why Wonder Pick counts for one end and not the other.
    expect(screen.getByText(/En Wonder Pick ves las cinco cartas antes de elegir/)).toBeInTheDocument()
    // With one import, «desde la primera importación» starts with the next one, and when to import is said.
    expect(screen.queryByTestId('game-luck-since-first')).toBeNull()
    expect(screen.getByText(/Con la próxima importación empieza «desde la primera importación»/)).toBeInTheDocument()
    expect(screen.queryByText(/se van sumando/)).toBeNull()
    expect(screen.getByTestId('import-regularly')).toHaveTextContent(
      'Importá todos los días a la misma hora, después del Sync automático de pokemon-zone',
    )
    // The CSV's view stays, apart, with the expected count as a count (not a percentage).
    expect(screen.getByRole('heading', { name: 'Según tu colección' })).toBeInTheDocument()
    expect(screen.getByText(/se esperaban 1,3, 3,3 % de lo que entró/)).toBeInTheDocument()
  })

  it('pz/luck: «desde la primera importación» says which spans count, each end, and the verdict with its tail', async () => {
    open(CSV_LUCK, { ...SUMMARY, luck: { ...LUCK, sinceFirst: SINCE_FIRST } })
    const card = await screen.findByTestId('game-luck-since-first')
    expect(card).toHaveTextContent('Desde la primera importación:')
    const [rare, ex] = within(card).getAllByTestId('since-first-tier') as [HTMLElement, HTMLElement]
    expect(rare).toHaveTextContent('☆ o más: cuentan 2 de 3 períodos entre importaciones.')
    // Review of #172: the packs alone for «mejor», with the Wonder Picks at the packs' odds for «peor».
    expect(rare).toHaveTextContent(
      'En las 200 cartas de los sobres (n) se esperaban ~9; con 2 cartas de Wonder Pick a la tasa de los sobres, ~9 en 202',
    )
    expect(rare).toHaveTextContent('De los sobres salieron al menos 12; de los sobres y Wonder Pick, a lo sumo 14.')
    expect(rare).toHaveTextContent('mejor de lo normal (pasa 1 de cada 50)')
    expect(ex).toHaveTextContent('◊◊◊◊ (ex): todavía no cuenta ninguno de 3 períodos entre importaciones.')
    expect(card).toHaveTextContent('en un empate, el más reciente')
    expect(within(card).getByTestId('import-regularly')).toBeInTheDocument()
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
