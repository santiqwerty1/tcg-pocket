/**
 * Simulación (BRIEF M7, Fase 6): the jobs played by the worker on the PC with deckgym-core, the engine revision and
 * which workers are online. Simulated results stay here and in their own column of the deck comparison; they never
 * mix with own matches or tournaments.
 */
import { ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, CpuIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { EngineInfo, JobSummary } from '@/api/schemas'
import {
  useArchiveSimulation,
  useCleanupSimulations,
  useDeleteSimulation,
  useEngineInfo,
  useSimulations,
} from '@/api/simulations'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, shortSha } from '@/lib/format'
import { useMarkSeen } from '@/lib/seen'
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

/** The row's own action: archive a finished job, bring back an archived one, delete a cancelled or failed one. */
function RowAction({ job, onDelete }: { job: JobSummary; onDelete: (job: JobSummary) => void }) {
  const archive = useArchiveSimulation()
  function setArchived(archived: boolean) {
    archive.mutate(
      { id: job.id, archived },
      {
        onSuccess: () =>
          toast.success(archived ? `#${job.id} archivada` : `#${job.id} vuelve a la lista`, {
            duration: 8000,
            action: archived
              ? { label: 'Deshacer', onClick: () => archive.mutate({ id: job.id, archived: false }) }
              : undefined,
          }),
        onError: (error) => toast.error(errorMessage(error)),
      },
    )
  }
  if (job.archived) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Desarchivar #${job.id}`}
        title="Desarchivar"
        disabled={archive.isPending}
        onClick={() => setArchived(false)}
      >
        <ArchiveRestoreIcon />
      </Button>
    )
  }
  if (job.status === 'done') {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Archivar #${job.id}`}
        title="Archivar (sus resultados siguen valiendo; a la semana queda una repetición por cruce)"
        disabled={archive.isPending}
        onClick={() => setArchived(true)}
      >
        <ArchiveIcon />
      </Button>
    )
  }
  if (job.status === 'cancelled' || job.status === 'failed') {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Borrar #${job.id}`}
        title="Borrar"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(job)}
      >
        <Trash2Icon />
      </Button>
    )
  }
  return null
}

function JobRow({ job, onDelete }: { job: JobSummary; onDelete: (job: JobSummary) => void }) {
  const active = isActive(job.status)
  return (
    <li className="flex items-center">
      <Link
        to={job.lab ? `/laboratorio/${job.id}` : `/simulacion/${job.id}`}
        className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 hover:bg-muted"
      >
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
      <div className="shrink-0 pr-1">
        <RowAction job={job} onDelete={onDelete} />
      </div>
    </li>
  )
}

export function SimulacionPage() {
  useMarkSeen('simulacion')
  const [showArchived, setShowArchived] = useState(false)
  const jobs = useSimulations(showArchived)
  const engine = useEngineInfo()
  const remove = useDeleteSimulation()
  const cleanup = useCleanupSimulations()
  const [toDelete, setToDelete] = useState<JobSummary | null>(null)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const counts = jobs.data?.counts

  function archiveDone() {
    cleanup.mutate('archive_done', {
      onSuccess: ({ count }) =>
        toast.success(count === 1 ? '1 simulación archivada' : `${count} simulaciones archivadas`),
      onError: (error) => toast.error(errorMessage(error)),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {engine.data && !showArchived ? <EngineLine engine={engine.data} /> : null}
      <Section
        title={showArchived ? 'Simulaciones archivadas' : 'Simulaciones'}
        action={
          showArchived ? (
            <Button size="sm" variant="outline" onClick={() => setShowArchived(false)}>
              <ArrowLeftIcon data-icon="inline-start" />
              Volver
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/simulacion/nueva">
                <PlusIcon data-icon="inline-start" />
                Nueva
              </Link>
            </Button>
          )
        }
      >
        {showArchived ? (
          <p className="text-xs text-muted-foreground">
            Archivadas: no aparecen en la lista, pero sus resultados siguen contando (comparativa, consistencia,
            laboratorio).
          </p>
        ) : null}
        {jobs.isPending ? (
          <LoadingRows />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : showArchived && jobs.data.items.length === 0 ? (
          <EmptyState title="No hay simulaciones archivadas" />
        ) : jobs.data.items.length === 0 ? (
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
            {jobs.data.items.map((job) => (
              <JobRow key={job.id} job={job} onDelete={setToDelete} />
            ))}
          </ul>
        )}
        {!showArchived && counts && (counts.done > 0 || counts.cancelled > 0 || counts.archived > 0) ? (
          <div className="flex flex-wrap gap-2">
            {counts.done > 0 ? (
              <Button size="sm" variant="outline" disabled={cleanup.isPending} onClick={archiveDone}>
                <ArchiveIcon data-icon="inline-start" />
                Archivar terminadas ({counts.done})
              </Button>
            ) : null}
            {counts.cancelled > 0 ? (
              <Button size="sm" variant="outline" disabled={cleanup.isPending} onClick={() => setConfirmCleanup(true)}>
                <Trash2Icon data-icon="inline-start" />
                Borrar canceladas ({counts.cancelled})
              </Button>
            ) : null}
            {counts.archived > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setShowArchived(true)}>
                Ver archivadas ({counts.archived})
              </Button>
            ) : null}
          </div>
        ) : null}
      </Section>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => (open ? null : setToDelete(null))}
        title={`¿Borrar la simulación #${toDelete?.id ?? ''}?`}
        description="Se borran sus resultados y repeticiones. Los mazos no se tocan."
        confirmLabel="Borrar"
        destructive
        pending={remove.isPending}
        onConfirm={async () => {
          if (!toDelete) return
          try {
            await remove.mutateAsync(toDelete.id)
            toast.success(`Simulación #${toDelete.id} borrada`)
            setToDelete(null)
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
      />
      <ConfirmDialog
        open={confirmCleanup}
        onOpenChange={setConfirmCleanup}
        title={`¿Borrar las ${counts?.cancelled ?? 0} simulaciones canceladas?`}
        description="Se borran con lo que hayan llegado a jugar y sus repeticiones. Los mazos no se tocan."
        confirmLabel="Borrar"
        destructive
        pending={cleanup.isPending}
        onConfirm={() =>
          cleanup.mutate('delete_cancelled', {
            onSuccess: ({ count }) => {
              toast.success(count === 1 ? '1 simulación borrada' : `${count} simulaciones borradas`)
              setConfirmCleanup(false)
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
      <p className="text-xs text-muted-foreground">
        Los porcentajes simulados dependen del bot y del motor: sirven para comparar mazos entre sí, no para predecir
        partidas reales.
      </p>
    </div>
  )
}
