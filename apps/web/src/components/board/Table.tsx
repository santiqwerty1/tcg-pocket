/**
 * The table (Fase 22), shared by games against the bot and replays: each side with its active Pokémon and bench as
 * cards (picture, HP bar, energies, status, tool, prize points), the hand, the Energy Zone, deck and discard counts
 * and the points; what changed since the previous moment (damage, healing, knockouts) floats over the cards. Taps
 * and long presses go to the page: a tap plays (or opens the card), a long press always shows the card.
 */
import { WrenchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ActionSource, BoardChanges, Seat, SlotRef } from '@/lib/board'
import { hpTone, sameSource, slotKey } from '@/lib/board'
import { energyEs, type ReplaySlot, type ReplayState, statusEs } from '@/lib/replay'
import { cn } from '@/lib/utils'
import { useBoardCard } from './BoardContext'
import { CardArt } from './CardArt'
import { EnergyDot, EnergyDots } from './EnergyDot'
import { useLongPress } from './useLongPress'

const STATUS_TONE: Record<string, string> = {
  Poisoned: 'bg-purple-600',
  Burned: 'bg-orange-600',
  Asleep: 'bg-sky-600',
  Paralyzed: 'bg-yellow-500 text-black',
  Confused: 'bg-pink-600',
}

export interface TableHandlers {
  /** A tap on a Pokémon or an empty spot. */
  onSlot?: ((at: SlotRef) => void) | undefined
  /** A tap on a card of a hand. */
  onHandCard?: ((engineId: string, player: Seat) => void) | undefined
  /** A tap on the Energy Zone. */
  onEnergy?: ((player: Seat) => void) | undefined
  /** Long press anywhere, or a tap with nothing to play: show the card. */
  onInspect: (engineId: string, at?: SlotRef) => void
  onDiscard?: ((player: Seat) => void) | undefined
}

export interface TableProps extends TableHandlers {
  state: ReplayState
  /** Whose side is at the bottom (you, in a game against the bot). */
  bottom: Seat
  labels: [string, string]
  changes?: BoardChanges | null | undefined
  /** Changes when the moment changes: restarts the animations. */
  stamp: string | number
  /** A hand shown only as a count (the bot's, in a game). */
  hiddenHand?: Seat | null | undefined
  /** Spots that can be touched now (targets of what is selected, or of a «pick a Pokémon» decision). */
  targets?: ReadonlySet<string> | undefined
  selected?: ActionSource | null | undefined
  /** Cards of the bottom hand that can be played. */
  playable?: ReadonlySet<string> | undefined
  energyPlayable?: boolean | undefined
  banner?: ReactNode
}

function PrizeBadge({ points }: { points: number }) {
  if (points < 2) return null
  return (
    <span
      className="absolute top-0.5 right-0.5 rounded bg-amber-400 px-1 text-[10px] leading-4 font-bold text-black shadow"
      title={`Si cae, el rival suma ${points} puntos`}
    >
      {points}
    </span>
  )
}

function HpBar({ slot }: { slot: ReplaySlot }) {
  const tone = hpTone(slot.hp, slot.max_hp)
  const width = slot.max_hp > 0 ? Math.max(0, Math.min(100, (slot.hp / slot.max_hp) * 100)) : 100
  return (
    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 pt-0.5 pb-0.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
            tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-400' : 'bg-red-500',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="text-center text-[10px] leading-3 font-semibold text-white tabular-nums">
        {slot.hp}/{slot.max_hp}
      </div>
    </div>
  )
}

