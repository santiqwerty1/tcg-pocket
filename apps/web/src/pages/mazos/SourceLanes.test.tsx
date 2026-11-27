// The three sources of a deck, as they are drawn from the columns of the API's answer. What the deck's page adds to
// them (the choice of the deck's archetype, the requests) is in DeckPerformance.test.tsx. The numbers are invented
// (pages/mas/pieces/fixtures.ts).
import { cleanup, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DECK, DECK_EMPTY, NOTES } from '@/pages/mas/pieces/fixtures'
import { DASH } from '@/test/figures'
import { SourceLane, SourceLanes } from './SourceLanes'

const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('SourceLanes', () => {
  it('is one card named «Tres fuentes, nunca mezcladas»: a lane for each column, in order, and the legend last', () => {
    render(<SourceLanes columns={DECK} />)
    const card = screen.getByRole('region', { name: 'Tres fuentes, nunca mezcladas' })
    expect(classes(card)).toEqual(expect.arrayContaining(['overflow-hidden', 'rounded-lg', 'border', 'bg-card']))
    const children = [...card.children]
    expect(children).toHaveLength(4)
    expect(children.slice(0, 3).map((lane) => lane.firstElementChild?.getAttribute('data-source'))).toEqual([
      'matches',
      'tournament',
      'simulation',
    ])
    expect(children[3]).toHaveAttribute('data-slot', 'source-legend')
    for (const lane of children.slice(0, 3)) {
      // The padding and the line between two lanes are the holder's, 12 × 14 px as D's; the block is all it holds.
      expect(classes(lane)).toEqual(expect.arrayContaining(['border-t', 'px-[14px]', 'py-3', 'first:border-t-0']))
      expect(lane.children).toHaveLength(1)
      expect(lane.firstElementChild).toHaveAttribute('data-slot', 'source-block')
      expect(lane.firstElementChild).toHaveAttribute('data-size', 'lane')
    }
  })

  it('takes another name where a page draws more than one', () => {
    render(
      <>
        <SourceLanes columns={DECK} />
        <SourceLanes columns={DECK_EMPTY} label="Tres fuentes de un mazo sin datos" />
      </>,
    )
    expect(screen.getAllByRole('region')).toHaveLength(2)
    expect(
      within(screen.getByRole('region', { name: 'Tres fuentes de un mazo sin datos' })).getAllByText('sin datos'),
    ).toHaveLength(3)
  })

  it('a screen may draw a column itself; the ones it leaves are drawn as they come', () => {
    render(
      <SourceLanes
        columns={DECK}
        lane={(column) =>
          column.source === 'tournament' ? (
            <SourceLane column={column}>
              <p>Más del torneo</p>
            </SourceLane>
          ) : column.source === 'matches' ? null : undefined
        }
      />,
    )
    const card = screen.getByRole('region', { name: 'Tres fuentes, nunca mezcladas' })
    const blocks = [...card.querySelectorAll('[data-slot="source-block"]')]
    expect(blocks.map((block) => block.getAttribute('data-source'))).toEqual(['matches', 'tournament', 'simulation'])
    // What the screen added is in the block of that column, inside its lane, the last thing of its detail; the
    // columns it left have nothing of the kind.
    const more = blocks.map((block) => block.querySelector('[data-part="more"]'))
    expect(more.map((item) => item !== null)).toEqual([false, true, false])
    expect(more[1]?.firstElementChild?.lastElementChild).toHaveTextContent(/^Más del torneo$/)
    expect(card.querySelectorAll('p')).toContain(screen.getByText('Más del torneo'))
    expect(blocks[1]?.parentElement).toHaveClass('px-[14px]')
  })

  it('names exactly the sources it is given in its legend, in their order: two columns are two seals', () => {
    const [mine, , bots] = DECK
    if (!mine || !bots) throw new Error('the deck of the fixtures has three columns')
    const { container, rerender } = render(<SourceLanes columns={[mine, bots]} />)
    const keys = () => [...container.querySelectorAll('[data-key]')].map((key) => key.getAttribute('data-key'))
    const blocks = () =>
      [...container.querySelectorAll('[data-slot="source-block"]')].map((block) => block.getAttribute('data-source'))
    expect(blocks()).toEqual(['matches', 'simulation'])
    expect(keys()).toEqual(['matches', 'simulation', 'interval'])
    rerender(<SourceLanes columns={[bots]} />)
    expect(blocks()).toEqual(['simulation'])
    expect(keys()).toEqual(['simulation', 'interval'])
    // The order is the columns', not one of its own.
    rerender(<SourceLanes columns={[bots, mine]} />)
    expect(keys()).toEqual(['simulation', 'matches', 'interval'])
  })

  it('the legend explains what the card draws: the «orientativo» of a row is on the card with its key, or neither is', () => {
    // As «Piezas de la interfaz» draws it: the columns, and no `lane` of its own.
    const { container, rerender } = render(<SourceLanes columns={DECK} />)
    const keys = () => [...container.querySelectorAll('[data-key]')].map((key) => key.getAttribute('data-key'))
    /** Every «orientativo» of the card that is not the legend's: the words of a block, the badge of a row. */
    const said = () =>
      [...container.querySelectorAll('[data-slot="source-block"]')]
        .map((block) => block.textContent ?? '')
        .join(' ')
        .match(/orientativo/g)?.length ?? 0
    const rows = () => container.querySelectorAll('[data-part="more"] li').length
    expect(keys()).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'interval'])
    // The headline of the tournament (in words) and its two rows (their badges).
    expect(rows()).toBe(2)
    expect(said()).toBe(3)

    // The headline of the tournament column with lists enough, and one of its rows without: the key stays, and so
    // does what it explains, the badge of that row, on the card.
    const [mine, tournament, bots] = DECK
    if (!mine || !tournament?.rate || !tournament.rows?.[1] || !bots) throw new Error('the fixtures’ deck is whole')
    const solid = { ...tournament.rate, samples: 40, orientative: false }
    const mixed = { ...tournament, rate: solid, rows: [{ ...tournament.rows[1] }] }
    rerender(<SourceLanes columns={[mine, mixed, bots]} />)
    expect(keys()).toEqual(['matches', 'tournament', 'simulation', 'orientative', 'interval'])
    expect(rows()).toBe(1)
    expect(said()).toBe(1)
    expect(container.querySelector('[data-part="more"] li')).toHaveTextContent(/orientativo$/)
    expect(container.querySelector('[data-key="orientative"]')).toHaveTextContent('orientativo: menos de 30 listas')

    // No row and a solid headline: nothing «orientativo» on the card, and no key for it.
    rerender(<SourceLanes columns={[mine, { ...mixed, rows: [] }, bots]} />)
    expect(keys()).toEqual(['matches', 'tournament', 'simulation', 'interval'])
    expect(rows()).toBe(0)
    expect(said()).toBe(0)
    rerender(<SourceLanes columns={DECK_EMPTY} />)
    expect(keys()).toEqual(['matches', 'tournament', 'simulation'])
  })
})

