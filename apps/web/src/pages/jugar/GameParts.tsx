/**
 * Pieces of a game against the bot (Fase 22): the attacks panel of your active Pokémon, every option grouped by kind
 * (always there, also for actions the board cannot point at), what the bot did since your last move and the
 * end-of-game screen with the rematch.
 */
import {
  ArrowRightLeftIcon,
  BoltIcon,
  FlagIcon,
  HandIcon,
  type LucideIcon,
  PlusIcon,
  RotateCcwIcon,
  SparklesIcon,
  SwordsIcon,
  TrendingUpIcon,
  WrenchIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import type { LiveGame, LiveLogEntry } from '@/api/schemas'
import { useBoardCard } from '@/components/board/BoardContext'
import { AttackLine, useAttacks } from '@/components/board/CardSheet'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { type ActionKind, activeExtras, type BoardAction } from '@/lib/board'
import { editionTypesInPlay } from '@/lib/energies'
import type { ReplayReader, ReplayState } from '@/lib/replay'
import { CoachSummarySection } from './Coach'

export const KIND_ES: Record<ActionKind, { label: string; icon: LucideIcon }> = {
  attack: { label: 'Atacar', icon: SwordsIcon },
  play: { label: 'Jugar carta', icon: HandIcon },
  place: { label: 'Poner en juego', icon: PlusIcon },
  evolve: { label: 'Evolucionar', icon: TrendingUpIcon },
  attach: { label: 'Unir energía', icon: BoltIcon },
  tool: { label: 'Herramienta', icon: WrenchIcon },
  retreat: { label: 'Retirarse', icon: ArrowRightLeftIcon },
  ability: { label: 'Habilidad', icon: SparklesIcon },
  activate: { label: 'Elegir activo', icon: ArrowRightLeftIcon },
  damage: { label: 'Elegir objetivo', icon: SwordsIcon },
  endTurn: { label: 'Terminar el turno', icon: FlagIcon },
  other: { label: 'Otras', icon: SparklesIcon },
}

const KIND_ORDER: ActionKind[] = [
  'attack',
  'activate',
  'damage',
  'evolve',
  'place',
  'attach',
  'tool',
  'play',
  'ability',
  'retreat',
  'other',
  'endTurn',
]

/** Every option of the decision, grouped by kind: the fallback for anything the board does not point at. */
export function OptionsSheet({
  open,
  onOpenChange,
  actions,
  describe,
  hint,
  disabled,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: BoardAction[]
  describe: (action: BoardAction) => string
  hint: number | null
  disabled: boolean
  onChoose: (i: number) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto px-4 pb-6">
        <SheetHeader className="px-0 pb-0">
          <SheetTitle>Todas tus opciones</SheetTitle>
          <SheetDescription>También se juegan tocando las cartas de la mesa.</SheetDescription>
        </SheetHeader>
        {KIND_ORDER.map((kind) => {
          const group = actions.filter((action) => action.kind === kind)
          if (group.length === 0) return null
          const { label, icon: Icon } = KIND_ES[kind]
          return (
            <div key={kind} className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </p>
              {group.map((action) => (
                <Button
                  key={action.i}
                  type="button"
                  variant={hint === action.i ? 'default' : 'outline'}
                  className="h-auto min-h-10 justify-start py-2 text-left whitespace-normal"
                  disabled={disabled}
                  onClick={() => onChoose(action.i)}
                >
                  {describe(action)}
                  {hint === action.i ? <span className="ml-auto text-xs">entrenador</span> : null}
                </Button>
              ))}
            </div>
          )
        })}
      </SheetContent>
    </Sheet>
  )
}

/**
 * What your active Pokémon can do: its attacks as the card prints them (the ones you cannot pay, greyed; +20 when the
 * rival's active is weak to it), the retreat with its cost and an ability.
 */
export function ActiveActions({
  state,
  actions,
  hint,
  disabled,
  describe,
  onChoose,
  onRetreat,
}: {
  state: ReplayState
  actions: BoardAction[]
  hint: number | null
  disabled: boolean
  describe: (action: BoardAction) => string
  onChoose: (i: number) => void
  onRetreat: () => void
}) {
  const mine = state.players[0]?.in_play[0]?.card ?? null
  const theirs = state.players[1]?.in_play[0]?.card ?? null
  const me = useBoardCard(mine)
  const rival = useBoardCard(theirs)
  const attacks = useAttacks(mine)
  const attackOptions = actions.filter((action) => action.kind === 'attack')
  const titleOf = (action: BoardAction) =>
    String(((action.action as { Attack?: { title?: unknown } }).Attack?.title as string | undefined) ?? '')
  // Any of the attacker's types hits a Weakness (C1's dual types, Urshifu's «Double Type»).
  const weak =
    me?.edition && rival?.edition?.weakness && editionTypesInPlay(me.edition).includes(rival.edition.weakness)
      ? `+20 por debilidad de ${rival.name}`
      : null
  const matched = new Set<number>()
  const retreats = actions.filter((action) => action.kind === 'retreat')
  const abilities = actions.filter(
    (action) => action.kind === 'ability' && action.source.kind === 'slot' && action.source.index === 0,
  )
  return (
    <>
      {attacks.map((attack) => {
        const option = attackOptions.find((action) => titleOf(action) === attack.name)
        if (option) matched.add(option.i)
        return option ? (
          <Button
            key={attack.name}
            type="button"
            variant={hint === option.i ? 'default' : 'outline'}
            className="h-auto justify-start py-2 text-left whitespace-normal"
            disabled={disabled}
            onClick={() => onChoose(option.i)}
          >
            <span className="w-full">
              <AttackLine attack={attack} extra={weak} />
            </span>
          </Button>
        ) : (
          <div key={attack.name} className="rounded-md border border-dashed px-3 py-2">
            <AttackLine attack={attack} extra="No se puede usar ahora (energía o efecto)" disabled />
          </div>
        )
      })}
      {attackOptions
        .filter((action) => !matched.has(action.i))
        .map((action) => (
          <Button
            key={action.i}
            type="button"
            variant="outline"
            className="h-auto justify-start py-2 text-left whitespace-normal"
            disabled={disabled}
            onClick={() => onChoose(action.i)}
          >
            {describe(action)}
          </Button>
        ))}
      {abilities.map((action) => (
        <Button key={action.i} type="button" variant="secondary" disabled={disabled} onClick={() => onChoose(action.i)}>
          <SparklesIcon aria-hidden="true" />
          Usar la habilidad{me?.edition?.ability ? `: ${me.edition.ability.name}` : ''}
        </Button>
      ))}
      {activeExtras(actions).map((action) => (
        <Button
          key={action.i}
          type="button"
          variant={hint === action.i ? 'default' : 'outline'}
          className="h-auto justify-start py-2 text-left whitespace-normal"
          disabled={disabled}
          onClick={() => onChoose(action.i)}
        >
          {describe(action)}
        </Button>
      ))}
      {retreats.length > 0 ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRetreat}>
          <ArrowRightLeftIcon aria-hidden="true" />
          Retirarse
          {me?.edition?.retreat !== null && me?.edition?.retreat !== undefined
            ? ` (cuesta ${me.edition.retreat} ${me.edition.retreat === 1 ? 'energía' : 'energías'})`
            : ''}
          : elegí quién entra
        </Button>
      ) : null}
    </>
  )
}

