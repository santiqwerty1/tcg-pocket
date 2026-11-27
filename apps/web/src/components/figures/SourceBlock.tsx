/**
 * One source in full (mock-up D): its seal and its name, the percentage, its n, the interval drawn and written, the
 * record and, in words, «orientativo» with what it counted. It is what the detail of a row and a sheet are made of
 * (`row`), and a block of a page where everything is in sight (`lane`: the three sources of a deck). A block is one
 * source: two sources are two blocks, never one number.
 */
import { Fragment, type ReactNode } from 'react'
import {
  type Figure,
  figureSample,
  intervalText,
  type MaybeFigure,
  orientativeText,
  SOURCE_NAME,
  type SourceKey,
} from '@/lib/figure'
import { formatNumber } from '@/lib/format'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { type BarReference, IntervalBar, referenceText } from './IntervalBar'
import { MarkWords, NoData } from './Marks'
import { SourceSeal } from './SourceSeal'
import { chartScale, type Scale } from './scale'

export function SourceBlock({
  source,
  name,
  figure,
  size = 'row',
  scale,
  reference = null,
  note,
  warning,
  unavailable,
  children,
  className,
}: {
  source: SourceKey
  /** What the number is, as the screen calls it: «En torneos», «Vos contra él», «Laboratorio: bots g2». */
  name: string
  /** Null: «sin datos», and no chart. */
  figure: MaybeFigure
  /** `row`: inside a detail or a sheet, the value at 16 px. `lane`: a block of a page, the value at 28 px. */
  size?: 'row' | 'lane'
  /** The scale of the bar, 0–100 unless given. A lane writes its two ends. */
  scale?: Scale
  /** A value to compare with: an amber mark on the bar, and its name and value in words under it. */
  reference?: BarReference | null
  /** What the source says of its own number: the list or the era it comes from, the bots that played. */
  note?: ReactNode
  /** Something to be careful with in this number («posible punto ciego del bot»): right under the figures. */
  warning?: ReactNode
  /**
   * The source cannot give a number, and why. The block takes a dashed edge and a padding of its own: the padding of
   * a lane or of a card goes on what holds the block, not on its `className`, which would replace this one.
   */
  unavailable?: string
  /** More of the same source, under everything else: the rows of a tournament column. */
  children?: ReactNode
  className?: string
}) {
  const lane = size === 'lane'
  const [from, to] = chartScale(scale)
  return (
    <div
      data-slot="source-block"
      data-source={source}
      data-size={size}
      {...(unavailable !== undefined ? { 'data-unavailable': '' } : {})}
      className={cn(
        // One column that never grows past the block: what is given to it that does not wrap (a row of a list that
        // cuts its name, a line of figures) stays inside, and cannot push the percentage out of sight.
        'grid min-w-0 grid-cols-[minmax(0,1fr)]',
        lane ? 'gap-[6px]' : 'gap-1',
        unavailable !== undefined && 'rounded-[10px] border border-dashed border-input px-[10px] py-2',
        className,
      )}
    >
      <div
        data-part="head"
        className={cn(
          'flex justify-between',
          // A row writes its n beside the percentage, and a tournament one may be long («n = 12.406 en 1.203
          // listas»): when the two do not fit on a line with the name, the number goes under it, at the right, and
          // the name keeps its line whole instead of being squeezed into what is left.
          lane ? 'items-end gap-[10px]' : 'flex-wrap items-baseline gap-x-2 gap-y-0.5',
        )}
      >
        <span
          className={cn(
            'flex min-w-0 font-heading tracking-[0.02em] text-foreground-2',
            // The line height goes after the size: written before it, `cn` takes it for the size's own and drops it.
            lane
              ? 'items-start gap-[7px] text-[15px] leading-[1.2] font-bold'
              : 'items-center gap-[6px] text-[14px] leading-[1.2] font-semibold',
          )}
        >
          {/* The seal is silent only beside the very name of its source: any other name does not say whose it is. */}
          <SourceSeal source={source} named={name !== SOURCE_NAME[source]} />
          <span className="min-w-0 wrap-anywhere">{name}</span>
        </span>
        {figure ? (
          <span
            data-part="value"
            className={cn(
              // Not the type of a column of figures: a block stands alone, and its digits keep their own widths. At
              // the right also when it is alone on its line, under a name.
              'ml-auto shrink-0 font-heading font-bold whitespace-nowrap',
              lane ? 'text-[28px] leading-[0.95]' : 'text-[16px] leading-[1.1]',
              // A score of another era: quiet, and not bold.
              figure.stale ? 'font-medium text-foreground-2' : 'text-foreground',
            )}
          >
            {formatRateValue(figure.value)}
            {lane ? null : (
              <>
                {' '}
                <span className="type-n text-foreground-3">{figureSample(figure)}</span>
              </>
            )}
          </span>
        ) : (
          <NoData className="ml-auto shrink-0" />
        )}
      </div>

      {figure ? (
        <>
          {/* Drawn for the eye only: everything the bar shows is written under it, in words. */}
          <div
            data-part="chart"
            aria-hidden="true"
            className={cn(
              lane &&
                'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[9px] type-n leading-none text-foreground-3',
            )}
          >
            {lane ? <span>{formatNumber(from)}</span> : null}
            <IntervalBar figure={figure} scale={scale} reference={reference} />
            {lane ? <span>{formatNumber(to)}</span> : null}
          </div>
          <div
            data-part="figures"
            className={cn('type-sub text-pretty', lane ? 'leading-[1.4] text-foreground-2' : 'text-foreground-3')}
          >
            {lane ? (
              <>
                <Line pieces={[sample(figure), record(figure), coverage(figure)]} />
                <Line pieces={[interval(figure), orientative(figure), era(figure), compared(reference)]} />
              </>
            ) : (
              <Line
                pieces={[
                  interval(figure),
                  record(figure),
                  orientative(figure),
                  coverage(figure),
                  era(figure),
                  compared(reference),
                ]}
              />
            )}
          </div>
        </>
      ) : null}

      {warning ? (
        <p data-part="warning" className="type-sub text-pretty wrap-anywhere text-foreground">
          {warning}
        </p>
      ) : null}
      {unavailable ? (
        <p data-part="unavailable" className="type-sub text-pretty wrap-anywhere text-foreground-2">
          {unavailable}
        </p>
      ) : null}
      {note ? (
        <p data-part="note" className="type-sub text-pretty wrap-anywhere text-foreground-3">
          {note}
        </p>
      ) : null}
      {children ? <div data-part="more">{children}</div> : null}
    </div>
  )
}

