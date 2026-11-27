// The numbers are invented (test/figures.ts).
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Figure } from '@/lib/figure'
import { BOTS, DASH, EXACT_LIST, EXPECTED, LOST_ONCE, MINE, NBSP, WON_TWICE } from '@/test/figures'
import { type BarReference, IntervalBar, referenceText } from './IntervalBar'
import { OrientativeMark } from './Marks'
import { SourceSeal } from './SourceSeal'

/** The piece as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)
/** The bar itself: the image inside the piece. */
function bar(piece: HTMLElement): HTMLElement {
  const found = piece.querySelector<HTMLElement>(':scope > [data-part="bar"]')
  if (!found) throw new Error('the piece has no bar')
  return found
}
const parts = (piece: HTMLElement) => [...bar(piece).children].map((child) => child.getAttribute('data-part'))
function part(piece: HTMLElement, name: string): HTMLElement {
  const found = bar(piece).querySelector<HTMLElement>(`:scope > [data-part="${name}"]`)
  if (!found) throw new Error(`the bar draws no ${name}`)
  return found
}
/** A label that rides over or under the bar, and the two boxes that place it. */
function rider(piece: HTMLElement, where: 'above' | 'below') {
  const row = piece.querySelector<HTMLElement>(`:scope > [data-part="${where}"]`)
  if (!row) throw new Error(`no label ${where}`)
  const [before, label, after] = [...row.children] as [HTMLElement, HTMLElement, HTMLElement]
  return { row, before, label, after, at: [Number(before.style.flexGrow), Number(after.style.flexGrow)] }
}

/** What the bar says when nobody gives it a name: the name of its image. */
const intervalBarText = (figure: Figure, reference?: BarReference | null) =>
  bar(root(<IntervalBar figure={figure} reference={reference} />)).getAttribute('aria-label')

const MINE_TEXT = `51,1${NBSP}%, IC${NBSP}37,2${DASH}64,7${NBSP}%`

describe('what an interval bar says', () => {
  it('the value and its interval: «51,1 %, IC 37,2–64,7 %»', () => {
    expect(intervalBarText(MINE)).toBe(MINE_TEXT)
    expect(intervalBarText(BOTS)).toBe(`50${NBSP}%, IC${NBSP}49,2${DASH}50,9${NBSP}%`)
    expect(intervalBarText(LOST_ONCE)).toBe(`0${NBSP}%, IC${NBSP}0,0${DASH}79,3${NBSP}%`)
  })

  it('a value without an interval is only the value', () => {
    expect(intervalBarText(EXPECTED)).toBe(`59,3${NBSP}%`)
  })

  it('the reference, which is drawn with no text of its own, is said with its name', () => {
    expect(referenceText({ value: 40.7, label: 'esperable' })).toBe(`esperable: 40,7${NBSP}%`)
    expect(referenceText({ value: 48.2 })).toBe(`referencia: 48,2${NBSP}%`)
    expect(intervalBarText(MINE, { value: 48.2, label: 'tu lista' })).toBe(`${MINE_TEXT}, tu lista: 48,2${NBSP}%`)
    expect(intervalBarText(EXPECTED, { value: 50 })).toBe(`59,3${NBSP}%, referencia: 50${NBSP}%`)
    expect(intervalBarText(MINE, null)).toBe(MINE_TEXT)
  })

  it('no space of it breaks a line inside a number', () => {
    for (const text of [intervalBarText(MINE, { value: 48.2, label: 'tu lista' }), intervalBarText(BOTS)]) {
      expect(text).not.toMatch(/\d %/)
      expect(text).not.toMatch(/IC /)
    }
  })
})

