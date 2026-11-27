/**
 * The seal of a source: M (my matches), T (tournaments), B (bots). Every number of the three sources goes under its
 * seal, and the three are never mixed (mock-up D, DIRECCION-D §1). Three shapes, so a source is never told apart by a
 * colour alone: M filled, T outlined, B dashed.
 */
import { SOURCE_LETTER, SOURCE_NAME, type SourceKey } from '@/lib/figure'
import { cn } from '@/lib/utils'

/**
 * Where the system forces its own colours it drops every fill and every shadow, and paints the edges in its colour of
 * text: a filled M would be a bare letter, and so would T. There M takes a double edge and T a single one, beside the
 * dashed one of B: still three shapes, and no colour is written for them.
 */
const SHAPE: Record<SourceKey, string> = {
  matches: 'bg-foreground text-card forced-colors:border-[3px] forced-colors:border-double',
  tournament: 'text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground-2)] forced-colors:border-[1.5px]',
  simulation: 'border-[1.5px] border-dashed border-foreground-2 text-foreground',
}
/** Thirty filled M down a column would shout: there the fill steps back to the second text colour. */
const QUIET_FILL = 'bg-foreground-2 text-card forced-colors:border-[3px] forced-colors:border-double'

/** The box, and how far under the baseline it sits when it is written inside a line of text. */
const SIZE = { 18: 'size-[18px] align-[-3px]', 16: 'size-[16px] align-[-2px]' } as const

export function SourceSeal({
  source,
  size = 18,
  named = false,
  label,
  quiet = false,
  className,
}: {
  source: SourceKey
  /** 16 inside a cell, a caption or the second line of a row. */
  size?: 18 | 16
  /**
   * Without it the seal is decoration: the name of the source is written beside it. With it the seal is alone (a
   * cell, a sentence) and says its source itself.
   */
  named?: boolean
  /** Another name to say, more exact than the source's: «Torneo, lista exacta», «Bots g2». A seal with one is named. */
  label?: string
  /** The filled M of a long column, quieter. T and B are already an outline: it changes nothing in them. */
  quiet?: boolean
  className?: string
}) {
  const name = label ?? (named ? SOURCE_NAME[source] : undefined)
  return (
    <span
      data-slot="source-seal"
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
      className={cn(
        // A label in capitals around it must not space the letter out of the centre of its box.
        'inline-grid shrink-0 place-items-center rounded-[5px] font-heading text-[13px] leading-none font-bold tracking-normal normal-case',
        SIZE[size],
        quiet && source === 'matches' ? QUIET_FILL : SHAPE[source],
        className,
      )}
    >
      {SOURCE_LETTER[source]}
    </span>
  )
}
