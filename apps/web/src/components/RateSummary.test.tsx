import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { OrientativeBadge, RateDetails, RateHeadline, RateRows } from './RateSummary'

const rate = {
  source: 'tournament' as const,
  value: 56.4,
  games: 202,
  samples: 33,
  sampleKind: 'lists' as const,
  ci95: [49.5, 63.1] as [number, number],
  orientative: false,
}
const record = { wins: 114, losses: 85, ties: 3 }

describe('rate details on a phone (phone review: a line started with «·»)', () => {
  it('each piece but the last ends with its «·», and a plain space between pieces is where a line wraps', () => {
    const { container } = render(<RateDetails record={record} rate={rate} />)
    const pieces = [...container.querySelectorAll('span.whitespace-nowrap')].map((piece) => piece.textContent)
    expect(pieces.length).toBe(3)
    for (const piece of pieces.slice(0, -1)) expect(piece).toMatch(/ ·$/)
    expect(pieces.at(-1)).toMatch(/^IC\u00a0/)
    for (const piece of pieces) expect(piece).not.toMatch(/^ ?·/)
    // The text between two pieces is a plain (breakable) space.
    const outer = container.firstElementChild as HTMLElement
    const between = [...outer.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
    expect(between).toEqual([' ', ' '])
  })

  it('a hint keeps its «·» on its own line (no-break space before it)', () => {
    const { container } = render(
      <MemoryRouter>
        <RateRows rows={[{ id: 'a', label: 'Mega Lucario ex', hint: '33 listas', record, rate }]} />
      </MemoryRouter>,
    )
    expect(container.textContent).toContain('33 listas · 114 V')
  })
})

describe('«orientativo» says what it counted', () => {
  it('own matches without a kind, the lists of a tournament rate, the games of a simulation', () => {
    const { rerender } = render(<OrientativeBadge />)
    expect(screen.getByText('orientativo')).toHaveAttribute('title', 'Menos de 30 partidas: orienta, no prueba')
    rerender(<OrientativeBadge kind="matches" />)
    expect(screen.getByText('orientativo')).toHaveAttribute('title', 'Menos de 30 partidas: orienta, no prueba')
    // 70 games in 14 lists: the rate has more than 30 games and is still «orientativo».
    rerender(<OrientativeBadge kind="lists" />)
    expect(screen.getByText('orientativo')).toHaveAttribute('title', 'Menos de 30 listas: orienta, no prueba')
    rerender(<OrientativeBadge kind="simulations" />)
    expect(screen.getByText('orientativo')).toHaveAttribute(
      'title',
      'Menos de 30 partidas simuladas: orienta, no prueba',
    )
  })

  it('a row and a headline take the kind from their rate, never from the number of games', () => {
    const few = {
      ...rate,
      value: 35.7,
      games: 70,
      samples: 14,
      ci95: [25.5, 47.4] as [number, number],
      orientative: true,
    }
    const mine = { ...few, source: 'matches' as const, games: 8, samples: 8, sampleKind: 'matches' as const }
    // Each of the two with a rate of each kind: one that always said «listas», or always «partidas», fails here.
    render(
      <MemoryRouter>
        <RateRows
          rows={[
            { id: 'a', label: 'Arquetipo', record: { wins: 25, losses: 45, ties: 0 }, rate: few },
            { id: 'b', label: 'Gyarados ex', record: { wins: 3, losses: 5, ties: 0 }, rate: mine },
          ]}
        />
        <RateHeadline label="Mis partidas" record={{ wins: 3, losses: 5, ties: 0 }} rate={mine} />
        <RateHeadline label="Arquetipo" record={{ wins: 25, losses: 45, ties: 0 }} rate={few} />
      </MemoryRouter>,
    )
    expect(screen.getAllByText('orientativo').map((badge) => badge.getAttribute('title'))).toEqual([
      'Menos de 30 listas: orienta, no prueba',
      'Menos de 30 partidas: orienta, no prueba',
      'Menos de 30 partidas: orienta, no prueba',
      'Menos de 30 listas: orienta, no prueba',
    ])
  })

  it('a rate that is not «orientativo» has no badge, whatever it counted', () => {
    render(
      <MemoryRouter>
        <RateRows rows={[{ id: 'a', label: 'Mega Lucario ex', record, rate }]} />
        <RateHeadline label="Torneo" record={record} rate={rate} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('orientativo')).not.toBeInTheDocument()
  })
})
