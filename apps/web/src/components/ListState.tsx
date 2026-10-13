import { CircleAlertIcon, RefreshCwIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { errorMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/offlineMatches'
import { cn } from '@/lib/utils'

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  const ids = Array.from({ length: rows }, (_, i) => `row-${i}`)
  // Phone review: without signal a query that never loaded waits (paused) and the skeleton stayed with no reason.
  const online = useOnline()
  return (
    <output className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-label="Cargando">
      {online ? null : (
        <p className="text-sm text-muted-foreground">Sin señal: esto se carga cuando vuelva la conexión.</p>
      )}
      {ids.map((id) => (
        <Skeleton key={id} className="h-12 w-full" />
      ))}
    </output>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-2 rounded-lg border border-destructive/40 p-3', className)}
    >
      <div className="flex items-start gap-2 text-destructive">
        <CircleAlertIcon className="mt-0.5 size-5 shrink-0" />
        <span>{errorMessage(error)}</span>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
          Reintentar
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center',
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <RefreshCwIcon className={cn('size-4 animate-spin', className)} aria-hidden="true" />
}
