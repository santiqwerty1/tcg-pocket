// The deck's «Rendimiento»: the three sources as three blocks under one legend. Every answer of the API goes through
// the web's schema before it is served, so a fixture cannot drift from the shape the screen reads.
//
// The numbers are invented (they start from the mock-up's public docs/prototipos/renovacion-ui/datos.js): none is a
// real result.
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { archetypesResponseSchema, deckComparisonSchema, matchStatsSchema } from '@/api/schemas'
import { Providers } from '@/app/Providers'
import { type FakeCall, fakeApi } from '@/test/fakeApi'
import { DASH } from '@/test/figures'
import { DeckPerformance } from './DeckPerformance'

// Radix's Select asks for pointer capture, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type Comparison = z.input<typeof deckComparisonSchema>
type Column = Comparison['columns'][number]
type Row = NonNullable<Column['rows']>[number]
type Rate = NonNullable<Column['rate']>

const TEXT =
  'Posible punto ciego del bot: e2 casi nunca evoluciona a Ivysaur, que no hace daño, así que el mazo casi no llega a Mega-Venusaur ex. Probalo con f2.'
const SCOPE = 'Era B4a (Ambición del Equipo Rocket), 12 torneos, media 48,2 %. Datos de torneo: Limitless.'

const mineRate: Rate = {
  source: 'matches',
  value: (24 / 47) * 100,
  games: 47,
  samples: 47,
  sampleKind: 'matches',
  ci95: [37.2, 64.7],
  orientative: false,
}
const MINE: Column = {
  source: 'matches',
  label: 'Mis partidas',
  available: true,
  record: { wins: 24, losses: 22, ties: 1 },
  rate: mineRate,
  note: 'Partidas registradas en la app, todas las modalidades.',
}
/** No match yet: the source is there (`available`), it has nothing to count. */
const MINE_NONE: Column = {
  source: 'matches',
  label: 'Mis partidas',
  available: true,
  record: { wins: 0, losses: 0, ties: 0 },
  rate: null,
  note: 'Todavía no registraste partidas con este mazo.',
}
/** One match, lost: a real zero. */
const MINE_LOST_ONCE: Column = {
  ...MINE,
  record: { wins: 0, losses: 1, ties: 0 },
  rate: { ...mineRate, value: 0, games: 1, samples: 1, ci95: [0, 79.3], orientative: true },
}

/** 8 games in 2 lists: «orientativo» by its lists. */
const EXACT: Row = {
  label: 'Lista exacta',
  record: { wins: 1, losses: 7, ties: 0 },
  rate: {
    source: 'tournament',
    value: 12.5,
    games: 8,
    samples: 2,
    sampleKind: 'lists',
    ci95: [2.2, 47.1],
    orientative: true,
  },
}
/** 70 games, more than 30, and still «orientativo»: they are in 14 lists. */
const ARCHETYPE: Row = {
  label: 'Arquetipo: Butterfree Mega Sceptile ex',
  record: { wins: 25, losses: 45, ties: 0 },
  rate: {
    source: 'tournament',
    value: (25 / 70) * 100,
    games: 70,
    samples: 14,
    sampleKind: 'lists',
    ci95: [25.5, 47.4],
    orientative: true,
  },
  note: 'Sugerido por las listas más parecidas (2 cambios).',
}
const tournament = (rows: Row[]): Column => ({
  source: 'tournament',
  label: 'Torneo',
  available: rows.length > 0,
  record: rows[0]?.record ?? null,
  rate: rows[0]?.rate ?? null,
  note: rows.length > 0 ? SCOPE : `Nadie jugó esta lista ni una parecida en la era. ${SCOPE}`,
  rows,
})
const TOURNAMENT = tournament([EXACT, ARCHETYPE])
const TOURNAMENT_NONE: Column = {
  source: 'tournament',
  label: 'Torneo',
  available: false,
  record: null,
  rate: null,
  note: 'Todavía no hay datos de torneo sincronizados.',
}

const BOTS: Column = {
  source: 'simulation',
  label: 'Simulación',
  available: true,
  record: { wins: 7095, losses: 7004, ties: 80 },
  rate: {
    source: 'simulation',
    value: (7095 / 14179) * 100,
    games: 14179,
    samples: 14179,
    sampleKind: 'simulations',
    ci95: [49.2, 50.9],
    orientative: false,
  },
  note: 'Bots g2 vs g2, 3 simulaciones, motor 0a1b2c3. El porcentaje depende del bot.',
  blindSpot: null,
}
const BOTS_NONE: Column = {
  source: 'simulation',
  label: 'Simulación',
  available: false,
  record: null,
  rate: null,
  note: 'Todavía no se simuló la lista actual de este mazo (Pruebas → Simulación).',
}

