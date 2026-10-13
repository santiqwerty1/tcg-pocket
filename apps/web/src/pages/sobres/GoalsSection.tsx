/**
 * Goals of the recommendation (BRIEF M4): target decks with a priority (1–3, stored in each deck), the collection
 * goal with a rarity filter, α between them, the weight of what only a limited-time pack gives, the model switch
 * and «solo disponibles». The decks goal aims at each deck's saved list or at its «versión de torneo» (the list of
 * its archetype worth aiming at): the owner's lists are built with what he has, so the saved ones are complete.
 */

import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useDecks, useUpdateDeck } from '@/api/decks'
import type { CollectionGoal, DeckTarget, DeckVersion, PackModel } from '@/api/schemas'
import { useDeckVersions } from '@/api/tournaments'
import { DeckNumber } from '@/components/DeckNumber'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { PERCENT } from '@/lib/format'
import { formatBoost, PACK_RARITIES, rarityLabel } from '@/lib/packs'
import { ChoiceGroup } from '@/pages/partidas/MatchFields'

const PRESSED = 'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground'
const PRIORITY_LABEL = ['—', 'Baja', 'Media', 'Alta'] as const
const LIMITED_BOOSTS = [1, 1.5, 2, 3] as const

/** «torneo: faltan 2» next to each deck of the sheet. */
function versionLabel(version: DeckVersion | undefined): { text: string; tone: string } | null {
  if (!version) return null
  if (!version.version) return { text: 'sin lista de torneo', tone: 'text-muted-foreground' }
  if (version.version.missingCopies === 0) {
    return {
      text: version.version.swaps === 0 ? 'ya es la de torneo' : 'versión de torneo: la tenés',
      tone: 'text-success',
    }
  }
  const names = version.version.missing.map((item) => `${item.need - item.have} ${item.nameEs}`).join(', ')
  return { text: `versión de torneo: faltan ${names}`, tone: 'text-warning' }
}

