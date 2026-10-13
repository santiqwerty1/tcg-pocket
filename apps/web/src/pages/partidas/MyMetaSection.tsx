/**
 * Fase 44: «Tu meta» — the rivals of my matches of the era as tournament archetypes, the recent ones weighing more.
 * It is what «¿Cuál llevo hoy?» and «Contra cada rival» use as weights when asked for «los que me tocan». The shares
 * rest on the effective matches (recent ones weigh more, so there are fewer than were played): each carries its
 * interval and «orientativo» under 30.
 */
import { Link } from 'react-router'
import { useMyMeta } from '@/api/matches'
import type { MatchMode } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Fold } from '@/components/Section'
import { formatInterval, MODE_LABEL } from '@/lib/matches'
import { formatShare } from '@/lib/tournaments'

const effectiveFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

function Body({ mode, days }: { mode?: MatchMode | undefined; days?: number | undefined }) {
  const meta = useMyMeta({ ...(mode ? { mode } : {}), ...(days ? { days } : {}) })
  if (meta.isPending) return <LoadingRows rows={3} />
  if (meta.isError) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
  const data = meta.data
  const modes = (mode ? MODE_LABEL[mode] : `${MODE_LABEL.competitive} y ${MODE_LABEL.casual}`).toLowerCase()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{data.text}</p>
      {data.shares.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {data.shares.slice(0, 12).map((row) => (
            <li key={row.archetypeId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <div className="flex items-baseline gap-2">
                <Link
                  to={`/torneos/arquetipos/${encodeURIComponent(row.archetypeId)}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {row.name}
                </Link>
                <span className="w-14 shrink-0 text-right font-semibold tabular">{formatShare(row.share)}</span>
              </div>
              <span className="text-xs text-muted-foreground tabular">
                {row.games} {row.games === 1 ? 'partida' : 'partidas'}
                {row.ci95 ? ` · IC\u00a0${formatInterval(row.ci95)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Partidas de {data.era} en {modes}. {Math.round(data.coverage)} % de tus partidas con rival, ponderadas por
        fecha, son contra un arquetipo de torneo
        {data.withoutRival > 0 ? `; ${data.withoutRival} no tienen rival anotado` : ''}. Una partida de hace{' '}
        {data.halfLifeDays} días pesa la mitad que una de hoy, así que tus {data.matched} partidas valen como{' '}
        {effectiveFormat.format(data.effectiveMatches)}.
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
