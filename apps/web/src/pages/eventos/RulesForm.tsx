/**
 * The rules of an event (Fase 16): types, «al menos N», no ex, rarities, expansions, the editions allowed outside
 * them and banned cards.
 */
import { XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useCardsBatch, useExpansions } from '@/api/catalog'
import { EVENT_TYPES, type EventRules, type EventType } from '@/api/schemas'
import { CardSearch } from '@/components/CardSearch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { looksLikeEditionCode, MAX_ALLOWED_EDITIONS, parseEditionCodes } from '@/lib/editionCodes'
import { useDebouncedValue } from '@/lib/useDebounce'
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

/**
 * The editions the event allows outside its expansions and rarities, typed or pasted as codes («P-A-1, A2b-111»),
 * each one shown with its Spanish name from the catalog, or why it is not one. The text is the field's own (it keeps
 * what is being typed); the rules get the codes as the catalog writes them.
 */
function AllowedEditions({
  allow,
  expansionIds,
  editionRule,
  onChange,
}: {
  allow: readonly string[] | undefined
  expansionIds: readonly string[]
  /** The event has an expansion or rarity rule (without one, the allowed editions change nothing). */
  editionRule: boolean
  onChange: (allow: string[]) => void
}) {
  const id = useId()
  const [text, setText] = useState(() => (allow ?? []).join(', '))
  const codes = allow ?? []
  const shown = codes.slice(0, MAX_ALLOWED_EDITIONS)
  // One lookup when the typing stops, of the codes that can be one.
  const lookup = useDebouncedValue(shown.filter(looksLikeEditionCode).join(','), 300)
  const looked = new Set(lookup ? lookup.split(',') : [])
  const cards = useCardsBatch([...looked])
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Ediciones permitidas aparte</legend>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Valen aunque sean de otra expansión o rareza (por ejemplo, Poción P-A-1 en un evento de Fusión Dual). Los tipos,
        «sin ex» y las prohibidas les siguen valiendo. Códigos separados por comas o espacios.
      </p>
      <Textarea
        aria-label="Ediciones permitidas aparte"
        aria-describedby={`${id}-hint`}
        rows={2}
        placeholder="P-A-1, P-A-5, A2b-111"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange(parseEditionCodes(event.target.value, expansionIds))
        }}
      />
      {shown.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Ediciones leídas">
          {shown.map((code) => {
            const card = cards.data?.get(code)
            const problem = !looksLikeEditionCode(code)
              ? 'no es un código de carta'
              : !card && looked.has(code) && cards.isSuccess
                ? 'no está en el catálogo'
                : null
            return (
              <li
                key={code}
                className={cn(
                  'rounded-md border px-2 py-1 text-sm',
                  problem && 'border-destructive/60 text-destructive',
                )}
              >
                <span className="font-medium tabular">{code}</span>
                {card ? (
                  <>
                    {' '}
                    {card.nameEs} <span className="text-muted-foreground">· {card.rarity}</span>
                  </>
                ) : problem ? (
                  `: ${problem}`
                ) : (
                  <span className="text-muted-foreground"> …</span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      {codes.length > MAX_ALLOWED_EDITIONS ? (
        <p className="text-xs text-destructive">
          Son {codes.length}: el evento acepta hasta {MAX_ALLOWED_EDITIONS} ediciones aparte.
        </p>
      ) : null}
      {codes.length > 0 && !editionRule ? (
        <p className="text-xs text-destructive">
          Necesitan una regla de rarezas o de expansiones: sin ella cualquier edición vale, y no se pueden guardar.
        </p>
      ) : null}
    </fieldset>
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
      <AllowedEditions
        allow={rules.allow}
        expansionIds={(expansions.data ?? []).map((expansion) => expansion.id)}
        editionRule={Boolean(rules.expansions || rules.rarities)}
        onChange={(allow) => set({ allow: allow.length > 0 ? allow : undefined })}
      />
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
