/**
 * The small charts that go under or beside a figure (mock-up D): a point with its interval on a scale, a bar against
 * a maximum and the bar of a record. Each one is a few CSS boxes placed in percent of the width of its own box: no
 * library, no animation (what is drawn is the final state), and nothing a reader needs is only drawn here: the
 * numbers are written beside it.
 *
 * Where the system forces its own colours it drops every fill: each box then takes an edge as thick as what it fills
 * (`forced-colors:border-…`), which the system paints in its colour of text. No colour is written for it.
 */
import type { GameRecord } from '@/api/schemas'
import type { MaybeFigure } from '@/lib/figure'
import { formatNumber } from '@/lib/format'
import { RESULT_SHORT } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { inBox, intervalGeometry, type Scale } from './scale'

/**
 * A point and its interval, 12 px tall and as wide as its box: the chart of a cell. It is decoration: the percentage
 * and its n are written above it, and the interval is said in words by the figure it belongs to.
 *
 * The point has a ring of the surface it is drawn on, so it reads over the band: the card's, unless what holds the
 * chart sets `--chart-surface` to its own surface.
 */
export function IntervalMark({
  figure,
  scale,
  tick,
  reference = null,
  className,
}: {
  /** Null: the dashed empty track of «sin datos». */
  figure: MaybeFigure
  /** 0–100 unless given. A legend says a cut scale in words («Punto e intervalo sobre 40–70 %»). */
  scale?: Scale
  /** 50 on the full scale and none on a cut one, unless given; null draws none. */
  tick?: number | null
  /** An amber mark at a value to compare with (the list a variant comes from, the mean of the era). */
  reference?: number | null
  className?: string
}) {
  if (!figure) {
    return (
      <span data-slot="interval-mark" data-empty="" aria-hidden="true" className={cn(MARK_BOX, className)}>
        <i
          data-part="track"
          className="absolute inset-x-0 top-[5.5px] h-px bg-[repeating-linear-gradient(90deg,var(--track)_0_4px,transparent_4px_8px)] forced-colors:border-t forced-colors:border-dashed"
        />
      </span>
    )
  }
  const at = intervalGeometry(figure, { scale, tick, reference })
  return (
    <span data-slot="interval-mark" aria-hidden="true" className={cn(MARK_BOX, className)}>
      <i data-part="track" className="absolute inset-x-0 top-[5.5px] h-px bg-track forced-colors:border-t" />
      {at.tick !== null ? (
        <i
          data-part="tick"
          style={{ left: `${at.tick}%` }}
          className="absolute inset-y-px w-px bg-foreground-3 forced-colors:border-l"
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
          className="absolute inset-y-0 -ml-px w-[2px] rounded-[1px] bg-warning forced-colors:border-l-2"
        />
      ) : null}
      <i
        data-part="point"
        style={{ left: `${at.point}%` }}
        className="absolute top-[2px] -ml-[4px] size-[8px] rounded-full bg-foreground shadow-[0_0_0_2px_var(--chart-surface,var(--card))] forced-colors:border-4"
      />
    </span>
  )
}

const MARK_BOX = 'relative block h-[12px] min-w-[24px]'

/** A bar from zero to a maximum, 6 px tall: a share against the largest of its column. Decoration, as the interval. */
export function BarMark({ value, max, className }: { value: number; max: number; className?: string }) {
  // Without a maximum to compare with there is nothing to fill.
  const filled = max > 0 ? inBox((value / max) * 100) : 0
  return (
    <span
      data-slot="bar-mark"
      aria-hidden="true"
      className={cn('block h-[6px] overflow-hidden rounded-[3px] bg-track forced-colors:border', className)}
    >
      <i
        data-part="fill"
        style={{ width: `${filled}%` }}
        className="block h-full rounded-r-[3px] bg-foreground-2 forced-colors:border-y-2"
      />
    </span>
  )
}

/** One part of a bar that is split in parts: how much it weighs, how it is drawn and what it is («24 V»). */
export interface BarSegment {
  value: number
  /** `win`, `loss` and `draw` are the three results; `strong`, `soft` and `none` grade anything else without a hue. */
  tone: 'win' | 'loss' | 'draw' | 'strong' | 'soft' | 'none'
  /** What the segment is, with its number: shown when the pointer rests on it. */
  label: string
}

/**
 * A bar split in parts, each as wide as it weighs: the record of some matches (`recordSegments`), or any other
 * count in parts. A part that weighs nothing is not drawn. Its colours never say anything alone: next to a written
 * record the bar is decoration; where it stands alone it takes a `label`, and says it.
 */
export function RecordBar({
  segments,
  size = 6,
  label,
  className,
}: {
  segments: readonly BarSegment[]
  /** 6 px in the foot of a number, 12 px where it has a line of its own. */
  size?: 6 | 12
  /** What the bar says, whole («2 V · 7 D»). Without it the bar is decoration: its numbers are written beside it. */
  label?: string
  className?: string
}) {
  const drawn = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0)
  const total = drawn.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <span
      data-slot="record-bar"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={cn(
        'flex gap-[2px] overflow-hidden',
        BAR_SIZE[size],
        drawn.length === 0 && 'bg-track forced-colors:border',
        className,
      )}
    >
      {drawn.map((segment, at) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts go in order, and two may be the same
          key={at}
          data-tone={segment.tone}
          title={segment.label}
          // Its share of the whole, so the parts add up to a hundred whatever unit they were counted in.
          style={{ flexGrow: inBox((segment.value / total) * 100) }}
          className={cn(
            'block min-w-[3px] basis-0',
            TONE[segment.tone],
            FORCED[segment.tone === 'none' ? 'none' : size],
          )}
        />
      ))}
    </span>
  )
}

const BAR_SIZE = { 6: 'h-[6px] rounded-[3px]', 12: 'h-[12px] rounded-[6px]' } as const
/** A part where the system forces its colours: an edge that fills it, by the height of the bar; `none`, an outline. */
const FORCED = {
  6: 'forced-colors:border-y-[3px]',
  12: 'forced-colors:border-y-[6px]',
  none: 'forced-colors:border-[1.5px]',
} as const

/** Green, red and grey are the results' and nobody else's; the other three tones grade with the text colours. */
const TONE: Record<BarSegment['tone'], string> = {
  win: 'bg-success',
  loss: 'bg-destructive',
  draw: 'bg-draw',
  strong: 'bg-foreground',
  soft: 'bg-foreground-3',
  // An outline: what is not there. At an end of the bar it follows the bar's round corner.
  none: 'shadow-[inset_0_0_0_1.5px_var(--input)] first:rounded-l-[inherit] last:rounded-r-[inherit]',
}

/** A record as the three parts of its bar, in the order it is always written: victories, defeats, ties. */
export function recordSegments(record: GameRecord): BarSegment[] {
  return [
    { value: record.wins, tone: 'win', label: `${formatNumber(record.wins)} ${RESULT_SHORT.win}` },
    { value: record.losses, tone: 'loss', label: `${formatNumber(record.losses)} ${RESULT_SHORT.loss}` },
    { value: record.ties, tone: 'draw', label: `${formatNumber(record.ties)} ${RESULT_SHORT.tie}` },
  ]
}
