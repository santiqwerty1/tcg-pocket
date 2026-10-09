/**
 * The replay of a finished game against the bot (Fase 22): the same viewer as simulations, you at the bottom, and
 * the coach's verdict on each of your choices when the game had it.
 */
import { Link, useParams, useSearchParams } from 'react-router'
import { useGameReplay, usePlayGame } from '@/api/play'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { ReplayViewer } from '@/components/replay/ReplayViewer'
import { isReplay } from '@/lib/replay'

export function GameReplayPage() {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  const step = Number.parseInt(search.get('paso') ?? '', 10)
  const game = usePlayGame(id)
  const replay = useGameReplay(id, game.data?.replay === true)
  if (game.isPending || (game.data?.replay && replay.isPending)) return <LoadingRows rows={6} />
  if (game.isError) return <ErrorState error={game.error} onRetry={() => game.refetch()} />
  if (!game.data?.replay) {
    return <ErrorState error={new Error('Esta partida todavía no tiene repetición: aparece cuando termina.')} />
  }
  if (replay.isError) return <ErrorState error={replay.error} onRetry={() => replay.refetch()} />
  if (!isReplay(replay.data)) {
    return <ErrorState error={new Error('La repetición no tiene el formato esperado del motor.')} />
  }
  const data = game.data
  return (
    <ReplayViewer
      replay={replay.data}
      names={data.names}
      cardIds={data.cardIds}
      bottom={0}
      labels={[`Vos: ${data.human.label}`, `Bot: ${data.rival.label}`]}
      short={['Vos', 'Bot']}
      outcome={['Ganaste', 'Ganó el bot']}
      reviews={data.coach ? data.coachReviews : undefined}
      initialStep={Number.isInteger(step) && step >= 0 ? step : undefined}
      header={
        <div className="flex flex-col gap-1">
          <Link to={`/jugar/${data.id}`} className="text-sm text-primary hover:underline">
            Partida #{data.id}
          </Link>
          <p className="text-sm">
            <span className="font-medium">{data.human.label}</span>
            <span className="text-muted-foreground"> contra </span>
            <span className="font-medium">{data.rival.label}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            bot {data.botEs} · semilla {data.seed}
            {data.coach ? ' · con entrenador' : ''}
          </p>
        </div>
      }
    />
  )
}
