/**
 * The legend of the figures of a screen (mock-up D): one per screen says what each seal is, what the marks mean and
 * which interval is written. It is built from what the figures above it really have: the sources that are there, the
 * bots when the data names them, «orientativo» by what those figures counted.
 */
import type { ReactNode } from 'react'
import { INTERVAL_KEY, NO_COVERAGE, orientativeKey, type SampleKind, SOURCE_NAME, type SourceKey } from '@/lib/figure'
import { cn } from '@/lib/utils'
import { MarkWords } from './Marks'
import { SourceSeal } from './SourceSeal'

export function SourceLegend({
  sources,
  bot,
  marks,
  interval = true,
  variant = 'board',
  children,
  className,
}: {
  /** The sources of the figures above, in the order their seals are read. Exactly these get a key. */
  sources: readonly SourceKey[]
  /** The bots of the B figures («g2»), when the data has them as a field; left out otherwise. */
  bot?: string | null
  marks?: {
    /** What the «orientativo» figures above counted: the key says each kind. None, or empty: no key. */
    orientative?: readonly SampleKind[]
    /** Some figure above has no matchup with data behind it (▲). */
    coverage?: boolean
  }
  /** False where no interval is drawn or written above: the legend then does not say which one it is. */
  interval?: boolean
  /** `board`: the foot of a card, under a line. `page`: loose at the foot of a view. */
  variant?: 'board' | 'page'
  /** More keys and sentences, after the legend's own. */
  children?: ReactNode
  className?: string
}) {
  const orientative = orientativeKey(marks?.orientative ?? [])
  return (
    <div
      data-slot="source-legend"
      className={cn(
        'flex flex-wrap gap-x-[14px] type-n leading-[1.3] tracking-[0.01em] text-foreground-3',
        variant === 'board' ? 'gap-y-1 border-t border-border px-[14px] pt-2 pb-[10px]' : 'gap-y-0.5 px-0.5 pt-0.5',
        className,
      )}
    >
      {[...new Set(sources)].map((source) => (
        <span key={source} data-key={source} className="inline-flex items-center gap-[5px] whitespace-nowrap">
          {/* Decoration: the name it stands for is written right after it. */}
          <SourceSeal source={source} />
          {SOURCE_NAME[source].toLocaleLowerCase('es')}
          {source === 'simulation' && bot ? ` ${bot}` : null}
        </span>
      ))}
      {/* Each mark with its words: the mark is decoration there, and a long key wraps after its first word. */}
      {orientative ? (
        <span data-key="orientative">
          <MarkWords mark="orientative" text={orientative} />
        </span>
      ) : null}
      {marks?.coverage ? (
        <span data-key="coverage">
          <MarkWords mark="coverage" text={NO_COVERAGE} />
        </span>
      ) : null}
      {interval ? <span data-key="interval">{INTERVAL_KEY}</span> : null}
      {children}
    </div>
  )
}
