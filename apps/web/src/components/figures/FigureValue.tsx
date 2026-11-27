/**
 * A percentage with its n, as it is written wherever there is no room for a sentence (mock-up D): the cell of a
 * table, a deck's header, a deck's summary, a number of the day. One piece for the four sizes, so no screen writes a
 * percentage by hand: there is no way to give it one without its n, and no data is «sin datos», never a zero.
 */
import { intervalText, type MaybeFigure, orientativeText, type SourceKey } from '@/lib/figure'
import { formatPercent, PERCENT } from '@/lib/format'
import { formatRateValue, formatSampleShort } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { CoverageMark, NoData, OrientativeMark } from './Marks'
import { SourceSeal } from './SourceSeal'

type Size = 'cell' | 'header' | 'hero' | 'score'

/**
 * For each size: how its parts line up, the type of what leads (the percentage, or the n of a table sorted by n), the
 * type of what follows, and «sin datos». The sizes are D's: 17, 15, 22 and 28 px over an n of 14 px.
 */
const LOOK: Record<Size, { line: string; lead: string; rest: string; empty: string }> = {
  // The n on the line of the percentage (1.1): a cell is as tall as its percentage, 18.7 px, and no more.
  cell: { line: 'items-baseline', lead: 'type-figure-17', rest: 'type-n leading-[1.1] text-foreground-3', empty: '' },
  // A deck's header is one line of 18 px, with the seal: everything on its middle.
  header: {
    line: 'items-center',
    lead: 'type-figure-15 leading-[18px]',
    rest: 'type-n leading-[18px] text-foreground-2',
    empty: 'text-foreground-2',
  },
  hero: { line: 'items-baseline', lead: 'type-figure-22', rest: 'type-n text-foreground-3', empty: '' },
  score: { line: 'items-baseline', lead: 'type-figure-28', rest: 'type-n text-foreground-2', empty: 'text-[15px]' },
}

export function FigureValue({
  figure,
  size,
  seal,
  sealNamed = false,
  lead = 'value',
  decimals,
  marks = true,
  noData,
  className,
}: {
  /** Null: «sin datos». */
  figure: MaybeFigure
  /** `cell` 17 px, `header` 15 px, `hero` 22 px, `score` 28 px; the n is 14 px in all of them. */
  size: Size
  /** The seal of its source, before the number. */
  seal?: SourceKey
  /** The seal says its source: for a figure whose source is written nowhere near it. */
  sealNamed?: boolean
  /** `n`: the table is sorted by n, so the n goes first and takes the weight; the percentage steps back. */
  lead?: 'value' | 'n'
  /** `fixed`: always one decimal, so a column lines up («50,0 %»). `auto`: «50 %». A cell is fixed unless told. */
  decimals?: 'fixed' | 'auto'
  /**
   * False where a legend says once that every figure is «orientativo»: the mark is not drawn (it is still said).
   * It does not take away the mark of a number with no matchup behind it: that one is about this figure alone.
   */
  marks?: boolean
  /** Another text for no data («sin partidas»). */
  noData?: string
  className?: string
}) {
  const look = LOOK[size]
  // Two groups that never break inside, so a narrow box wraps between them: the seal with what leads, and what
  // follows with its marks (a mark alone on a line would say nothing).
  const root = cn('inline-flex flex-wrap gap-x-[5px] gap-y-0.5', look.line, className)
  const group = cn('inline-flex gap-x-[5px] whitespace-nowrap', look.line)
  const badge = seal ? (
    <SourceSeal source={seal} size={size === 'cell' ? 16 : 18} named={sealNamed} quiet={size === 'cell'} />
  ) : null
  if (!figure) {
    return (
      <span data-slot="figure" data-size={size} data-empty="" className={root}>
        <span className={group}>
          {badge}
          {badge ? ' ' : null}
          <NoData text={noData} className={look.empty} />
        </span>
      </span>
    )
  }

  const leads = lead === 'value'
  // A score of another era is still a number, but not one to compare with the others: quiet, and not bold.
  const strong = cn(look.lead, figure.stale ? 'font-medium text-foreground-2' : 'text-foreground')
  const written =
    (decimals ?? (size === 'cell' ? 'fixed' : 'auto')) === 'fixed'
      ? formatPercent(figure.value)
      : formatRateValue(figure.value)
  // A number of the day is 28 px in a cell of some 60: its «%» is written small, as a unit.
  const unit = size === 'score' && leads && written.endsWith(PERCENT)
  const value = (
    <span data-part="value" className={leads ? strong : cn(look.rest, 'tabular-nums')}>
      {unit ? written.slice(0, -PERCENT.length) : written}
      {unit ? <small className="text-[15px] font-semibold text-foreground-2">{PERCENT}</small> : null}
    </span>
  )
  const sample = (
    <span data-part="n" className={leads ? look.rest : strong}>
      {formatSampleShort(figure.n)}
    </span>
  )
  const drawn = figure.orientative && marks
  // What is not written, for who does not see the chart beside it: the interval, always; «orientativo», when its
  // mark is not drawn here; and the era of a score that is not this one's.
  const unwritten = [
    ...(figure.ci95 ? [intervalText(figure.ci95)] : []),
    ...(figure.orientative && !drawn ? [orientativeText(figure.sampleKind)] : []),
    ...(figure.stale ? [`de la era ${figure.stale.era}`] : []),
  ]
  return (
    <span data-slot="figure" data-size={size} {...(figure.stale ? { 'data-stale': '' } : {})} className={root}>
      <span className={group}>
        {badge}
        {badge ? ' ' : null}
        {leads ? value : sample}
      </span>{' '}
      <span className={group}>
        {leads ? sample : value}
        {drawn ? <OrientativeMark kind={figure.sampleKind} /> : null}
        {figure.coverage === 0 ? <CoverageMark /> : null}
      </span>
      {unwritten.length > 0 ? <span className="sr-only">{`, ${unwritten.join(', ')}`}</span> : null}
    </span>
  )
}
