/**
 * The small marks that go beside a figure (mock-up D): «orientativo», «sin cruces con datos» and the text that stands
 * where a number has nothing behind it. The amber of a warning is theirs: no other piece of a figure uses it.
 */
import { NO_COVERAGE, NO_DATA, orientativeText, type SampleKind } from '@/lib/figure'
import { cn } from '@/lib/utils'

/**
 * «orientativo»: a 9 px circle, half filled. It has no text of its own, so its name says the word and what it
 * counted («orientativo: menos de 30 listas»): a screen reader, and a test that looks for the word, find it there.
 *
 * Where the system forces its colours the fill is dropped: there the left edge is as thick as half the circle.
 */
export function OrientativeMark({
  kind = 'matches',
  decorative = false,
  className,
}: {
  /** What the figure counted to be «orientativo»: the API's `sampleKind`. */
  kind?: SampleKind
  /**
   * Beside the words that say it the mark is decoration: it has no name at all, so nothing is said twice, and no
   * name can say another kind than the one that is written. `MarkWords` draws it so.
   */
  decorative?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="orientative-mark"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': orientativeText(kind) })}
      className={cn(
        'inline-block size-[9px] shrink-0 rounded-full border-[1.5px] border-warning bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)] forced-colors:border-l-[4.5px]',
        className,
      )}
    />
  )
}

/**
 * ▲: a number against the meta that has no matchup with data behind it. A 10 × 9 px triangle, drawn with its edges
 * and cut to its shape: where the system forces its colours it paints the clear sides too, and the cut keeps the
 * triangle.
 */
export function CoverageMark({
  decorative = false,
  className,
}: {
  /** Beside the words that say it: decoration, with no name of its own (`MarkWords`). */
  decorative?: boolean
  className?: string
}) {
  return (
    <span
      data-slot="coverage-mark"
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': NO_COVERAGE })}
      className={cn(
        'inline-block size-0 shrink-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-warning [clip-path:polygon(50%_0,100%_100%,0_100%)]',
        className,
      )}
    />
  )
}

/** «sin datos», where a figure would be: never a zero. Another text says why there is nothing («sin partidas»). */
export function NoData({ text = NO_DATA, className }: { text?: string; className?: string }) {
  return (
    <span data-slot="no-data" className={cn('type-n whitespace-nowrap text-foreground-3', className)}>
      {text}
    </span>
  )
}

/**
 * A mark and, right after it, the words that say what it means: «◐ orientativo: menos de 30 listas» in a line of a
 * block or in the key of a legend. The words are written, so the mark is decoration: only the words are read. The
 * mark stays on the line of the first word, and the rest of the words wraps.
 */
export function MarkWords({ mark, text }: { mark: 'orientative' | 'coverage'; text: string }) {
  const [word, ...rest] = text.split(' ')
  return (
    <span data-slot="mark-words">
      <span className="whitespace-nowrap">
        {mark === 'orientative' ? (
          <OrientativeMark decorative className="mr-[5px]" />
        ) : (
          <CoverageMark decorative className="mr-[5px]" />
        )}
        {word}
      </span>{' '}
      {rest.join(' ')}
    </span>
  )
}
