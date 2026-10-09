import { Link } from 'react-router'
import type { Match, MatchResult } from '@/api/schemas'
import { formatPlayedAt, MODE_LABEL, RESULT_LABEL, RESULT_SHORT } from '@/lib/matches'
import { cn } from '@/lib/utils'

const RESULT_BADGE: Record<MatchResult, string> = {
  win: 'bg-success text-success-foreground',
  loss: 'bg-destructive text-destructive-foreground',
  tie: 'bg-muted text-foreground',
}

export function ResultBadge({ result }: { result: MatchResult }) {
  return (
    <span
      className={cn('flex size-9 shrink-0 items-center justify-center rounded-md font-semibold', RESULT_BADGE[result])}
      title={RESULT_LABEL[result]}
    >
      <span aria-hidden="true">{RESULT_SHORT[result]}</span>
      <span className="sr-only">{RESULT_LABEL[result]}</span>
    </span>
  )
}

/** Newest first; each row opens the edit page. */
export function MatchList({ matches, showDeck = true }: { matches: Match[]; showDeck?: boolean }) {
  return (
    <ul className="divide-y rounded-lg border">
      {matches.map((match) => {
        const details = [
          formatPlayedAt(match.playedAt),
          MODE_LABEL[match.mode],
          match.wentFirst === null ? null : match.wentFirst ? 'empecé yo' : 'empezó el rival',
        ].filter(Boolean)
        return (
          <li key={match.id}>
            <Link
              to={`/partidas/${encodeURIComponent(match.id)}`}
              className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted"
            >
              <ResultBadge result={match.result} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {showDeck ? <span className="font-medium">{match.deck.name}</span> : null}
                  {showDeck && match.opponent ? <span className="text-muted-foreground"> vs </span> : null}
                  {match.opponent ? (
                    <span>{match.opponent}</span>
                  ) : showDeck ? null : (
                    <span className="text-muted-foreground">sin rival anotado</span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {details.join(' · ')}
                  {match.note ? ` · ${match.note}` : ''}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
