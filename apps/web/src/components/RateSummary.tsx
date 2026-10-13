import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { GameRecord, WinRate } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { formatInterval, formatRateValue, formatRecord, formatSample } from '@/lib/matches'
import { cn } from '@/lib/utils'

export function OrientativeBadge() {
  return (
    <Badge variant="outline" className="text-warning" title="Menos de 30 partidas: orienta, no prueba">
      orientativo
    </Badge>
  )
}

/**
 * «7 V · 3 D · n = 10 · IC 39,7–89,2 %»: everything the product rules require next to a percentage (BRIEF §2). Each
 * piece is unbreakable so a narrow screen wraps between pieces, never inside the interval.
 */
export function RateDetails({ record, rate }: { record: GameRecord | null; rate: WinRate }) {
  const pieces = [...(record ? [formatRecord(record)] : []), formatSample(rate), `IC ${formatInterval(rate.ci95)}`]
  // Phone review: the separator went inside the next piece (« · 124 V»), so a line could start with «·»; now each
  // piece but the last ends with its «·» and a plain space between pieces is where a line wraps.
  return (
    <span className="tabular">
      {pieces.map((piece, index) => (
        <Fragment key={piece}>
          {index > 0 ? ' ' : ''}
          <span className="whitespace-nowrap">
            {piece}
            {index < pieces.length - 1 ? ' ·' : ''}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

/** The headline rate of a view: label and big value on one line, details and «orientativo» below. */
export function RateHeadline({
  label,
  hint,
  record,
  rate,
}: {
  label: string
  hint?: ReactNode
  record: GameRecord | null
  rate: WinRate | null
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular">{rate ? formatRateValue(rate.value) : 'sin datos'}</span>
      </div>
      {rate ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <RateDetails record={record} rate={rate} />
          {rate.orientative ? <OrientativeBadge /> : null}
        </div>
      ) : null}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export interface RateRow {
  id: string
  label: ReactNode
  hint?: ReactNode
  to?: string
  record: GameRecord
  rate: WinRate | null
}

/**
 * A bordered list of labelled rates (by deck, by opponent…). Two lines per row so long deck names keep their width
 * on a phone: name and value on top, details and «orientativo» below. Without games: «sin datos», never «0 %».
 */
export function RateRows({ rows, empty = 'Sin partidas.' }: { rows: RateRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5 px-3 py-2">
          <div className="flex items-baseline gap-3">
            <div className="min-w-0 flex-1">
              {row.to ? (
                <Link to={row.to} className="block truncate font-medium hover:underline">
                  {row.label}
                </Link>
              ) : (
                <span className="block truncate font-medium">{row.label}</span>
              )}
            </div>
            <span className={cn('shrink-0 tabular', row.rate ? 'font-semibold' : 'text-sm text-muted-foreground')}>
              {row.rate ? formatRateValue(row.rate.value) : 'sin datos'}
            </span>
          </div>
          {row.rate || row.hint ? (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="min-w-0">
                {row.hint ? (
                  <span>
                    {row.hint}
                    {'\u00a0·'}
                  </span>
                ) : null}
                {row.hint && row.rate ? ' ' : null}
                {row.rate ? <RateDetails record={row.record} rate={row.rate} /> : null}
              </span>
              {row.rate?.orientative ? <OrientativeBadge /> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