/** A comparison as the API answers it, checked against the schema the screen parses it with. */
const comparison = (...columns: Column[]) =>
  deckComparisonSchema.parse({ deck: { id: '40', name: 'Butterfree / Mega-Sceptile ex', archived: false }, columns })

const SCOPE_ROW = { lists: 0, record: { wins: 0, losses: 0, ties: 0 }, rate: null, share: 0 }
/** The archetypes of the era, as `GET /api/tournaments/archetypes` gives them. */
const archetypes = (...rows: { id: string | null; name: string; lists: number }[]) =>
  archetypesResponseSchema.parse({
    scope: {
      era: { code: 'B4a', nameEs: 'Ambición del Equipo Rocket', from: '2026-09-25', to: null, current: true },
      format: 'STANDARD',
      minPlayers: 50,
      tournaments: 12,
      lists: 900,
      games: 5000,
      mean: SCOPE_ROW,
      conflicts: [],
      unknownCards: 0,
      attribution: 'Datos de torneo: Limitless',
    },
    rows: rows.map((row) => ({ ...SCOPE_ROW, lists: row.lists, archetype: { id: row.id, name: row.name, icons: [] } })),
  })
const ERA = archetypes(
  { id: 'butterfree-mega-sceptile-ex', name: 'Butterfree Mega Sceptile ex', lists: 14 },
  { id: 'gyarados-ex', name: 'Gyarados ex', lists: 1203 },
  // The lists no archetype claims: a row of the era with no id, which is nothing a deck can be set to.
  { id: null, name: 'Otros', lists: 37 },
)

const statRow = (wins: number, losses: number, ties = 0) => {
  const games = wins + losses + ties
  return {
    record: { wins, losses, ties },
    rate: { ...mineRate, value: (wins / games) * 100, games, samples: games, orientative: games < 30 },
  }
}
type Stats = z.input<typeof matchStatsSchema>
/** Going first against going second, as the API says it: 14 of 23 against 10 of 24, and its sentence. */
const TURN_ORDER: NonNullable<Stats['turnOrder']> = {
  first: { wins: 14, losses: 9, ties: 0 },
  second: { wins: 10, losses: 13, ties: 1 },
  unknown: 0,
  coverage: 100,
  firstShare: (14 / 23) * 100,
  secondShare: (10 / 24) * 100,
  gap: (14 / 23) * 100 - (10 / 24) * 100,
  z: 1.32,
  p: 0.24,
  verdict: 'maybe',
  text: 'Empezando ganás el 60,9 % (n = 23) y yendo segundo el 41,7 % (n = 24): 19,2 puntos más empezando, pero puede ser azar.',
}
/** The same matches with the coin even: half going first, half going second. */
const COIN_ADJUSTED: NonNullable<Stats['coinAdjusted']> = {
  value: 51.3,
  ci95: [37.1, 65.3],
  first: TURN_ORDER.first,
  second: TURN_ORDER.second,
  firstShare: (14 / 23) * 100,
  secondShare: (10 / 24) * 100,
  games: 47,
  unknown: 0,
  orientative: false,
  plain: (24 / 47) * 100,
  text: 'Sin ajustar es 51,1 %: empezaste 23 de 47 partidas.',
}
/** The own matches of the deck, as `GET /api/matches/stats?deckId=40` gives them. */
const stats = (revisions: number, more: Partial<Stats> = {}) =>
  matchStatsSchema.parse({
    filters: { deckId: '40', mode: null, from: null, to: null },
    overall: statRow(24, 22, 1),
    byDeck: [],
    byOpponent: [{ ...statRow(9, 4), key: 'gyarados ex', label: 'Gyarados ex' }],
    byWentFirst: [
      { ...statRow(14, 9), key: 'first', label: 'Empecé yo' },
      { ...statRow(10, 13, 1), key: 'second', label: 'Empezó el rival' },
      { record: { wins: 0, losses: 0, ties: 0 }, rate: null, key: 'unknown', label: 'Sin dato' },
    ],
    byMode: [],
    byRevision: Array.from({ length: revisions }, (_, at) => ({ ...statRow(12, 11), revision: at + 1 })),
    ...more,
  })

