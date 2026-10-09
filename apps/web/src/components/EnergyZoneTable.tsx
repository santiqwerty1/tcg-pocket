/**
 * Fase 44: the Energy Zone, turn by turn — for each attack of the attacker, the chance of having its energy by each
 * own turn, going first (no energy on the first turn) and going second.
 */
import type { EnergyZone, SelectableEnergy } from '@/api/schemas'
import { ENERGY_NAME_ES } from '@/lib/energies'
import { formatRateValue } from '@/lib/matches'
import { EnergyChips } from './EnergyChip'

const OTHER_ENERGY: Record<string, string> = { colorless: 'Incolora', dragon: 'Dragón' }

function costText(cost: readonly string[]): string {
  if (cost.length === 0) return 'sin costo'
  const counts = new Map<string, number>()
  for (const energy of cost) counts.set(energy, (counts.get(energy) ?? 0) + 1)
  return [...counts]
    .map(
      ([energy, count]) => `${count} ${ENERGY_NAME_ES[energy as SelectableEnergy] ?? OTHER_ENERGY[energy] ?? energy}`,
    )
    .join(' + ')
}

export function EnergyZoneTable({ energy }: { energy: EnergyZone }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Energía para atacar con {energy.attacker.nameEs}</span>
        <EnergyChips energies={energy.types} />
      </div>
      {energy.attacks.map((attack) => (
        <div key={attack.name} className="flex flex-col gap-1">
          <p className="text-xs">
            <span className="font-medium">{attack.name}</span>{' '}
            <span className="text-muted-foreground">({costText(attack.cost)})</span>
          </p>
          {attack.payable ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-2 py-1 text-left font-normal">Turno</th>
                    <th className="px-2 py-1 text-right font-normal">Empezando</th>
                    <th className="px-2 py-1 text-right font-normal">Yendo segundo</th>
                  </tr>
                </thead>
                <tbody>
                  {attack.first.map((row, at) => (
                    <tr key={row.turn} className="border-t">
                      <td className="px-2 py-1">Turno {row.turn}</td>
                      <td className="px-2 py-1 text-right tabular">{formatRateValue(row.probability * 100)}</td>
                      <td className="px-2 py-1 text-right tabular">
                        {formatRateValue((attack.second[at]?.probability ?? 0) * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-warning">Pide una energía que el mazo no tiene en la Zona de Energía.</p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{energy.note}</p>
    </div>
  )
}
