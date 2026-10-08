/** Fase 13: «¿mala racha o mal matchup?» — the verdict on an own record, in words. */
import { DicesIcon } from 'lucide-react'
import { useLuck } from '@/api/matches'
import { cn } from '@/lib/utils'

const TITLE = {
  too_few: 'Todavía pocas partidas',
  normal: 'Dentro de lo normal',
  unlucky: 'Racha rara',
  lucky: 'Mejor de lo esperable',
} as const

export function LuckCard({ deckId, opponent }: { deckId: string; opponent: string | null }) {
  const luck = useLuck(deckId, opponent)
  if (!luck.data) return null
  const verdict = luck.data.check?.verdict ?? null
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm',
        verdict === 'unlucky' && 'border-warning',
        verdict === 'lucky' && 'border-success',
      )}
      role="status"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <DicesIcon className="size-3.5" aria-hidden="true" />
        {verdict ? TITLE[verdict] : '¿Mala racha?'}
        {luck.data.opponent ? ` · contra ${luck.data.opponent}` : ''}
      </span>
      <p className="text-muted-foreground">{luck.data.text}</p>
    </div>
  )
}