function show(routes: Parameters<typeof fakeApi>[0], props: { archetype?: string | null } = {}) {
  const api = fakeApi(routes)
  const router = createMemoryRouter(
    [
      {
        path: '/mazos/:id',
        element: <DeckPerformance deckId="40" tournamentArchetypeId={props.archetype ?? null} />,
      },
    ],
    { initialEntries: ['/mazos/40'] },
  )
  render(
    <Providers queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return api
}

const requests = (calls: FakeCall[]) =>
  calls.map((call) => `${call.method} ${call.path}${call.query.size > 0 ? `?${call.query}` : ''}`)

/** The three sources and their legend. */
const sources = () => screen.findByRole('region', { name: 'Tres fuentes, nunca mezcladas' })
const blocks = (region: HTMLElement) => [...region.querySelectorAll<HTMLElement>('[data-slot="source-block"]')]
function block(region: HTMLElement, source: Column['source']): HTMLElement {
  const found = region.querySelector<HTMLElement>(`[data-slot="source-block"][data-source="${source}"]`)
  if (!found) throw new Error(`no block of ${source}`)
  return found
}
/** The part of a block with this name that is its own (a row of the detail has none). */
function part(of: HTMLElement, name: string): HTMLElement | null {
  return of.querySelector<HTMLElement>(`:scope > [data-part="${name}"]`)
}
/** The lines a block writes under its bar, as they are read. */
const lines = (of: HTMLElement) => [...(part(of, 'figures')?.children ?? [])].map((line) => text(line))
/** A text as it is read: a no-break space is a space. */
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\u00a0/g, ' ')
const legend = (region: HTMLElement) => {
  const found = region.querySelector<HTMLElement>('[data-slot="source-legend"]')
  if (!found) throw new Error('no legend')
  return found
}
/** The keys of the legend, in order. */
const keys = (region: HTMLElement) =>
  [...legend(region).querySelectorAll('[data-key]')].map((key) => key.getAttribute('data-key'))

