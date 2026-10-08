/**
 * «Disponible» and «tiempo limitado» (with its last day) per pack, the rarity rules (points, confirmed, tradeable)
 * and the pack points saved per expansion: owner settings.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { type PackPatch, packKeys, usePacks, useRarityRules, useSetRarityRule, useUpdatePack } from '@/api/packs'
import type { PackInfo, RarityRuleInfo } from '@/api/schemas'
import { useSetSetting, useSettings } from '@/api/settings'
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

const POINTS_KEY = 'packPoints'

function readPoints(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, points] of Object.entries(value)) {
    if (typeof points === 'number' && Number.isInteger(points) && points >= 0) out[key] = points
  }
  return out
}

function PointsRow({
  expansionId,
  name,
  value,
  onSave,
}: {
  expansionId: string
  name: string
  value: number
  onSave: (points: number) => void
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '')
  return (
    <li className="grid min-h-11 grid-cols-[1fr_6rem] items-center gap-3 px-3 py-1 text-sm">
      <span className="min-w-0 truncate">
        {name} <span className="text-muted-foreground">· {expansionId}</span>
      </span>
      <Input
        aria-label={`Puntos guardados de ${name}`}
        inputMode="numeric"
        className="h-9"
        placeholder="0"
        value={text}
        onChange={(event) => setText(event.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          const next = text === '' ? 0 : Math.min(1_000_000, Number(text))
          if (next !== value) onSave(next)
        }}
      />
    </li>
  )
}

/** Fase 14: the pace of «¿cuántos días me faltan?»: packs a day and pack hourglasses saved. */
function Pace() {
  const settings = useSettings()
  const setSetting = useSetSetting()
  const queryClient = useQueryClient()
  const perDay = typeof settings.data?.packsPerDay === 'number' ? settings.data.packsPerDay : 2
  const hourglasses = typeof settings.data?.hourglasses === 'number' ? settings.data.hourglasses : 0
  const [perDayText, setPerDayText] = useState<string | null>(null)
  const [hourglassText, setHourglassText] = useState<string | null>(null)

  async function save(key: 'packsPerDay' | 'hourglasses', value: number) {
    try {
      await setSetting.mutateAsync({ key, value })
      await queryClient.invalidateQueries({ queryKey: packKeys.all })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 font-medium select-none">Ritmo de apertura</summary>
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        Para «completo en ~N días»: cuántos sobres abrís por día (2 gratis; 3 con el pase) y cuántos relojes de arena de
        sobre tenés guardados (12 son un sobre).
      </p>
      <div className="grid grid-cols-[1fr_6rem] items-center gap-3 border-t px-3 py-2 text-sm">
        <Label htmlFor="packs-per-day">Sobres por día</Label>
        <Input
          id="packs-per-day"
          inputMode="decimal"
          className="h-9"
          value={perDayText ?? String(perDay)}
          onChange={(event) => setPerDayText(event.target.value.replace(/[^\d.,]/g, ''))}
          onBlur={() => {
            const next = Number((perDayText ?? '').replace(',', '.'))
            setPerDayText(null)
            if (Number.isFinite(next) && next >= 0.5 && next <= 20 && next !== perDay) void save('packsPerDay', next)
          }}
        />
        <Label htmlFor="hourglasses">Relojes de arena de sobre</Label>
        <Input
          id="hourglasses"
          inputMode="numeric"
          className="h-9"
          value={hourglassText ?? String(hourglasses)}
          onChange={(event) => setHourglassText(event.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            const next = hourglassText === '' || hourglassText === null ? hourglasses : Number(hourglassText)
            setHourglassText(null)
            if (next !== hourglasses && next <= 100_000) void save('hourglasses', next)
          }}
        />
      </div>
    </details>
  )
}

/** Pack points already saved per expansion: they can be spent even after its packs leave the shop (S-002). */
function SavedPoints() {
  const packs = usePacks()
  const settings = useSettings()
  const setSetting = useSetSetting()
  const queryClient = useQueryClient()
  const saved = readPoints(settings.data?.[POINTS_KEY])
  const expansions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const pack of packs.data ?? [])
      if (!seen.has(pack.expansionId)) seen.set(pack.expansionId, pack.expansionNameEs)
    return [...seen]
  }, [packs.data])

  async function save(expansionId: string, points: number) {
    const next = { ...saved, [expansionId]: points }
    if (points === 0) delete next[expansionId]
    try {
      await setSetting.mutateAsync({ key: POINTS_KEY, value: next })
      await queryClient.invalidateQueries({ queryKey: packKeys.all })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 font-medium select-none">Puntos de sobre guardados</summary>
      <p className="px-3 pb-2 text-xs text-muted-foreground">
        Los puntos de cada expansión se pueden canjear aunque sus sobres ya no estén a la venta. Si alcanzan para una
        carta que te falta, la recomendación dice «canjear».
      </p>
      {packs.isPending || settings.isPending ? <LoadingRows rows={3} /> : null}
      {settings.isError ? <ErrorState error={settings.error} onRetry={() => settings.refetch()} /> : null}
      {settings.data ? (
        <ul className="divide-y border-t">
          {expansions.map(([expansionId, name]) => (
            <PointsRow
              key={expansionId}
              expansionId={expansionId}
              name={name}
              value={saved[expansionId] ?? 0}
              onSave={(points) => void save(expansionId, points)}
            />
          ))}
        </ul>
      ) : null}
    </details>
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
          Costos del tracker; ✵ y ✵✵ confirmados en el juego el 8/10/2026. Marcá «confirmado» cuando veas los demás.
        </p>
        {rules.isPending ? <LoadingRows rows={3} /> : null}
        {rules.isError ? <ErrorState error={rules.error} onRetry={() => rules.refetch()} /> : null}
        <ul className="divide-y border-t">
          {(rules.data ?? []).map((rule) => (
            <RarityRuleRow key={rule.rarity} rule={rule} />
          ))}
        </ul>
      </details>
      <SavedPoints />
      <Pace />
    </Section>
  )
}
