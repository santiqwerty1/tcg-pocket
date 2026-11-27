// jsdom draws nothing, but a chart of these is boxes placed with `left` and `width` in percent: the places are in
// the markup, and that is what is read here. The numbers are invented (test/figures.ts).
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BOTS, EXPECTED, LOST_ONCE, MINE } from '@/test/figures'
import { BarMark, type BarSegment, IntervalMark, RecordBar, recordSegments } from './MiniCharts'

/** The chart as it is in the page: the root of what the component writes. */
function root(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  expect(container.children).toHaveLength(1)
  return container.firstElementChild as HTMLElement
}
const classes = (element: Element | null | undefined) => (element?.getAttribute('class') ?? '').split(/\s+/)
/** The parts a chart draws, in the order they are painted. */
const parts = (chart: HTMLElement) => [...chart.children].map((child) => child.getAttribute('data-part'))
function part(chart: HTMLElement, name: string): HTMLElement {
  const found = chart.querySelector<HTMLElement>(`:scope > [data-part="${name}"]`)
  if (!found) throw new Error(`the chart draws no ${name}`)
  return found
}
/** What a part takes where the system forces its own colours (and drops every fill): an edge, of no colour. */
const forced = (element: Element | null | undefined) =>
  classes(element).filter((name) => name.startsWith('forced-colors:'))
/** Where a part is placed, as it is written in its style. */
const place = (element: HTMLElement) => ({ left: element.style.left, width: element.style.width })

