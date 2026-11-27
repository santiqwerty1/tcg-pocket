/**
 * The interval of a figure drawn large (mock-up D): the bar of a source block, of a deck's summary, of the result of
 * a test. Unlike the small chart of a cell it stands by itself, so it is an image with a name that says the value
 * and its interval in words.
 */
import type { ReactNode } from 'react'
import { type Figure, intervalText } from '@/lib/figure'
import { formatRateValue } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { intervalGeometry, type Scale } from './scale'

/** A value to compare the figure with, drawn as an amber mark: what is expected, the list a variant comes from. */
export interface BarReference {
  value: number
  /** What the mark is («esperable», «tu lista»). */
  label?: string
}

/** «esperable: 40,7 %»: a reference in words, for a name and for the text under a bar. */
export function referenceText(reference: BarReference): string {
  return `${reference.label ?? 'referencia'}: ${formatRateValue(reference.value)}`
}

/**
 * What the bar says when nobody gives it a name: «51,1 %, IC 37,2–64,7 %», and the reference when there is one. The
 * amber mark has no text of its own: this is where it is said.
 */
function intervalBarText(figure: Figure, reference?: BarReference | null): string {
  const parts = [formatRateValue(figure.value)]
  if (figure.ci95) parts.push(intervalText(figure.ci95))
  if (reference) parts.push(referenceText(reference))
  return parts.join(', ')
}

/**
 * The bar is 12 px tall and as wide as its box. Where the system forces its colours, each part is an edge of the
 * thickness it fills, as in the small charts. `above` and `below` are labels that ride with the marks: the one
 * above follows the point, the one below follows the reference (the point, without one). Each stays inside the box
 * and is as near its mark as its own width allows, so «vos» over the point and «esperable» under its mark are two
 * props. What they write is text of the page, read as it is written: only the bar itself is the image.
 *
 * The point has a ring of the surface it is drawn on: the card's, unless what holds the bar sets `--chart-surface`.
 */
export function IntervalBar({
  figure,
  scale,
  tick,
  reference = null,
  above,
  below,
  label,
  className,
}: {
  figure: Figure
  /** 0–100 unless given. */
  scale?: Scale
  /** 50 on the full scale and none on a cut one, unless given; null draws none. */
  tick?: number | null
  reference?: BarReference | null
  above?: ReactNode
  below?: ReactNode
  /** The name of the image; without it, the value, its interval and the reference. */
  label?: string
  className?: string
}) {
  const at = intervalGeometry(figure, { scale, tick, reference: reference?.value })
  return (
    <div data-slot="interval-bar" className={cn('flex min-w-0 flex-col gap-1', className)}>
      {shown(above) ? (
        <Rider part="above" at={at.point}>
          {above}
        </Rider>
      ) : null}
      <div
        data-part="bar"
        role="img"
        aria-label={label ?? intervalBarText(figure, reference)}
        className="relative h-[12px]"
      >
        <i
          data-part="track"
          className="absolute inset-x-0 top-[5px] h-[2px] rounded-[2px] bg-track forced-colors:border-t-2"
        />
        {at.tick !== null ? (
          <i
            data-part="tick"
            style={{ left: `${at.tick}%` }}
            className="absolute top-px h-[10px] w-px bg-foreground-3 forced-colors:border-l"
          />
        ) : null}
        {at.band ? (
          <i
            data-part="band"
            style={{ left: `${at.band.left}%`, width: `${at.band.width}%` }}
            className="absolute top-[3px] h-[6px] rounded-[3px] bg-band forced-colors:border"
          />
        ) : null}
        {at.reference !== null ? (
          <i
            data-part="reference"
            style={{ left: `${at.reference}%` }}
            className="absolute -top-px -ml-px h-[14px] w-[2px] rounded-[1px] bg-warning forced-colors:border-l-2"
          />
        ) : null}
        <i
          data-part="point"
          style={{ left: `${at.point}%` }}
          className="absolute top-px -ml-[5px] size-[10px] rounded-full bg-foreground shadow-[0_0_0_2px_var(--chart-surface,var(--card))] forced-colors:border-[5px]"
        />
      </div>
      {shown(below) ? (
        <Rider part="below" at={at.reference ?? at.point}>
          {below}
        </Rider>
      ) : null}
    </div>
  )
}

/** A label that was given: anything React writes (a condition, held or not, writes nothing by itself). */
const shown = (label: ReactNode) => label != null && typeof label !== 'boolean' && label !== ''

/**
 * A label that follows a mark of the bar. Two empty boxes share the room the label leaves, in the proportion of the
 * mark's place: at 0 the label is against the left end, at 100 against the right one, at 50 centred on the mark. No
 * width is measured or guessed, and a label longer than the bar wraps inside it. Its parts (a seal, a word, a number)
 * sit on one middle line, 4 px apart, as D's.
 */
function Rider({ part, at, children }: { part: 'above' | 'below'; at: number; children: ReactNode }) {
  return (
    <div data-part={part} className="flex min-h-[18px] items-center type-n text-foreground-2">
      <span aria-hidden="true" style={{ flexGrow: at }} className="basis-0" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-1">{children}</span>
      <span aria-hidden="true" style={{ flexGrow: Math.round((100 - at) * 100) / 100 }} className="basis-0" />
    </div>
  )
}