/** The bot's moves since your last choice, told like the log. */
export function BotTurn({
  game,
  reader,
  context,
}: {
  game: LiveGame
  reader: ReplayReader
  context: (entry: LiveLogEntry) => ReplayState
}) {
  const log = game.log
  let lastOwn = -1
  log.forEach((entry, index) => {
    if (entry.actor === 0 && !entry.forced) lastOwn = index
  })
  const moves = log.slice(lastOwn + 1).filter((entry) => entry.actor === 1 && entry.turn > 0)
  if (moves.length === 0) return null
  return (
    <div className="rounded-lg border px-3 py-2 text-sm">
      <p className="pb-1 text-xs font-medium text-muted-foreground">Lo que hizo el bot</p>
      <ul className="flex flex-col gap-0.5">
        {moves.slice(-8).map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: log entries are positional
          <li key={index}>{reader.describe(entry.action, context(entry), entry.actor, entry.text)}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Phase 42: the engine changed while the game was being played, and a worker cannot rebuild it the same way. Not a
 * defeat and not abandoned: what was played stays in the log, and a rematch starts on the engine there is now.
 */
export function EngineChangedScreen({
  game,
  pending,
  onRematch,
}: {
  game: LiveGame
  pending: boolean
  onRematch: (sameSeed: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/50 p-3">
      <div>
        <p className="text-lg font-bold">Cambió el motor</p>
        <p className="text-sm text-muted-foreground">
          {game.error ?? 'Esta partida no se puede seguir igual con el motor de ahora: lo jugado queda en el registro.'}{' '}
          No cuenta como derrota ni como abandono.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => onRematch(false)}>
          <SwordsIcon aria-hidden="true" />
          Revancha
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onRematch(true)}>
          <RotateCcwIcon aria-hidden="true" />
          Jugarla de nuevo
        </Button>
      </div>
    </div>
  )
}

/** The end of the game: the result, the coach's summary and what to do next. */
export function EndScreen({
  game,
  reader,
  pending,
  onRematch,
  onUndo,
}: {
  game: LiveGame
  reader: ReplayReader
  pending: boolean
  onRematch: (sameSeed: boolean) => void
  onUndo: () => void
}) {
  const state = game.finalState as unknown as ReplayState | null
  const points = state?.points ?? [0, 0]
  const title = game.winner === 'you' ? '¡Ganaste!' : game.winner === 'bot' ? 'Perdiste' : 'Empate'
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary/50 p-3">
      <div>
        <p className="text-2xl font-bold">{title}</p>
        <p className="text-sm text-muted-foreground">
          {points[0]}–{points[1]} puntos en {game.turns ?? 0} turnos
          {game.undos > 0 ? ` · deshiciste ${game.undos} ${game.undos === 1 ? 'jugada' : 'jugadas'}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => onRematch(false)}>
          <SwordsIcon aria-hidden="true" />
          Revancha
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onRematch(true)}>
          <RotateCcwIcon aria-hidden="true" />
          Jugarla de nuevo
        </Button>
        {game.choices > 0 ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onUndo}>
            Deshacer la última jugada
          </Button>
        ) : null}
        {game.replay ? (
          <Button asChild variant="ghost">
            <Link to={`/jugar/${game.id}/repeticion`}>Ver la repetición</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        «Revancha»: mismos mazos y bot, otro reparto. «Jugarla de nuevo»: el mismo reparto desde el principio, para
        probar otra línea.
      </p>
      {game.coachSummary && game.coachSummary.decisions > 0 ? (
        <CoachSummarySection summary={game.coachSummary} reader={reader} final />
      ) : null}
    </div>
  )
}