export function PokemonTile({
  slot,
  at,
  size,
  stamp,
  delta,
  fresh,
  knockedOut,
  target,
  selected,
  onSlot,
  onInspect,
}: {
  slot: ReplaySlot | null
  at: SlotRef
  size: 'lg' | 'md'
  stamp: string | number
  delta?: number | undefined
  fresh?: boolean | undefined
  knockedOut?: string | null | undefined
  target?: boolean | undefined
  selected?: boolean | undefined
  onSlot?: ((at: SlotRef) => void) | undefined
  onInspect: (engineId: string, at?: SlotRef) => void
}) {
  const card = useBoardCard(slot?.card)
  const press = useLongPress(
    () => (onSlot ? onSlot(at) : slot ? onInspect(slot.card, at) : undefined),
    () => (slot ? onInspect(slot.card, at) : undefined),
  )
  const place = at.index === 0 ? 'activo' : `banca ${at.index}`
  const ko = knockedOut ? (
    <span
      key={`ko-${stamp}`}
      className="board-float pointer-events-none absolute inset-x-0 top-1/3 z-10 text-center text-lg font-black text-red-500 drop-shadow"
    >
      KO
    </span>
  ) : null
  if (!slot) {
    return (
      <button
        type="button"
        disabled={!target}
        onClick={() => onSlot?.(at)}
        aria-label={`${place} vacío${target ? ': elegir' : ''}`}
        className={cn(
          'relative flex aspect-[5/6] w-full items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground',
          target && 'board-target border-primary bg-primary/10 text-primary',
        )}
      >
        {target ? 'acá' : size === 'lg' ? 'activo' : ''}
        {ko}
      </button>
    )
  }
  const statuses = slot.status.map((status) => String(status))
  return (
    <button
      type="button"
      {...press}
      aria-label={`${card?.name ?? slot.card} (${place}), ${slot.hp} de ${slot.max_hp} PS${target ? ': elegir' : ''}`}
      className={cn(
        'relative aspect-[5/6] w-full touch-manipulation overflow-hidden rounded-md border bg-muted text-left shadow-sm select-none',
        fresh && 'board-fresh',
        target && 'board-target ring-2 ring-primary',
        selected && 'ring-2 ring-amber-400',
      )}
    >
      <CardArt engineId={slot.card} />
      <PrizeBadge points={card?.edition?.prizePoints ?? 1} />
      {slot.energy.length > 0 ? (
        <EnergyDots energies={slot.energy} className="absolute top-0.5 left-0.5 max-w-[70%]" />
      ) : null}
      <div className="absolute right-0.5 bottom-7 flex flex-col items-end gap-0.5">
        {statuses.map((status) => (
          <span
            key={status}
            className={cn(
              'rounded px-1 text-[9px] leading-4 font-bold text-white',
              STATUS_TONE[status] ?? 'bg-gray-600',
            )}
            title={statusEs(status)}
          >
            {statusEs(status).slice(0, 3).toUpperCase()}
          </span>
        ))}
        {slot.tools.length > 0 ? (
          <span className="rounded bg-slate-700 p-0.5 text-white" title={slot.tools.join(', ')}>
            <WrenchIcon className="size-3" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <HpBar slot={slot} />
      {delta ? (
        <span
          key={`delta-${stamp}`}
          className={cn(
            'board-float pointer-events-none absolute inset-x-0 top-1/4 z-10 text-center text-xl font-black drop-shadow',
            delta < 0 ? 'text-red-500' : 'text-emerald-400',
          )}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      ) : null}
      {ko}
    </button>
  )
}

function HandCard({
  engineId,
  player,
  playable,
  selected,
  onHandCard,
  onInspect,
}: {
  engineId: string
  player: Seat
  playable: boolean
  selected: boolean
  onHandCard?: ((engineId: string, player: Seat) => void) | undefined
  onInspect: (engineId: string) => void
}) {
  const card = useBoardCard(engineId)
  const press = useLongPress(
    () => (onHandCard ? onHandCard(engineId, player) : onInspect(engineId)),
    () => onInspect(engineId),
  )
  return (
    <button
      type="button"
      {...press}
      aria-label={`${card?.name ?? engineId} (mano)${playable ? ', se puede jugar' : ''}`}
      className={cn(
        'relative aspect-[63/88] w-11 shrink-0 touch-manipulation overflow-hidden rounded border bg-muted select-none',
        playable && 'ring-2 ring-emerald-400 board-glow',
        selected && 'ring-2 ring-amber-400 -translate-y-1',
        !playable && onHandCard && 'opacity-80',
      )}
    >
      <CardArt engineId={engineId} />
    </button>
  )
}

function Points({ points }: { points: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={`${points} de 3 puntos`}
      role="img"
      aria-label={`${points} puntos`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full border border-amber-400',
            i < points ? 'bg-amber-400' : 'bg-transparent',
          )}
        />
      ))}
    </span>
  )
}

