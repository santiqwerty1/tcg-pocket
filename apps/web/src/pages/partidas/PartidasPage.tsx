import { CalendarDaysIcon, ChartColumnIcon, HistoryIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { useMatches, useMatchSuggestions, useUnclassifiedCount } from '@/api/matches'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { MatchList } from './MatchList'
import { PendingMatches } from './PendingMatches'
import { QuickMatchForm } from './QuickMatchForm'
import { TodayStrip } from './TodayStrip'

/** 14/10: «Clasificar rivales», with how many matches wait for a rival (by the cards seen). */
function ClassifyLink() {
  // Self-review: only the count (the groups and their suggestions are the classify page's).
  const pending = useUnclassifiedCount().data?.matches ?? 0
  return (
    <Link to="/partidas/clasificar" className="-mt-4 self-start text-sm text-primary hover:underline">
      Clasificar rivales
      {pending > 0 ? ` (${pending === 1 ? 'una partida sin clasificar' : `${pending} partidas sin clasificar`})` : ''}
    </Link>
  )
}

/** Home screen («Hoy», Fase 26): what matters today, the quick-entry sheet, the last matches. */
export function PartidasPage() {
  const [params] = useSearchParams()
  const suggestions = useMatchSuggestions()
  const recent = useMatches({ limit: 10 })

  return (
    <div className="flex flex-col gap-6">
      <TodayStrip />
      <Section title="Nueva partida">
        {suggestions.isPending ? <LoadingRows rows={5} /> : null}
        {suggestions.isError && !suggestions.data ? (
          <ErrorState error={suggestions.error} onRetry={() => suggestions.refetch()} />
        ) : null}
        {suggestions.data && suggestions.data.decks.length === 0 ? (
          <EmptyState
            title="Primero necesitás un mazo"
            description="Las partidas se registran contra un mazo de la app. Importá tus listas o creá uno."
            action={
              <Button asChild>
                <Link to="/mazos/importar">Importar mazos</Link>
              </Button>
            }
          />
        ) : null}
        {suggestions.data && suggestions.data.decks.length > 0 ? (
          <QuickMatchForm suggestions={suggestions.data} preferredDeckId={params.get('mazo')} />
        ) : null}
      </Section>

      <PendingMatches />

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" asChild>
          <Link to="/partidas/estadisticas">
            <ChartColumnIcon data-icon="inline-start" />
            Estadísticas
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/partidas/historial">
            <HistoryIcon data-icon="inline-start" />
            Historial
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/partidas/semana">
            <CalendarDaysIcon data-icon="inline-start" />
            Semana
          </Link>
        </Button>
      </div>
      <ClassifyLink />

      <Section title="Últimas partidas">
        {recent.isPending ? <LoadingRows rows={3} /> : null}
        {recent.isError ? <ErrorState error={recent.error} onRetry={() => recent.refetch()} /> : null}
        {recent.data && recent.data.items.length === 0 ? (
          <EmptyState title="Todavía no registraste partidas" description="La primera que guardes aparece acá." />
        ) : null}
        {recent.data && recent.data.items.length > 0 ? <MatchList matches={recent.data.items} /> : null}
      </Section>
    </div>
  )
}
