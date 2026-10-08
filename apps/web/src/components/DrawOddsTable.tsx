/** Fase 10: P(card by own turn) as a table, opening hand first, and the Basics the opening hand usually brings. */
import type { DrawOdds } from '@/api/schemas'
import { formatRateValue } from '@/lib/matches'

export function DrawOddsTable({ data, labels }: { data: DrawOdds; labels: string[] }) {
  const two = data.groups.length === 2
  const basics = data.basicsInHand.filter((row) => row.probability > 0.0005)
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left font-normal">Cuándo</th>
              {labels.map((label) => (
                <th key={label} className="px-2 py-1 text-right font-normal">
                  {label}
                </th>
              ))}
              {two ? <th className="px-2 py-1 text-right font-normal">Las dos</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.turn} className="border-t">
                <td className="px-2 py-1">
                  {row.turn === 0 ? 'Mano inicial' : `Turno ${row.turn}`}
                  <span className="block text-[11px] text-muted-foreground">{row.cardsSeen} cartas vistas</span>
                </td>
                {row.each.map((value, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: one column per group, in order
                  <td key={at} className="px-2 py-1 text-right font-medium tabular">
                    {formatRateValue(value * 100)}
                  </td>
                ))}
                {two ? (
                  <td className="px-2 py-1 text-right font-medium tabular">{formatRateValue((row.all ?? 0) * 100)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Básicos en la mano inicial ({data.basics} en el mazo):{' '}
        {basics.map((row) => `${row.count}: ${formatRateValue(row.probability * 100)}`).join(' · ')}. {data.note}
      </p>
    </div>
  )
}
