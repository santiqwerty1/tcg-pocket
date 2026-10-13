/**
 * Fase 23: a recent tournament list as the bot's deck — the exact list of a player who placed well in the last days
 * (puesto, torneo, jugador y récord), filtered by archetype. Lists the engine cannot play are shown but disabled.
 */
import { useMemo, useState } from 'react'
import { useRecentLists } from '@/api/play'
import { EnergyChips } from '@/components/EnergyChip'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const ALL = '__all__'

export function RecentListPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (listKey: string, era: string, format: string) => void
}) {
  const recent = useRecentLists(true)
  const [archetype, setArchetype] = useState(ALL)
  const archetypes = useMemo(() => {
    const names = new Map<string, string>()
    for (const item of recent.data?.items ?? []) {
      if (item.archetypeId) names.set(item.archetypeId, item.archetypeName ?? item.archetypeId)
    }
    return [...names].sort((a, b) => a[1].localeCompare(b[1]))
  }, [recent.data])
  if (recent.isPending) return <LoadingRows rows={3} />
  if (recent.isError) return <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
  const data = recent.data
  const items = data.items.filter((item) => archetype === ALL || item.archetypeId === archetype)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Las listas exactas del top 8 de los torneos de los últimos {data.days} días
        {data.from && data.to ? ` (${formatDate(data.from)} al ${formatDate(data.to)})` : ''}. El bot juega esa lista
        tal cual.
      </p>
      {value && !data.items.some((item) => item.listKey === value) ? (
        <p className="rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm">
          Elegiste la lista {value.slice(0, 6)} desde Torneos: el bot va a jugar esa.
        </p>
      ) : null}
      <Select value={archetype} onValueChange={setArchetype}>
        <SelectTrigger aria-label="Arquetipo" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los arquetipos ({data.items.length})</SelectItem>
          {archetypes.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay listas en esos días.</p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.listKey}>
              <button
                type="button"
                disabled={!item.playable}
                onClick={() => onChange(item.listKey, data.era, data.format)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50',
                  value === item.listKey && 'border-primary bg-primary/10',
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-semibold tabular-nums">{item.placing}.º</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.archetypeName ?? 'Sin arquetipo'}</span>
                  <EnergyChips energies={item.energies} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.playerName} ({item.record.wins}-{item.record.losses}-{item.record.ties}) · {item.tournamentName}
                  {item.players ? ` · ${formatNumber(item.players)} jugadores` : ''} · {formatDate(item.date)}
                  {item.pilots > 1 ? ` · la jugaron ${item.pilots}` : ''}
                </span>
                {item.problem ? <span className="text-xs text-warning">No se puede jugar: {item.problem}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{data.attribution}</p>
    </div>
  )
}