function Side({ props, player, top }: { props: TableProps; player: Seat; top: boolean }) {
  const { state, changes, stamp, targets, selected, playable, energyPlayable } = props
  const data = state.players[player]
  if (!data) return null
  const turn = state.current_player === player
  const [active, ...bench] = data.in_play
  const knocked = new Map((changes?.knockedOut[player] ?? []).map((ko) => [ko.index, ko.engineId]))
  const tile = (slot: ReplaySlot | null, index: number) => {
    const at = { player, index }
    const change = changes?.slots.get(slotKey(at))
    return (
      <PokemonTile
        key={index}
        slot={slot}
        at={at}
        size={index === 0 ? 'lg' : 'md'}
        stamp={stamp}
        delta={change?.delta}
        fresh={change?.fresh}
        knockedOut={knocked.get(index) ?? null}
        target={targets?.has(slotKey(at))}
        selected={selected ? sameSource(selected, { kind: 'slot', player, index }) : false}
        onSlot={props.onSlot}
        onInspect={props.onInspect}
      />
    )
  }
  const showHand = props.hiddenHand !== player && data.hand.length > 0
  const zone = data.energy_zone
  const energyButton =
    zone.current || zone.next ? (
      <button
        type="button"
        disabled={!energyPlayable || !props.onEnergy}
        onClick={() => props.onEnergy?.(player)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5',
          energyPlayable && 'board-target border-primary bg-primary/10',
          selected?.kind === 'energy' && 'ring-2 ring-amber-400',
        )}
        aria-label={`Zona de energía: ${zone.current ? energyEs(zone.current) : 'nada'}, luego ${zone.next ? energyEs(zone.next) : 'nada'}`}
      >
        {zone.current ? <EnergyDot energy={zone.current} className="size-5 text-[10px]" /> : null}
        {zone.next ? <EnergyDot energy={zone.next} className="opacity-60" /> : null}
      </button>
    ) : null
  const info = (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn('min-w-0 flex-1 truncate font-medium', turn && 'text-primary')}>
        {turn ? '▸ ' : ''}
        {props.labels[player]}
      </span>
      {energyButton}
      <span className="text-muted-foreground tabular-nums" title="Cartas en la mano">
        mano {data.hand_count}
      </span>
      <span className="text-muted-foreground tabular-nums" title="Cartas en el mazo">
        mazo {data.deck_count}
      </span>
      <button
        type="button"
        onClick={() => props.onDiscard?.(player)}
        disabled={!props.onDiscard}
        className="text-muted-foreground underline-offset-2 tabular-nums hover:underline"
      >
        desc. {data.discard.length + data.discard_energies.length}
      </button>
      <Points points={state.points[player]} />
    </div>
  )
  const row = (
    <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] items-end gap-1.5">
      {tile(active ?? null, 0)}
      {bench.map((slot, i) => tile(slot, i + 1))}
    </div>
  )
  const hand = showHand ? (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {data.hand.map((engineId, index) => (
        <HandCard
          // biome-ignore lint/suspicious/noArrayIndexKey: a hand can hold two copies of a card
          key={`${engineId}-${index}`}
          engineId={engineId}
          player={player}
          playable={!top && (playable?.has(engineId) ?? false)}
          selected={!top && selected?.kind === 'hand' && selected.engineId === engineId}
          onHandCard={top ? undefined : props.onHandCard}
          onInspect={props.onInspect}
        />
      ))}
    </div>
  ) : null
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-lg border p-1.5', turn && 'border-primary/50')}>
      {top ? (
        <>
          {info}
          {hand}
          {row}
        </>
      ) : (
        <>
          {row}
          {info}
          {hand}
        </>
      )}
    </div>
  )
}

export function Table(props: TableProps) {
  const top: Seat = props.bottom === 0 ? 1 : 0
  const stadium = props.state.stadium
  return (
    <div className="relative flex flex-col gap-1.5">
      <Side props={props} player={top} top />
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        {stadium ? (
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => props.onInspect(stadium)}>
            Estadio: <StadiumName engineId={stadium} />
          </button>
        ) : null}
        <span>turno {props.state.turn}</span>
      </div>
      <Side props={props} player={props.bottom} top={false} />
      {props.banner ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">{props.banner}</div>
      ) : null}
    </div>
  )
}

function StadiumName({ engineId }: { engineId: string }) {
  const card = useBoardCard(engineId)
  return <>{card?.name ?? engineId}</>
}

/** A short centered banner («Tu turno»), re-animated each time its key changes. */
export function TurnBanner({ text, stamp }: { text: string; stamp: string | number }) {
  return (
    <span
      key={stamp}
      className="board-banner rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground shadow-lg"
    >
      {text}
    </span>
  )
}