describe('the three sources of a deck', () => {
  it('with data: one block for each source, in the API’s order, each under its seal and with all of its figure', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS) })
    const region = await sources()
    expect(blocks(region).map((item) => item.getAttribute('data-source'))).toEqual([
      'matches',
      'tournament',
      'simulation',
    ])
    for (const item of blocks(region)) {
      expect(item).toHaveAttribute('data-size', 'lane')
      expect(item).not.toHaveAttribute('data-unavailable')
      expect(item.querySelectorAll(':scope > [data-part="head"] [data-slot="source-seal"]')).toHaveLength(1)
      // One percentage for each source, drawn too: nothing adds two of them.
      expect(item.querySelectorAll(':scope > [data-part="head"] [data-part="value"]')).toHaveLength(1)
      expect(item.querySelectorAll(':scope > [data-part="chart"] [data-slot="interval-bar"]')).toHaveLength(1)
    }

    const mine = block(region, 'matches')
    expect(text(part(mine, 'head'))).toBe('MMis partidas51,1 %')
    expect(lines(mine)).toEqual(['n = 47 · 24 V · 22 D · 1 E', `IC 37,2${DASH}64,7 %`])
    const mineNote = part(mine, 'note')
    expect(mineNote?.tagName).toBe('P')
    expect(mineNote).toHaveTextContent('Partidas registradas en la app, todas las modalidades.')

    const tournaments = block(region, 'tournament')
    expect(text(part(tournaments, 'head'))).toBe('TTorneo12,5 %')
    expect(lines(tournaments)).toEqual([
      'n = 8 en 2 listas · 1 V · 7 D',
      `IC 2,2${DASH}47,1 % · orientativo: menos de 30 listas`,
    ])
    expect(part(tournaments, 'note')?.tagName).toBe('P')
    expect(part(tournaments, 'note')).toHaveTextContent(SCOPE)

    const bots = block(region, 'simulation')
    expect(text(part(bots, 'head'))).toBe('BSimulación50 %')
    expect(lines(bots)).toEqual(['n = 14.179 · 7.095 V · 7.004 D · 80 E', `IC 49,2${DASH}50,9 %`])
    expect(part(bots, 'note')).toHaveTextContent('Bots g2 vs g2, 3 simulaciones, motor 0a1b2c3.')
    expect(part(bots, 'warning')).toBeNull()

    // The three percentages of the three sources, and no other number that could be their sum or their mean.
    expect(
      [
        ...region.querySelectorAll(
          ':scope > div > [data-slot="source-block"] > [data-part="head"] [data-part="value"]',
        ),
      ].map(text),
    ).toEqual(['51,1 %', '12,5 %', '50 %'])
  })

  it('the seals are silent beside the API’s names, which already say their source: a reader hears each source once', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS) })
    const region = await sources()
    const seal = (source: Column['source']) => block(region, source).querySelector('[data-slot="source-seal"]')
    // «Mis partidas», «Torneo» and «Simulación»: no «Torneos, Torneo» nor «Bots, Simulación» (review of #211).
    for (const source of ['matches', 'tournament', 'simulation'] as const) {
      expect(seal(source), source).toHaveAttribute('aria-hidden', 'true')
    }
    expect(within(region).queryAllByRole('img', { name: /^(Mis partidas|Torneos|Bots)$/ })).toEqual([])
  })

  it('one legend for the three: each seal, what «orientativo» counted here, and which interval is written', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS) })
    const region = await sources()
    expect(region.querySelectorAll('[data-slot="source-legend"]')).toHaveLength(1)
    expect(keys(region)).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'interval'])
    // The legend is the last thing of the card, under the three blocks.
    expect(region.lastElementChild).toBe(legend(region))
    expect(text(legend(region))).toBe(
      'Mmis partidasTtorneosBbotsorientativo: menos de 30 listasIC: intervalo de confianza del 95 %',
    )
  })

  it('without data: «sin datos» in each block and never a zero; what cannot give a number says why, in its dashed box', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE_NONE, TOURNAMENT_NONE, BOTS_NONE) })
    const region = await sources()
    expect(blocks(region)).toHaveLength(3)
    for (const item of blocks(region)) {
      expect(item.querySelector(':scope > [data-part="head"] [data-slot="no-data"]')).toHaveTextContent('sin datos')
      expect(part(item, 'chart')).toBeNull()
      expect(part(item, 'figures')).toBeNull()
      expect(item.querySelector('[data-part="value"]')).toBeNull()
    }
    // No percentage at all, and so no zero.
    expect(text(region)).not.toMatch(/\d\s*%/)

    // Own matches are a source that is there with nothing to count yet: its note, and no dashed box.
    const mine = block(region, 'matches')
    expect(mine).not.toHaveAttribute('data-unavailable')
    expect(part(mine, 'note')?.tagName).toBe('P')
    expect(part(mine, 'note')).toHaveTextContent('Todavía no registraste partidas con este mazo.')

    for (const [source, reason] of [
      ['tournament', 'Todavía no hay datos de torneo sincronizados.'],
      ['simulation', 'Todavía no se simuló la lista actual de este mazo (Pruebas → Simulación).'],
    ] as const) {
      const item = block(region, source)
      expect(item).toHaveAttribute('data-unavailable')
      expect(item).toHaveClass('border-dashed')
      // The API's note is the reason, in a paragraph, and it is written once.
      expect(part(item, 'unavailable')?.tagName).toBe('P')
      expect(part(item, 'unavailable')).toHaveTextContent(reason)
      expect(part(item, 'note')).toBeNull()
      expect(part(item, 'more')).toBeNull()
    }

    // The seals are still explained; no figure is «orientativo» and no interval is written, so neither has a key.
    expect(keys(region)).toEqual(['matches', 'tournament', 'simulation'])
  })

  it('a real 0 % with a match behind it is a figure, not «sin datos»', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE_LOST_ONCE, TOURNAMENT_NONE, BOTS_NONE) })
    const region = await sources()
    const mine = block(region, 'matches')
    expect(text(part(mine, 'head'))).toBe('MMis partidas0 %')
    expect(mine.querySelector('[data-slot="no-data"]')).toBeNull()
    expect(lines(mine)).toEqual(['n = 1 · 0 V · 1 D', `IC 0,0${DASH}79,3 % · orientativo: menos de 30 partidas`])
    expect(keys(region)).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'interval'])
    expect(text(legend(region))).toContain('orientativo: menos de 30 partidas')
    expect(text(legend(region))).not.toContain('listas')
  })

  it('a tournament figure with 70 games is still «orientativo»: it says «listas», in the block and in the legend, and nowhere «partidas»', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, tournament([ARCHETYPE]), BOTS) })
    const region = await sources()
    const tournaments = block(region, 'tournament')
    expect(text(part(tournaments, 'head'))).toBe('TTorneo35,7 %')
    expect(lines(tournaments)).toEqual([
      'n = 70 en 14 listas · 25 V · 45 D',
      `IC 25,5${DASH}47,4 % · orientativo: menos de 30 listas`,
    ])
    // Its mark is drawn before those words, as decoration: the words are what says it.
    const mark = part(tournaments, 'figures')?.querySelector('[data-slot="orientative-mark"]')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark?.closest('[data-slot="mark-words"]')).toHaveTextContent(/^orientativo: menos de 30 listas$/)
    expect(text(legend(region))).toContain('orientativo: menos de 30 listas')
    expect(text(tournaments)).not.toMatch(/menos de 30 partidas/)
    expect(text(legend(region))).not.toMatch(/menos de 30 partidas/)
    // Not in a name or a title either: no mark of the card says another kind than its words.
    expect(region.outerHTML).not.toMatch(/menos de 30 partidas/i)
  })

  it('the legend says each thing «orientativo» counted, from the three blocks and from the rows of the tournament one', async () => {
    // Own matches by matches, the tournament by lists.
    show({ 'GET /api/decks/40/comparison': comparison(MINE_LOST_ONCE, TOURNAMENT, BOTS) })
    expect(text(legend(await sources()))).toContain('orientativo: menos de 30 partidas, o de 30 listas en torneos')
  })

  it('a row of the tournament block that is «orientativo» has its key in the legend, whatever the headline', async () => {
    const solid: Row = {
      ...EXACT,
      rate: { ...(EXACT.rate as Rate), games: 420, samples: 40, ci95: [9.7, 16], orientative: false },
    }
    show({ 'GET /api/decks/40/comparison': comparison(MINE, tournament([solid, ARCHETYPE]), BOTS) })
    const region = await sources()
    expect(lines(block(region, 'tournament'))).toEqual(['n = 420 en 40 listas · 1 V · 7 D', `IC 9,7${DASH}16,0 %`])
    expect(keys(region)).toContain('orientative')
    expect(text(legend(region))).toContain('orientativo: menos de 30 listas')
  })

  it('no figure «orientativo», no key for it', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS) })
    expect(keys(await sources())).toEqual(['matches', 'tournament', 'simulation', 'interval'])
  })
})

