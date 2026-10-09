/**
 * Card details on the board (Fase 22): the card enlarged with what it can do (attacks with their cost and damage, the
 * ability, weakness and retreat) and, in play, its HP, energies, tools and status. Actions the page can take from it
 * (attack, retreat, play) go on top. Also the discard piles and the bot's list.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { energyLabel } from '@/lib/energies'
import { type ReplaySlot, statusEs } from '@/lib/replay'
import { useBoardCard, useBoardCards } from './BoardContext'
import { CardArt } from './CardArt'
import { EnergyDot, EnergyDots } from './EnergyDot'

export interface AttackInfo {
  name: string
  cost: string[]
  damage: string | null
  effect: string | null
}

/** Attacks of a card: the catalog's, else the engine's own data. */
export function useAttacks(engineId: string | null | undefined): AttackInfo[] {
  const card = useBoardCard(engineId)
  if (!card) return []
  if (card.edition) return card.edition.attacks.map((attack) => ({ ...attack }))
  const attacks = (card.engine?.attacks ?? []) as {
    title?: string
    energy_required?: string[]
    fixed_damage?: number
    effect?: string | null
  }[]
  return attacks.map((attack) => ({
    name: attack.title ?? '?',
    cost: attack.energy_required ?? [],
    damage: attack.fixed_damage ? String(attack.fixed_damage) : null,
    effect: attack.effect ?? null,
  }))
}

export function AttackLine({
  attack,
  extra,
  disabled,
}: {
  attack: AttackInfo
  /** «+20 por debilidad», «faltan energías»… */
  extra?: string | null | undefined
  disabled?: boolean | undefined
}) {
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="flex items-center gap-2">
        <span className="inline-flex gap-0.5">
          {attack.cost.length === 0 ? (
            <span className="text-xs text-muted-foreground">sin costo</span>
          ) : (
            attack.cost.map((energy, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: costs repeat energies
              <EnergyDot key={`${energy}-${index}`} energy={energy} />
            ))
          )}
        </span>
        <span className="min-w-0 flex-1 font-medium">{attack.name}</span>
        {attack.damage ? <span className="font-bold tabular-nums">{attack.damage}</span> : null}
      </div>
      {extra ? <p className="text-xs text-primary">{extra}</p> : null}
      {attack.effect ? <p className="text-xs text-muted-foreground">{attack.effect}</p> : null}
    </div>
  )
}

export function CardSheet({
  engineId,
  slot,
  actions,
  hideAttacks,
  open,
  onOpenChange,
}: {
  engineId: string | null
  slot?: ReplaySlot | null | undefined
  /** Buttons for what can be done with this card now. */
  actions?: ReactNode
  /** The attacks are already among the actions (your active): do not list them twice. */
  hideAttacks?: boolean | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const card = useBoardCard(engineId)
  const attacks = useAttacks(engineId)
  const edition = card?.edition
  return (
    <Sheet open={open && card !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto px-4 pb-6">
        {card ? (
          <>
            <SheetHeader className="px-0 pb-0">
              <SheetTitle>{card.name}</SheetTitle>
              <SheetDescription>
                {edition
                  ? [
                      edition.cardType === 'pokemon' ? 'Pokémon' : 'Entrenador',
                      edition.hp ? `${edition.hp} PS` : null,
                      edition.energy && edition.energy !== 'trainer' ? energyLabel(edition.energy) : null,
                      edition.cardType === 'pokemon'
                        ? `si cae da ${edition.prizePoints} ${edition.prizePoints === 1 ? 'punto' : 'puntos'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : card.engineId}
              </SheetDescription>
            </SheetHeader>
            {actions ? <div className="flex flex-col gap-1.5">{actions}</div> : null}
            <div className="flex gap-3">
              <div className="aspect-[63/88] w-36 shrink-0 overflow-hidden rounded-md border sm:w-48">
                {edition?.imageUrl ? (
                  <img
                    src={edition.imageUrl}
                    alt={card.name}
                    crossOrigin="anonymous"
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <CardArt engineId={card.engineId} />
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                {slot ? (
                  <>
                    <span className="font-semibold tabular-nums">
                      {slot.hp}/{slot.max_hp} PS
                    </span>
                    {slot.energy.length > 0 ? <EnergyDots energies={slot.energy} /> : null}
                    {slot.tools.length > 0 ? (
                      <span className="text-xs">
                        Herramienta: <ToolNames tools={slot.tools} />
                      </span>
                    ) : null}
                    {slot.status.length > 0 ? (
                      <span className="text-xs text-warning">{slot.status.map((s) => statusEs(s)).join(', ')}</span>
                    ) : null}
                  </>
                ) : null}
                {edition ? (
                  <div className="flex flex-wrap gap-1">
                    {edition.weakness ? (
                      <Badge variant="outline">debilidad {energyLabel(edition.weakness)} (+20)</Badge>
                    ) : null}
                    {edition.retreat !== null && edition.retreat !== undefined ? (
                      <Badge variant="outline">retirada {edition.retreat}</Badge>
                    ) : null}
                    {edition.ex ? <Badge>ex</Badge> : null}
                  </div>
                ) : null}
              </div>
            </div>
            {edition?.ability ? (
              <div>
                <p className="text-sm font-medium">Habilidad: {edition.ability.name}</p>
                <p className="text-xs text-muted-foreground">{edition.ability.effect}</p>
              </div>
            ) : null}
            {attacks.length > 0 && !hideAttacks ? (
              <div className="flex flex-col gap-2">
                {attacks.map((attack) => (
                  <AttackLine key={attack.name} attack={attack} />
                ))}
              </div>
            ) : null}
            {card.cardId ? (
              <Link to={`/cartas/${encodeURIComponent(card.cardId)}`} className="text-sm text-primary hover:underline">
                Ver la carta en el catálogo
              </Link>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ToolNames({ tools }: { tools: string[] }) {
  const { reader } = useBoardCards()
  return <>{tools.map((tool) => reader.name(tool)).join(', ')}</>
}

/** A list of cards as small pictures (a discard pile, a deck list). */
export function CardGridSheet({
  title,
  description,
  cards,
  energies,
  open,
  onOpenChange,
  onInspect,
}: {
  title: string
  description?: string | undefined
  cards: { engineId: string; count?: number }[]
  energies?: string[] | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onInspect: (engineId: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto px-4 pb-6">
        <SheetHeader className="px-0 pb-0">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {energies && energies.length > 0 ? <EnergyDots energies={energies} /> : null}
        {cards.length === 0 ? <p className="text-sm text-muted-foreground">Nada todavía.</p> : null}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {cards.map(({ engineId, count }, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: discard piles repeat cards
              key={`${engineId}-${index}`}
              type="button"
              onClick={() => onInspect(engineId)}
              className="relative aspect-[63/88] overflow-hidden rounded border"
            >
              <CardArt engineId={engineId} />
              {count && count > 1 ? (
                <span className="absolute right-0.5 bottom-0.5 rounded bg-black/75 px-1 text-xs font-bold text-white">
                  ×{count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
