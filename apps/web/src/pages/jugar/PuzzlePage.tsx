/**
 * One situation to solve (Fase 24): the table of that moment of your game, played by touch like the game itself.
 * After the answer: how it went by the coach's measure, the coach's move, what you did in the game and every option
 * with its value.
 */
import { ListIcon, RotateCcwIcon, SkipForwardIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useAnswerPuzzle, usePuzzle } from '@/api/puzzles'
import type { Puzzle, PuzzleAnswer } from '@/api/schemas'
import { BoardProvider } from '@/components/board/BoardContext'
import { Table } from '@/components/board/Table'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Button } from '@/components/ui/button'
import type { BoardAction } from '@/lib/board'
import { type Replay, ReplayReader, type ReplayState } from '@/lib/replay'
import { cn } from '@/lib/utils'
import { VERDICT_ES, VerdictBadge } from './Coach'
import { OptionsSheet } from './GameParts'
import { TouchPlaySheet, useTouchPlay } from './useTouchPlay'

function readerFor(puzzle: Puzzle): ReplayReader {
  const replay: Replay = {
    version: 1,
    game_id: String(puzzle.gameId),
    seed: 0,
    players: [],
    cards: puzzle.cards as unknown as Replay['cards'],
    steps: [],
    final_state: null as unknown as ReplayState,
    outcome: null,
  }
  return new ReplayReader(replay, puzzle.names)
}

export function PuzzlePage() {
  const { id = '' } = useParams()
  const puzzle = usePuzzle(id)
  const reader = useMemo(() => (puzzle.data ? readerFor(puzzle.data) : null), [puzzle.data])
  if (puzzle.isPending) return <LoadingRows rows={6} />
  if (puzzle.isError || !puzzle.data || !reader) {
    return <ErrorState error={puzzle.error} onRetry={() => void puzzle.refetch()} />
  }
  return (
    <BoardProvider reader={reader} cardIds={puzzle.data.cardIds}>
      <Solve key={id} puzzle={puzzle.data} reader={reader} />
    </BoardProvider>
  )
}

function Solve({ puzzle, reader }: { puzzle: Puzzle; reader: ReplayReader }) {
  const navigate = useNavigate()
  const answer = useAnswerPuzzle(puzzle.id)
  const [result, setResult] = useState<PuzzleAnswer | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const state = puzzle.state as unknown as ReplayState
  const play = useTouchPlay({
    options: result ? null : puzzle.actions,
    state,
    resetKey: result === null,
    onChoose: (i) => {
      setOptionsOpen(false)
      answer.mutate({ i }, { onSuccess: setResult, onError: (error) => toast.error(errorMessage(error)) })
    },
  })
  const describe = (action: BoardAction) => reader.describe(action.action, state, 0, action.text)
  const text = (i: number) => {
    const option = puzzle.actions[i]
    return option ? reader.describe(option.action, state, 0, option.text) : '—'
  }

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  return (
    <div className="flex flex-col gap-3 pb-24">
      <div>
        <p className="text-sm">
          {puzzle.turn === 0 ? 'Preparación' : `Turno ${puzzle.turn}`} · contra{' '}
          <span className="font-medium">{puzzle.rival}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Partida #{puzzle.gameId} · tu jugada {puzzle.ply}
          {puzzle.attempts > 0 ? ` · ${puzzle.attempts} ${puzzle.attempts === 1 ? 'intento' : 'intentos'}` : ''}
          {puzzle.solved ? ' · ya resuelta' : ''}
        </p>
      </div>
      {result ? null : (
        <p className="rounded-lg border border-primary px-3 py-2 text-sm text-primary">
          ¿Qué jugás acá? Tocá las cartas como en una partida (o elegí en «Opciones»).
        </p>
      )}

      {result ? (
        <div
          className={cn(
            'flex flex-col gap-2 rounded-xl border-2 p-3',
            result.solved ? 'border-success/60' : 'border-destructive/60',
          )}
        >
          <div className="flex items-center gap-2">
            <p className="flex-1 text-lg font-bold">{result.solved ? '¡Bien!' : 'No era la mejor'}</p>
            <VerdictBadge verdict={result.verdict} />
          </div>
          <p className="text-sm">
            Tu jugada: <span className="font-medium">{text(result.answer)}</span>
            {result.solved ? '' : ` (${result.rank}.ª de ${result.scores.length})`}
          </p>
          {result.best !== result.answer ? (
            <p className="text-sm">
              El entrenador: <span className="font-medium">{text(result.best)}</span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            En la partida jugaste «{text(result.original.chosen)}» ({VERDICT_ES[result.original.verdict].toLowerCase()}
            ).
          </p>
          <ul className="flex flex-col gap-1">
            {result.scores.map((score, i) => {
              const min = Math.min(...result.scores)
              const max = Math.max(...result.scores)
              const width = max > min ? 8 + ((score - min) / (max - min)) * 92 : 100
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
                <li key={i} className="relative overflow-hidden rounded border text-xs">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0',
                      i === result.best ? 'bg-success/30' : i === result.answer ? 'bg-destructive/25' : 'bg-muted',
                    )}
                    style={{ width: `${width}%` }}
                  />
                  <span className={cn('relative flex gap-2 px-2 py-1', i === result.answer && 'font-semibold')}>
                    <span className="min-w-0 flex-1">{text(i)}</span>
                    <span className="tabular-nums text-muted-foreground">{score.toLocaleString('es-AR')}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Valor de la mesa al final de tu turno según el entrenador (un punto de premio vale 10.000).
          </p>
          <div className="flex flex-wrap gap-2">
            {result.next ? (
              <Button type="button" onClick={() => navigate(`/jugar/situaciones/${result.next}`)}>
                <SkipForwardIcon data-icon="inline-start" />
                Siguiente
              </Button>
            ) : (
              <Button asChild>
                <Link to="/jugar/situaciones">No quedan: ver todas</Link>
              </Button>
            )}
            {result.solved ? null : (
              <Button type="button" variant="outline" onClick={() => setResult(null)}>
                <RotateCcwIcon data-icon="inline-start" />
                Intentar de nuevo
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link to={`/jugar/${puzzle.gameId}/repeticion?paso=${puzzle.id.split('-')[1]}`}>Ver ese momento</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <Table
        state={state}
        bottom={0}
        labels={[`Vos: ${puzzle.human}`, `Bot: ${puzzle.rival}`]}
        stamp={puzzle.id}
        hiddenHand={1}
        targets={play.targets}
        selected={play.selected}
        playable={play.playable}
        energyPlayable={play.energyPlayable}
        onSlot={play.onSlot}
        onHandCard={play.onHandCard}
        onEnergy={play.onEnergy}
        onInspect={play.inspect}
      />

      {result ? null : (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 px-3 py-2 backdrop-blur pb-safe">
          {play.selected ? (
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <span className="flex-1 text-primary">Tocá un lugar marcado</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => play.setSelected(null)}>
                Cancelar
              </Button>
            </div>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => setOptionsOpen(true)}>
              <ListIcon aria-hidden="true" />
              Opciones ({play.actions.length})
            </Button>
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link to="/jugar/situaciones">Todas</Link>
            </Button>
          </div>
        </div>
      )}

      <OptionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        actions={play.actions}
        describe={describe}
        hint={null}
        disabled={answer.isPending}
        onChoose={play.choose}
      />
      <TouchPlaySheet play={play} state={state} describe={describe} hint={null} busy={answer.isPending} />
    </div>
  )
}
