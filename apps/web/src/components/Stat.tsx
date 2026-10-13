import type { ReactNode } from 'react'
import type { Percentage } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface StatProps {
  label: string
  value: ReactNode
  /** Secondary line under the value. */
  hint?: ReactNode
  /** Sample size; every percentage must show it (BRIEF §2). */
  n?: number
  nLabel?: string
  /** 95 % confidence interval, shown as a range. */
  ci95?: readonly [number, number]
  /** Fewer than 30 samples: the number orients but does not prove. */
  orientative?: boolean
  className?: string
}

/**
 * A number with its context. For percentages, `n` and `ci95` are mandatory in the product rules, so the component
 * always renders them when present and marks small samples as «orientativo».
 */
export function Stat({ label, value, hint, n, nLabel = 'muestras', ci95, orientative, className }: StatProps) {
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2.5 text-card-foreground', className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="text-2xl font-semibold tabular">{value}</div>
        {orientative ? (
          <Badge variant="outline" className="text-warning">
            orientativo
          </Badge>
        ) : null}
      </div>
      {n !== undefined || ci95 ? (
        <div className="text-xs text-muted-foreground tabular">
          {n !== undefined ? `n = ${formatNumber(n)} ${nLabel}` : null}
          {n !== undefined && ci95 ? ' · ' : null}
          {ci95 ? `IC\u00a095\u00a0% ${formatPercent(ci95[0])} – ${formatPercent(ci95[1])}` : null}
        </div>
      ) : null}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

/** Renders a contract `Percentage` ({ value, samples, ci95, orientative }). */
export function StatPercent({ label, stat, className }: { label: string; stat: Percentage; className?: string }) {
  const n = stat.games ?? stat.samples
  return (
    <Stat
      label={label}
      value={formatPercent(stat.value)}
      {...(n !== undefined ? { n } : {})}
      nLabel={stat.sampleKind ?? (stat.games !== undefined ? 'partidas' : 'muestras')}
      {...(stat.ci95 ? { ci95: stat.ci95 } : {})}
      {...(stat.orientative !== undefined ? { orientative: stat.orientative } : {})}
      {...(className ? { className } : {})}
    />
  )
}
