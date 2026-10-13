/**
 * Meta semanal (Fase 11): what is played more and less in tournaments, the last week against the one before, by
 * archetype and by card. Shares of lists only; a change is «claro» when a two-proportion test says it is not noise.
 */
import { ArrowDownIcon, ArrowUpIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { MetaTrends } from '@/api/schemas'
import { useMetaTrends } from '@/api/tournaments'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PERCENT } from '@/lib/format'
import { formatInterval, formatRateValue, formatSample } from '@/lib/matches'
import { formatDayEs, formatShare, scopeFromSearch, scopeSearch, staleTournaments } from '@/lib/tournaments'
import { cn } from '@/lib/utils'

const DAYS = [7, 14] as const

function tournamentsLabel(count: number): string {
  return count === 1 ? '1 torneo' : `${count} torneos`
}

function points(value: number): string {
  const text = formatShare(Math.abs(value)).replace(PERCENT, '')
  return `${value >= 0 ? '+' : '−'}${text} pts`
}

interface Row {
  key: string
  name: string
  to?: string
  now: { lists: number; share: number }
  before: { lists: number; share: number }
  delta: number
  clear: boolean
  isNew?: boolean
  extra?: string
}

/** `shareOnly`: no week before to compare with, so the row shows this week's share and nothing else. */
function Rows({ rows, empty, shareOnly = false }: { rows: Row[]; empty: string; shareOnly?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-0.5 px-3 py-2">
          <div className="flex items-baseline gap-2">
            {row.to ? (
              <Link to={row.to} className="min-w-0 flex-1 truncate font-medium hover:underline">
                {row.name}
              </Link>
            ) : (
              <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
            )}
            {row.isNew ? <Badge variant="outline">nuevo</Badge> : null}
            <span
              className={cn(
                'shrink-0 font-semibold tabular',
                !shareOnly && row.clear
                  ? row.delta > 0
                    ? 'text-success'
                    : 'text-destructive'
                  : !shareOnly && 'text-muted-foreground',
              )}
            >
              {shareOnly ? formatShare(row.now.share) : points(row.delta)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {shareOnly
              ? `${row.now.lists} listas`
              : `${formatShare(row.now.share)} (${row.now.lists}) · antes ${formatShare(row.before.share)} (${row.before.lists})${row.clear ? ' · cambio claro' : ' · puede ser ruido'}`}
            {row.extra ? ` · ${row.extra}` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

function split(data: MetaTrends, search: string) {
  const archetypes: Row[] = data.archetypes.map((row) => ({
    key: row.archetype.id ?? '__none__',
    name: row.archetype.name,
    to: `/torneos/arquetipos/${encodeURIComponent(row.archetype.id ?? 'none')}${search}`,
    now: row.now,
    before: row.before,
    delta: row.delta,
    clear: row.clear,
    isNew: row.isNew,
    // Phone review: every percentage with its n and interval (and «orientativo» under 30).
    extra: row.rate
      ? `gana ${formatRateValue(row.rate.value)} en esos días (${formatSample(row.rate)}, IC\u00a0${formatInterval(row.rate.ci95)}${row.rate.orientative ? ', orientativo' : ''})`
      : undefined,
  }))
  const cards: Row[] = data.cards.map((row) => ({
    key: row.groupId,
    name: row.nameEs,
    to: `/cartas/${encodeURIComponent(row.groupId)}`,
    now: row.now,
    before: row.before,
    delta: row.delta,
    clear: row.clear,
  }))
  const up = (rows: Row[]) => rows.filter((row) => row.delta > 0).slice(0, 10)
  const down = (rows: Row[]) =>
    rows
      .filter((row) => row.delta < 0)
      .reverse()
      .slice(0, 10)
  return { archetypesUp: up(archetypes), archetypesDown: down(archetypes), cardsUp: up(cards), cardsDown: down(cards) }
}

export function TrendsPage() {
  const [params] = useSearchParams()
  const scope = scopeFromSearch(params)
  const search = scopeSearch(scope)
  const [days, setDays] = useState<number>(7)
  const trends = useMetaTrends(scope, days)
  if (trends.isPending) return <LoadingRows />
  if (trends.isError) return <ErrorState error={trends.error} onRetry={() => trends.refetch()} />
  const data = trends.data
  const rows = split(data, search)
  const range = (w: MetaTrends['now']) =>
    `${formatDayEs(w.from)} – ${formatDayEs(new Date(new Date(w.to).getTime() - 1).toISOString())}`
  // The window ends a day after the newest tournament loaded (domain `metaTrends`).
  // Review of #87: a closed era is old on purpose; only the current one warns.
  const stale = data.scope.era.current
    ? staleTournaments(new Date(new Date(data.now.to).getTime() - 86_400_000).toISOString())
    : null

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Meta semanal"
        action={
          <div className="flex gap-1">
            {DAYS.map((value) => (
              <Button
                key={value}
                size="xs"
                variant={days === value ? 'default' : 'outline'}
                onClick={() => setDays(value)}
              >
                {value} días
              </Button>
            ))}
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          {range(data.now)}, hasta el último torneo cargado: {tournamentsLabel(data.now.tournaments)}, {data.now.lists}{' '}
          listas. Antes ({range(data.before)}): {tournamentsLabel(data.before.tournaments)}, {data.before.lists} listas.
          Cambio en puntos de cuota de listas; «claro» si el cambio pasa una prueba de dos proporciones que cuenta cada
          torneo como un bloque (un torneo grande no arrastra todo) y, entre todos los arquetipos y cartas, se espera
          que como mucho 1 de cada 20 «claros» sea ruido.
        </p>
        {stale ? <p className="text-xs text-warning">{stale}</p> : null}
        {data.before.lists === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No hay torneos de la era en la ventana anterior: todavía no se puede comparar.
          </p>
        ) : null}
      </Section>
      {data.before.lists === 0 ? (
        <Section title="Lo más jugado en esos días">
          <Rows
            rows={rows.archetypesUp.map((row) => ({ ...row, clear: false, isNew: false }))}
            empty="Sin listas en esos días."
            shareOnly
          />
        </Section>
      ) : (
        <Comparison rows={rows} />
      )}
      <p className="text-xs text-muted-foreground">{data.attribution}.</p>
    </div>
  )
}

function Comparison({ rows }: { rows: ReturnType<typeof split> }) {
  return (
    <>
      <Section
        title={
          <span className="flex items-center gap-2">
            <ArrowUpIcon className="size-4 text-success" />
            Suben
          </span>
        }
      >
        <Rows rows={rows.archetypesUp} empty="Ningún arquetipo subió." />
      </Section>
      <Section
        title={
          <span className="flex items-center gap-2">
            <ArrowDownIcon className="size-4 text-destructive" />
            Bajan
          </span>
        }
      >
        <Rows rows={rows.archetypesDown} empty="Ningún arquetipo bajó." />
      </Section>
      <Section
        title={
          <span className="flex items-center gap-2">
            <SparklesIcon className="size-4" />
            Cartas que suben
          </span>
        }
      >
        <Rows rows={rows.cardsUp} empty="Ninguna carta subió." />
      </Section>
      <Section title="Cartas que bajan">
        <Rows rows={rows.cardsDown} empty="Ninguna carta bajó." />
      </Section>
    </>
  )
}
