/**
 * ¿Importa empezar? (Fase 25): own matches going first against going second, with the gap and whether it is more than
 * chance (two-proportion test), and how many matches have who went first noted.
 */
import type { CoinAdjusted, TurnOrder } from '@/api/schemas'
import { formatRateValue, formatRecord } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { OrientativeBadge } from './RateSummary'

export function TurnOrderCard({
  turnOrder,
  coinAdjusted = null,
}: {
  turnOrder: TurnOrder
  /** Fase 44: half going first, half going second. */
  coinAdjusted?: CoinAdjusted | null
}) {
  const sides = [
    { label: 'Empezando', record: turnOrder.first, share: turnOrder.firstShare },
    { label: 'Yendo segundo', record: turnOrder.second, share: turnOrder.secondShare },
  ]
  const better = turnOrder.gap === null ? null : turnOrder.gap >= 0 ? 0 : 1
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-2">
        {sides.map((side, i) => (
          <div
            key={side.label}
            className={cn(
              'rounded-md border px-2 py-1.5',
              turnOrder.verdict === 'clear' && better === i && 'border-success bg-success/10',
            )}
          >
            <p className="text-xs text-muted-foreground">{side.label}</p>
            <p className="text-lg font-semibold tabular-nums">
              {side.share === null ? '—' : formatRateValue(side.share)}
            </p>
            <p className="text-xs text-muted-foreground">{formatRecord(side.record)}</p>
          </div>
        ))}
      </div>
      <p className={cn('text-sm', turnOrder.verdict === 'clear' && 'font-medium')}>{turnOrder.text}</p>
      {coinAdjusted ? (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-2 py-1.5">
          <p className="flex items-center gap-2 text-sm">
            <span>
              Con la moneda pareja: <span className="font-semibold tabular">{formatRateValue(coinAdjusted.value)}</span>
            </span>
            {coinAdjusted.orientative ? <OrientativeBadge /> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {coinAdjusted.text} La moneda decide quién empieza: a la larga, la mitad de las partidas son de cada lado.
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {Math.round(turnOrder.coverage)} % de estas partidas tienen anotado quién empezó
        {turnOrder.unknown > 0 ? ` (${turnOrder.unknown} sin el dato)` : ''}. Lo podés pedir siempre en Más → Ajustes de
        la app.
      </p>
    </div>
  )
}
