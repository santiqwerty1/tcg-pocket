import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { Issue } from '@/api/schemas'
import { cn } from '@/lib/utils'

export type IssueLevel = 'error' | 'warning' | 'info'

const STYLES: Record<IssueLevel, { icon: typeof InfoIcon; className: string }> = {
  error: { icon: CircleAlertIcon, className: 'text-destructive' },
  warning: { icon: TriangleAlertIcon, className: 'text-warning' },
  info: { icon: InfoIcon, className: 'text-muted-foreground' },
}

export function IssueList({
  issues,
  level,
  className,
}: {
  issues: readonly Issue[]
  level: IssueLevel
  className?: string
}) {
  if (issues.length === 0) return null
  const { icon: Icon, className: color } = STYLES[level]
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {issues.map((issue) => (
        <li
          key={`${issue.code}:${issue.message}:${(issue.cardIds ?? []).join(',')}`}
          className="flex items-start gap-2 text-sm"
        >
          <Icon className={cn('mt-0.5 size-4 shrink-0', color)} aria-hidden="true" />
          <span>
            {issue.message}
            {issue.cardIds && issue.cardIds.length > 0 ? (
              <span className="ml-1 font-mono text-xs text-muted-foreground">({issue.cardIds.join(', ')})</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
