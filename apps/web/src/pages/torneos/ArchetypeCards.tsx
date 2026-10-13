/**
 * Fase 44: what the archetype's lists play — the núcleo and its slots, the techs with the difference they make (with
 * its interval and whether it is clear after looking at every card), two copies against one, and how often its lists
 * reach the top 8. The server runs a bootstrap, so the section asks for it only when opened.
 */

import type { RateDifference, RecordRow } from '@/api/schemas'
import type { TournamentScopeParams } from '@/api/tournaments'
import { useArchetypeCards } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { OrientativeBadge, RateDetails } from '@/components/RateSummary'
import { Fold } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { formatRateValue } from '@/lib/matches'
import { cardLabels, formatShare } from '@/lib/tournaments'

const slotsFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

/** One side of a comparison with its own n, interval and «orientativo» (review of #17: every % with its n and IC). */
function Side({ label, row }: { label: string; row: RecordRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="w-12 shrink-0">{label}</span>
      <span className="font-medium text-foreground tabular">
        {row.rate ? formatRateValue(row.rate.value) : 'sin datos'}
      </span>
      {row.rate ? <RateDetails record={row.record} rate={row.rate} /> : null}
      {row.rate?.orientative ? <OrientativeBadge /> : null}
    </div>
  )
}

function Difference({ difference }: { difference: RateDifference | null }) {
  if (!difference) return <span>Sin datos suficientes de los dos lados para comparar.</span>
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {difference.text}
      {difference.orientative ? <OrientativeBadge /> : null}
      {difference.clear ? (
        <Badge variant={difference.value > 0 ? 'default' : 'destructive'}>
          {difference.value > 0 ? 'rinde más' : 'rinde menos'}
        </Badge>
      ) : null}
    </span>
  )
}

function Body({ id, scope }: { id: string; scope: TournamentScopeParams }) {
  const cards = useArchetypeCards(id, scope)
  if (cards.isPending) return <LoadingRows rows={4} />
  if (cards.isError) return <ErrorState error={cards.error} onRetry={() => cards.refetch()} />
  const data = cards.data
  const labels = cardLabels([...data.core, ...data.techs, ...data.copies])
  const label = (row: { groupId: string; nameEs: string }) => labels.get(row.groupId) ?? row.nameEs
  return (
    <div className="flex flex-col gap-4">
      {data.conversion ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Llegada al top {data.conversion.top}</h3>
          <p className="text-sm">{data.conversion.text}</p>
          {data.conversion.tournaments > 0 ? (
            <p className="text-xs text-muted-foreground">
              En {data.conversion.tournaments} {data.conversion.tournaments === 1 ? 'torneo' : 'torneos'} de{' '}
              {data.conversion.minPlayers} jugadores o más que publicaron casi todas sus listas. Cada lista se compara
              con el resto de las listas de su torneo: un arquetipo muy jugado llena el top por ser muy jugado, y en un
              torneo chico el top es más fácil.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">Núcleo</h3>
        <p className="text-xs text-muted-foreground">
          Lo que juega el 90&nbsp;% de las listas o más: ocupa ~{slotsFormat.format(data.coreSlots)} de los 20 lugares y
          quedan ~{slotsFormat.format(data.freeSlots)} libres.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {data.core.map((row) => (
            <li key={row.groupId} className="rounded-md border px-2 py-1 text-xs">
              {label(row)}{' '}
              <span className="text-muted-foreground tabular">×{slotsFormat.format(row.averageCopies)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">Techs</h3>
        {data.techs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguna carta la juega entre el 10 y el 90&nbsp;% de las listas.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.techs.map((row) => (
              <li key={row.groupId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{label(row)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">
                    {formatShare(row.share)} de las listas
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  <Side label="Con" row={row.with} />
                  <Side label="Sin" row={row.without} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <Difference difference={row.difference} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.copies.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">Dos copias contra una</h3>
          <ul className="divide-y rounded-lg border">
            {data.copies.map((row) => (
              <li key={row.groupId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <span className="font-medium">{label(row)}</span>
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  <Side label="Con 2" row={row.two} />
                  <Side label="Con 1" row={row.one} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <Difference difference={row.difference} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {data.incomplete > 0
          ? `${data.incomplete} ${data.incomplete === 1 ? 'lista queda afuera' : 'listas quedan afuera'}: tienen cartas que el catálogo todavía no conoce. `
          : ''}
        {data.note}
      </p>
    </div>
  )
}

export function ArchetypeCards({ id, scope }: { id: string; scope: TournamentScopeParams }) {
  return (
    <Fold
      id="nucleo"
      title="Núcleo, techs y top 8"
      hint="Qué cartas cambian el récord"
      remember="tcg.fold.archetype-cards"
    >
      <Body id={id} scope={scope} />
    </Fold>
  )
}
