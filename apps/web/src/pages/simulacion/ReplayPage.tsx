/**
 * A simulated game step by step (PLAN §3.7, Fase 6; the board of Fase 22): the bots' choices told in Spanish over
 * the table, with deckgym's own graphical viewer one link away.
 */
import { Link, useParams } from 'react-router'
import type { ReplayResponse } from '@/api/schemas'
import { useReplay } from '@/api/simulations'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { ReplayViewer } from '@/components/replay/ReplayViewer'
import { shortSha } from '@/lib/format'
import { isReplay } from '@/lib/replay'

function Header({ data, replayId, steps }: { data: ReplayResponse; replayId: string; steps: number }) {
  return (
    <div className="flex flex-col gap-1">
      <Link to={`/simulacion/${data.game.jobId}`} className="text-sm text-primary hover:underline">
        {data.game.jobLabel}
      </Link>
      <p className="text-sm">
        <strong>A</strong> {data.game.decks[0] ?? '—'} <span className="text-muted-foreground">vs</span>{' '}
        <strong>B</strong> {data.game.decks[1] ?? '—'}
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Detalles de la partida</summary>
        <p>
          Partida {data.game.gameIndex + 1} · semilla <code className="font-mono">{data.game.seed}</code> · motor{' '}
          <code className="font-mono">{shortSha(data.game.engineRev)}</code> · {steps} pasos · {data.game.playersEs[0]}{' '}
          vs {data.game.playersEs[1]}
        </p>
        <p className="text-xs">
          <a
            href={`/viewer/index.html?url=${encodeURIComponent(`/api/simulations/replays/${replayId}/raw`)}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Ver en el visor gráfico de deckgym
          </a>{' '}
          <span className="text-muted-foreground">
            (en inglés; código AGPL-3.0:{' '}
            <a
              href={`https://github.com/bcollazo/deckgym-core/tree/${data.game.engineRev}/viewer`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              fuente
            </a>
            )
          </span>
        </p>
      </details>
    </div>
  )
}

export function ReplayPage() {
  const { id = '' } = useParams()
  const query = useReplay(id)
  if (query.isPending) return <LoadingRows />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const replay = query.data.replay
  if (!isReplay(replay)) {
    return <ErrorState error={new Error('La repetición no tiene el formato esperado del motor.')} />
  }
  const decks = query.data.game.decks
  return (
    <ReplayViewer
      replay={replay}
      names={query.data.names}
      cardIds={query.data.cardIds}
      bottom={0}
      labels={[`A · ${decks[0] ?? '—'}`, `B · ${decks[1] ?? '—'}`]}
      short={['A', 'B']}
      header={<Header data={query.data} replayId={id} steps={replay.steps.length} />}
    />
  )
}
