import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { winRateSchema } from '@/api/schemas'
import { CoverageMark, MarkWords, NoData, OrientativeMark } from './Marks'

/** The mark as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}

describe('OrientativeMark', () => {
  it('has no text: its name says the word and what it counted', () => {
    const mark = root(<OrientativeMark kind="lists" />)
    expect(mark).toHaveAttribute('data-slot', 'orientative-mark')
    expect(mark).toBeEmptyDOMElement()
    expect(screen.getByRole('img', { name: 'orientativo: menos de 30 listas' })).toBe(mark)
    // The word stays findable by name, as the tests of the screens look for it.
    expect(screen.getByRole('img', { name: /orientativo/ })).toBe(mark)
    expect(screen.getByLabelText(/^orientativo/)).toBe(mark)
  })

  it.each([
    ['matches', 'orientativo: menos de 30 partidas'],
    ['lists', 'orientativo: menos de 30 listas'],
    ['simulations', 'orientativo: menos de 30 partidas simuladas'],
  ] as const)('a figure counted on %s says «%s»', (kind, name) => {
    expect(root(<OrientativeMark kind={kind} />)).toHaveAttribute('aria-label', name)
  })

  it('names every kind of sample a rate of the API can have, and own matches without one', () => {
    const names = winRateSchema.shape.sampleKind.options.map((kind) =>
      root(<OrientativeMark kind={kind} />).getAttribute('aria-label'),
    )
    expect(new Set(names).size).toBe(winRateSchema.shape.sampleKind.options.length)
    for (const name of names) expect(name).toMatch(/^orientativo: menos de 30 \S/)
    expect(root(<OrientativeMark />)).toHaveAttribute('aria-label', 'orientativo: menos de 30 partidas')
  })

  it('beside the words that say it, it is decoration: no name, no role, whatever kind it is given', () => {
    for (const kind of [undefined, 'matches', 'lists'] as const) {
      const mark = root(<OrientativeMark decorative kind={kind} />)
      expect(mark).toHaveAttribute('data-slot', 'orientative-mark')
      expect(mark).toHaveAttribute('aria-hidden', 'true')
      expect(mark).not.toHaveAttribute('aria-label')
      expect(mark).not.toHaveAttribute('role')
      expect(mark).not.toHaveAttribute('title')
    }
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // Drawn the same: only its name goes.
    expect(root(<OrientativeMark decorative />).className).toBe(root(<OrientativeMark />).className)
  })

  it('is a 9 px circle, half filled with the amber of a warning, and takes the classes of where it is drawn', () => {
    const mark = root(<OrientativeMark className="mr-[5px]" />)
    const classes = mark.className.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining([
        'inline-block',
        'size-[9px]',
        'shrink-0',
        'rounded-full',
        'border-[1.5px]',
        'border-warning',
        'bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)]',
        'mr-[5px]',
      ]),
    )
  })

  it('where the system forces its colours the fill is dropped: the left edge is then half the circle', () => {
    const classes = root(<OrientativeMark />).className.split(/\s+/)
    expect(classes.filter((name) => name.startsWith('forced-colors:'))).toEqual(['forced-colors:border-l-[4.5px]'])
  })
})

describe('CoverageMark', () => {
  it('says that the number against the meta has no matchup with data', () => {
    const mark = root(<CoverageMark />)
    expect(mark).toHaveAttribute('data-slot', 'coverage-mark')
    expect(mark).toBeEmptyDOMElement()
    expect(screen.getByRole('img', { name: 'sin cruces con datos en el meta' })).toBe(mark)
  })

  it('is a 10 × 9 px triangle drawn with its edges, in the amber of a warning', () => {
    const classes = root(<CoverageMark className="ml-1" />).className.split(/\s+/)
    expect(classes).toEqual(
      expect.arrayContaining([
        'inline-block',
        'size-0',
        'shrink-0',
        'border-x-[5px]',
        'border-b-[9px]',
        'border-x-transparent',
        'border-b-warning',
        'ml-1',
      ]),
    )
    // Cut to its shape: where the system forces its colours it paints the clear sides too, and the cut keeps the
    // triangle a triangle (the same one in every mode).
    expect(classes).toContain('[clip-path:polygon(50%_0,100%_100%,0_100%)]')
  })

  it('beside the words that say it, it is decoration: no name and no role', () => {
    const mark = root(<CoverageMark decorative />)
    expect(mark).toHaveAttribute('data-slot', 'coverage-mark')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark).not.toHaveAttribute('aria-label')
    expect(mark).not.toHaveAttribute('role')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(mark.className).toBe(root(<CoverageMark />).className)
  })

  it('is another mark than «orientativo»: a reader never takes one for the other', () => {
    render(
      <>
        <OrientativeMark />
        <CoverageMark />
      </>,
    )
    const [orientative, coverage] = screen.getAllByRole('img')
    expect(orientative).toHaveAttribute('data-slot', 'orientative-mark')
    expect(coverage).toHaveAttribute('data-slot', 'coverage-mark')
    expect(coverage?.getAttribute('aria-label')).not.toMatch(/orientativo/)
  })
})

describe('MarkWords', () => {
  it('writes the words whole, with their mark before them as decoration: only the words are read', () => {
    const words = root(<MarkWords mark="orientative" text="orientativo: menos de 30 listas" />)
    expect(words).toHaveAttribute('data-slot', 'mark-words')
    expect(words.textContent).toBe('orientativo: menos de 30 listas')
    const mark = words.querySelector('[data-slot="orientative-mark"]') as HTMLElement
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    // Nothing in it carries a name: what a reader hears is the text, and the text says lists.
    expect([words, ...words.querySelectorAll('*')].filter((element) => element.hasAttribute('aria-label'))).toEqual([])
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(words).not.toHaveAttribute('aria-hidden')
  })

  it('keeps the mark on the line of the first word, 5 px before it, and lets the rest wrap', () => {
    const words = root(
      <MarkWords mark="orientative" text="orientativo: menos de 30 partidas, o de 30 listas en torneos" />,
    )
    const first = words.firstElementChild as HTMLElement
    expect(first).toHaveClass('whitespace-nowrap')
    expect(first.textContent).toBe('orientativo:')
    expect(first.firstElementChild).toHaveAttribute('data-slot', 'orientative-mark')
    expect(first.firstElementChild).toHaveClass('mr-[5px]')
    // The words after the first are plain text of the piece, after a space where a line may break.
    expect(words.className).not.toMatch(/whitespace-nowrap/)
    expect([...words.childNodes].slice(1).map((node) => node.textContent)).toEqual([
      ' ',
      'menos de 30 partidas, o de 30 listas en torneos',
    ])
  })

  it('draws the ▲ for the words of a number with no matchup behind it, and no other mark', () => {
    const words = root(<MarkWords mark="coverage" text="sin cruces con datos en el meta" />)
    expect(words.textContent).toBe('sin cruces con datos en el meta')
    expect(words.querySelectorAll('[data-slot="coverage-mark"]')).toHaveLength(1)
    expect(words.querySelector('[data-slot="orientative-mark"]')).toBeNull()
    expect(words.querySelector('[data-slot="coverage-mark"]')).toHaveAttribute('aria-hidden', 'true')
    expect(words.firstElementChild).toHaveTextContent(/^sin$/)
    cleanup()
    expect(
      root(<MarkWords mark="orientative" text="orientativo" />).querySelector('[data-slot="coverage-mark"]'),
    ).toBeNull()
  })
})

describe('NoData', () => {
  it('says «sin datos» where a figure would be: no digit and no percentage', () => {
    const empty = root(<NoData />)
    expect(empty).toHaveAttribute('data-slot', 'no-data')
    expect(empty).toHaveTextContent(/^sin datos$/)
    expect(empty.textContent).not.toMatch(/\d|%/)
    // It is text, read as it is written: nothing hides it and nothing renames it.
    expect(empty).not.toHaveAttribute('aria-hidden')
    expect(empty).not.toHaveAttribute('aria-label')
    expect(empty).not.toHaveAttribute('role')
  })

  it('another text says why there is nothing', () => {
    expect(root(<NoData text="sin partidas" />)).toHaveTextContent(/^sin partidas$/)
    expect(screen.queryByText('sin datos')).not.toBeInTheDocument()
  })

  it('is written at 14 px in the third text colour, on one line, and where it is drawn can change its colour', () => {
    const plain = root(<NoData />).className.split(/\s+/)
    expect(plain).toEqual(expect.arrayContaining(['type-n', 'whitespace-nowrap', 'text-foreground-3']))
    const header = root(<NoData className="text-foreground-2" />).className.split(/\s+/)
    expect(header).toContain('text-foreground-2')
    expect(header).not.toContain('text-foreground-3')
    expect(header).toContain('type-n')
  })
})
