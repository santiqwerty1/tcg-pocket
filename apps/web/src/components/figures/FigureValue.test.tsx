// The numbers are invented (test/figures.ts).
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Figure } from '@/lib/figure'
import {
  ARCHETYPE,
  BOTS,
  COVERED,
  DASH,
  EXACT_LIST,
  EXPECTED,
  LOST_ONCE,
  MINE,
  NBSP,
  STALE,
  WON_TWICE,
} from '@/test/figures'
import { FigureValue } from './FigureValue'

const SIZES = ['cell', 'header', 'hero', 'score'] as const

/** The piece as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)
function part(piece: HTMLElement, name: 'value' | 'n'): HTMLElement {
  const found = piece.querySelector<HTMLElement>(`[data-part="${name}"]`)
  if (!found) throw new Error(`the figure writes no ${name}`)
  return found
}
/** What is written for who does not see the figure, or null when everything is in sight. */
const unwritten = (piece: HTMLElement) => piece.querySelector('.sr-only')?.textContent ?? null
/** What is drawn: the text of the piece without the words that are only said. */
function drawn(piece: HTMLElement): string {
  const copy = piece.cloneNode(true) as HTMLElement
  for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove()
  return copy.textContent ?? ''
}

describe('FigureValue', () => {
  it('writes the percentage with its n beside it: «51,1 % n 47»', () => {
    const piece = root(<FigureValue figure={MINE} size="cell" />)
    expect(piece).toHaveAttribute('data-slot', 'figure')
    expect(piece).toHaveAttribute('data-size', 'cell')
    expect(part(piece, 'value').textContent).toBe(`51,1${NBSP}%`)
    expect(part(piece, 'n').textContent).toBe(`n${NBSP}47`)
    expect(drawn(piece)).toBe(`51,1${NBSP}% n${NBSP}47`)
    // The percentage comes first, and nothing is drawn after the n: this figure has no mark.
    expect(part(piece, 'value').compareDocumentPosition(part(piece, 'n'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('there is no way to give it a percentage without its n', () => {
    // @ts-expect-error a figure is whole: a value alone is not one.
    const alone: Figure = { value: 50, ci95: null, orientative: false, sampleKind: 'matches' }
    expect(alone).not.toHaveProperty('n')
    // And the n is written with its thousands, through the one helper that writes the short form.
    expect(part(root(<FigureValue figure={BOTS} size="header" />), 'n').textContent).toBe(`n${NBSP}14.179`)
  })

  it('an «orientativo» figure carries its mark, which says what it counted', () => {
    const lists = root(<FigureValue figure={EXACT_LIST} size="cell" />)
    const mark = screen.getByRole('img', { name: 'orientativo: menos de 30 listas' })
    expect(lists).toContainElement(mark)
    expect(mark).toHaveAttribute('data-slot', 'orientative-mark')
    expect(drawn(lists)).toBe(`12,5${NBSP}% n${NBSP}8`)
    // 70 games, more than 30, and still «orientativo»: the flag is the API's, and it counted lists.
    expect(ARCHETYPE.n).toBeGreaterThanOrEqual(30)
    const archetype = root(<FigureValue figure={ARCHETYPE} size="cell" />)
    expect(archetype.querySelector('[data-slot="orientative-mark"]')).toHaveAttribute(
      'aria-label',
      'orientativo: menos de 30 listas',
    )
    const matches = root(<FigureValue figure={LOST_ONCE} size="cell" />)
    expect(matches.querySelector('[data-slot="orientative-mark"]')).toHaveAttribute(
      'aria-label',
      'orientativo: menos de 30 partidas',
    )
    // A figure that is not «orientativo» has no mark, however few games it has.
    expect(root(<FigureValue figure={MINE} size="cell" />).querySelector('[data-slot="orientative-mark"]')).toBeNull()
  })

  it('the interval always reaches a screen reader in words, though it is not drawn here', () => {
    const piece = root(<FigureValue figure={MINE} size="cell" />)
    expect(unwritten(piece)).toBe(`, IC${NBSP}37,2${DASH}64,7${NBSP}%`)
    expect(piece.textContent).toBe(`51,1${NBSP}% n${NBSP}47, IC${NBSP}37,2${DASH}64,7${NBSP}%`)
    expect(drawn(piece)).not.toMatch(/IC/)
    // The words are in the page for a reader, not hidden from it: only out of sight.
    const words = piece.querySelector('.sr-only')
    expect(words).not.toHaveAttribute('aria-hidden')
    expect(words?.closest('[aria-hidden="true"]')).toBeNull()
    for (const size of SIZES) {
      expect(unwritten(root(<FigureValue figure={EXACT_LIST} size={size} />)), size).toBe(
        `, IC${NBSP}2,2${DASH}47,1${NBSP}%`,
      )
    }
    // A value that comes without an interval has nothing more to say.
    const expected = root(<FigureValue figure={{ ...EXPECTED, coverage: null }} size="cell" />)
    expect(unwritten(expected)).toBeNull()
    expect(expected.textContent).toBe(`59,3${NBSP}% n${NBSP}41`)
  })

  it.each([
    ['cell', 'type-figure-17', ['type-n', 'text-foreground-3']],
    ['header', 'type-figure-15', ['type-n', 'text-foreground-2']],
    ['hero', 'type-figure-22', ['type-n', 'text-foreground-3']],
    ['score', 'type-figure-28', ['type-n', 'text-foreground-2']],
  ] as const)('%s: the percentage in %s and the n at 14 px', (size, figureType, sampleType) => {
    const piece = root(<FigureValue figure={MINE} size={size} />)
    expect(piece).toHaveAttribute('data-size', size)
    expect(classes(part(piece, 'value'))).toEqual(expect.arrayContaining([figureType, 'text-foreground']))
    expect(classes(part(piece, 'n'))).toEqual(expect.arrayContaining([...sampleType]))
    // One figure type each: the n never takes the weight of the percentage, nor the percentage the n's.
    expect(classes(part(piece, 'value')).filter((name) => name.startsWith('type-'))).toEqual([figureType])
    expect(classes(part(piece, 'n')).filter((name) => name.startsWith('type-'))).toEqual(['type-n'])
  })

  it('a deck’s header is one line of 18 px with everything on its middle; the others sit on the baseline', () => {
    const header = root(<FigureValue figure={MINE} size="header" />)
    expect(classes(header)).toContain('items-center')
    expect(classes(part(header, 'value'))).toContain('leading-[18px]')
    expect(classes(part(header, 'n'))).toContain('leading-[18px]')
    for (const size of ['cell', 'hero', 'score'] as const) {
      const piece = root(<FigureValue figure={MINE} size={size} />)
      expect(classes(piece), size).toContain('items-baseline')
      expect(
        classes(part(piece, 'value')).filter((name) => name.startsWith('leading-')),
        size,
      ).toEqual([])
    }
  })

  it('in a cell the n is on the line height of the percentage, so the cell is as tall as its percentage', () => {
    // D's cell: 17 px / 1.1 and 14 px / 1.1, 18.7 px tall. On the n's own 1.15 it would hang 0.4 px under it.
    const leading = (size: (typeof SIZES)[number], name: 'value' | 'n', lead?: 'n') =>
      classes(part(root(<FigureValue figure={MINE} size={size} lead={lead} />), name)).filter((item) =>
        item.startsWith('leading-'),
      )
    expect(leading('cell', 'n')).toEqual(['leading-[1.1]'])
    // Sorted by n it is the percentage that steps back, onto the same line height.
    expect(leading('cell', 'value', 'n')).toEqual(['leading-[1.1]'])
    expect(leading('cell', 'n', 'n')).toEqual([])
    for (const size of ['hero', 'score'] as const) expect(leading(size, 'n'), size).toEqual([])
  })

  it('in a cell every percentage has one decimal, so a column lines up; elsewhere, one at most', () => {
    expect(part(root(<FigureValue figure={BOTS} size="cell" />), 'value').textContent).toBe(`50,0${NBSP}%`)
    for (const size of ['header', 'hero', 'score'] as const) {
      expect(part(root(<FigureValue figure={BOTS} size={size} />), 'value').textContent, size).toBe(`50${NBSP}%`)
    }
    // Either can be asked for.
    expect(part(root(<FigureValue figure={BOTS} size="cell" decimals="auto" />), 'value').textContent).toBe(
      `50${NBSP}%`,
    )
    expect(part(root(<FigureValue figure={BOTS} size="hero" decimals="fixed" />), 'value').textContent).toBe(
      `50,0${NBSP}%`,
    )
    expect(part(root(<FigureValue figure={WON_TWICE} size="cell" />), 'value').textContent).toBe(`100,0${NBSP}%`)
    expect(part(root(<FigureValue figure={MINE} size="cell" decimals="auto" />), 'value').textContent).toBe(
      `51,1${NBSP}%`,
    )
  })

  it('a real zero with a game behind it is a figure: «0,0 % n 1»', () => {
    const piece = root(<FigureValue figure={LOST_ONCE} size="cell" />)
    expect(piece).not.toHaveAttribute('data-empty')
    expect(drawn(piece)).toBe(`0,0${NBSP}% n${NBSP}1`)
    expect(piece.textContent).not.toMatch(/sin datos/)
    expect(drawn(root(<FigureValue figure={LOST_ONCE} size="header" />))).toBe(`0${NBSP}% n${NBSP}1`)
  })

  it('null is «sin datos»: no percentage, no digit, nothing said that is not written', () => {
    for (const size of SIZES) {
      const piece = root(<FigureValue figure={null} size={size} />)
      expect(piece, size).toHaveAttribute('data-slot', 'figure')
      expect(piece, size).toHaveAttribute('data-empty')
      expect(piece.textContent, size).toBe('sin datos')
      expect(piece.textContent, size).not.toMatch(/%|\d/)
      expect(piece.querySelector('[data-part]'), size).toBeNull()
      expect(unwritten(piece), size).toBeNull()
      expect(piece.querySelector('[data-slot="no-data"]'), size).toHaveTextContent(/^sin datos$/)
    }
  })

  it('another text says why there is nothing, and each size writes «sin datos» as its place asks', () => {
    const today = root(<FigureValue figure={null} size="score" noData="sin partidas" />)
    expect(today.textContent).toBe('sin partidas')
    const empty = (size: (typeof SIZES)[number]) =>
      classes(root(<FigureValue figure={null} size={size} />).querySelector('[data-slot="no-data"]'))
    // On the tinted header of a deck, the second text colour; under a label of the day, 15 px.
    expect(empty('header')).toContain('text-foreground-2')
    expect(empty('header')).not.toContain('text-foreground-3')
    expect(empty('score')).toEqual(expect.arrayContaining(['text-[15px]', 'text-foreground-3']))
    expect(empty('cell')).toContain('text-foreground-3')
    expect(empty('cell').filter((name) => /^text-\[/.test(name))).toEqual([])
  })

  describe('sorted by n', () => {
    it('the n goes first and takes the weight; the percentage steps back, still in columns', () => {
      const piece = root(<FigureValue figure={BOTS} size="cell" lead="n" />)
      expect(drawn(piece)).toBe(`n${NBSP}14.179 50,0${NBSP}%`)
      expect(part(piece, 'n').compareDocumentPosition(part(piece, 'value'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(classes(part(piece, 'n'))).toEqual(expect.arrayContaining(['type-figure-17', 'text-foreground']))
      expect(classes(part(piece, 'value'))).toEqual(
        expect.arrayContaining(['type-n', 'text-foreground-3', 'tabular-nums']),
      )
      expect(classes(part(piece, 'value'))).not.toContain('type-figure-17')
      expect(classes(part(piece, 'n'))).not.toContain('type-n')
    })

    it('the marks stay after both, and the interval is still said', () => {
      const piece = root(<FigureValue figure={EXACT_LIST} size="cell" lead="n" />)
      expect(drawn(piece)).toBe(`n${NBSP}8 12,5${NBSP}%`)
      const mark = piece.querySelector('[data-slot="orientative-mark"]') as HTMLElement
      expect(part(piece, 'value').compareDocumentPosition(mark)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(unwritten(piece)).toBe(`, IC${NBSP}2,2${DASH}47,1${NBSP}%`)
    })
  })

  describe('the seal', () => {
    it('goes before the number, as decoration unless it is asked to say its source', () => {
      const piece = root(<FigureValue figure={EXACT_LIST} size="header" seal="tournament" />)
      const seal = piece.querySelector('[data-slot="source-seal"]') as HTMLElement
      expect(seal).toHaveTextContent('T')
      expect(seal).toHaveAttribute('aria-hidden', 'true')
      expect(seal.compareDocumentPosition(part(piece, 'value'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(drawn(piece)).toBe(`T 12,5${NBSP}% n${NBSP}8`)
      const named = root(<FigureValue figure={EXACT_LIST} size="header" seal="tournament" sealNamed />)
      expect(named).toContainElement(screen.getByRole('img', { name: 'Torneos' }))
      // No seal unless one is given: a column says its source once, in its head.
      expect(root(<FigureValue figure={MINE} size="cell" />).querySelector('[data-slot="source-seal"]')).toBeNull()
    })

    it('is 18 px, and in a cell 16 px with the filled M one step quieter', () => {
      const of = (size: (typeof SIZES)[number]) =>
        classes(
          root(<FigureValue figure={MINE} size={size} seal="matches" />).querySelector('[data-slot="source-seal"]'),
        )
      for (const size of ['header', 'hero', 'score'] as const) {
        expect(of(size), size).toEqual(expect.arrayContaining(['size-[18px]', 'bg-foreground']))
      }
      expect(of('cell')).toEqual(expect.arrayContaining(['size-[16px]', 'bg-foreground-2']))
      expect(of('cell')).not.toContain('bg-foreground')
    })

    it('stays with «sin datos»: the source is known, its number is not', () => {
      const piece = root(<FigureValue figure={null} size="header" seal="tournament" sealNamed />)
      expect(piece.textContent).toBe('T sin datos')
      expect(piece).toContainElement(screen.getByRole('img', { name: 'Torneos' }))
    })
  })

  describe('the marks', () => {
    it('a number against the meta with no matchup behind it carries ▲; with some, or none said, it does not', () => {
      const piece = root(<FigureValue figure={EXPECTED} size="cell" />)
      expect(piece).toContainElement(screen.getByRole('img', { name: 'sin cruces con datos en el meta' }))
      expect(root(<FigureValue figure={COVERED} size="cell" />).querySelector('[data-slot="coverage-mark"]')).toBeNull()
      expect(root(<FigureValue figure={MINE} size="cell" />).querySelector('[data-slot="coverage-mark"]')).toBeNull()
    })

    it('where a legend says «todo orientativo» once, the mark is not drawn and the word is still said', () => {
      const piece = root(<FigureValue figure={LOST_ONCE} size="cell" marks={false} />)
      expect(piece.querySelector('[data-slot="orientative-mark"]')).toBeNull()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(drawn(piece)).toBe(`0,0${NBSP}% n${NBSP}1`)
      expect(unwritten(piece)).toBe(`, IC${NBSP}0,0${DASH}79,3${NBSP}%, orientativo: menos de 30 partidas`)
      // Drawn, the mark says it itself: the words are not said twice.
      expect(unwritten(root(<FigureValue figure={LOST_ONCE} size="cell" />))).toBe(`, IC${NBSP}0,0${DASH}79,3${NBSP}%`)
      // What it counted is the figure's own: a tournament figure counted on lists says «listas».
      expect(unwritten(root(<FigureValue figure={EXACT_LIST} size="cell" marks={false} />))).toBe(
        `, IC${NBSP}2,2${DASH}47,1${NBSP}%, orientativo: menos de 30 listas`,
      )
      // It changes nothing in a figure that is not «orientativo».
      expect(unwritten(root(<FigureValue figure={MINE} size="cell" marks={false} />))).toBe(
        `, IC${NBSP}37,2${DASH}64,7${NBSP}%`,
      )
    })

    it('that does not take ▲ away: it is about this figure alone, and no legend says it for all', () => {
      const piece = root(<FigureValue figure={{ ...EXPECTED, orientative: true }} size="cell" marks={false} />)
      expect(piece.querySelector('[data-slot="orientative-mark"]')).toBeNull()
      expect(piece.querySelector('[data-slot="coverage-mark"]')).not.toBeNull()
      expect(unwritten(piece)).toBe(', orientativo: menos de 30 partidas')
    })

    it('a mark never ends up alone on a line: it is in one piece with what it follows', () => {
      const piece = root(<FigureValue figure={{ ...EXACT_LIST, coverage: 0 }} size="cell" seal="tournament" />)
      const [first, second] = [...piece.children] as [HTMLElement, HTMLElement]
      // Two groups that do not break inside; a narrow box wraps between them.
      expect(classes(piece)).toEqual(expect.arrayContaining(['inline-flex', 'flex-wrap']))
      for (const group of [first, second]) {
        expect(classes(group)).toEqual(expect.arrayContaining(['inline-flex', 'whitespace-nowrap']))
      }
      expect(first).toContainElement(piece.querySelector('[data-slot="source-seal"]') as HTMLElement)
      expect(first).toContainElement(part(piece, 'value'))
      expect(second).toContainElement(part(piece, 'n'))
      expect(second).toContainElement(piece.querySelector('[data-slot="orientative-mark"]') as HTMLElement)
      expect(second).toContainElement(piece.querySelector('[data-slot="coverage-mark"]') as HTMLElement)
      expect(
        [...second.children].map((child) => child.getAttribute('data-slot') ?? child.getAttribute('data-part')),
      ).toEqual(['n', 'orientative-mark', 'coverage-mark'])
    })
  })

  describe('a score of another era', () => {
    it('is drawn quiet, not bold, and its era is said', () => {
      const piece = root(<FigureValue figure={STALE} size="cell" />)
      expect(piece).toHaveAttribute('data-stale')
      const value = classes(part(piece, 'value'))
      expect(value).toEqual(expect.arrayContaining(['type-figure-17', 'font-medium', 'text-foreground-2']))
      expect(value).not.toContain('text-foreground')
      expect(drawn(piece)).toBe(`50,3${NBSP}% n${NBSP}3.600`)
      expect(unwritten(piece)).toBe(`, IC${NBSP}48,7${DASH}51,9${NBSP}%, de la era B4b`)
    })

    it('a score of this era is drawn as any figure', () => {
      const piece = root(<FigureValue figure={{ ...STALE, stale: null }} size="cell" />)
      expect(piece).not.toHaveAttribute('data-stale')
      expect(classes(part(piece, 'value'))).toContain('text-foreground')
      expect(classes(part(piece, 'value'))).not.toContain('font-medium')
      expect(unwritten(piece)).toBe(`, IC${NBSP}48,7${DASH}51,9${NBSP}%`)
    })

    it('sorted by n, it is the n that steps back', () => {
      const piece = root(<FigureValue figure={STALE} size="cell" lead="n" />)
      expect(classes(part(piece, 'n'))).toEqual(expect.arrayContaining(['font-medium', 'text-foreground-2']))
      expect(classes(part(piece, 'n'))).not.toContain('text-foreground')
    })
  })

  describe('a number of the day', () => {
    it('writes its «%» small, as a unit: at 28 px the whole would not fit its cell', () => {
      const piece = root(<FigureValue figure={MINE} size="score" />)
      const value = part(piece, 'value')
      expect(value.textContent).toBe(`51,1${NBSP}%`)
      const unit = value.querySelector('small')
      expect(unit?.textContent).toBe(`${NBSP}%`)
      expect(classes(unit)).toEqual(expect.arrayContaining(['text-[15px]', 'font-semibold', 'text-foreground-2']))
      expect(value.firstChild?.textContent).toBe('51,1')
    })

    it('no other size splits it, and sorted by n the percentage is already small', () => {
      for (const size of ['cell', 'header', 'hero'] as const) {
        expect(part(root(<FigureValue figure={MINE} size={size} />), 'value').querySelector('small'), size).toBeNull()
      }
      expect(part(root(<FigureValue figure={MINE} size="score" lead="n" />), 'value').querySelector('small')).toBeNull()
    })
  })

  it('takes the classes of where it is drawn', () => {
    expect(classes(root(<FigureValue figure={MINE} size="cell" className="justify-end" />))).toContain('justify-end')
    expect(classes(root(<FigureValue figure={null} size="cell" className="justify-end" />))).toContain('justify-end')
  })
})
