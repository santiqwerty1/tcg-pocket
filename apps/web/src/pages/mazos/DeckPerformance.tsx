/**
 * Per-deck comparison (BRIEF M6, PLAN §3.6): own matches, tournament and simulation as three blocks, each under its
 * seal (M, T, B) with its own n, interval and record, «sin datos» where there is nothing, never one combined number,
 * and one legend for the three. Below, the breakdown of own matches by opponent, by who started and by revision.
 * The way to log a match with the deck is the fixed row's («Registrar partida», `frame.ts`).
 */
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useUpdateDeck } from '@/api/decks'
import { useDeckComparison, useMatchStats } from '@/api/matches'
import type { ComparisonColumn } from '@/api/schemas'
import { useArchetypes } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { RateRows } from '@/components/RateSummary'
import { Section } from '@/components/Section'
import { TurnOrderCard } from '@/components/TurnOrderCard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { SourceLane, SourceLanes } from './SourceLanes'

const GUESS = '__guess__'

/**
 * The tournament block: its headline and its rows (the exact list and the archetype, drawn by the block itself) and,
 * under them, the way to the deck's archetype and the choice of it. Without an archetype to choose in the era there
 * is nothing to add.
 */
function TournamentLane({
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
  const choices = archetypes.data?.rows ?? []
  if (choices.length === 0) return <SourceLane column={column} />

  async function choose(value: string) {
    try {
      await update.mutateAsync({ id: deckId, patch: { tournamentArchetypeId: value === GUESS ? null : value } })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <SourceLane column={column}>
      {/* Only when the archetype has lists in this era: an id kept from an older era would open a 404. */}
      {tournamentArchetypeId && choices.some((row) => row.archetype.id === tournamentArchetypeId) ? (
        // A line of text is 20 px tall: the link takes the 44 px of a finger, with its words in the middle.
        <Link
          to={`/torneos/arquetipos/${encodeURIComponent(tournamentArchetypeId)}`}
          className="flex min-h-11 items-center text-sm underline"
        >
          Ver el arquetipo en Torneos
        </Link>
      ) : null}
      <Select value={tournamentArchetypeId ?? GUESS} onValueChange={choose}>
        {/* Inside the block the select is narrower than it was: its value goes on a second line when it takes
            one, instead of being cut (the kit's trigger is one line of 44 px that hides what does not fit). */}
        <SelectTrigger
          aria-label="Arquetipo del mazo en torneos"
          className="w-full text-left whitespace-normal data-[size=default]:h-auto data-[size=default]:min-h-11 *:data-[slot=select-value]:line-clamp-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GUESS}>Arquetipo: sugerido por las listas más parecidas</SelectItem>
          {choices
            .filter((row) => row.archetype.id !== null)
            .map((row) => (
              <SelectItem key={row.archetype.id} value={row.archetype.id as string}>
                {row.archetype.name} ({formatNumber(row.lists)})
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </SourceLane>
  )
}

export function DeckPerformance({
  deckId,
  tournamentArchetypeId = null,
}: {
  deckId: string
  tournamentArchetypeId?: string | null
}) {
  const comparison = useDeckComparison(deckId)
  const stats = useMatchStats({ deckId })
  const games = stats.data?.overall.rate?.games ?? 0

  return (
    <Section title="Rendimiento">
      {/* One row for each source that is coming. */}
      {comparison.isPending ? <LoadingRows rows={3} /> : null}
      {comparison.isError ? <ErrorState error={comparison.error} onRetry={() => comparison.refetch()} /> : null}
      {comparison.data ? (
        <SourceLanes
          columns={comparison.data.columns}
          lane={(column) =>
            column.source === 'tournament' ? (
              <TournamentLane deckId={deckId} column={column} tournamentArchetypeId={tournamentArchetypeId} />
            ) : null
          }
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
            className="text-sm text-primary underline underline-offset-4"
          >
            Ver {games === 1 ? 'la partida' : `las ${formatNumber(games)} partidas`}
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
