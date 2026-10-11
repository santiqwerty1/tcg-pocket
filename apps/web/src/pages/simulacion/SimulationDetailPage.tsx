/**
 * One simulation: live progress (SSE, every 2 s while it runs), then the results per deck with wins, losses and ties
 * apart and their Wilson interval, each deck's pairings, the optimize ranking, the stored replays and the chunks that
 * failed. Every number carries its bots, n, seed and engine revision.
 */
import { useQueryClient } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  PlayIcon,
  RepeatIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import type { JobDetail, Snapshot } from '@/api/schemas'
import { jobSummarySchema } from '@/api/schemas'
import {
  simulationKeys,
  useArchiveSimulation,
  useCancelSimulation,
  useDeleteSimulation,
  useSimulation,
} from '@/api/simulations'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ConsistencyTable } from '@/components/ConsistencyTable'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { OrientativeBadge, RateDetails } from '@/components/RateSummary'
import { SearchBox } from '@/components/SearchBox'
import { KeyValue, Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatNumber, plural, shortSha } from '@/lib/format'
import { formatRateValue } from '@/lib/matches'
import { encodeSource, formatDuration, gamesLabel, isActive, KIND_LABEL, progressFraction } from '@/lib/simulation'
import { cn } from '@/lib/utils'
import { ProgressBar, StatusBadge } from './SimulacionPage'
import { SimulationPriorityButton } from './SimulationPriorityButton'

/** SSE and REST share the cache so an old event cannot mask a successful priority change. */
function useLiveProgress(id: string, active: boolean): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!active || typeof EventSource === 'undefined') return
    const source = new EventSource(`/api/simulations/${encodeURIComponent(id)}/events`, { withCredentials: true })
    source.onmessage = (event) => {
      const parsed = jobSummarySchema.safeParse(JSON.parse(event.data as string))
      if (!parsed.success) return
      queryClient.setQueryData<JobDetail>(simulationKeys.detail(id), (job) => (job ? { ...job, ...parsed.data } : job))
      if (!isActive(parsed.data.status)) {
        source.close()
        void queryClient.invalidateQueries({ queryKey: simulationKeys.all })
      }
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [id, active, queryClient])
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
}

function snapshotLink(snapshot: Snapshot | undefined): string | null {
  if (!snapshot) return null
  if (snapshot.deckId) return `/mazos/${snapshot.deckId}`
  if (snapshot.sourceType === 'tournament_list' && snapshot.sourceId) {
    return `/torneos/listas/${snapshot.sourceId}`
  }
  return null
}

function RateCell({
  record,
  rate,
}: Pick<JobDetail['rows'][number], 'rate'> & { record: JobDetail['rows'][number]['total'] }) {
  if (!rate) return <span className="text-sm text-muted-foreground">sin datos</span>
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="font-semibold tabular">{formatRateValue(rate.value)}</span>
      <span className="text-right text-xs text-muted-foreground">
        <RateDetails record={record} rate={rate} />
      </span>
    </div>
  )
}