/** One thing a block writes under its bar. `whole`: it never breaks inside (a number, a record, an interval). */
interface Piece {
  key: string
  whole: boolean
  text: ReactNode
}

/** «n = 47», «n = 268 en 40 listas». A row writes it beside the value, a lane under its bar. */
function sample(figure: Figure): Piece {
  return { key: 'n', whole: true, text: figureSample(figure) }
}

function record(figure: Figure): Piece | null {
  return figure.record ? { key: 'record', whole: true, text: formatRecord(figure.record) } : null
}

function interval(figure: Figure): Piece | null {
  return figure.ci95 ? { key: 'interval', whole: true, text: intervalText(figure.ci95) } : null
}

/** The mark of the legend and, after it, what it means here in words. */
function orientative(figure: Figure): Piece | null {
  if (!figure.orientative) return null
  return {
    key: 'orientative',
    whole: false,
    text: <MarkWords mark="orientative" text={orientativeText(figure.sampleKind)} />,
  }
}

/** How much of the meta the number has data against; with none, the mark of the legend before it. */
function coverage(figure: Figure): Piece | null {
  if (figure.coverage == null) return null
  const text = `cruces con datos: ${formatRateValue(figure.coverage)} del meta`
  return {
    key: 'coverage',
    whole: false,
    text: figure.coverage === 0 ? <MarkWords mark="coverage" text={text} /> : text,
  }
}

function era(figure: Figure): Piece | null {
  return figure.stale ? { key: 'era', whole: false, text: `de la era ${figure.stale.era}` } : null
}

function compared(reference: BarReference | null): Piece | null {
  return reference ? { key: 'reference', whole: false, text: referenceText(reference) } : null
}

/**
 * The pieces there are, on one line that wraps between them: each one but the last ends with its «·», so a line
 * never starts with one. Nothing at all when there is no piece.
 */
function Line({ pieces }: { pieces: readonly (Piece | null)[] }) {
  const present = pieces.filter((piece): piece is Piece => piece !== null)
  if (present.length === 0) return null
  return (
    <span className="block">
      {present.map((piece, at) => (
        <Fragment key={piece.key}>
          {at > 0 ? ' ' : null}
          <span data-piece={piece.key} className={cn(piece.whole && 'whitespace-nowrap')}>
            {piece.text}
            {at < present.length - 1 ? '\u00a0·' : null}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