describe('H-055: «posible punto ciego del bot»', () => {
  it('is the warning of the bots’ block, right under its figures and before its note', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, { ...BOTS, blindSpot: { text: TEXT } }) })
    const region = await sources()
    const bots = block(region, 'simulation')
    const warning = part(bots, 'warning')
    expect(warning?.tagName).toBe('P')
    expect(warning).toHaveTextContent(TEXT)
    expect([...bots.children].map((child) => child.getAttribute('data-part'))).toEqual([
      'head',
      'chart',
      'figures',
      'warning',
      'note',
    ])
    // Written once, and in no other block.
    expect(screen.getAllByText(TEXT)).toHaveLength(1)
  })

  it('nothing when the simulation has none', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS) })
    expect(await screen.findByText(/^Bots g2 vs g2/)).toBeInTheDocument()
    expect(screen.queryByText(/^Posible punto ciego del bot/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-part="warning"]')).toBeNull()
  })

  it('it is about the bots: no other source writes one', async () => {
    show({
      'GET /api/decks/40/comparison': comparison({ ...MINE, blindSpot: { text: TEXT } }, TOURNAMENT_NONE, BOTS),
    })
    await sources()
    expect(screen.queryByText(TEXT)).not.toBeInTheDocument()
  })
})

describe('the tournament block, in detail', () => {
  it('holds its rows, the way to the archetype and the choice of archetype, after its note', async () => {
    show(
      { 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS), 'GET /api/tournaments/archetypes': ERA },
      { archetype: 'butterfree-mega-sceptile-ex' },
    )
    const region = await sources()
    const tournaments = block(region, 'tournament')
    const select = await within(tournaments).findByRole('combobox', { name: 'Arquetipo del mazo en torneos' })
    expect([...tournaments.children].map((child) => child.getAttribute('data-part'))).toEqual([
      'head',
      'chart',
      'figures',
      'note',
      'more',
    ])
    const more = within(part(tournaments, 'more') as HTMLElement)
    expect(more.getByRole('heading', { level: 3, name: 'Torneo, en detalle' })).toBeInTheDocument()
    const rows = more.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(text(rows[0])).toBe(`Lista exacta12,5 %1 V · 7 D · n = 8 en 2 listas · IC 2,2${DASH}47,1 %orientativo`)
    expect(text(rows[1])).toBe(
      `Arquetipo: Butterfree Mega Sceptile ex35,7 %Sugerido por las listas más parecidas (2 cambios). · 25 V · 45 D · n = 70 en 14 listas · IC 25,5${DASH}47,4 %orientativo`,
    )
    // The name of an archetype is whole, on a second line when it takes one: the list does not cut it here.
    expect(more.getByText('Arquetipo: Butterfree Mega Sceptile ex')).toHaveClass('whitespace-normal', 'wrap-anywhere')
    // Each «orientativo» of a row says what it counted: lists.
    for (const badge of more.getAllByText('orientativo')) {
      expect(badge).toHaveAttribute('title', 'Menos de 30 listas: orienta, no prueba')
    }
    const way = more.getByRole('link', { name: 'Ver el arquetipo en Torneos' })
    expect(way).toHaveAttribute('href', '/torneos/arquetipos/butterfree-mega-sceptile-ex')
    // A line of text is 20 px: the link is as tall as a finger, 44 px, with its words in the middle.
    expect(way).toHaveClass('flex', 'min-h-11', 'items-center', 'underline')
    expect(select).toHaveTextContent('Butterfree Mega Sceptile ex (14)')
    // Its value is never cut: it takes a second line, and the select grows from the 44 px of a tap.
    expect(select).toHaveClass(
      'w-full',
      'whitespace-normal',
      'data-[size=default]:h-auto',
      'data-[size=default]:min-h-11',
    )
    // And the one line of 44 px of the kit's trigger is gone, with its cut.
    for (const kit of ['whitespace-nowrap', 'data-[size=default]:h-11', '*:data-[slot=select-value]:line-clamp-1']) {
      expect(select.className.split(/\s+/), kit).not.toContain(kit)
    }
    // No other block has a detail.
    expect(region.querySelectorAll('[data-part="more"]')).toHaveLength(1)
  })

  it('without an archetype chosen the select says the one it guesses, and there is no way to an archetype', async () => {
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS),
      'GET /api/tournaments/archetypes': ERA,
    })
    const tournaments = block(await sources(), 'tournament')
    expect(await within(tournaments).findByRole('combobox')).toHaveTextContent(
      'Arquetipo: sugerido por las listas más parecidas',
    )
    expect(within(tournaments).queryByRole('link', { name: 'Ver el arquetipo en Torneos' })).toBeNull()
  })

  it('an archetype kept from another era has no way to it: it would open nothing', async () => {
    show(
      { 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS), 'GET /api/tournaments/archetypes': ERA },
      { archetype: 'pikachu-ex' },
    )
    const tournaments = block(await sources(), 'tournament')
    await within(tournaments).findByRole('combobox')
    expect(within(tournaments).queryByRole('link', { name: 'Ver el arquetipo en Torneos' })).toBeNull()
  })

  it('nobody played the list: its reason, and still the choice of archetype, inside the dashed box', async () => {
    show({
      'GET /api/decks/40/comparison': comparison(MINE, tournament([]), BOTS),
      'GET /api/tournaments/archetypes': ERA,
    })
    const tournaments = block(await sources(), 'tournament')
    expect(await within(tournaments).findByRole('combobox')).toBeInTheDocument()
    expect(tournaments).toHaveAttribute('data-unavailable')
    expect(part(tournaments, 'unavailable')).toHaveTextContent(/^Nadie jugó esta lista ni una parecida en la era\./)
    expect(within(tournaments).getByRole('heading', { level: 3, name: 'Torneo, en detalle' })).toBeInTheDocument()
    // No row, and no «Sin partidas.» in the place of the rows.
    expect(within(tournaments).queryByRole('list')).toBeNull()
    expect(within(tournaments).queryByText('Sin partidas.')).toBeNull()
  })

  it('without rows and without archetypes there is nothing more: the note is the last paragraph of the block', async () => {
    const { calls } = show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS),
      'GET /api/tournaments/archetypes': archetypes(),
    })
    const tournaments = block(await sources(), 'tournament')
    await vi.waitFor(() => expect(requests(calls)).toContain('GET /api/tournaments/archetypes'))
    await act(async () => {})
    expect(part(tournaments, 'more')).toBeNull()
    expect(within(tournaments).queryByRole('heading')).toBeNull()
    const paragraphs = tournaments.querySelectorAll('p')
    expect(paragraphs[paragraphs.length - 1]).toHaveTextContent('Todavía no hay datos de torneo sincronizados.')
  })

  it('choosing an archetype saves it on the deck, and choosing the guess clears it', async () => {
    const user = userEvent.setup()
    const { calls } = show(
      { 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS), 'GET /api/tournaments/archetypes': ERA },
      { archetype: 'butterfree-mega-sceptile-ex' },
    )
    const tournaments = block(await sources(), 'tournament')
    const saved = () =>
      calls.filter((call) => call.method === 'PATCH').map((call) => `${call.path} ${String(call.body)}`)
    await user.click(await within(tournaments).findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Gyarados ex (1.203)' }))
    await vi.waitFor(() => expect(saved()).toEqual(['/api/decks/40 {"tournamentArchetypeId":"gyarados-ex"}']))
    await user.click(within(tournaments).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Arquetipo: sugerido por las listas más parecidas' }))
    await vi.waitFor(() => expect(saved()).toHaveLength(2))
    expect(saved()[1]).toBe('/api/decks/40 {"tournamentArchetypeId":null}')
  })

  it('offers the guess and each archetype of the era that has an id, with its lists; a row without one is no choice', async () => {
    const user = userEvent.setup()
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS),
      'GET /api/tournaments/archetypes': ERA,
    })
    const tournaments = block(await sources(), 'tournament')
    await user.click(await within(tournaments).findByRole('combobox'))
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Arquetipo: sugerido por las listas más parecidas',
      'Butterfree Mega Sceptile ex (14)',
      'Gyarados ex (1.203)',
    ])
  })

  it('a choice the API refuses is said in a toast, with the API’s words, and the select keeps what it had', async () => {
    const user = userEvent.setup()
    const said = vi.spyOn(toast, 'error').mockImplementation(() => '')
    const { calls } = show(
      {
        'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS),
        'GET /api/tournaments/archetypes': ERA,
        'PATCH /api/decks/40': () =>
          new Response(JSON.stringify({ error: { code: 'conflict', message: 'El mazo cambió en otro lado.' } }), {
            status: 409,
          }),
      },
      { archetype: 'butterfree-mega-sceptile-ex' },
    )
    const tournaments = block(await sources(), 'tournament')
    await user.click(await within(tournaments).findByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Gyarados ex (1.203)' }))
    await vi.waitFor(() => expect(said).toHaveBeenCalledTimes(1))
    expect(said).toHaveBeenCalledWith('El mazo cambió en otro lado.')
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    // The archetype is the deck's, given by the page: nothing was saved, so nothing changed.
    expect(within(tournaments).getByRole('combobox')).toHaveTextContent('Butterfree Mega Sceptile ex (14)')
  })
})

