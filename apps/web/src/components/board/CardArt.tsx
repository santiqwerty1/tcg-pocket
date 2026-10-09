/**
 * A card's picture on the board (Fase 22): the tracker's image (Spanish when there is one), loaded lazily and with
 * CORS so the service worker can keep it for offline use; without images (setting off, failed load) a text tile
 * with the name and the type's color.
 */
import { useState } from 'react'
import { ENERGY_COLORS, isSelectableEnergy } from '@/lib/energies'
import { cn } from '@/lib/utils'
import { useBoardCard } from './BoardContext'

function tone(energy: string | undefined): string {
  const key = (energy ?? '').toLowerCase()
  return isSelectableEnergy(key) ? ENERGY_COLORS[key].bg : key === 'trainer' ? '#64748b' : '#94a3b8'
}

export function CardArt({ engineId, className }: { engineId: string; className?: string }) {
  const card = useBoardCard(engineId)
  const [failed, setFailed] = useState(false)
  if (!card) return null
  if (card.imageUrl && !failed) {
    return (
      <img
        src={card.imageUrl}
        alt={card.name}
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className={cn('size-full bg-muted object-cover object-top select-none', className)}
      />
    )
  }
  const energy = card.edition?.energy ?? card.engine?.energy_type
  return (
    <div
      className={cn('flex size-full flex-col justify-between bg-card p-1 text-left', className)}
      style={{ borderTop: `4px solid ${tone(typeof energy === 'string' ? energy : undefined)}` }}
    >
      <span className="line-clamp-3 text-[11px] leading-tight font-medium">{card.name}</span>
      {card.edition?.hp ? <span className="text-[10px] text-muted-foreground">{card.edition.hp} PS</span> : null}
    </div>
  )
}
