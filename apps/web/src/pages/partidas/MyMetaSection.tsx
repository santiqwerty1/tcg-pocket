/**
 * Fase 44: «Tu meta» — the rivals of my matches as tournament archetypes, the recent ones weighing more. It is what
 * «¿Cuál llevo hoy?» and «Contra cada rival» use as weights when asked for «los que me tocan».
 */
import { Link } from 'react-router'
import { useMyMeta } from '@/api/matches'
import type { MatchMode } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Fold } from '@/components/Section'
import { formatShare } from '@/lib/tournaments'

function Body({ mode, days }: { mode?: MatchMode | undefined; days?: number | undefined }) {
  const meta = useMyMeta({ ...(mode ? { mode } : {}), ...(days ? { days } : {}) })
  if (meta.isPending) return <LoadingRows rows={3} />
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
  const data = meta.data
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{data.text}</p>
      {data.shares.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {data.shares.slice(0, 12).map((row) => (
            <li key={row.archetypeId} className="flex items-baseline gap-2 px-3 py-2 text-sm">
              <Link
                to={`/torneos/arquetipos/${encodeURIComponent(row.archetypeId)}`}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {row.name}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {row.games} {row.games === 1 ? 'partida' : 'partidas'}
              </span>
              <span className="w-14 shrink-0 text-right font-semibold tabular">{formatShare(row.share)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {Math.round(data.coverage)} % de tus partidas con rival son contra un arquetipo de torneo de {data.era}
        {data.withoutRival > 0 ? `; ${data.withoutRival} no tienen rival anotado` : ''}. Una partida de hace{' '}
        {data.halfLifeDays} días pesa la mitad que una de hoy.
      </p>
      {data.unmatched.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin arquetipo: {data.unmatched.map((row) => `${row.label} (${row.games})`).join(', ')}. Cuentan si al cargar
          la partida elegís el rival de la lista de arquetipos, o si escribís su nota desde la ficha del arquetipo.
        </p>
      ) : null}
    </div>
  )
}

export function MyMetaSection({ mode, days }: { mode?: MatchMode | undefined; days?: number | undefined }) {
  return (
    <Fold title="Tu meta" hint="Contra qué arquetipos jugás" remember="tcg.fold.my-meta">
      <Body mode={mode} days={days} />
    </Fold>
  )
}