describe('point 6: the section asks for what it asked before, and for nothing more', () => {
  /** A clock that only the test moves: a request made after a wait or by an interval is seen without sleeping. */
  const ownClock = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  /**
   * The answers that are on their way arrive, and what they mount asks and is answered too. A millisecond each round:
   * what a timer of this clock schedules «at once» is due one millisecond later.
   */
  const settle = async () => {
    for (let round = 0; round < 5; round++) await pass(1)
  }
  // Measured on the section as it was with its three columns, before the blocks, under this same clock.
  const BEFORE = ['GET /api/decks/40/comparison', 'GET /api/matches/stats?deckId=40', 'GET /api/tournaments/archetypes']

  it('the comparison, the own matches of the deck and the archetypes of the era, once each; nothing in two hours', async () => {
    ownClock()
    const { calls } = show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT, BOTS),
      'GET /api/matches/stats?deckId=40': stats(2),
      'GET /api/tournaments/archetypes': ERA,
    })
    await settle()
    expect(screen.getByRole('region', { name: 'Tres fuentes, nunca mezcladas' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Arquetipo del mazo en torneos' })).toBeInTheDocument()
    expect(requests(calls)).toEqual(BEFORE)
    await pass(120 * 60_000)
    expect(requests(calls)).toEqual(BEFORE)
  })

  it('the same three when no source has a number', async () => {
    ownClock()
    const { calls } = show({ 'GET /api/decks/40/comparison': comparison(MINE_NONE, TOURNAMENT_NONE, BOTS_NONE) })
    await settle()
    expect(screen.getByRole('region', { name: 'Tres fuentes, nunca mezcladas' })).toBeInTheDocument()
    expect(requests(calls)).toEqual(BEFORE)
    await pass(120 * 60_000)
    expect(requests(calls)).toEqual(BEFORE)
  })

  it('a comparison that fails asks for no archetype; «Reintentar» asks for the comparison again, and only for it', async () => {
    const user = userEvent.setup()
    const { calls } = show({})
    const failed = await screen.findByRole('alert')
    expect(failed).toHaveTextContent('sin API')
    expect(screen.queryByRole('region', { name: 'Tres fuentes, nunca mezcladas' })).toBeNull()
    expect(requests(calls)).toEqual(BEFORE.slice(0, 2))
    await user.click(within(failed).getByRole('button', { name: 'Reintentar' }))
    await vi.waitFor(() => expect(requests(calls)).toEqual([...BEFORE.slice(0, 2), 'GET /api/decks/40/comparison']))
  })
})

