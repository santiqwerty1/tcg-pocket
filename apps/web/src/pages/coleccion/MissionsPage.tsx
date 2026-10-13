/**
 * Misiones de colección (Fase 8): the game's themed collections against your collection, by expansion, with what
 * each one still needs. Names and rewards come in English, as the tracker has them.
 */
import { CheckCircle2Icon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useMissions } from '@/api/collection'
import { EmptyState, ErrorState, LoadingRows } from '@/components/ListState'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { missing } from '@/lib/format'
import { rarityLabel } from '@/lib/packs'
import { cn } from '@/lib/utils'

const ALL = '__all__'

export function MissionsPage() {
  const [expansion, setExpansion] = useState(ALL)
  const [incomplete, setIncomplete] = useState(true)
  const missions = useMissions({ ...(expansion === ALL ? {} : { expansion }), incomplete })
  const data = missions.data

  return (
    <div className="flex flex-col gap-4">
      {data ? (
        <p className="text-sm text-muted-foreground">
          Completaste {data.complete} de {data.total} misiones. Las reimpresiones y otras artes de una carta cuentan.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={expansion} onValueChange={setExpansion}>
          <SelectTrigger aria-label="Expansión" className="min-w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las expansiones</SelectItem>
            {(data?.expansions ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.nameEs} ({item.missions})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="flex min-h-11 items-center gap-2">
          <Switch checked={incomplete} onCheckedChange={setIncomplete} />
          Solo las que faltan
        </Label>
      </div>
      {missions.isLoading ? <LoadingRows rows={5} /> : null}
      {missions.isError ? <ErrorState error={missions.error} onRetry={() => void missions.refetch()} /> : null}
      {data && data.total === 0 ? (
        <EmptyState
          title="El catálogo no tiene misiones"
          description="Llegan con la próxima sincronización del catálogo (Más → Catálogo)."
        />
      ) : null}
      {data && data.total > 0 && data.items.length === 0 ? (
        <EmptyState title="No falta ninguna" description="Todas las misiones de esta selección están completas." />
      ) : null}
      <ul className="flex flex-col gap-2">
        {(data?.items ?? []).map((item) => (
          <li key={`${item.expansionId}-${item.name}`} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{item.name}</span>
              {item.complete ? (
                <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-label="Completa" />
              ) : (
                <Badge variant="outline">{missing(item.missingCopies)}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {item.expansionNameEs}
              {item.secret ? ' · secreta' : ''}
              {item.reward ? ` · ${item.reward.replaceAll('<br />', ', ')}` : ''}
            </p>
            <ul className="flex flex-col gap-0.5 text-sm">
              {item.slots.map((slot, at) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: slots are positional
                <li key={at} className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn('tabular', slot.have >= slot.amount ? 'text-success' : 'text-warning')}>
                    {Math.min(slot.have, slot.amount)}/{slot.amount}
                  </span>
                  <span>{slot.nameEs}</span>
                  <span className="text-xs text-muted-foreground">
                    {slot.options.map((option, index) => (
                      <span key={option.cardId}>
                        {index > 0 ? ', ' : ''}
                        <Link to={`/cartas/${encodeURIComponent(option.cardId)}`} className="font-mono hover:underline">
                          {option.cardId}
                        </Link>
                        {option.rarity ? ` ${rarityLabel(option.rarity)}` : ''}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
