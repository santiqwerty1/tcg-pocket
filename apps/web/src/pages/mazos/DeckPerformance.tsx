/**
 * Per-deck comparison (BRIEF M6, PLAN §3.6): own matches, tournament and simulation in three separate columns, each
 * with its own n, interval and source, «sin datos» where there is nothing, never one combined number. Below, the
 * breakdown of own matches by opponent, by who started and by revision.
 */
import { PlusIcon } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useUpdateDeck } from '@/api/decks'
import { useDeckComparison, useMatchStats } from '@/api/matches'
import type { ComparisonColumn } from '@/api/schemas'
import { useArchetypes } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { OrientativeBadge, RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { TurnOrderCard } from '@/components/TurnOrderCard'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
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
          {/* A narrow column (82 px at 360): «IC» may go above its interval, which never breaks. */}
          <div className="text-xs text-muted-foreground tabular">IC {formatInterval(rate.ci95)}</div>
          {column.record ? (
            <div className="text-xs text-muted-foreground tabular">{formatRecord(column.record)}</div>
          ) : null}
        </>
      ) : (
        <div className="text-sm font-medium text-muted-foreground">sin datos</div>
      )}
      <p className="mt-auto break-words text-[11px] leading-tight text-muted-foreground">{column.note}</p>
    </div>
  )
}

const GUESS = '__guess__'

/** The tournament column in detail: exact list and archetype as separate rows, and the archetype of the deck. */
function TournamentDetail({
  deckId,
  column,
  tournamentArchetypeId,
}: {
  deckId: string
  column: ComparisonColumn
  tournamentArchetypeId: string | null
}) {
  const archetypes = useArchetypes({})
  const update = useUpdateDeck()
  const rows = column.rows ?? []
  if (rows.length === 0 && (archetypes.data?.rows.length ?? 0) === 0) return null

  async function choose(value: string) {
    try {
      await update.mutateAsync({ id: deckId, patch: { tournamentArchetypeId: value === GUESS ? null : value } })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">Torneo, en detalle</h3>
      {rows.length > 0 ? (
        <RateRows
          rows={rows.map((row) => ({
            id: row.label,
            label: row.label,
            hint: row.note,
            record: row.record,
            rate: row.rate,
          }))}
        />
      ) : null}
      {/* Only when the archetype has lists in this era: an id kept from an older era would open a 404. */}
      {tournamentArchetypeId && archetypes.data?.rows.some((row) => row.archetype.id === tournamentArchetypeId) ? (
        <Link to={`/torneos/arquetipos/${encodeURIComponent(tournamentArchetypeId)}`} className="text-sm underline">
          Ver el arquetipo en Torneos
        </Link>
      ) : null}
      {archetypes.data && archetypes.data.rows.length > 0 ? (
        <Select value={tournamentArchetypeId ?? GUESS} onValueChange={choose}>
          <SelectTrigger aria-label="Arquetipo del mazo en torneos" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GUESS}>Arquetipo: sugerido por las listas más parecidas</SelectItem>
            {archetypes.data.rows
              .filter((row) => row.archetype.id !== null)
              .map((row) => (
                <SelectItem key={row.archetype.id} value={row.archetype.id as string}>
                  {row.archetype.name} ({formatNumber(row.lists)})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

export function DeckPerformance({
  deckId,
  archived,
  tournamentArchetypeId = null,
}: {
  deckId: string
  archived: boolean
  tournamentArchetypeId?: string | null
}) {
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
      {/* H-055: the simulation column's «posible punto ciego del bot», across the three columns (they are narrow). */}
      {comparison.data?.columns.map((column) =>
        column.source === 'simulation' && column.blindSpot ? (
          <p key="blind-spot" className="text-xs text-warning">
            {column.blindSpot.text}
          </p>
        ) : null,
      )}
      {comparison.data?.columns.find((column) => column.source === 'tournament') ? (
        <TournamentDetail
          deckId={deckId}
          column={comparison.data.columns.find((column) => column.source === 'tournament') as ComparisonColumn}
          tournamentArchetypeId={tournamentArchetypeId}
        />
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
            <h3 className="text-sm font-medium">¿Importa empezar?</h3>
            {stats.data.turnOrder ? (
              <TurnOrderCard turnOrder={stats.data.turnOrder} coinAdjusted={stats.data.coinAdjusted} />
            ) : null}
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
            Ver {games === 1 ? 'la partida' : `las ${formatNumber(games)} partidas`}
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
