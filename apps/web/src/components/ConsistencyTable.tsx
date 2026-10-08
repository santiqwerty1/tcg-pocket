/** P(key attacker ready by own turn N), going first, second and both, with n and interval (Fase 8). */
import type { Consistency, CurvePoint } from '@/api/schemas'
import { formatInterval, formatRateValue } from '@/lib/matches'

function Cell({ point }: { point: CurvePoint | undefined }) {
  if (!point || point.games === 0) return <td className="px-2 py-1 text-right text-muted-foreground">—</td>
  return (
    <td className="px-2 py-1 text-right tabular" title={`n = ${point.games} · IC ${formatInterval(point.ci95)}`}>
      <span className="font-medium">{formatRateValue(point.value)}</span>
      <span className="block text-[11px] text-muted-foreground">{formatInterval(point.ci95)}</span>
    </td>
  )
}

export function ConsistencyTable({ data, turns = 5 }: { data: Consistency; turns?: number }) {
  const rows = Array.from({ length: Math.min(turns, data.maxTurn) }, (_, at) => at)
  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left font-normal">Listo en el turno propio</th>
              <th className="px-2 py-1 text-right font-normal">Todas (n = {data.games.all})</th>
              <th className="px-2 py-1 text-right font-normal">Empezando ({data.games.first})</th>
              <th className="px-2 py-1 text-right font-normal">Segundo ({data.games.second})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((at) => (
              <tr key={at} className="border-t">
                <td className="px-2 py-1">≤ {at + 1}</td>
                <Cell point={data.ready.all[at]} />
                <Cell point={data.ready.first[at]} />
                <Cell point={data.ready.second[at]} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        «Listo»: {[...new Set(data.keyCards.map((card) => card.nameEs))].join(' o ')} en juego con energía para uno de
        sus ataques. Partidas contra un rival que no juega, con el mazo jugado por el bot {data.botEs} sin atacar: mide
        cómo se arma la lista, no la pelea.
      </p>
    </div>
  )
}
