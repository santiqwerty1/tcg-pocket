import { ENERGY_COLORS, ENERGY_NAME_ES, isSelectableEnergy } from '@/lib/energies'
import { cn } from '@/lib/utils'

const EXTRA: Record<string, { bg: string; fg: string; name: string }> = {
  colorless: { bg: '#e5e7eb', fg: '#111827', name: 'Incolora' },
  dragon: { bg: '#a16207', fg: '#ffffff', name: 'Dragón' },
}

/** One energy as a small colored dot with its initial (engine «Fire» or app «fire»). */
export function EnergyDot({ energy, className }: { energy: string; className?: string }) {
  const key = energy.toLowerCase()
  const known = isSelectableEnergy(key) ? { ...ENERGY_COLORS[key], name: ENERGY_NAME_ES[key] } : EXTRA[key]
  const colors = known ?? { bg: '#6b7280', fg: '#ffffff', name: energy }
  return (
    <span
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-bold ring-1 ring-black/30',
        className,
      )}
      style={{ backgroundColor: colors.bg, color: colors.fg }}
      title={colors.name}
      role="img"
      aria-label={colors.name}
    >
      {colors.name.slice(0, 1)}
    </span>
  )
}

export function EnergyDots({ energies, className }: { energies: readonly string[]; className?: string }) {
  if (energies.length === 0) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-0.5', className)}>
      {energies.map((energy, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the same energy appears several times
        <EnergyDot key={`${energy}-${index}`} energy={energy} />
      ))}
    </span>
  )
}