/** Decks sorted by win rate; each opens its pairings. */
function MatrixResults({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState<number | null>(null)
  const byId = useMemo(() => new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot])), [job.snapshots])
  const rows = [...job.rows].sort((a, b) => (b.rate?.value ?? -1) - (a.rate?.value ?? -1))
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay cruces terminados.</p>
  return (
    <ol className="divide-y rounded-lg border">
      {rows.map((row, position) => {
        const snapshot = byId.get(row.snapshot)
        const expanded = open === row.snapshot
        const link = snapshotLink(snapshot)
        return (
          <li key={row.snapshot} className="flex flex-col">
            <button
              type="button"
              className="flex items-start gap-2 px-3 py-2 text-left hover:bg-muted"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : row.snapshot)}
            >
              <span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground tabular">{position + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{snapshot?.label ?? `#${row.snapshot}`}</span>
                {row.rate?.orientative ? <OrientativeBadge /> : null}
              </span>
              <RateCell record={row.total} rate={row.rate} />
              <ChevronDownIcon
                className={cn(
                  'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
            {expanded ? (
              <div className="flex flex-col gap-1 border-t bg-muted/30 px-3 py-2">
                {link ? (
                  <Link to={link} className="text-xs text-primary hover:underline">
                    Ver {snapshot?.deckId ? 'el mazo' : 'la lista'}
                  </Link>
                ) : null}
                <ul className="divide-y">
                  {[...row.cells]
                    .sort((a, b) => (b.rate?.value ?? -1) - (a.rate?.value ?? -1))
                    .map((cell) => (
                      <li key={cell.rival} className="flex items-start gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm">
                          vs {byId.get(cell.rival)?.label ?? `#${cell.rival}`}
                        </span>
                        {cell.record ? (
                          <RateCell record={cell.record} rate={cell.rate} />
                        ) : (
                          <span className="text-xs text-muted-foreground">pendiente</span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** «#20 20. Mega-Steelix ex (rev. 1)» → «20. Mega-Steelix ex». */
function shortLabel(label: string): string {
  return label.replace(/^#\d+\s+/, '').replace(/\s*\(rev\. \d+\)$/, '')
}

/** 0 % red, 50 % yellow, 100 % green. */
function heat(value: number): string {
  const hue = Math.round(Math.max(0, Math.min(100, value)) * 1.3)
  return `hsl(${hue} 65% 40%)`
}

/** Every deck against every rival at a glance: rows by win rate, a colored cell per pairing (title: W-L-T and n). */
export function MatrixGrid({ job }: { job: { snapshots: Pick<Snapshot, 'id' | 'label'>[]; rows: JobDetail['rows'] } }) {
  const [selected, setSelected] = useState<{ a: number; b: number } | null>(null)
  const byId = useMemo(() => new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot])), [job.snapshots])
  const rows = [...job.rows].sort((a, b) => (b.rate?.value ?? -1) - (a.rate?.value ?? -1))
  const position = new Map(rows.map((row, at) => [row.snapshot, at + 1]))
  const rivals = [...new Set(rows.flatMap((row) => row.cells.map((cell) => cell.rival)))].sort(
    (a, b) => (position.get(a) ?? 1e6 + a) - (position.get(b) ?? 1e6 + b),
  )
  const outside = rivals.filter((rival) => !position.has(rival))
  const code = (rival: number) => position.get(rival)?.toString() ?? `R${outside.indexOf(rival) + 1}`
  const name = (id: number) => shortLabel(byId.get(id)?.label ?? `#${id}`)
  const selectedCell = job.rows
    .find((row) => row.snapshot === selected?.a)
    ?.cells.find((cell) => cell.rival === selected?.b)
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay cruces terminados.</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="border-separate border-spacing-0 text-[11px] tabular">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 min-w-40 bg-background px-2 py-1 text-left font-medium">Mazo</th>
              {rivals.map((rival) => (
                <th
                  key={rival}
                  scope="col"
                  className="sticky top-0 z-10 min-w-8 bg-background px-1 py-1 text-center font-medium"
                  title={name(rival)}
                >
                  {code(rival)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cells = new Map(row.cells.map((cell) => [cell.rival, cell]))
              return (
                <tr key={row.snapshot}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-48 truncate bg-background px-2 py-0.5 text-left font-normal"
                    title={byId.get(row.snapshot)?.label}
                  >
                    {position.get(row.snapshot)} · {name(row.snapshot)}{' '}
                  </th>
                  {rivals.map((rival) => {
                    const cell = cells.get(rival)
                    if (rival === row.snapshot) return <td key={rival} className="bg-muted" />
                    if (!cell?.record || !cell.rate) {
                      return (
                        <td key={rival} className="text-center text-muted-foreground">
                          ·
                        </td>
                      )
                    }
                    const { wins, losses, ties } = cell.record
                    return (
                      <td
                        key={rival}
                        className="text-center font-medium text-white"
                        style={{ backgroundColor: heat(cell.rate.value) }}
                        title={`${name(row.snapshot)} vs ${name(rival)}: ${formatRateValue(cell.rate.value)} · ${wins} V · ${losses} D · ${ties} E · n = ${cell.rate.games} · IC 95 % ${cell.rate.ci95.map((v) => v.toFixed(1)).join('–')} %${cell.rate.orientative ? ' · orientativo' : ''}`}
                      >
                        <button
                          type="button"
                          className="min-h-11 min-w-9 px-1 focus-visible:outline-2 focus-visible:outline-offset-2"
                          aria-label={`${name(row.snapshot)} contra ${name(rival)}`}
                          onClick={() => setSelected({ a: row.snapshot, b: rival })}
                        >
                          {Math.round(cell.rate.value)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {selected && selectedCell?.record ? (
        <div aria-live="polite" className="rounded-lg border p-3 text-sm">
          <p>
            {name(selected.a)} contra {name(selected.b)}
          </p>
          <RateCell record={selectedCell.record} rate={selectedCell.rate} />
          {selectedCell.rate?.orientative ? <OrientativeBadge /> : null}
        </div>
      ) : null}
      {outside.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {outside.map((rival) => (
            <li key={rival}>
              {code(rival)}: {name(rival)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Cada celda es el % de victorias del mazo de la fila contra el de la columna; tocala o pasá el mouse para ver
        victorias, derrotas, empates, n e intervalo. Los intervalos son puntuales; los cruces son exploratorios.
      </p>
    </div>
  )
}

/**
 * H-011.5: the best of many combinations measured on the same games is also the luckiest. The first ones were played
 * again with fresh seeds and more games; that is the number to trust.
 */
function OptimizeConfirmation({ job }: { job: JobDetail }) {
  const confirmation = job.optimizeConfirmation
  if (!confirmation) return null
  // The confirmation takes the first ones of the same ranking: rank n is row n − 1 of the optimize.
  const original = job.optimize ?? []
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Confirmación con semillas nuevas</span>
        {confirmation.status === 'pending' ? (
          <Badge variant="outline">por encolar</Badge>
        ) : confirmation.status === 'skipped' ? (
          <Badge variant="secondary">no se juega</Badge>
        ) : (
          <StatusBadge status={confirmation.status} />
        )}
        {confirmation.jobId !== null ? (
          <Link to={`/simulacion/${confirmation.jobId}`} className="text-xs text-primary hover:underline">
            simulación #{confirmation.jobId}
          </Link>
        ) : null}
      </div>
      {confirmation.status === 'pending' ? (
        <p className="text-sm text-muted-foreground">
          {confirmation.error
            ? `No se pudo encolar (${confirmation.error}); se vuelve a intentar sola mientras esta página está abierta.`
            : 'Se encola en unos segundos.'}
        </p>
      ) : confirmation.status === 'skipped' ? (
        <p className="text-sm text-muted-foreground">{confirmation.error}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {confirmation.rows.map((row) => {
            const before = original[row.rank - 1]
            return (
              <li key={row.rank} className="flex items-start gap-2 text-sm">
                <span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground tabular">{row.rank}</span>
                <span className="min-w-0 flex-1">
                  + {row.cards.map((card) => card.nameEs).join(', ')}
                  {before?.rate ? (
                    <span className="block text-xs text-muted-foreground">
                      en la búsqueda: {formatRateValue(before.rate.value)} ·{' '}
                      <RateDetails record={before.record} rate={before.rate} />
                    </span>
                  ) : null}
                </span>
                {!row.playable ? (
                  <span className="text-xs text-muted-foreground">el motor no juega ese mazo</span>
                ) : row.record && row.rate ? (
                  <RateCell record={row.record} rate={row.rate} />
                ) : (
                  <span className="text-right text-xs text-muted-foreground">
                    {row.rivalsPlayed} de {plural(confirmation.rivals, 'rival', 'rivales')}
                    {row.rivalsFailed > 0 ? (
                      <span className="block text-destructive">
                        {plural(row.rivalsFailed, 'falló', 'fallaron')} en el motor
                      </span>
                    ) : null}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        La mejor de muchas combinaciones medidas con las mismas partidas también es la que tuvo más suerte: las primeras
        se vuelven a jugar contra los mismos rivales con otras semillas y más partidas. Ese es el número para decidir;
        el porcentaje sale cuando jugó contra todos los rivales.
      </p>
    </div>
  )
}

function OptimizeResults({ job }: { job: JobDetail }) {
  const byId = new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const rows = job.optimize ?? []
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay resultados.</p>
  return (
    <>
      <OptimizeConfirmation job={job} />
      <ol className="divide-y rounded-lg border">
        {rows.map((row, position) => (
          <li key={row.cards.map((card) => card.engineId).join('+')} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex items-start gap-2">
              <span className="w-6 shrink-0 pt-0.5 text-xs text-muted-foreground tabular">{position + 1}</span>
              <span className="min-w-0 flex-1 text-sm font-medium">
                + {row.cards.map((card) => card.nameEs).join(', ')}
              </span>
              <RateCell record={row.record} rate={row.rate} />
            </div>
            {row.perEnemy.length > 1 ? (
              <details className="pl-8 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Por rival</summary>
                <ul>
                  {row.perEnemy.map((enemy) => (
                    <li key={enemy.snapshot} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate">vs {byId.get(enemy.snapshot)?.label ?? `#${enemy.snapshot}`}</span>
                      <span className="shrink-0 tabular">
                        {enemy.rate ? formatRateValue(enemy.rate.value) : 'sin datos'}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  )
}

const REPLAYS_SHOWN = 200

function Replays({ job }: { job: JobDetail }) {
  const [filter, setFilter] = useState('')
  const byId = useMemo(() => new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot])), [job.snapshots])
  const rows = useMemo(() => {
    const folded = fold(filter.trim())
    return job.replays
      .map((replay) => ({
        replay,
        a: replay.a !== null ? (byId.get(replay.a)?.label ?? null) : null,
        b: replay.b !== null ? (byId.get(replay.b)?.label ?? null) : null,
      }))
      .filter(({ a, b }) => folded === '' || fold(`${a ?? ''} ${b ?? ''}`).includes(folded))
  }, [job.replays, byId, filter])
  if (job.replays.length === 0) return null
  return (
    <Section title="Repeticiones">
      {job.replays.length > 10 ? (
        <SearchBox value={filter} onChange={setFilter} placeholder="Filtrar por mazo" />
      ) : null}
      <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
        {rows.slice(0, REPLAYS_SHOWN).map(({ replay, a, b }) => {
          const winner = replay.winner === 'tie' ? 'empate' : `ganó ${replay.winner === 'a' ? a : b}`
          return (
            <li key={replay.id}>
              <Link
                to={`/simulacion/repeticiones/${replay.id}`}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
              >
                <PlayIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {a ?? '?'} vs {b ?? '?'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    partida {replay.gameIndex + 1} · {winner}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
        {rows.length === 0 ? <li className="p-3 text-sm text-muted-foreground">Ninguna coincide.</li> : null}
      </ul>
      {rows.length > REPLAYS_SHOWN ? (
        <p className="text-xs text-muted-foreground">
          Se muestran {REPLAYS_SHOWN} de {formatNumber(rows.length)}: filtrá por mazo para ver el resto.
        </p>
      ) : null}
    </Section>
  )
}

function FailedChunks({ job }: { job: JobDetail }) {
  const failed = job.chunks.filter((chunk) => chunk.status === 'failed')
  if (failed.length === 0) return null
  const byId = new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  return (
    <Section title="Cruces que fallaron">
      <ul className="divide-y rounded-lg border border-destructive/40">
        {failed.map((chunk) => (
          <li key={chunk.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <span>
              {chunk.a !== null ? byId.get(chunk.a)?.label : '?'} vs {chunk.b !== null ? byId.get(chunk.b)?.label : '?'}{' '}
              <span className="text-xs text-muted-foreground">
                ({chunk.attempt} intentos, semilla {chunk.seed})
              </span>
            </span>
            {chunk.error ? (
              <code className="line-clamp-3 font-mono text-xs break-all text-destructive">{chunk.error}</code>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Skipped({ job }: { job: JobDetail }) {
  const skipped = job.snapshots.filter((snapshot) => !snapshot.simulable)
  if (skipped.length === 0) return null
  return (
    <Section title="Salteados por no simulables">
      <ul className="divide-y rounded-lg border">
        {skipped.map((snapshot) => (
          <li key={snapshot.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
            <span className="font-medium">{snapshot.label}</span>
            <span className="text-xs text-destructive">
              {snapshot.problems.map((problem) => problem.message).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** «Repetir»: the same decks, bots and games in the form; the same seed only when asked (it gives the same result). */
function rerunLink(job: JobDetail): string {
  const params = new URLSearchParams({ tipo: job.kind })
  const byId = new Map(job.snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const token = (id: number) => {
    const snapshot = byId.get(id)
    if (!snapshot) return null
    const energies = snapshot.energies.length > 0 ? { energies: snapshot.energies as never } : {}
    if (snapshot.deckId) return encodeSource({ deckId: snapshot.deckId, ...energies })
    if (snapshot.sourceType === 'tournament_list' && snapshot.sourceId) {
      return encodeSource({ listKey: snapshot.sourceId, ...energies })
    }
    return null
  }
  for (const id of job.sideA) {
    const value = token(id)
    if (value) params.append('a', value)
  }
  for (const id of job.sideB) {
    const value = token(id)
    if (value) params.append('b', value)
  }
  return `/simulacion/nueva?${params.toString()}`
}

export function SimulationDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const query = useSimulation(id)
  const cancel = useCancelSimulation()
  const remove = useDeleteSimulation()
  const archive = useArchiveSimulation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const job = query.data
  useLiveProgress(id, job ? isActive(job.status) : false)

  if (query.isPending) return <LoadingRows />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const current = job
  if (!current) return null
  const active = isActive(current.status)
  const fraction = progressFraction(current)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">{current.label}</h1>
          <StatusBadge status={current.status} />
          {current.priority > 0 ? <Badge variant="secondary">Adelantada</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <ProgressBar fraction={fraction} />
          <span className="shrink-0 text-xs text-muted-foreground tabular">{Math.floor(fraction * 100)} %</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatNumber(current.progress.gamesDone)} de {gamesLabel(current.progress.totalGames)} ·{' '}
          {current.progress.chunks.done}/{current.progress.chunks.total} cruces
          {current.progress.chunks.running > 0 ? ` · ${current.progress.chunks.running} jugándose` : ''}
          {current.progress.chunks.failed > 0 ? ` · ${current.progress.chunks.failed} fallaron` : ''}
          {active && current.progress.etaSeconds !== null
            ? ` · faltan ${formatDuration(current.progress.etaSeconds)}`
            : ''}
        </p>
        {current.status === 'queued' && current.progress.chunks.running === 0 ? (
          <p className="text-xs text-warning">En cola: arranca cuando un worker esté en línea.</p>
        ) : null}
        {current.error ? <p className="text-sm text-destructive">{current.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <SimulationPriorityButton job={current} />
          {active ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(current.id, {
                  onSuccess: () => toast.success('Simulación cancelada'),
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
            >
              <XCircleIcon data-icon="inline-start" />
              Cancelar
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link to={rerunLink(current)}>
              <RepeatIcon data-icon="inline-start" />
              Repetir con otros ajustes
            </Link>
          </Button>
          {current.status === 'done' || current.archived ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: current.id, archived: !current.archived },
                  {
                    onSuccess: (job) =>
                      toast.success(
                        job.archived
                          ? 'Archivada: no aparece en la lista, sus resultados siguen contando'
                          : 'Vuelve a la lista',
                      ),
                    onError: (error) => toast.error(errorMessage(error)),
                  },
                )
              }
            >
              {current.archived ? (
                <ArchiveRestoreIcon data-icon="inline-start" />
              ) : (
                <ArchiveIcon data-icon="inline-start" />
              )}
              {current.archived ? 'Desarchivar' : 'Archivar'}
            </Button>
          ) : null}
          {!active ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon data-icon="inline-start" />
              Borrar
            </Button>
          ) : null}
        </div>
      </div>

      <KeyValue
        items={[
          { label: 'Tipo', value: KIND_LABEL[current.kind] },
          { label: 'Bots', value: `${current.playersEs[0]} vs ${current.playersEs[1]}` },
          {
            label: current.kind === 'optimize' ? 'Partidas' : 'Por cruce',
            value: gamesLabel(current.gamesPerPair),
          },
          { label: 'Semilla', value: <code className="font-mono text-xs">{current.baseSeed}</code> },
          { label: 'Motor', value: <code className="font-mono text-xs">{shortSha(current.engineRev)}</code> },
          { label: 'Creada', value: formatDateTime(current.createdAt) },
          ...(current.finishedAt ? [{ label: 'Terminó', value: formatDateTime(current.finishedAt) }] : []),
        ]}
      />

      {current.kind === 'consistency' ? (
        <Section title="¿En qué turno está listo?">
          {current.consistency ? (
            <ConsistencyTable data={current.consistency} turns={current.consistency.maxTurn} />
          ) : (
            <p className="text-sm text-muted-foreground">Todavía no terminó.</p>
          )}
        </Section>
      ) : null}

      <Section
        title={current.kind === 'optimize' ? 'Combinaciones' : 'Resultados'}
        className={current.kind === 'consistency' ? 'hidden' : undefined}
      >
        <p className="text-xs text-muted-foreground">
          Victorias, derrotas y empates por separado; el porcentaje es victorias sobre partidas (un empate no suma) con
          su intervalo de Wilson al 95 %. Depende del bot ({current.playersEs.join(' vs ')}).
        </p>
        {current.kind === 'optimize' ? (
          <OptimizeResults job={current} />
        ) : (
          <Tabs defaultValue="list">
            <TabsList className="w-full">
              <TabsTrigger value="list">Ranking</TabsTrigger>
              <TabsTrigger value="grid">Tabla</TabsTrigger>
            </TabsList>
            <TabsContent value="list">
              <MatrixResults job={current} />
            </TabsContent>
            <TabsContent value="grid">
              <MatrixGrid job={current} />
            </TabsContent>
          </Tabs>
        )}
      </Section>

      <Replays job={current} />
      <FailedChunks job={current} />
      <Skipped job={current} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="¿Borrar la simulación?"
        description="Se borran sus resultados y repeticiones. Los mazos no se tocan."
        confirmLabel="Borrar"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(current.id)
            toast.success('Simulación borrada')
            navigate('/simulacion')
          } catch (error) {
            toast.error(errorMessage(error))
          }
        }}
      />
    </div>
  )
}