describe('IntervalBar', () => {
  it('is an image that says the value and its interval in words', () => {
    const piece = root(<IntervalBar figure={MINE} />)
    expect(piece).toHaveAttribute('data-slot', 'interval-bar')
    const image = screen.getByRole('img')
    expect(image).toBe(bar(piece))
    expect(image).toHaveAttribute('aria-label', MINE_TEXT)
    expect(image).not.toHaveAttribute('aria-hidden')
    // The piece around it is no image: what rides over and under the bar is text of the page.
    expect(piece).not.toHaveAttribute('role')
    expect(piece).not.toHaveAttribute('aria-label')
    expect(piece.textContent).toBe('')
  })

  it('a label is the name it says; without one, a reference is part of the name', () => {
    const named = root(<IntervalBar figure={MINE} label="Vos, en tus partidas: 51,1 %" />)
    expect(bar(named)).toHaveAttribute('aria-label', 'Vos, en tus partidas: 51,1 %')
    const compared = root(<IntervalBar figure={EXACT_LIST} reference={{ value: 40.7, label: 'esperable' }} />)
    expect(bar(compared)).toHaveAttribute(
      'aria-label',
      `12,5${NBSP}%, IC${NBSP}2,2${DASH}47,1${NBSP}%, esperable: 40,7${NBSP}%`,
    )
    expect(bar(root(<IntervalBar figure={EXPECTED} />))).toHaveAttribute('aria-label', `59,3${NBSP}%`)
  })

  it('draws the track, the tick at 50 %, the band and the point, each in its place', () => {
    const piece = root(<IntervalBar figure={MINE} />)
    expect(parts(piece)).toEqual(['track', 'tick', 'band', 'point'])
    expect(part(piece, 'tick').style.left).toBe('50%')
    expect(part(piece, 'band').style.left).toBe('37.2%')
    expect(part(piece, 'band').style.width).toBe('27.5%')
    expect(part(piece, 'point').style.left).toBe('51.06%')
    expect(part(piece, 'track').getAttribute('style')).toBeNull()
  })

  it('is 12 px tall and as wide as its box: a track of 2 px, a band of 6 px, a point of 10 px', () => {
    const piece = root(<IntervalBar figure={MINE} />)
    expect(classes(bar(piece))).toEqual(expect.arrayContaining(['relative', 'h-[12px]']))
    expect(classes(part(piece, 'track'))).toEqual(
      expect.arrayContaining(['absolute', 'inset-x-0', 'top-[5px]', 'h-[2px]', 'rounded-[2px]', 'bg-track']),
    )
    expect(classes(part(piece, 'tick'))).toEqual(
      expect.arrayContaining(['absolute', 'top-px', 'h-[10px]', 'w-px', 'bg-foreground-3']),
    )
    expect(classes(part(piece, 'band'))).toEqual(
      expect.arrayContaining(['absolute', 'top-[3px]', 'h-[6px]', 'rounded-[3px]', 'bg-band']),
    )
    // Centred on its value: 10 px wide, pulled 5 px back; with a ring of the surface under it.
    expect(classes(part(piece, 'point'))).toEqual(
      expect.arrayContaining([
        'absolute',
        'top-px',
        '-ml-[5px]',
        'size-[10px]',
        'rounded-full',
        'bg-foreground',
        'shadow-[0_0_0_2px_var(--chart-surface,var(--card))]',
      ]),
    )
    // Without labels the piece is the bar and nothing else.
    expect(piece.children).toHaveLength(1)
    expect(classes(piece)).toEqual(expect.arrayContaining(['flex', 'min-w-0', 'flex-col']))
  })

  it('without an interval it is only the point; the two ends of the scale are at the edges', () => {
    expect(parts(root(<IntervalBar figure={EXPECTED} />))).toEqual(['track', 'tick', 'point'])
    expect(part(root(<IntervalBar figure={LOST_ONCE} />), 'point').style.left).toBe('0%')
    const won = root(<IntervalBar figure={WON_TWICE} />)
    expect(part(won, 'point').style.left).toBe('100%')
    expect(part(won, 'band').style.left).toBe('34.2%')
    expect(part(won, 'band').style.width).toBe('65.8%')
  })

  it('a scale cut to a range has no tick unless one is asked for, and keeps everything inside the box', () => {
    const zoom = root(<IntervalBar figure={MINE} scale={[40, 70]} />)
    expect(parts(zoom)).toEqual(['track', 'band', 'point'])
    expect(part(zoom, 'band').style.left).toBe('0%')
    expect(part(zoom, 'band').style.width).toBe('82.33%')
    expect(part(zoom, 'point').style.left).toBe('36.88%')
    expect(part(root(<IntervalBar figure={MINE} scale={[40, 70]} tick={50} />), 'tick').style.left).toBe('33.33%')
    expect(parts(root(<IntervalBar figure={MINE} tick={null} />))).toEqual(['track', 'band', 'point'])
  })

  it('a reference is an amber mark at its value, taller than the bar, over the band and under the point', () => {
    const piece = root(<IntervalBar figure={EXACT_LIST} reference={{ value: 40.7, label: 'esperable' }} />)
    expect(parts(piece)).toEqual(['track', 'tick', 'band', 'reference', 'point'])
    const reference = part(piece, 'reference')
    expect(reference.style.left).toBe('40.7%')
    expect(classes(reference)).toEqual(
      expect.arrayContaining(['absolute', '-top-px', '-ml-px', 'h-[14px]', 'w-[2px]', 'rounded-[1px]', 'bg-warning']),
    )
    for (const name of ['track', 'tick', 'band', 'point']) expect(part(piece, name).className).not.toMatch(/warning/)
    // On a cut scale it moves with everything else.
    const zoom = root(<IntervalBar figure={MINE} scale={[40, 70]} reference={{ value: 48.2 }} />)
    expect(part(zoom, 'reference').style.left).toBe('27.33%')
    expect(parts(root(<IntervalBar figure={MINE} reference={null} />))).not.toContain('reference')
  })

  it('a tick and a reference at the left end are drawn there: zero is a place, not nothing', () => {
    const zoom = root(<IntervalBar figure={MINE} scale={[40, 70]} tick={40} reference={{ value: 35 }} />)
    expect(parts(zoom)).toEqual(['track', 'tick', 'band', 'reference', 'point'])
    expect(part(zoom, 'tick').style.left).toBe('0%')
    expect(part(zoom, 'reference').style.left).toBe('0%')
    const full = root(<IntervalBar figure={MINE} tick={0} reference={{ value: 0 }} />)
    expect(part(full, 'tick').style.left).toBe('0%')
    expect(part(full, 'reference').style.left).toBe('0%')
  })

  it('the label above rides with the point and the one below with the reference', () => {
    const piece = root(
      <IntervalBar
        figure={EXACT_LIST}
        reference={{ value: 40.7, label: 'esperable' }}
        above={
          <>
            <SourceSeal source="matches" /> vos <b>12,5{NBSP}%</b> <OrientativeMark />
          </>
        }
        below="esperable"
      />,
    )
    expect([...piece.children].map((child) => child.getAttribute('data-part'))).toEqual(['above', 'bar', 'below'])
    // The room the label leaves is shared in the proportion of the mark's place: 12,5 to 87,5 and 40,7 to 59,3.
    expect(rider(piece, 'above').at).toEqual([12.5, 87.5])
    expect(rider(piece, 'below').at).toEqual([40.7, 59.3])
    for (const where of ['above', 'below'] as const) {
      const { before, after, label } = rider(piece, where)
      // The two boxes that place it are empty, start from nothing and are not read.
      for (const box of [before, after]) {
        expect(box).toBeEmptyDOMElement()
        expect(box).toHaveAttribute('aria-hidden', 'true')
        expect(classes(box)).toContain('basis-0')
      }
      // The label can shrink to the bar and wrap inside it: it never pushes the page wider.
      expect(classes(label)).toEqual(expect.arrayContaining(['min-w-0', 'flex', 'flex-wrap', 'items-center']))
      expect(label.style.flexGrow).toBe('')
    }
  })

  it('without a reference the label below rides with the point too; at the ends it is against the edge', () => {
    const middle = root(<IntervalBar figure={MINE} above="vos" below="abajo" />)
    expect(rider(middle, 'above').at).toEqual([51.06, 48.94])
    expect(rider(middle, 'below').at).toEqual([51.06, 48.94])
    expect(rider(root(<IntervalBar figure={LOST_ONCE} above="vos" />), 'above').at).toEqual([0, 100])
    expect(rider(root(<IntervalBar figure={WON_TWICE} above="vos" />), 'above').at).toEqual([100, 0])
    // The room after the label is written to the hundredth, as the place of the mark: 100 − 99,99 is not 0,0100…05.
    expect(rider(root(<IntervalBar figure={{ ...MINE, value: 99.99 }} above="vos" />), 'above').at).toEqual([
      99.99, 0.01,
    ])
    // On a cut scale the labels follow the marks where they are drawn.
    const zoom = root(<IntervalBar figure={MINE} scale={[40, 70]} reference={{ value: 48.2 }} above="a" below="b" />)
    expect(rider(zoom, 'above').at).toEqual([36.88, 63.12])
    expect(rider(zoom, 'below').at).toEqual([27.33, 72.67])
  })

  it('what the labels write is text of the page, read as it is written: only the bar is the image', () => {
    const piece = root(
      <IntervalBar figure={EXACT_LIST} above={<SourceSeal source="matches" named />} below="esperable 40,7 %" />,
    )
    const below = screen.getByText('esperable 40,7 %')
    expect(bar(piece)).not.toContainElement(below)
    expect(below.closest('[aria-hidden="true"]')).toBeNull()
    // A named seal in a label keeps its name: nothing above it hides or renames it.
    expect(screen.getByRole('img', { name: 'Mis partidas' }).closest('[role="img"][data-part="bar"]')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(2)
    // A label is written at 14 px, in the second text colour, on a line of at least the seal's 18 px.
    expect(classes(rider(piece, 'below').row)).toEqual(
      expect.arrayContaining(['flex', 'min-h-[18px]', 'items-center', 'type-n', 'text-foreground-2']),
    )
  })

  it('a label that is nothing leaves no empty line', () => {
    const condition = false as boolean
    for (const nothing of [undefined, null, false, true, '', condition && 'vos']) {
      const piece = root(<IntervalBar figure={MINE} above={nothing} below={nothing} />)
      expect([...piece.children].map((child) => child.getAttribute('data-part'))).toEqual(['bar'])
    }
    // Zero is something to write.
    const zero = root(<IntervalBar figure={MINE} above={0} />)
    expect(rider(zero, 'above').label).toHaveTextContent(/^0$/)
  })

  it('where the system forces its colours each part is an edge as thick as what it fills: the point a disc', () => {
    const forced = (element: Element) => classes(element).filter((name) => name.startsWith('forced-colors:'))
    const piece = root(<IntervalBar figure={MINE} reference={{ value: 48.2 }} />)
    expect(parts(piece)).toEqual(['track', 'tick', 'band', 'reference', 'point'])
    expect(forced(part(piece, 'track'))).toEqual(['forced-colors:border-t-2'])
    expect(forced(part(piece, 'tick'))).toEqual(['forced-colors:border-l'])
    expect(forced(part(piece, 'band'))).toEqual(['forced-colors:border'])
    expect(forced(part(piece, 'reference'))).toEqual(['forced-colors:border-l-2'])
    // 5 px on each side of a 10 px box: the whole disc.
    expect(forced(part(piece, 'point'))).toEqual(['forced-colors:border-[5px]'])
  })

  it('takes the classes of where it is drawn', () => {
    expect(classes(root(<IntervalBar figure={MINE} className="mt-2" />))).toEqual(
      expect.arrayContaining(['mt-2', 'flex', 'flex-col']),
    )
  })
})
