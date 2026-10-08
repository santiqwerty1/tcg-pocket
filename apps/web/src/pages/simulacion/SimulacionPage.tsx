/**
 * Simulación (BRIEF M7, Fase 6): the jobs played by the worker on the PC with deckgym-core, the engine revision and
 * which workers are online. Simulated results stay here and in their own column of the deck comparison; they never
 * mix with own matches or tournaments.
 */
import { CpuIcon, PlusIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { EngineInfo, JobSummary } from '@/api/schemas'
import { useEngineInfo, useSimulations } from '@/api/simulations'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, shortSha } from '@/lib/format'
import { formatDuration, gamesLabel, isActive, KIND_LABEL, progressFraction, STATUS_LABEL } from '@/lib/simulation'
import { ago } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

export function ProgressBar({ fraction, className }: { fraction: number; className?: string }) {
  const percent = Math.round(fraction * 1000) / 10
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}

export function StatusBadge({ status }: { status: JobSummary['status'] }) {
  return (
    <Badge
      variant={status === 'failed' ? 'destructive' : status === 'done' ? 'secondary' : 'outline'}
      className={cn(status === 'running' && 'border-primary text-primary')}
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/** Engine revision and workers: who is online, what it is playing, and why nothing moves when none is. */
export function EngineLine({ engine }: { engine: EngineInfo }) {
  const online = engine.workers.filter((worker) => worker.online)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CpuIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <span>
          Motor <code className="font-mono text-xs">{shortSha(engine.engineRev)}</code>
        </span>
        <span className="text-muted-foreground">
          · {engine.incomplete} cartas sin implementar
          {engine.source === 'fallback'
            ? ' (lista de la Fase 0, hasta que el worker suba la suya)'
            : engine.source === 'previous'
              ? ` (según el motor ${shortSha(engine.statusRev)}, hasta que un worker con este motor suba la suya)`
              : ''}
        </span>
      </div>
      {engine.upstream && engine.upstream.aheadBy > 0 ? (
        <p className="text-xs text-muted-foreground">
          deckgym tiene {engine.upstream.aheadBy} {engine.upstream.aheadBy === 1 ? 'commit nuevo' : 'commits nuevos'}{' '}
          desde <code className="font-mono">{shortSha(engine.upstream.pinned)}</code>
          {engine.upstream.latest?.date ? ` (el último del ${formatDate(engine.upstream.latest.date)})` : ''}.{' '}
          <a
            href={engine.upstream.compareUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Ver cambios
          </a>
          . El motor queda fijo hasta que decidas actualizarlo (se recompila y las simulaciones nuevas usan el motor
          nuevo).
        </p>
      ) : engine.upstream ? (
        <p className="text-xs text-muted-foreground">deckgym al día con el motor fijado.</p>
      ) : null}
      {engine.workers.length === 0 ? (
        <p className="text-muted-foreground">
          Ningún worker se conectó todavía. Creá un token de tipo worker en Más → Tokens de API, guardalo en{' '}
          <code className="font-mono text-xs">%LOCALAPPDATA%\tcg-worker\config.json</code> como{' '}
          <code className="font-mono text-xs">{'{"token": "tcg_wk_…"}'}</code> y en la PC corré{' '}
          <code className="font-mono text-xs">pnpm -F @tcg/worker install-task</code>.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {engine.workers.map((worker) => (
            <li key={worker.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={cn('size-2 rounded-full', worker.online ? 'bg-success' : 'bg-muted-foreground/40')}
                aria-hidden="true"
              />
              <span className="font-medium">{worker.name}</span>
              <span className="text-xs text-muted-foreground">
                {worker.cores} {worker.cores === 1 ? 'núcleo' : 'núcleos'} ·{' '}
                {worker.online ? 'en línea' : `visto ${ago(worker.lastSeenAt)}`}
                {worker.engineRev && worker.engineRev !== engine.engineRev
                  ? ` · motor ${shortSha(worker.engineRev)} (distinto)`
                  : ''}
              </span>
              {worker.current ? (
                <Link to={`/simulacion/${worker.current.jobId}`} className="text-xs text-primary hover:underline">
                  jugando #{worker.current.jobId}: {worker.current.gamesDone}/{worker.current.games}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {engine.workers.length > 0 && online.length === 0 ? (
        <p className="text-xs text-warning">
          No hay workers en línea: lo encolado espera a que prendas la PC. Lo que se cortó sigue solo.
        </p>
      ) : null}
    </div>
  )
}

function JobRow({ job }: { job: JobSummary }) {
  const active = isActive(job.status)
  return (
    <li>
      <Link to={`/simulacion/${job.id}`} className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-muted">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{job.label}</span>
          <StatusBadge status={job.status} />
        </div>
        <div className="text-xs text-muted-foreground">
          #{job.id} · {KIND_LABEL[job.kind]} · {job.playersEs[0]} vs {job.playersEs[1]} · {gamesLabel(job.gamesPerPair)}{' '}
          por cruce · {formatDateTime(job.createdAt)}
        </div>
        {active || job.status === 'failed' ? (
          <div className="flex items-center gap-2">
            <ProgressBar fraction={progressFraction(job)} />
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {Math.floor(progressFraction(job) * 100)} %
              {job.progress.etaSeconds !== null && active ? ` · faltan ${formatDuration(job.progress.etaSeconds)}` : ''}
            </span>
          </div>
        ) : null}
      </Link>
    </li>
  )
}

export function SimulacionPage() {
  const jobs = useSimulations()
  const engine = useEngineInfo()
  return (
    <div className="flex flex-col gap-4">
      {engine.data ? <EngineLine engine={engine.data} /> : null}
      <Section
        title="Simulaciones"
        action={
          <Button asChild size="sm">
            <Link to="/simulacion/nueva">
              <PlusIcon data-icon="inline-start" />
              Nueva
            </Link>
          </Button>
        }
      >
        {jobs.isPending ? (
          <LoadingRows />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : jobs.data.length === 0 ? (
          <EmptyState
            title="Sin simulaciones todavía"
            description="Elegí mazos o listas de torneo, los bots y cuántas partidas; el worker de la PC las juega con deckgym-core."
            action={
              <Button asChild>
                <Link to="/simulacion/nueva">Nueva simulación</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y rounded-lg border">
            {jobs.data.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </Section>
      <p className="text-xs text-muted-foreground">
        Los porcentajes simulados dependen del bot y del motor: sirven para comparar mazos entre sí, no para predecir
        partidas reales.
      </p>
    </div>
  )
}
