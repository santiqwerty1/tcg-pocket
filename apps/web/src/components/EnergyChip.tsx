import type { SelectableEnergy } from '@/api/schemas'
import { ENERGY_COLORS, ENERGY_NAME_ES, ENERGY_SHORT_ES, SELECTABLE_ENERGIES } from '@/lib/energies'
import { cn } from '@/lib/utils'

export interface EnergyChipProps {
  energy: SelectableEnergy
  size?: 'sm' | 'md'
  className?: string
}

/** Colored chip with the Spanish energy name. */
export function EnergyChip({ energy, size = 'sm', className }: EnergyChipProps) {
  const colors = ENERGY_COLORS[energy]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm',
        className,
      )}
      style={{ backgroundColor: colors.bg, color: colors.fg }}
      title={ENERGY_NAME_ES[energy]}
    >
      {size === 'sm' ? ENERGY_SHORT_ES[energy] : ENERGY_NAME_ES[energy]}
    </span>
  )
}

export function EnergyChips({ energies, size = 'sm' }: { energies: readonly SelectableEnergy[]; size?: 'sm' | 'md' }) {
  if (energies.length === 0) return <span className="text-xs text-muted-foreground">sin energía</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {energies.map((energy) => (
        <EnergyChip key={energy} energy={energy} size={size} />
      ))}
    </span>
  )
}

export interface EnergyPickerProps {
  value: readonly SelectableEnergy[]
  onChange: (next: SelectableEnergy[]) => void
  disabled?: boolean
  /** Accessible group name. */
  label?: string
}

/** Eight toggle chips (the Energy Zone types; dragon and colorless are never selectable). */
export function EnergyPicker({ value, onChange, disabled, label = 'Energías del mazo' }: EnergyPickerProps) {
  const selected = new Set(value)
  function toggle(energy: SelectableEnergy) {
    const next = new Set(selected)
    if (next.has(energy)) next.delete(energy)
    else next.add(energy)
    onChange(SELECTABLE_ENERGIES.filter((e) => next.has(e)))
  }
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{label}</legend>
      {SELECTABLE_ENERGIES.map((energy) => {
        const isOn = selected.has(energy)
        const colors = ENERGY_COLORS[energy]
        return (
          <button
            key={energy}
            type="button"
            aria-pressed={isOn}
            disabled={disabled}
            onClick={() => toggle(energy)}
            className={cn(
              'inline-flex h-11 min-w-11 items-center justify-center rounded-full border-2 px-3 text-sm font-medium transition-colors select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
              isOn ? 'border-transparent' : 'border-border bg-background text-foreground',
            )}
            style={isOn ? { backgroundColor: colors.bg, color: colors.fg } : undefined}
          >
            {ENERGY_NAME_ES[energy]}
          </button>
        )
      })}
    </fieldset>
  )
}
