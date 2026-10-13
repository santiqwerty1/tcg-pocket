/**
 * ¿Qué mazo armo después? (Fase 44): per tournament archetype, the exact list closest to the collection, what it
 * lacks and what finishing it costs in pack points, ranked by how the archetype does in tournaments (the low end of
 * its interval). Archetypes I already have a deck of go last.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { useNextBuild } from '@/api/decks'
import type { NextBuild } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatInterval, formatRateValue } from '@/lib/matches'
import { formatCount } from '@/lib/tournaments'

const REACH = [
  { value: 0, label: 'Hoy' },
  { value: 2, label: 'Hasta 2 copias' },
  { value: 8, label: 'Hasta 8' },
] as const

const copies = (count: number) => `${count} ${count === 1 ? 'copia' : 'copias'}`

/** Points of the priced copies, plus the ones without a point price, and what can be traded (review of #52). */
function costText(row: NextBuild['rows'][number]): string {
  const parts: string[] = []
  const points = row.points ?? 0
  if (points > 0 || row.unpriced === 0) parts.push(`${formatCount(points)} puntos de sobre`)
  if (row.unpriced > 0) parts.push(`${copies(row.unpriced)} sin precio en puntos`)
  if (row.tradeable > 0) {
    parts[parts.length - 1] +=
      ` · ${copies(row.tradeable)} ${row.tradeable === 1 ? 'intercambiable' : 'intercambiables'}`
  }
  return parts.join(' + ')
}

function Row({ row }: { row: NextBuild['rows'][number] }) {
  const { archetype, closest } = row
  const id = archetype.archetype.id ?? 'none'
  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <Link
          to={`/torneos/arquetipos/${encodeURIComponent(id)}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          {archetype.archetype.name}
        </Link>
        {row.built ? <Badge variant="secondary">ya tenés uno</Badge> : null}
        <span className="shrink-0 font-semibold tabular">
          {archetype.rate ? formatRateValue(archetype.rate.value) : 'sin datos'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCount(archetype.lists)} listas en torneos
        {archetype.rate ? `, IC\u00a0${formatInterval(archetype.rate.ci95)}` : ''} · la lista más cercana la jugaron{' '}
        {formatCount(closest.lists)}
      </p>
      <p className="text-sm">
        {closest.missingCopies === 0 ? (
          <span className="font-medium text-success">Se arma hoy con tu colección.</span>
        ) : (
          <>
            Falta: {closest.missing.map((item) => `${item.nameEs} ×${item.need - item.have}`).join(', ')}
            <span className="text-muted-foreground"> · {costText(row)}</span>
          </>
        )}
      </p>
      <Link
        to={`/torneos/listas/${encodeURIComponent(closest.key)}`}
        className="self-start text-xs text-primary hover:underline"
      >
        Ver la lista
      </Link>
    </li>
  )
}

export function NextBuildPage() {
  const [reach, setReach] = useState<number>(8)
  const next = useNextBuild(reach)
  return (
    <div className="flex flex-col gap-4">
      <Section title="¿Qué mazo armo después?">
        <p className="text-sm text-muted-foreground">
          Por arquetipo de torneo, la lista exacta más cercana a tu colección y cuánto cuesta terminarla. Primero los
          que mejor rinden en torneos, mirando el extremo bajo de su intervalo.
        </p>
        <fieldset className="flex min-w-0 flex-wrap gap-1.5">
          <legend className="sr-only">Cuánto puede faltar</legend>
          {REACH.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={reach === option.value ? 'default' : 'outline'}
              aria-pressed={reach === option.value}
              onClick={() => setReach(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
      </Section>
      {next.isPending ? <LoadingRows rows={5} /> : null}
      {next.isError ? <ErrorState error={next.error} onRetry={() => next.refetch()} /> : null}
      {next.data && next.data.rows.length === 0 ? (
        <EmptyState
          title="Nada tan cerca"
          description="Ninguna lista de torneo de la era queda a esa distancia de tu colección."
        />
      ) : null}
      {next.data && next.data.rows.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {next.data.rows.map((row) => (
            <Row key={row.archetype.archetype.id ?? row.closest.key} row={row} />
          ))}
        </ul>
      ) : null}
      {next.data ? (
        <p className="text-xs text-muted-foreground">
          {next.data.note} {next.data.scope.attribution}
        </p>
      ) : null}
    </div>
  )
}