function TargetDecksSheet({
  open,
  onOpenChange,
  deckTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deckTarget: DeckTarget
}) {
  const decks = useDecks({ archived: false })
  const versions = useDeckVersions(open && deckTarget === 'tournament')
  const versionOf = new Map((versions.data?.decks ?? []).map((version) => [version.deckId, version]))
  const update = useUpdateDeck()
  const [filter, setFilter] = useState('')
  const items = (decks.data ?? []).filter((deck) =>
    filter.trim() === ''
      ? true
      : deck.id === filter.trim() || deck.name.toLocaleLowerCase('es').includes(filter.trim().toLocaleLowerCase('es')),
  )

  async function setPriority(id: string, packPriority: 0 | 1 | 2 | 3) {
    try {
      await update.mutateAsync({ id, patch: { packPriority } })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] pb-safe">
        <SheetHeader>
          <SheetTitle>Mazos objetivo</SheetTitle>
          <SheetDescription>
            La prioridad pesa las cartas que le faltan a cada mazo
            {deckTarget === 'tournament' ? ' para su versión de torneo' : ''}.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-col gap-2 px-4 pb-4">
          <Input
            aria-label="Buscar mazo"
            placeholder="Buscar por número o nombre"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul className="min-h-0 divide-y overflow-y-auto rounded-lg border">
            {items.map((deck) => (
              <li key={deck.id} className="flex flex-col gap-1.5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <DeckNumber id={deck.id} name={deck.name} className="text-sm" />
                  <span className="min-w-0 flex-1 truncate">{deck.name}</span>
                  {deck.complete ? (
                    <span className="text-xs text-success">completo</span>
                  ) : (
                    <span className="text-xs text-warning">faltan {deck.missingCount}</span>
                  )}
                </div>
                {deckTarget === 'tournament'
                  ? (() => {
                      const label = versionLabel(versionOf.get(deck.id))
                      return label ? <span className={`text-xs ${label.tone}`}>{label.text}</span> : null
                    })()
                  : null}
                <ChoiceGroup label={`Prioridad de ${deck.name}`} hiddenLabel className="grid grid-cols-4 gap-1">
                  {PRIORITY_LABEL.map((label, priority) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-pressed={deck.packPriority === priority}
                      className={PRESSED}
                      disabled={update.isPending}
                      onClick={() => setPriority(deck.id, priority as 0 | 1 | 2 | 3)}
                    >
                      {label}
                    </Button>
                  ))}
                </ChoiceGroup>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function GoalsSection({
  decks,
  collection,
  onCollectionChange,
  alpha,
  onAlphaChange,
  onAlphaCommit,
  model,
  onModelChange,
  onlyAvailable,
  onOnlyAvailableChange,
  limitedBoost,
  onLimitedBoostChange,
  limitedPacks,
  deckTarget,
  onDeckTargetChange,
  missions,
  onMissionsChange,
  missionsGoal,
}: {
  decks: {
    id: string
    name: string
    priority: number
    target: DeckTarget
    list: { key: string; lists: number } | null
  }[]
  collection: CollectionGoal | null
  onCollectionChange: (goal: CollectionGoal | null) => void
  alpha: number
  onAlphaChange: (alpha: number) => void
  /** The slider was released: save the value. */
  onAlphaCommit: () => void
  model: PackModel
  onModelChange: (model: PackModel) => void
  onlyAvailable: boolean
  onOnlyAvailableChange: (value: boolean) => void
  limitedBoost: number
  onLimitedBoostChange: (value: number) => void
  /** Limited-time packs on sale, e.g. «Sobre Deluxe Mega (hasta el 28/10)». */
  limitedPacks: string[]
  deckTarget: DeckTarget
  onDeckTargetChange: (target: DeckTarget) => void
  /** Fase 44: the missions as a third goal. */
  missions: boolean
  onMissionsChange: (value: boolean) => void
  missionsGoal: { slots: number; missingCopies: number; outOfPacks: number; weight: number } | null
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const toggleRarity = (rarity: (typeof PACK_RARITIES)[number]) => {
    if (!collection) return
    const has = collection.rarities.includes(rarity)
    onCollectionChange({
      ...collection,
      rarities: has ? collection.rarities.filter((r) => r !== rarity) : [...collection.rarities, rarity],
    })
  }

  return (
    <Section title="Objetivos">
      <div className="flex flex-col gap-1.5 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Completar mazos</span>
          <Button size="sm" variant="outline" onClick={() => setSheetOpen(true)}>
            Elegir mazos
          </Button>
        </div>
        {decks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ningún mazo marcado. Elegí los que querés completar y su prioridad.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {decks.map((deck) => (
              <Badge key={deck.id} variant="secondary" className="h-auto py-0.5">
                <span className="font-mono text-muted-foreground">#{deck.id}</span>
                <span className="max-w-48 truncate">{deck.name}</span>
                <span className="text-muted-foreground">{PRIORITY_LABEL[deck.priority] ?? deck.priority}</span>
                {deck.target === 'tournament' ? <span className="text-primary">torneo</span> : null}
              </Badge>
            ))}
          </div>
        )}
        <Label className="flex min-h-11 items-center justify-between gap-2 text-sm font-normal">
          <span>
            Apuntar a la versión de torneo
            <span className="block text-xs text-muted-foreground">
              Tus listas están armadas con lo que tenés; con esto se buscan las cartas de la lista de torneo de su
              arquetipo (la más sólida de la era, jugada 5 veces o más). Un mazo sin lista de torneo usa la suya.
            </span>
          </span>
          <Switch
            checked={deckTarget === 'tournament'}
            onCheckedChange={(on) => onDeckTargetChange(on ? 'tournament' : 'saved')}
          />
        </Label>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Label className="flex min-h-11 items-center justify-between gap-2 font-medium">
          Completar colección
          <Switch
            checked={collection !== null}
            onCheckedChange={(on) => onCollectionChange(on ? { rarities: [], copies: 1 } : null)}
          />
        </Label>
        {collection ? (
          <>
            <ChoiceGroup label="Rarezas (ninguna marcada = todas)" className="flex flex-wrap gap-1.5">
              {PACK_RARITIES.map((rarity) => (
                <Button
                  key={rarity}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={collection.rarities.includes(rarity)}
                  className={PRESSED}
                  onClick={() => toggleRarity(rarity)}
                >
                  {rarityLabel(rarity)}
                </Button>
              ))}
            </ChoiceGroup>
            <ChoiceGroup label="Copias por edición" className="grid grid-cols-2 gap-1.5">
              {[1, 2].map((copies) => (
                <Button
                  key={copies}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={collection.copies === copies}
                  className={PRESSED}
                  onClick={() => onCollectionChange({ ...collection, copies })}
                >
                  {copies === 1 ? 'Tener 1' : 'Tener 2'}
                </Button>
              ))}
            </ChoiceGroup>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border p-3">
        <Label className="flex min-h-11 items-center justify-between gap-2 font-medium">
          Completar misiones
          <Switch checked={missions} onCheckedChange={onMissionsChange} />
        </Label>
        {missions ? (
          <p className="text-xs text-muted-foreground">
            {missionsGoal
              ? `${missionsGoal.slots} huecos de misiones con ${missionsGoal.missingCopies} copias por conseguir; pesan ${Math.round(missionsGoal.weight * 100)} % del puntaje (lo mismo que cada objetivo prendido)${missionsGoal.outOfPacks > 0 ? `. ${missionsGoal.outOfPacks} no salen de ningún sobre a la venta` : ''}.`
              : 'Las misiones de colección incompletas: cada hueco pesa por las copias que le faltan.'}{' '}
            <Link to="/coleccion/misiones" className="text-primary hover:underline">
              Ver las misiones
            </Link>
          </p>
        ) : null}
      </div>

      {decks.length > 0 && collection ? (
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <label htmlFor="pack-alpha" className="flex items-center justify-between text-sm font-medium">
            <span>Peso de los mazos</span>
            <span className="tabular text-muted-foreground">{`${Math.round(alpha * 100)}${PERCENT}`}</span>
          </label>
          <input
            id="pack-alpha"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={alpha}
            onChange={(event) => onAlphaChange(Number(event.target.value))}
            onPointerUp={onAlphaCommit}
            onKeyUp={onAlphaCommit}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Colección</span>
            <span>Mazos</span>
          </div>
        </div>
      ) : null}

      {limitedPacks.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <ChoiceGroup label="Prioridad a los sobres por tiempo limitado" className="grid grid-cols-4 gap-1.5">
            {LIMITED_BOOSTS.map((boost) => (
              <Button
                key={boost}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={limitedBoost === boost}
                className={PRESSED}
                onClick={() => onLimitedBoostChange(boost)}
              >
                {boost === 1 ? 'No' : formatBoost(boost)}
              </Button>
            ))}
          </ChoiceGroup>
          <p className="text-xs text-muted-foreground">
            {limitedPacks.join(' · ')}. Lo que solo sale de ahí pesa más mientras dure: para los mazos, una carta que
            ningún otro sobre a la venta da; para la colección, una versión (arte u holo) que ningún otro sobre da.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1 rounded-lg border p-3">
        <Label className="flex min-h-11 items-center justify-between gap-2 font-medium">
          Modelo del tracker
          <Switch checked={model === 'tracker'} onCheckedChange={(on) => onModelChange(on ? 'tracker' : 'corrected')} />
        </Label>
        <p className="text-xs text-muted-foreground">
          Reproduce los números de la web del tracker. Difiere del modelo corregido en dos cosas: no cuenta las
          reimpresiones de otra expansión (por ejemplo, Hoopa ex en el Deluxe Mega da 0 %) y en algunos sets B cuenta de
          más las cartas bebé.
        </p>
        <Label className="flex min-h-11 items-center justify-between gap-2 font-medium">
          Solo sobres disponibles
          <Switch checked={onlyAvailable} onCheckedChange={onOnlyAvailableChange} />
        </Label>
      </div>
      {sheetOpen ? <TargetDecksSheet open onOpenChange={setSheetOpen} deckTarget={deckTarget} /> : null}
    </Section>
  )
}
