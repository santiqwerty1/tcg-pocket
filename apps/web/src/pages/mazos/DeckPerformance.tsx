/**
 * Per-deck comparison (BRIEF M6, PLAN §3.6): own matches, tournament and simulation in three separate columns, each
 * with its own n, interval and source, «sin datos» where there is nothing, never one combined number. Below, the
 * breakdown of own matches by opponent, by who started and by revision.
 */
import { PlusIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useDeckComparison, useMatchStats } from '@/api/matches'
import type { ComparisonColumn } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { OrientativeBadge, RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatInterval, formatRateValue, formatRecord, formatSample } from '@/lib/matches'
import { cn } from '@/lib/utils'

function ColumnCard({ column }: { column: ComparisonColumn }) {
  const { rate } = column
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1 rounded-lg border p-2.5', !column.available && 'border-dashed')}
      data-source={column.source}
    >
      <div className="text-xs font-medium text-muted-foreground">{column.label}</div>
      {rate ? (
        <>
          <div className="text-xl font-semibold tabular">{formatRateValue(rate.value)}</div>
          {rate.orientative ? <OrientativeBadge /> : null}
          <div className="text-xs text-muted-foreground tabular">{formatSample(rate)}</div>
          <div className="text-xs text-muted-foreground tabular">IC {formatInterval(rate.ci95)}</div>
          {column.record ? (
            <div className="text-xs text-muted-foreground tabular">{formatRecord(column.record)}</div>
          ) : null}
        </>
      ) : (
        <div className="text-sm font-medium text-muted-foreground">sin datos</div>
      )}
      <p className="mt-auto text-[11px] leading-tight text-muted-foreground">{column.note}</p>
    </div>
  )
}

export function DeckPerformance({ deckId, archived }: { deckId: string; archived: boolean }) {
  const comparison = useDeckComparison(deckId)
  const stats = useMatchStats({ deckId })
  const games = stats.data?.overall.rate?.games ?? 0

  return (
    <Section
      title="Rendimiento"
      action={
        archived ? null : (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/partidas?mazo=${encodeURIComponent(deckId)}`}>
              <PlusIcon data-icon="inline-start" />
              Registrar partida
            </Link>
          </Button>
        )
      }
    >
      {comparison.isPending ? <LoadingRows rows={1} /> : null}
      {comparison.isError ? <ErrorState error={comparison.error} onRetry={() => comparison.refetch()} /> : null}
      {comparison.data ? (
        <div className="grid grid-cols-3 gap-2">
          {comparison.data.columns.map((column) => (
            <ColumnCard key={column.source} column={column} />
          ))}
        </div>
      ) : null}

      {stats.data && games > 0 ? (
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">Mis partidas por rival</h3>
            <RateRows
              rows={stats.data.byOpponent.map((row) => ({
                id: row.key ?? '__none__',
                label: row.label,
                record: row.record,
                rate: row.rate,
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">¿Quién empezó?</h3>
            <RateRows
              rows={stats.data.byWentFirst
                .filter((row) => row.rate !== null)
                .map((row) => ({ id: row.key, label: row.label, record: row.record, rate: row.rate }))}
            />
          </div>
          {stats.data.byRevision.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">Por revisión del mazo</h3>
              <RateRows
                rows={stats.data.byRevision.map((row) => ({
                  id: String(row.revision),
                  label: `Revisión #${row.revision ?? '?'}`,
                  record: row.record,
                  rate: row.rate,
                }))}
              />
            </div>
          ) : null}
          <Link
            to={`/partidas/historial?mazo=${encodeURIComponent(deckId)}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Ver {games === 1 ? 'la partida' : `las ${games} partidas`}
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