describe('IntervalMark', () => {
  it('draws the track, the tick at 50 %, the band of the interval and the point, each in its place', () => {
    const chart = root(<IntervalMark figure={MINE} />)
    expect(chart).toHaveAttribute('data-slot', 'interval-mark')
    expect(chart).not.toHaveAttribute('data-empty')
    expect(parts(chart)).toEqual(['track', 'tick', 'band', 'point'])
    expect(place(part(chart, 'tick'))).toEqual({ left: '50%', width: '' })
    expect(place(part(chart, 'band'))).toEqual({ left: '37.2%', width: '27.5%' })
    expect(place(part(chart, 'point'))).toEqual({ left: '51.06%', width: '' })
    // The track is the whole width: it has no place of its own.
    expect(part(chart, 'track').getAttribute('style')).toBeNull()
  })

  it('is decoration: it has no text and no name, and a screen reader does not find it', () => {
    const chart = root(<IntervalMark figure={MINE} reference={48.2} />)
    expect(chart).toHaveAttribute('aria-hidden', 'true')
    expect(chart).not.toHaveAttribute('role')
    expect(chart).not.toHaveAttribute('aria-label')
    expect(chart.textContent).toBe('')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('is 12 px tall and as wide as its box, with a track of 1 px, a band of 6 px and a point of 8 px', () => {
    const chart = root(<IntervalMark figure={MINE} />)
    expect(classes(chart)).toEqual(expect.arrayContaining(['relative', 'block', 'h-[12px]', 'min-w-[24px]']))
    expect(classes(chart).filter((name) => /^w-/.test(name))).toEqual([])
    expect(classes(part(chart, 'track'))).toEqual(
      expect.arrayContaining(['absolute', 'inset-x-0', 'top-[5.5px]', 'h-px', 'bg-track']),
    )
    expect(classes(part(chart, 'tick'))).toEqual(
      expect.arrayContaining(['absolute', 'inset-y-px', 'w-px', 'bg-foreground-3']),
    )
    expect(classes(part(chart, 'band'))).toEqual(
      expect.arrayContaining(['absolute', 'top-[3px]', 'h-[6px]', 'rounded-[3px]', 'bg-band']),
    )
    // The point is centred on its value: 8 px wide, pulled 4 px back.
    expect(classes(part(chart, 'point'))).toEqual(
      expect.arrayContaining(['absolute', 'top-[2px]', '-ml-[4px]', 'size-[8px]', 'rounded-full', 'bg-foreground']),
    )
  })

  it('the point has a ring of the surface under it: the card, or the one that holds the chart says', () => {
    const chart = root(<IntervalMark figure={MINE} />)
    expect(classes(part(chart, 'point'))).toContain('shadow-[0_0_0_2px_var(--chart-surface,var(--card))]')
  })

  it('null is the dashed empty track of «sin datos»: no tick, no band, no point', () => {
    const chart = root(<IntervalMark figure={null} />)
    expect(chart).toHaveAttribute('data-slot', 'interval-mark')
    expect(chart).toHaveAttribute('data-empty')
    expect(chart).toHaveAttribute('aria-hidden', 'true')
    expect(parts(chart)).toEqual(['track'])
    const track = classes(part(chart, 'track'))
    expect(track).toContain('bg-[repeating-linear-gradient(90deg,var(--track)_0_4px,transparent_4px_8px)]')
    // Dashed, and not also the solid line of a track with something on it.
    expect(track).not.toContain('bg-track')
    // The same box as a chart with data: a row keeps its height.
    expect(classes(chart)).toEqual(classes(root(<IntervalMark figure={MINE} />)))
  })

  it('null stays empty whatever else it is given', () => {
    const chart = root(<IntervalMark figure={null} scale={[40, 70]} tick={50} reference={48.2} />)
    expect(parts(chart)).toEqual(['track'])
  })

  it('a real 0 % is a point at the left end, never the empty track', () => {
    const chart = root(<IntervalMark figure={LOST_ONCE} />)
    expect(chart).not.toHaveAttribute('data-empty')
    expect(parts(chart)).toEqual(['track', 'tick', 'band', 'point'])
    expect(place(part(chart, 'point')).left).toBe('0%')
    expect(place(part(chart, 'band'))).toEqual({ left: '0%', width: '79.3%' })
    expect(classes(part(chart, 'track'))).toContain('bg-track')
  })

  it('a figure without an interval is only its point (and the tick)', () => {
    const chart = root(<IntervalMark figure={EXPECTED} />)
    expect(parts(chart)).toEqual(['track', 'tick', 'point'])
    expect(place(part(chart, 'point')).left).toBe('59.3%')
  })

  it('a scale cut to a range: no tick, and the band and the point on that scale, kept inside the box', () => {
    const chart = root(<IntervalMark figure={MINE} scale={[40, 70]} />)
    expect(parts(chart)).toEqual(['track', 'band', 'point'])
    expect(place(part(chart, 'band'))).toEqual({ left: '0%', width: '82.33%' })
    expect(place(part(chart, 'point')).left).toBe('36.88%')
    // The bots' interval, 49,2–50,9 around 50,04, is a sliver on 0–100 and a readable band on 45–55.
    const bots = root(<IntervalMark figure={BOTS} scale={[45, 55]} />)
    expect(place(part(bots, 'band'))).toEqual({ left: '42%', width: '17%' })
    expect(place(part(bots, 'point')).left).toBe('50.39%')
  })

  it('a tick that is asked for is drawn on a cut scale too; null takes it away from the full one', () => {
    expect(place(part(root(<IntervalMark figure={MINE} scale={[40, 70]} tick={50} />), 'tick')).left).toBe('33.33%')
    expect(parts(root(<IntervalMark figure={MINE} tick={null} />))).toEqual(['track', 'band', 'point'])
    expect(parts(root(<IntervalMark figure={MINE} scale={[60, 90]} tick={50} />))).toEqual(['track', 'band', 'point'])
  })

  it('a reference is an amber mark at its value, over the band and under the point', () => {
    const chart = root(<IntervalMark figure={MINE} scale={[40, 70]} reference={48.2} />)
    expect(parts(chart)).toEqual(['track', 'band', 'reference', 'point'])
    const reference = part(chart, 'reference')
    expect(place(reference)).toEqual({ left: '27.33%', width: '' })
    // 2 px wide and as tall as the chart: taller than the band, so it shows above and below it.
    expect(classes(reference)).toEqual(
      expect.arrayContaining(['absolute', 'inset-y-0', '-ml-px', 'w-[2px]', 'rounded-[1px]', 'bg-warning']),
    )
    // Amber is the reference's alone: no other part of the chart takes it.
    for (const name of ['track', 'band', 'point']) expect(part(chart, name).className).not.toMatch(/warning/)
    expect(parts(root(<IntervalMark figure={MINE} reference={null} />))).not.toContain('reference')
    expect(parts(root(<IntervalMark figure={MINE} />))).not.toContain('reference')
  })

  it('a tick and a reference at the left end are drawn there: zero is a place, not nothing', () => {
    // 40 is the start of 40–70, and 35 is before it: both at 0 % of the width.
    const chart = root(<IntervalMark figure={MINE} scale={[40, 70]} tick={40} reference={35} />)
    expect(parts(chart)).toEqual(['track', 'tick', 'band', 'reference', 'point'])
    expect(place(part(chart, 'tick')).left).toBe('0%')
    expect(place(part(chart, 'reference')).left).toBe('0%')
    // On the full scale, a reference at 0 % and a tick at 0.
    const full = root(<IntervalMark figure={MINE} tick={0} reference={0} />)
    expect(place(part(full, 'tick')).left).toBe('0%')
    expect(place(part(full, 'reference')).left).toBe('0%')
  })

  it('where the system forces its colours each part is an edge as thick as what it fills: the point a disc', () => {
    const chart = root(<IntervalMark figure={MINE} reference={48.2} />)
    expect(parts(chart)).toEqual(['track', 'tick', 'band', 'reference', 'point'])
    expect(forced(part(chart, 'track'))).toEqual(['forced-colors:border-t'])
    expect(forced(part(chart, 'tick'))).toEqual(['forced-colors:border-l'])
    // The band is outlined: the point and the tick read inside it.
    expect(forced(part(chart, 'band'))).toEqual(['forced-colors:border'])
    expect(forced(part(chart, 'reference'))).toEqual(['forced-colors:border-l-2'])
    // 4 px on each side of an 8 px box: the whole disc.
    expect(forced(part(chart, 'point'))).toEqual(['forced-colors:border-4'])
    // The empty track of «sin datos» keeps its dashes.
    const empty = root(<IntervalMark figure={null} />)
    expect(forced(part(empty, 'track'))).toEqual(['forced-colors:border-t', 'forced-colors:border-dashed'])
  })

  it('takes the classes of where it is drawn', () => {
    const chart = root(<IntervalMark figure={MINE} className="mt-1 flex-1" />)
    expect(classes(chart)).toEqual(expect.arrayContaining(['mt-1', 'flex-1', 'h-[12px]']))
  })
})

describe('BarMark', () => {
  const fill = (chart: HTMLElement) => part(chart, 'fill').style.width

  it('fills the share of the value in the maximum', () => {
    const chart = root(<BarMark value={14.3} max={22.8} />)
    expect(chart).toHaveAttribute('data-slot', 'bar-mark')
    expect(parts(chart)).toEqual(['fill'])
    expect(fill(chart)).toBe('62.72%')
    expect(fill(root(<BarMark value={22.8} max={22.8} />))).toBe('100%')
    expect(fill(root(<BarMark value={1} max={4} />))).toBe('25%')
    expect(fill(root(<BarMark value={0} max={22.8} />))).toBe('0%')
  })

  it('never leaves its box, and with nothing to compare with it is empty', () => {
    expect(fill(root(<BarMark value={30} max={22.8} />))).toBe('100%')
    expect(fill(root(<BarMark value={-3} max={22.8} />))).toBe('0%')
    expect(fill(root(<BarMark value={5} max={0} />))).toBe('0%')
    expect(fill(root(<BarMark value={5} max={-2} />))).toBe('0%')
    expect(fill(root(<BarMark value={5} max={Number.NaN} />))).toBe('0%')
    expect(fill(root(<BarMark value={Number.NaN} max={10} />))).toBe('0%')
  })

  it('is decoration, 6 px tall: a track with a fill in the second text colour', () => {
    const chart = root(<BarMark value={3} max={4} className="mt-1" />)
    expect(chart).toHaveAttribute('aria-hidden', 'true')
    expect(chart.textContent).toBe('')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(classes(chart)).toEqual(
      expect.arrayContaining(['block', 'h-[6px]', 'overflow-hidden', 'rounded-[3px]', 'bg-track', 'mt-1']),
    )
    expect(classes(part(chart, 'fill'))).toEqual(
      expect.arrayContaining(['block', 'h-full', 'rounded-r-[3px]', 'bg-foreground-2']),
    )
  })
})

describe('recordSegments', () => {
  it('a record is three parts in the order it is always written, each with its number and its letter', () => {
    expect(recordSegments({ wins: 24, losses: 22, ties: 1 })).toEqual([
      { value: 24, tone: 'win', label: '24 V' },
      { value: 22, tone: 'loss', label: '22 D' },
      { value: 1, tone: 'draw', label: '1 E' },
    ])
  })

  it('writes the thousands as every number of the app, and keeps the parts that weigh nothing', () => {
    expect(recordSegments({ wins: 7095, losses: 7004, ties: 80 }).map((segment) => segment.label)).toEqual([
      '7.095 V',
      '7.004 D',
      '80 E',
    ])
    expect(recordSegments({ wins: 0, losses: 3, ties: 0 })).toEqual([
      { value: 0, tone: 'win', label: '0 V' },
      { value: 3, tone: 'loss', label: '3 D' },
      { value: 0, tone: 'draw', label: '0 E' },
    ])
  })
})

describe('RecordBar', () => {
  const segments = (chart: HTMLElement) => [...chart.children] as HTMLElement[]
  const weights = (chart: HTMLElement) => segments(chart).map((segment) => Number(segment.style.flexGrow))

  it('each part is as wide as it weighs: its share of the whole', () => {
    const chart = root(<RecordBar segments={recordSegments({ wins: 24, losses: 22, ties: 1 })} />)
    expect(chart).toHaveAttribute('data-slot', 'record-bar')
    expect(segments(chart).map((segment) => segment.getAttribute('data-tone'))).toEqual(['win', 'loss', 'draw'])
    // 24, 22 and 1 of 47.
    expect(weights(chart)).toEqual([51.06, 46.81, 2.13])
    expect(weights(chart).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(100, 1)
    // The weight is all that sizes a part: no width of its own, and it starts from nothing.
    for (const segment of segments(chart)) {
      expect(segment.style.width).toBe('')
      expect(classes(segment)).toEqual(expect.arrayContaining(['block', 'basis-0', 'min-w-[3px]']))
    }
  })

  it('the parts add up to a hundred whatever they were counted in', () => {
    const shares: BarSegment[] = [
      { value: 0.2, tone: 'strong', label: 'con 2 copias' },
      { value: 0.3, tone: 'soft', label: 'con 1 copia' },
    ]
    expect(weights(root(<RecordBar segments={shares} />))).toEqual([40, 60])
    const games = recordSegments({ wins: 7095, losses: 7004, ties: 80 })
    expect(weights(root(<RecordBar segments={games} />))).toEqual([50.04, 49.4, 0.56])
  })

  it('a part that weighs nothing is not drawn, and neither is one that is not a count', () => {
    const chart = root(<RecordBar segments={recordSegments({ wins: 2, losses: 7, ties: 0 })} />)
    expect(segments(chart).map((segment) => segment.getAttribute('data-tone'))).toEqual(['win', 'loss'])
    expect(weights(chart)).toEqual([22.22, 77.78])
    const odd: BarSegment[] = [
      { value: 3, tone: 'win', label: '3 V' },
      { value: -2, tone: 'loss', label: '-2 D' },
      { value: Number.NaN, tone: 'draw', label: '? E' },
      { value: Number.POSITIVE_INFINITY, tone: 'soft', label: 'sin fin' },
    ]
    const drawn = root(<RecordBar segments={odd} />)
    expect(segments(drawn).map((segment) => segment.getAttribute('data-tone'))).toEqual(['win'])
    expect(weights(drawn)).toEqual([100])
  })

  it('two parts of the same tone under the same label are two parts, and React is given no key twice', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const twice: BarSegment[] = [
        { value: 3, tone: 'soft', label: 'x' },
        { value: 1, tone: 'soft', label: 'x' },
        { value: 0, tone: 'soft', label: 'x' },
      ]
      const chart = root(<RecordBar segments={twice} />)
      expect(weights(chart)).toEqual([75, 25])
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })

  it('with no part at all it is an empty track, the same box', () => {
    const empty = root(<RecordBar segments={recordSegments({ wins: 0, losses: 0, ties: 0 })} />)
    expect(empty).toHaveAttribute('data-slot', 'record-bar')
    expect(segments(empty)).toEqual([])
    expect(classes(empty)).toEqual(expect.arrayContaining(['bg-track', 'h-[6px]']))
    expect(classes(root(<RecordBar segments={[]} />))).toContain('bg-track')
    // With something to draw the bar has no fill of its own: the gaps between the parts show the surface.
    expect(classes(root(<RecordBar segments={recordSegments({ wins: 1, losses: 0, ties: 0 })} />))).not.toContain(
      'bg-track',
    )
  })

  it('next to a written record it is decoration; alone it takes a label, and says it', () => {
    const decoration = root(<RecordBar segments={recordSegments({ wins: 2, losses: 7, ties: 0 })} />)
    expect(decoration).toHaveAttribute('aria-hidden', 'true')
    expect(decoration).not.toHaveAttribute('role')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const named = root(<RecordBar segments={recordSegments({ wins: 2, losses: 7, ties: 0 })} label="Hoy: 2 V · 7 D" />)
    expect(screen.getByRole('img', { name: 'Hoy: 2 V · 7 D' })).toBe(named)
    expect(named).not.toHaveAttribute('aria-hidden')
    // An empty bar with a label still says it: «no matches» is something to say.
    const none = root(<RecordBar segments={[]} label="Hoy: sin partidas" />)
    expect(none).toHaveAttribute('role', 'img')
    expect(none).toHaveAttribute('aria-label', 'Hoy: sin partidas')
  })

  it('each part says what it is when the pointer rests on it', () => {
    const chart = root(<RecordBar segments={recordSegments({ wins: 24, losses: 22, ties: 1 })} />)
    expect(segments(chart).map((segment) => segment.title)).toEqual(['24 V', '22 D', '1 E'])
    expect(chart.textContent).toBe('')
  })

  it('the three results have their colours, and the other tones grade without a hue', () => {
    const all: BarSegment[] = [
      { value: 1, tone: 'win', label: 'a' },
      { value: 1, tone: 'loss', label: 'b' },
      { value: 1, tone: 'draw', label: 'c' },
      { value: 1, tone: 'strong', label: 'd' },
      { value: 1, tone: 'soft', label: 'e' },
      { value: 1, tone: 'none', label: 'f' },
    ]
    const [win, loss, draw, strong, soft, none] = segments(root(<RecordBar segments={all} />)).map(classes) as [
      string[],
      string[],
      string[],
      string[],
      string[],
      string[],
    ]
    expect(win).toContain('bg-success')
    expect(loss).toContain('bg-destructive')
    expect(draw).toContain('bg-draw')
    expect(strong).toContain('bg-foreground')
    expect(soft).toContain('bg-foreground-3')
    // What is not there is an outline with no fill; at an end of the bar it follows the bar's round corner.
    expect(none).toEqual(
      expect.arrayContaining([
        'shadow-[inset_0_0_0_1.5px_var(--input)]',
        'first:rounded-l-[inherit]',
        'last:rounded-r-[inherit]',
      ]),
    )
    expect(none.filter((name) => name.startsWith('bg-'))).toEqual([])
    for (const tone of [strong, soft, none]) {
      expect(tone.join(' ')).not.toMatch(/success|destructive|draw|warning/)
    }
    // One fill each: a part is never two tones.
    for (const tone of [win, loss, draw, strong, soft]) {
      expect(tone.filter((name) => name.startsWith('bg-'))).toHaveLength(1)
    }
  })

  it('where the system forces its colours each part is an edge that fills it, and the track an outline', () => {
    const segments = [
      ...recordSegments({ wins: 3, losses: 2, ties: 1 }),
      { value: 1, tone: 'none', label: '1 sin' },
    ] as const
    for (const [size, fill] of [
      [6, 'forced-colors:border-y-[3px]'],
      [12, 'forced-colors:border-y-[6px]'],
    ] as const) {
      const chart = root(<RecordBar segments={segments} size={size} />)
      const drawn = [...chart.children]
      expect(drawn.map((segment) => forced(segment))).toEqual([
        [fill],
        [fill],
        [fill],
        ['forced-colors:border-[1.5px]'],
      ])
      expect(forced(chart)).toEqual([])
    }
    // With nothing to draw, the track has an edge: the box is still seen.
    expect(forced(root(<RecordBar segments={[]} />))).toEqual(['forced-colors:border'])
    // The bar against a maximum: an outlined track and a fill as tall as what is inside it.
    const bar = root(<BarMark value={2} max={4} />)
    expect(forced(bar)).toEqual(['forced-colors:border'])
    expect(forced(part(bar, 'fill'))).toEqual(['forced-colors:border-y-2'])
  })

  it('6 px in the foot of a number and 12 px on a line of its own, round at both ends, with 2 px between parts', () => {
    const small = classes(root(<RecordBar segments={recordSegments({ wins: 1, losses: 1, ties: 1 })} />))
    const large = classes(root(<RecordBar size={12} segments={recordSegments({ wins: 1, losses: 1, ties: 1 })} />))
    expect(small).toEqual(expect.arrayContaining(['flex', 'gap-[2px]', 'overflow-hidden', 'h-[6px]', 'rounded-[3px]']))
    expect(large).toEqual(expect.arrayContaining(['flex', 'gap-[2px]', 'overflow-hidden', 'h-[12px]', 'rounded-[6px]']))
    expect(small).not.toContain('h-[12px]')
    expect(large).not.toContain('h-[6px]')
    expect(classes(root(<RecordBar segments={[]} className="flex-1" />))).toContain('flex-1')
  })
})