describe('SourceLane', () => {
  it('what the API says of a number is its note; of a source with no number, the reason of its dashed box', () => {
    const { container } = render(
      <>
        {DECK.map((column) => (
          <SourceLane key={column.source} column={column} />
        ))}
        {DECK_EMPTY.map((column) => (
          <SourceLane key={`none-${column.source}`} column={column} />
        ))}
      </>,
    )
    const blocks = [...container.querySelectorAll<HTMLElement>('[data-slot="source-block"]')]
    const written = (part: string) =>
      blocks.map((block) => block.querySelector(`[data-part="${part}"]`)?.textContent ?? null)
    expect(written('note')).toEqual([NOTES.mine, NOTES.tournament, NOTES.bots, NOTES.noMatches, null, null])
    expect(written('unavailable')).toEqual([null, null, null, null, NOTES.noTournaments, NOTES.noSimulation])
    expect(blocks.map((block) => block.hasAttribute('data-unavailable'))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ])
    // H-055: the warning is the bots', from the column of the simulation.
    expect(written('warning')).toEqual([null, null, NOTES.blindSpot, null, null, null])
  })

  it('draws the rows of a column inside its block, under «Torneo, en detalle», each name whole and each with its kind', () => {
    const [mine, tournament] = DECK
    if (!mine || !tournament) throw new Error('the deck of the fixtures has three columns')
    const { container } = render(<SourceLane column={tournament} />)
    const block = container.querySelector('[data-slot="source-block"]') as HTMLElement
    expect([...block.children].map((child) => child.getAttribute('data-part'))).toEqual([
      'head',
      'chart',
      'figures',
      'note',
      'more',
    ])
    const more = within(block.querySelector('[data-part="more"]') as HTMLElement)
    expect(more.getByRole('heading', { level: 3, name: 'Torneo, en detalle' })).toBeInTheDocument()
    expect(more.getAllByRole('listitem').map((row) => row.textContent?.replace(/\u00a0/g, ' '))).toEqual([
      `Lista exacta12,5 %1 V · 7 D · n = 8 en 2 listas · IC 2,2${DASH}47,1 %orientativo`,
      `Arquetipo: Butterfree Mega Sceptile ex35,7 %Sugerido por las listas más parecidas (2 cambios). · 25 V · 45 D · n = 70 en 14 listas · IC 25,5${DASH}47,4 %orientativo`,
    ])
    // A name is whole, on a second line when it takes one: the list does not cut it here.
    expect(more.getByText('Arquetipo: Butterfree Mega Sceptile ex')).toHaveClass('whitespace-normal', 'wrap-anywhere')
    for (const badge of more.getAllByText('orientativo')) {
      expect(badge).toHaveAttribute('title', 'Menos de 30 listas: orienta, no prueba')
    }
    // A column without rows, and with nothing added by the screen, has nothing more: no empty heading.
    cleanup()
    const plain = render(<SourceLane column={mine} />).container
    expect(plain.querySelector('[data-part="more"]')).toBeNull()
    expect(within(plain).queryByRole('heading')).toBeNull()
    cleanup()
    const none = render(<SourceLane column={{ ...tournament, rows: [] }} />).container
    expect(none.querySelector('[data-part="more"]')).toBeNull()
  })

  it('what the screen adds goes under the rows; with no row it still has its heading', () => {
    const [, tournament] = DECK
    if (!tournament) throw new Error('the deck of the fixtures has three columns')
    const { container } = render(
      <SourceLane column={{ ...tournament, rows: [] }}>
        <p>Elegí el arquetipo</p>
      </SourceLane>,
    )
    const detail = container.querySelector('[data-part="more"]')?.firstElementChild
    expect([...(detail?.children ?? [])].map((child) => child.tagName)).toEqual(['H3', 'P'])
    cleanup()
    const withRows = render(
      <SourceLane column={tournament}>
        <p>Elegí el arquetipo</p>
      </SourceLane>,
    ).container
    expect(
      [...(withRows.querySelector('[data-part="more"]')?.firstElementChild?.children ?? [])].map(
        (child) => child.tagName,
      ),
    ).toEqual(['H3', 'UL', 'P'])
  })
})
