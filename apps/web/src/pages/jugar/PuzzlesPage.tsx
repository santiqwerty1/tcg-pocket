/**
 * Situaciones para resolver (Fase 24): the moments of your finished games with the coach where it saw a much better
 * move («Peor» or «Error grave»). Never tried first, then the ones you failed, the solved ones last.
 */
import { CheckIcon, TargetIcon } from 'lucide-react'
import { Link } from 'react-router'
import { usePuzzles } from '@/api/puzzles'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { VerdictBadge } from './Coach'

export function PuzzlesPage() {
  const puzzles = usePuzzles()
  if (puzzles.isPending) return <LoadingRows rows={5} />
  if (puzzles.isError) return <ErrorState error={puzzles.error} onRetry={() => void puzzles.refetch()} />
  const { items, counts, coachGames } = puzzles.data
  const first = items.find((item) => !item.solved)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Momentos de tus partidas con el modo entrenador en los que había una jugada mucho mejor. Volvés a esa mesa,
        elegís qué hacer y te dice cómo te fue. Las que fallás vuelven a aparecer.
      </p>
      {items.length === 0 ? (
        <EmptyState
          title={coachGames === 0 ? 'Todavía no jugaste con el entrenador' : 'No hay situaciones: jugaste muy bien'}
          description="Salen de las partidas contra el bot terminadas con el modo entrenador prendido."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              <span className="font-semibold">{counts.pending}</span> para resolver ·{' '}
              <span className="font-semibold">{counts.solved}</span> resueltas
            </p>
            {first ? (
              <Button asChild className="ml-auto">
                <Link to={`/jugar/situaciones/${first.id}`}>
                  <TargetIcon data-icon="inline-start" />
                  {first.attempts > 0 ? 'Seguir practicando' : 'Empezar'}
                </Link>
              </Button>
            ) : null}
          </div>
          <Section title="Todas">
            <ul className="divide-y rounded-lg border">
              {items.map((item) => (
                <li key={item.id}>
                  <Link to={`/jugar/situaciones/${item.id}`} className="flex flex-col gap-1 px-3 py-2.5 hover:bg-muted">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {item.turn === 0 ? 'Preparación' : `Turno ${item.turn}`} · contra {item.rival}
                      </span>
                      {item.solved ? (
                        <CheckIcon className="size-4 text-success" aria-label="resuelta" />
                      ) : (
                        <VerdictBadge verdict={item.verdict} />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Partida #{item.gameId} · {item.options} opciones
                      {item.attempts > 0
                        ? ` · ${item.attempts} ${item.attempts === 1 ? 'intento' : 'intentos'}`
                        : ' · sin intentar'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
