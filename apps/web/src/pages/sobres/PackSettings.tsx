/**
 * «Disponible» and «tiempo limitado» (with its last day) per pack, and the rarity rules (points, confirmed,
 * tradeable): owner settings.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { type PackPatch, usePacks, useRarityRules, useSetRarityRule, useUpdatePack } from '@/api/packs'
import type { PackInfo, RarityRuleInfo } from '@/api/schemas'
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

function PackRow({ pack, onChange }: { pack: PackInfo; onChange: (patch: PackPatch) => void }) {
  return (
    <li className="flex flex-col gap-1 px-3 py-1">
      <div className="grid min-h-11 grid-cols-[1fr_auto_auto] items-center gap-3">
        <span className="min-w-0 truncate text-sm">
          {pack.nameEs} <span className="text-muted-foreground">· {pack.expansionId}</span>
        </span>
        <Switch
          aria-label={`${pack.nameEs} por tiempo limitado`}
          checked={pack.limited}
          onCheckedChange={(limited) => onChange({ limited })}
        />
        <Switch
          aria-label={`${pack.nameEs} disponible`}
          checked={pack.available}
          onCheckedChange={(available) => onChange({ available })}
        />
      </div>
      {pack.limited ? (
        <Label className="flex items-center gap-2 pb-1 text-xs font-normal text-muted-foreground">
          Último día
          <Input
            type="date"
            className="h-9 w-40"
            aria-label={`Último día de ${pack.nameEs}`}
            defaultValue={pack.limitedUntil ?? ''}
            onBlur={(event) => {
              const value = event.target.value === '' ? null : event.target.value
              if (value !== pack.limitedUntil) onChange({ limitedUntil: value })
            }}
          />
        </Label>
      ) : null}
    </li>
  )
}

export function PackSettings() {
  const packs = usePacks()
  const rules = useRarityRules()
  const updatePack = useUpdatePack()

  async function change(id: string, patch: PackPatch) {
    try {
      await updatePack.mutateAsync({ id, patch })
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
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Un sobre por tiempo limitado da más peso a lo que solo sale de él hasta su último día; después deja de contar
          como disponible.
        </p>
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-t px-3 py-1 text-xs text-muted-foreground">
          <span>Sobre</span>
          <span>Limitado</span>
          <span>Disponible</span>
        </div>
        <ul className="divide-y border-t">
          {(packs.data ?? []).map((pack) => (
            <PackRow key={pack.id} pack={pack} onChange={(patch) => change(pack.id, patch)} />
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
