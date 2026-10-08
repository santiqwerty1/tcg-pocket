/**
 * ¿Qué mazo llevo hoy? (Fase 15): the decks built in the game with three separate numbers — own matches, the
 * archetype against today's tournament meta and the latest Laboratorio score — sorted by the one chosen. They are
 * never combined: each comes from somewhere else (you, people in tournaments, bots).
 */

import { useState } from 'react'
import { Link } from 'react-router'
import { usePickToday } from '@/api/decks'
import { PICK_SORTS, type Pick, type PickSort } from '@/api/schemas'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatInterval, formatRateValue } from '@/lib/matches'
import { formatShare } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

const SORT_LABEL: Record<PickSort, string> = { tournament: 'Torneo', matches: 'Mis partidas', lab: 'Laboratorio' }

function Line({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-baseline gap-2 text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>
      <span className={cn('w-20 shrink-0', active && 'font-medium')}>{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function Row({ row, sort }: { row: Pick['items'][number]; sort: PickSort }) {
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
      <Line label="Torneo hoy" active={sort === 'tournament'}>
        {row.tournament ? (
          <>
            <span className="font-semibold tabular">{formatRateValue(row.tournament.value)}</span> · n ={' '}
            {row.tournament.matches} partidas de su arquetipo; matchups con datos en{' '}
            {formatShare(row.tournament.coverage)} del meta
          </>
        ) : (
          'sin datos de torneo'
        )}
      </Line>
      <Line label="Mis partidas" active={sort === 'matches'}>
        {row.mine?.rate ? (
          <>
            <span className="font-semibold tabular">{formatRateValue(row.mine.rate.value)}</span> · n ={' '}
            {row.mine.rate.games}, IC {formatInterval(row.mine.rate.ci95)}
          </>
        ) : (
          'sin partidas'
        )}
      </Line>
      <Line label="Laboratorio" active={sort === 'lab'}>
        {row.lab ? (
          <>
            <span className="font-semibold tabular">{formatRateValue(row.lab.value)}</span> · n = {row.lab.games}, IC{' '}
            {formatInterval(row.lab.ci95)} ·{' '}
            <Link to={`/laboratorio/${row.lab.jobId}`} className="text-primary hover:underline">
              #{row.lab.jobId}
            </Link>
          </>
        ) : (
          'sin probar contra el meta'
        )}
      </Line>
    </li>
  )
}

export function PickTodayPage() {
  const [sort, setSort] = useState<PickSort>('tournament')
  const pick = usePickToday(sort)
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
        {pick.data?.meta ? (
          <p className="text-xs text-muted-foreground">
            Meta: {pick.data.meta.kind === 'recent' ? `últimos ${pick.data.meta.days} días de` : 'toda la era'}{' '}
            {pick.data.meta.era} ({pick.data.meta.lists} listas).
          </p>
        ) : null}
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
            <Row key={row.deck.id} row={row} sort={sort} />
          ))}
        </ul>
      ) : null}
      {pick.data ? <p className="text-xs text-muted-foreground">{pick.data.note}</p> : null}
    </div>
  )
}
