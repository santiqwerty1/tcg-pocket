/** «Disponible» switch per pack and the rarity rules (points, confirmed, tradeable), both owner settings. */
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { usePacks, useRarityRules, useSetPackAvailable, useSetRarityRule } from '@/api/packs'
import type { RarityRuleInfo } from '@/api/schemas'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { rarityLabel } from '@/lib/packs'

function RarityRuleRow({ rule }: { rule: RarityRuleInfo }) {
  const setRule = useSetRarityRule()
  const [points, setPoints] = useState(rule.points === null ? '' : String(rule.points))
  async function save(patch: { points?: number | null; verified?: boolean; tradeable?: boolean }) {
    try {
      await setRule.mutateAsync({ rarity: rule.rarity, patch })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <li className="grid grid-cols-[4rem_5.5rem_1fr_1fr] items-center gap-2 px-3 py-1.5 text-sm">
      <span className="font-medium">{rarityLabel(rule.rarity)}</span>
      <Input
        aria-label={`Puntos de ${rarityLabel(rule.rarity)}`}
        inputMode="numeric"
        className="h-9"
        value={points}
        placeholder="—"
        disabled={rule.rarity === 'P'}
        onChange={(event) => setPoints(event.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          const next = points === '' ? null : Number(points)
          if (next !== rule.points) void save({ points: next })
        }}
      />
      <Label className="flex items-center gap-1.5 text-xs font-normal">
        <Switch checked={rule.verified} onCheckedChange={(verified) => save({ verified })} />
        confirmado
      </Label>
      <Label className="flex items-center gap-1.5 text-xs font-normal">
        <Switch checked={rule.tradeable} onCheckedChange={(tradeable) => save({ tradeable })} />
        intercambio
      </Label>
    </li>
  )
}

export function PackSettings() {
  const packs = usePacks()
  const rules = useRarityRules()
  const setAvailable = useSetPackAvailable()

  async function toggle(id: string, available: boolean) {
    try {
      await setAvailable.mutateAsync({ id, available })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Section title="Ajustes">
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 font-medium select-none">Sobres disponibles en el juego</summary>
        {packs.isPending ? <LoadingRows rows={3} /> : null}
        {packs.isError ? <ErrorState error={packs.error} onRetry={() => packs.refetch()} /> : null}
        <ul className="divide-y border-t">
          {(packs.data ?? []).map((pack) => (
            <li key={pack.id} className="flex min-h-11 items-center gap-2 px-3 py-1">
              <label htmlFor={`pack-${pack.id}`} className="min-w-0 flex-1 truncate text-sm">
                {pack.nameEs} <span className="text-muted-foreground">· {pack.expansionId}</span>
              </label>
              <Switch
                id={`pack-${pack.id}`}
                checked={pack.available}
                onCheckedChange={(available) => toggle(pack.id, available)}
              />
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 font-medium select-none">Puntos de sobre e intercambio</summary>
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Costos del tracker; ✵ y ✵✵ vienen de fuentes de la comunidad. Marcá «confirmado» cuando lo veas en el juego.
        </p>
        {rules.isPending ? <LoadingRows rows={3} /> : null}
        {rules.isError ? <ErrorState error={rules.error} onRetry={() => rules.refetch()} /> : null}
        <ul className="divide-y border-t">
          {(rules.data ?? []).map((rule) => (
            <RarityRuleRow key={rule.rarity} rule={rule} />
          ))}
        </ul>
      </details>
    </Section>
  )
}