describe('what the section had and keeps', () => {
  it('its title; the way to log a match with the deck is no longer the section’s, but the fixed row’s', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS) })
    expect(blocks(await sources())).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 2, name: 'Rendimiento' })).toBeInTheDocument()
    // The 36 px link of its header went to the row (`frame.ts`), where it is a link of 48 px with its text.
    expect(screen.queryByRole('link', { name: /Registrar partida/ })).toBeNull()
    expect(document.querySelector('a[href^="/partidas?mazo="]')).toBeNull()
  })

  it('while the comparison comes it says so, with a row for each source, and then the blocks take its place', async () => {
    show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS) })
    const loading = screen.getByRole('status', { name: 'Cargando' })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
    expect(screen.queryByRole('region', { name: 'Tres fuentes, nunca mezcladas' })).toBeNull()
    await sources()
    expect(screen.queryByRole('status', { name: 'Cargando' })).toBeNull()
  })

  it('the breakdown of own matches: by rival, by who started, by revision, and the way to the matches', async () => {
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(2),
    })
    expect(await screen.findByRole('heading', { level: 3, name: 'Mis partidas por rival' })).toBeInTheDocument()
    expect(screen.getByText('Gyarados ex')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '¿Importa empezar?' })).toBeInTheDocument()
    // The API sent no comparison of the two sides: the heading and its rows stay, without the card.
    expect(screen.queryByText('Empezando')).toBeNull()
    expect(screen.queryByText(/Con la moneda pareja/)).toBeNull()
    expect(screen.getByText('Empecé yo')).toBeInTheDocument()
    expect(screen.getByText('Empezó el rival')).toBeInTheDocument()
    // A side with no match is left out.
    expect(screen.queryByText('Sin dato')).toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: 'Por revisión del mazo' })).toBeInTheDocument()
    expect(screen.getByText('Revisión #1')).toBeInTheDocument()
    expect(screen.getByText('Revisión #2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver las 47 partidas' })).toHaveAttribute(
      'href',
      '/partidas/historial?mazo=40',
    )
    // It is under the three sources, not inside them.
    const region = await sources()
    expect(within(region).queryByText('Mis partidas por rival')).toBeNull()
  })

  it('«¿Importa empezar?» keeps its card: the two sides, the API’s sentence and the rate with the coin even', async () => {
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(2, { turnOrder: TURN_ORDER, coinAdjusted: COIN_ADJUSTED }),
    })
    const heading = await screen.findByRole('heading', { level: 3, name: '¿Importa empezar?' })
    // The card is under that heading, before the rows of each side.
    const group = within(heading.parentElement as HTMLElement)
    const side = (label: string) => text(group.getByText(label).parentElement)
    expect(side('Empezando')).toBe('Empezando60,9 %14 V · 9 D')
    expect(side('Yendo segundo')).toBe('Yendo segundo41,7 %10 V · 13 D · 1 E')
    expect(group.getByText(TURN_ORDER.text)).toBeInTheDocument()
    expect(text(group.getByText(/Con la moneda pareja/))).toBe('Con la moneda pareja: 51,3 %')
    expect(group.getByText(/^Sin ajustar es 51,1/)).toHaveTextContent(
      'Sin ajustar es 51,1 %: empezaste 23 de 47 partidas. La moneda decide quién empieza',
    )
    expect(text(group.getByText(/tienen anotado quién empezó/))).toBe(
      '100 % de estas partidas tienen anotado quién empezó. Lo podés pedir siempre en Menú → Ajustes de la app.',
    )
    const order = [...(heading.parentElement as HTMLElement).children].map((child) => child.tagName)
    expect(order).toEqual(['H3', 'DIV', 'UL'])
    expect(group.getByText('Empecé yo')).toBeInTheDocument()
  })

  it('one revision is no breakdown by revision', async () => {
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(1),
    })
    expect(await screen.findByRole('heading', { level: 3, name: 'Mis partidas por rival' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Por revisión del mazo' })).toBeNull()
  })

  it('with one match the way to it says «la partida»; with thousands, the number has its point', async () => {
    const one = { ...statRow(0, 1), key: 'gyarados ex', label: 'Gyarados ex' }
    show({
      'GET /api/decks/40/comparison': comparison(MINE_LOST_ONCE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(1, { overall: statRow(0, 1), byOpponent: [one] }),
    })
    const link = await screen.findByRole('link', { name: 'Ver la partida' })
    expect(link).toHaveAttribute('href', '/partidas/historial?mazo=40')
    expect(screen.queryByRole('link', { name: /^Ver las/ })).toBeNull()
    cleanup()
    show({
      'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(1, { overall: statRow(640, 580, 14) }),
    })
    expect(await screen.findByRole('link', { name: 'Ver las 1.234 partidas' })).toHaveAttribute(
      'href',
      '/partidas/historial?mazo=40',
    )
    expect(screen.queryByRole('link', { name: 'Ver la partida' })).toBeNull()
  })

  it('a deck with no match of its own has no breakdown, and no way to matches there are not', async () => {
    const { calls } = show({
      'GET /api/decks/40/comparison': comparison(MINE_NONE, TOURNAMENT_NONE, BOTS),
      'GET /api/matches/stats?deckId=40': stats(1, {
        overall: { record: { wins: 0, losses: 0, ties: 0 }, rate: null },
        byOpponent: [],
        byWentFirst: [],
        byRevision: [],
      }),
    })
    await sources()
    // The answer of the stats has arrived, and what it would have mounted has had its turn.
    await vi.waitFor(() => expect(requests(calls)).toContain('GET /api/matches/stats?deckId=40'))
    await act(async () => {})
    expect(screen.queryByRole('heading', { level: 3, name: 'Mis partidas por rival' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 3, name: '¿Importa empezar?' })).toBeNull()
    expect(screen.queryByText('Sin partidas.')).toBeNull()
    expect(screen.queryByRole('link', { name: /^Ver / })).toBeNull()
  })

  it('stats that do not come leave the three sources as they are, with no breakdown under them', async () => {
    const { calls } = show({ 'GET /api/decks/40/comparison': comparison(MINE, TOURNAMENT_NONE, BOTS) })
    expect(blocks(await sources())).toHaveLength(3)
    await vi.waitFor(() => expect(requests(calls)).toContain('GET /api/matches/stats?deckId=40'))
    await act(async () => {})
    expect(screen.queryByRole('heading', { level: 3, name: 'Mis partidas por rival' })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Ver / })).toBeNull()
    // And it is not said as an error of the section: the comparison is what the section is about.
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
