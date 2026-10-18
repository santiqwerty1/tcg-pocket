/**
 * ¿Qué mazo llevo hoy? (Fase 15): the decks built in the game with three separate numbers — own matches, the
 * archetype against today's tournament meta and the latest Laboratorio score — sorted by the one chosen. They are
 * never combined: each comes from somewhere else (you, people in tournaments, bots).
 */

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { usePickToday, useRefreshLab } from '@/api/decks'
import { type LabRefresh, PICK_SORTS, type Pick, type PickMeta, type PickSort } from '@/api/schemas'
import { useRetryFailedSimulation } from '@/api/simulations'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatNumber } from '@/lib/format'
import { formatInterval, formatRateValue, ORIENTATIVE_BELOW } from '@/lib/matches'
import { formatDuration } from '@/lib/simulation'
import { formatDayEs, formatShare, staleTournaments } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

const SORT_LABEL: Record<PickSort, string> = { tournament: 'Torneo', matches: 'Mis partidas', lab: 'Laboratorio' }
/** The Laboratorio's bots by default (D-029): the score on each row is theirs; the others go apart. */
const LAB_BOT = 'e2'

function Line({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-baseline gap-2 text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>
      <span className={cn('w-20 shrink-0', active && 'font-medium')}>{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function Row({
  row,
  sort,
  mine,
}: {
  row: Pick['items'][number]
  sort: PickSort
  /** Fase 44: the tournament number is weighed by «mi meta» (how many rivals, and whether it is orientative). */
  mine: { matched: number; orientative: boolean } | null
}) {
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <Link to={`/mazos/${row.deck.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
          {row.deck.name}
        </Link>
        {row.archetype ? (
          <span className="shrink-0 truncate text-xs text-muted-foreground">{row.archetype.name}</span>
        ) : null}
      </div>
      <Line label={mine ? 'Torneo, tus rivales' : 'Torneo hoy'} active={sort === 'tournament'}>
        {row.tournament ? (
          <>
            <span className="font-semibold tabular">{formatRateValue(row.tournament.value)}</span>
            {row.tournament.ci95 ? (
              <>
                {' '}
                (IC&nbsp;{formatInterval(row.tournament.ci95)}
                {mine?.orientative || row.tournament.matches < ORIENTATIVE_BELOW ? ', orientativo' : ''})
              </>
            ) : null}{' '}
            · n = {formatNumber(row.tournament.matches)} partidas de su arquetipo; matchups con datos en{' '}
            {formatShare(row.tournament.coverage)} {mine ? 'de tus rivales' : 'del meta'}
          </>
        ) : (
          'sin datos de torneo'
        )}
      </Line>
      <Line label="Mis partidas" active={sort === 'matches'}>
        {row.mine?.rate ? (
          <>
            <span className="font-semibold tabular">{formatRateValue(row.mine.rate.value)}</span> · n ={' '}
            {formatNumber(row.mine.rate.games)}, IC&nbsp;{formatInterval(row.mine.rate.ci95)}
            {row.mine.rate.orientative ? ', orientativo' : ''}
          </>
        ) : (
          'sin partidas'
        )}
      </Line>
      <Line label="Laboratorio" active={sort === 'lab'}>
        {row.lab ? (
          <span className={cn(row.lab.stale && 'text-muted-foreground')}>
            <span className={cn('tabular', !row.lab.stale && 'font-semibold')}>{formatRateValue(row.lab.value)}</span> ·
            n = {formatNumber(row.lab.games)}, IC
            {'\u00a0'}
            {formatInterval(row.lab.ci95)} ·{' '}
            <Link to={`/laboratorio/${row.lab.jobId}`} className="text-primary hover:underline">
              #{row.lab.jobId}
            </Link>
            {` · ${row.lab.bot}`}
            {row.lab.stale
              ? ` · viejo: de la era ${row.lab.era}${row.lab.finishedAt ? `, del ${formatDateTime(row.lab.finishedAt)}` : ''}`
              : ''}
          </span>
        ) : row.labRunning || row.labFailed ? null : (
          `sin probar contra el meta con ${LAB_BOT}`
        )}
        {row.labFailed ? <LabFailed jobId={row.labFailed.jobId} first={row.lab === null} /> : null}
        {row.labRunning ? <LabRunning run={row.labRunning} first={row.lab === null} /> : null}
        {row.labOthers.map((other) => (
          <span key={other.bot} className="text-muted-foreground">
            {' · con '}
            {other.bot}: {formatRateValue(other.value)} (
            <Link to={`/laboratorio/${other.jobId}`} className="text-primary hover:underline">
              #{other.jobId}
            </Link>
            )
          </span>
        ))}
      </Line>
      {/* H-055: under the Laboratorio's line, never in place of it. */}
      {row.blindSpot ? <p className="pl-22 text-xs text-warning">{row.blindSpot.text}</p> : null}
    </li>
  )
}

/** Review of #109: the list's last test failed before playing it whole; «Actualizar todos» leaves it out. */
function LabFailed({ jobId, first }: { jobId: number; first: boolean }) {
  const retry = useRetryFailedSimulation()
  async function again() {
    try {
      await retry.mutateAsync(jobId)
      toast.success(`Prueba #${jobId}: se vuelve a jugar lo que falló.`)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <span className="text-warning">
      {first ? null : ' · '}
      <Link to={`/laboratorio/${jobId}`} className="hover:underline">
        la última prueba falló (#{jobId})
      </Link>{' '}
      <Button type="button" variant="link" size="xs" className="h-auto p-0" disabled={retry.isPending} onClick={again}>
        Reintentar lo que falló
      </Button>
    </span>
  )
}

/** «Actualizar todos»: the test of the list playing now, or waiting its turn. */
function LabRunning({ run, first }: { run: NonNullable<Pick['items'][number]['labRunning']>; first: boolean }) {
  const share = run.totalGames > 0 ? Math.floor((100 * run.gamesDone) / run.totalGames) : 0
  return (
    <span className="text-muted-foreground">
      {first ? null : ' · '}
      <Link to={`/laboratorio/${run.jobId}`} className="text-primary hover:underline">
        {run.status === 'queued' && run.gamesDone === 0 ? 'en cola' : `probando… ${share}${'\u00a0'}%`}
      </Link>
    </span>
  )
}

/**
 * «Actualizar todos» (14/10): tests against this era's meta of the decks without a Laboratorio score of this era. It
 * asks first, with how many decks, games and how long.
 */
function RefreshLab({ due }: { due: number }) {
  const refresh = useRefreshLab()
  const [plan, setPlan] = useState<LabRefresh | null>(null)
  async function ask() {
    try {
      setPlan(await refresh.mutateAsync(true))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  async function start() {
    try {
      const done = await refresh.mutateAsync(false)
      setPlan(null)
      toast.success(
        done.queued.length === 0
          ? 'No había nada para actualizar.'
          : `${done.queued.length === 1 ? 'Un mazo en prueba' : `${done.queued.length} mazos en prueba`} contra el meta de ${done.era}.`,
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const decks = plan?.queued.length ?? 0
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={ask} disabled={refresh.isPending}>
          Actualizar todos
        </Button>
        <span className="text-xs text-muted-foreground">
          {due === 1
            ? 'Un mazo sin puntaje del Laboratorio de esta era.'
            : `${due} mazos sin puntaje del Laboratorio de esta era.`}
        </span>
      </div>
      <ConfirmDialog
        open={plan !== null}
        onOpenChange={(open) => {
          if (!open) setPlan(null)
        }}
        title="Actualizar el Laboratorio"
        description={
          plan && decks > 0
            ? `${decks === 1 ? 'Un mazo' : `${decks} mazos`} contra el meta de ${plan.era}: ${formatNumber(plan.games)} partidas, ~${formatDuration(plan.estimatedSeconds)} con los workers de hoy. Las pruebas del Laboratorio van antes que las demás simulaciones.`
            : 'No hay nada para actualizar: cada mazo ya tiene un puntaje de esta era o se está probando.'
        }
        confirmLabel={decks > 0 ? 'Probar' : 'Cerrar'}
        pending={refresh.isPending}
        onConfirm={decks > 0 ? start : () => setPlan(null)}
      >
        {plan && (plan.sameList > 0 || plan.notSimulable.length > 0 || plan.running > 0 || plan.failed.length > 0) ? (
          <p className="text-xs text-muted-foreground">
            {[
              plan.running > 0 ? `${plan.running} ya en prueba` : null,
              plan.sameList > 0 ? `${plan.sameList} con la misma lista que otro` : null,
              plan.notSimulable.length > 0 ? `${plan.notSimulable.length} que el motor no puede jugar` : null,
              plan.failed.length > 0
                ? `${plan.failed.length} cuya última prueba falló (reintentala desde su fila)`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            .
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}

/** Phone review: the window's real dates (it ends at the newest tournament loaded) and a warning when that is old. */
function MetaWindow({ meta }: { meta: NonNullable<Pick['meta']> }) {
  const stale = staleTournaments(meta.to)
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Meta: {meta.kind === 'recent' ? '' : 'toda la era, '}
        {meta.from && meta.to ? `del ${formatDayEs(meta.from)} al ${formatDayEs(meta.to)} ` : ''}de {meta.era}, hasta el
        último torneo cargado ({formatNumber(meta.lists)} listas).
      </p>
      {stale ? <p className="text-xs text-warning">{stale}</p> : null}
    </>
  )
}

export function PickTodayPage() {
  const [sort, setSort] = useState<PickSort>('tournament')
  // Fase 44: weigh the rivals by the tournament meta or by «mi meta» (in the URL, so it stays on reload).
  const [search, setSearch] = useSearchParams()
  const meta: PickMeta = search.get('meta') === 'mio' ? 'mine' : 'tournament'
  const pick = usePickToday(sort, meta)
  const usedMine = pick.data?.weights.used === 'mine'
  return (
    <div className="flex flex-col gap-4">
      <Section title="¿Qué mazo llevo hoy?">
        <p className="text-sm text-muted-foreground">
          Tus mazos armados en el juego con tres números que no se mezclan: lo que el arquetipo debería sacar contra el
          meta de los últimos días (torneos, personas), tus partidas y el último puntaje del Laboratorio (bots).
        </p>
        <fieldset className="flex min-w-0 flex-wrap gap-1.5">
          <legend className="sr-only">Ordenar por</legend>
          {PICK_SORTS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={sort === value ? 'default' : 'outline'}
              aria-pressed={sort === value}
              onClick={() => setSort(value)}
            >
              {SORT_LABEL[value]}
            </Button>
          ))}
        </fieldset>
        <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
          <legend className="sr-only">Rivales del número de torneo</legend>
          <span className="text-xs text-muted-foreground">Rivales:</span>
          {(['tournament', 'mine'] as const).map((value) => (
            <Button
              key={value}
              size="xs"
              variant={meta === value ? 'secondary' : 'ghost'}
              aria-pressed={meta === value}
              onClick={() => {
                const next = new URLSearchParams(search)
                if (value === 'mine') next.set('meta', 'mio')
                else next.delete('meta')
                setSearch(next, { replace: true, preventScrollReset: true })
              }}
            >
              {value === 'mine' ? 'Los que me tocan' : 'Meta de torneos'}
            </Button>
          ))}
        </fieldset>
        {pick.data?.weights.mine ? (
          <p className={cn('text-xs', usedMine ? 'text-muted-foreground' : 'text-warning')}>
            {usedMine
              ? `Torneos (personas), pesado por tus ${pick.data.weights.mine.matched} rivales de la era: los matchups son de torneos y los pesos, de tus partidas. `
              : ''}
            {pick.data.weights.mine.text}
            {usedMine ? '' : ' Mientras tanto, el número de torneo usa el meta de torneos.'}
          </p>
        ) : pick.data?.meta ? (
          <MetaWindow meta={pick.data.meta} />
        ) : null}
        {pick.data && pick.data.labDue > 0 ? <RefreshLab due={pick.data.labDue} /> : null}
      </Section>
      {pick.isPending ? <LoadingRows rows={5} /> : null}
      {pick.isError ? <ErrorState error={pick.error} onRetry={() => pick.refetch()} /> : null}
      {pick.data && pick.data.items.length === 0 ? (
        <EmptyState
          title="Ningún mazo marcado como armado"
          description="Marcá en Mazos los que tenés armados en el juego."
        />
      ) : null}
      {pick.data && pick.data.items.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {pick.data.items.map((row) => (
            <Row
              key={row.deck.id}
              row={row}
              sort={sort}
              mine={usedMine && pick.data?.weights.mine ? pick.data.weights.mine : null}
            />
          ))}
        </ul>
      ) : null}
      {pick.data ? <p className="text-xs text-muted-foreground">{pick.data.note}</p> : null}
    </div>
  )
}
