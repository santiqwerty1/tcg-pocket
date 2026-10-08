/** The rules of an event (Fase 16): types, «al menos N», no ex, rarities, expansions and banned cards. */
import { XIcon } from 'lucide-react'
import { useExpansions } from '@/api/catalog'
import { EVENT_TYPES, type EventRules, type EventType } from '@/api/schemas'
import { CardSearch } from '@/components/CardSearch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export const TYPE_ES: Record<EventType, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquico',
  fighting: 'Lucha',
  darkness: 'Oscuridad',
  metal: 'Metal',
  dragon: 'Dragón',
  colorless: 'Incoloro',
}
const RARITIES = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', '☆', '☆☆', '☆☆☆', '✵', '✵✵', 'Crown Rare', 'P']
const NONE = '__none__'

function toggle<T>(list: readonly T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value) ? list.filter((item) => item !== value) : [...(list ?? []), value]
  return next.length > 0 ? next : undefined
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} aria-pressed={active} onClick={onClick}>
      {children}
    </Button>
  )
}

export function RulesForm({
  rules,
  onChange,
  bannedNames,
  onBannedName,
}: {
  rules: EventRules
  onChange: (next: EventRules) => void
  /** Names of the banned cards, for the chips (the API only keeps ids). */
  bannedNames: Record<string, string>
  onBannedName: (groupId: string, nameEs: string) => void
}) {
  const expansions = useExpansions()
  const set = (patch: Partial<EventRules>) => {
    const next = { ...rules, ...patch }
    for (const key of Object.keys(next) as (keyof EventRules)[]) if (next[key] === undefined) delete next[key]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Solo Pokémon de estos tipos</legend>
        <div className="flex flex-wrap gap-1.5">
          {EVENT_TYPES.map((type) => (
            <Chip
              key={type}
              active={rules.types?.includes(type) ?? false}
              onClick={() => set({ types: toggle(rules.types, type) })}
            >
              {TYPE_ES[type]}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Al menos</span>
        <Input
          aria-label="Cantidad mínima"
          inputMode="numeric"
          className="h-9 w-16"
          value={rules.minOfType ? String(rules.minOfType.count) : ''}
          placeholder="—"
          onChange={(event) => {
            const count = Number(event.target.value.replace(/\D/g, ''))
            set({
              minOfType: count > 0 ? { type: rules.minOfType?.type ?? 'fire', count: Math.min(20, count) } : undefined,
            })
          }}
        />
        <span className="text-sm">Pokémon de tipo</span>
        <Select
          value={rules.minOfType?.type ?? NONE}
          onValueChange={(value) =>
            set({
              minOfType: value === NONE ? undefined : { type: value as EventType, count: rules.minOfType?.count ?? 8 },
            })
          }
        >
          <SelectTrigger aria-label="Tipo de la cantidad mínima" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {EVENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {TYPE_ES[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Label className="flex min-h-11 items-center gap-2">
        <Switch checked={rules.noEx ?? false} onCheckedChange={(noEx) => set({ noEx: noEx || undefined })} />
        Sin Pokémon ex
      </Label>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Solo estas rarezas (la edición que juega el mazo)</legend>
        <div className="flex flex-wrap gap-1.5">
          {RARITIES.map((rarity) => (
            <Chip
              key={rarity}
              active={rules.rarities?.includes(rarity) ?? false}
              onClick={() => set({ rarities: toggle(rules.rarities, rarity) })}
            >
              {rarity}
            </Chip>
          ))}
        </div>
      </fieldset>
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          Solo estas expansiones{rules.expansions ? ` (${rules.expansions.length})` : ''}
        </summary>
        <div className="flex flex-wrap gap-1.5 border-t p-3">
          {(expansions.data ?? []).map((expansion) => (
            <Chip
              key={expansion.id}
              active={rules.expansions?.includes(expansion.id) ?? false}
              onClick={() => set({ expansions: toggle(rules.expansions, expansion.id) })}
            >
              {expansion.id}
            </Chip>
          ))}
        </div>
      </details>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Cartas prohibidas</legend>
        <div className="flex flex-wrap gap-1.5">
          {(rules.banned ?? []).map((groupId) => (
            <span key={groupId} className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-sm')}>
              {bannedNames[groupId] ?? groupId}
              <button
                type="button"
                aria-label={`Quitar ${bannedNames[groupId] ?? groupId}`}
                onClick={() => set({ banned: rules.banned?.filter((id) => id !== groupId) })}
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
        <CardSearch
          placeholder="Prohibir una carta…"
          limit={8}
          onPick={(hit) => {
            onBannedName(hit.group.id, hit.group.nameEs)
            if (!rules.banned?.includes(hit.group.id)) set({ banned: [...(rules.banned ?? []), hit.group.id] })
          }}
        />
      </fieldset>
    </div>
  )
}
