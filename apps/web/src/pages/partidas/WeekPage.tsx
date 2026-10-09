/**
 * Tu semana (Fase 32): Monday to Sunday at a glance — matches against the week before, decks and rivals, games
 * against the bot, practice, what the PC did and how the meta moved. ‹ › walk the weeks (`?semana=`).
 */
import { ChevronLeftIcon, ChevronRightIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useWeekSummary } from '@/api/weekly'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { formatRecord } from '@/lib/matches'

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

export function WeekPage() {
  const [params, setParams] = useSearchParams()
  const week = params.get('semana')
  const summary = useWeekSummary(week)
  const go = (start: string) => setParams({ semana: start }, { replace: true })

  if (summary.isPending) return <LoadingRows rows={6} />
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
  const data = summary.data
  const { matches, bot, practice } = data
  const diff = matches.overall.games > 0 && matches.previousWeek.games > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="Semana anterior" onClick={() => go(data.week.previous)}>
          <ChevronLeftIcon />
        </Button>
        <div className="text-center">
          <p className="font-semibold">
            {data.week.current ? 'Esta semana' : 'Semana'} del {data.week.label}
          </p>
          <p className="text-sm text-muted-foreground">{data.headline}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Semana siguiente"
          disabled={!data.week.next}
          onClick={() => data.week.next && go(data.week.next)}
        >
          <ChevronRightIcon />
        </Button>
      </div>

      <Section title="Partidas">
        {matches.overall.games === 0 ? (
          <p className="text-sm text-muted-foreground">No registraste partidas esta semana.</p>
        ) : (
          <div className="divide-y rounded-lg border px-3">
            <Line label="Récord">
              <span className="font-semibold">{formatRecord(matches.overall.record)}</span>
              <span className="block text-xs text-muted-foreground">{matches.overall.text}</span>
            </Line>
            {diff ? (
              <Line label="La semana anterior">
                {formatRecord(matches.previousWeek.record)}
                <span className="block text-xs text-muted-foreground">{matches.previousWeek.text}</span>
              </Line>
            ) : null}
            {matches.byDeck.map((row) => (
              <Line key={row.deckId} label={row.deck}>
                <Link to={`/mazos/${row.deckId}`} className="hover:underline">
                  {formatRecord(row.record)}
                </Link>
              </Line>
            ))}
            {matches.bestRival ? (
              <Line label="Mejor contra">
                {matches.bestRival.label} ({formatRecord(matches.bestRival.record)})
              </Line>
            ) : null}
            {matches.worstRival ? (
              <Line label="Peor contra">
                {matches.worstRival.label} ({formatRecord(matches.worstRival.record)})
              </Line>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Práctica">
        <div className="divide-y rounded-lg border px-3">
          <Line label="Contra el bot">
            {bot.games === 0
              ? '—'
              : `${bot.games} ${bot.games === 1 ? 'partida' : 'partidas'}: ${bot.wins} ganadas, ${bot.losses} perdidas${bot.ties > 0 ? `, ${bot.ties} empates` : ''}`}
            {bot.coachAgreement !== null ? (
              <span className="block text-xs text-muted-foreground">
                Con el entrenador: {bot.coachAgreement} % de jugadas como las suyas
              </span>
            ) : null}
          </Line>
          <Line label="Situaciones">
            {practice.situationsTried === 0
              ? '—'
              : `${practice.situationsSolved} ${practice.situationsSolved === 1 ? 'resuelta' : 'resueltas'} de ${practice.situationsTried}`}
          </Line>
          <Line label="Ejercicios de cálculo">
            {practice.drillsAnswered === 0 ? '—' : `${practice.drillsCorrect} de ${practice.drillsAnswered} bien`}
          </Line>
        </div>
      </Section>

      <Section title="La PC y la colección">
        <div className="divide-y rounded-lg border px-3">
          <Line label="Simulaciones terminadas">{data.work.simulations || '—'}</Line>
          <Line label="Pruebas del laboratorio">{data.work.lab || '—'}</Line>
          <Line label="Importaciones del CSV">{data.imports || '—'}</Line>
        </div>
      </Section>

      {data.meta && (data.meta.rising.length > 0 || data.meta.falling.length > 0) ? (
        <Section title="El meta en torneos (últimos 7 días)">
          <ul className="flex flex-col gap-1 text-sm">
            {data.meta.rising.map((move) => (
              <li key={`up-${move.name}`} className="flex items-center gap-2">
                <TrendingUpIcon className="size-4 text-success" aria-hidden="true" />
                {move.name} <span className="text-xs text-muted-foreground">+{move.delta} puntos de cuota</span>
              </li>
            ))}
            {data.meta.falling.map((move) => (
              <li key={`down-${move.name}`} className="flex items-center gap-2">
                <TrendingDownIcon className="size-4 text-destructive" aria-hidden="true" />
                {move.name} <span className="text-xs text-muted-foreground">{move.delta} puntos de cuota</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
