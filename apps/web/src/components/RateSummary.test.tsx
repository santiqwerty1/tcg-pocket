import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RateDetails, RateRows } from './RateSummary'

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
