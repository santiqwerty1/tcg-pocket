/**
 * A game against the bot (PLAN §3.7, Fase 8; the board of Fase 22). The game runs on the PC; this page shows the
 * table as your seat sees it and plays by touch: a card of your hand lights the spots where it can go, the Energy
 * Zone lights where the energy can be attached, your active opens its attacks and the retreat; a long press shows
 * any card. Every option stays one tap away under «Opciones». The coach, undo, the bot's last moves and the
 * end-of-game screen with the rematch complete it.
 */
import { FlagIcon, LayersIcon, LightbulbIcon, ListIcon, Undo2Icon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useAbandon, useChoose, useHint, usePlayGame, useRematch, useUndo } from '@/api/play'
import type { LiveGame, LiveLogEntry } from '@/api/schemas'
import { BoardProvider } from '@/components/board/BoardContext'
import { CardGridSheet } from '@/components/board/CardSheet'
import { Table, TurnBanner } from '@/components/board/Table'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { type BoardAction, boardChanges, type Seat } from '@/lib/board'
import { type Replay, ReplayReader, type ReplayState } from '@/lib/replay'
import { cn } from '@/lib/utils'
import { CoachLast, CoachSummarySection } from './Coach'
import { BotTurn, EndScreen, OptionsSheet } from './GameParts'
import { TouchPlaySheet, useTouchPlay } from './useTouchPlay'

const WHO = ['Vos', 'Bot'] as const

/** A reader over the game's cards: Spanish names and the engine's English ones (to translate its own texts). */
function readerFor(game: LiveGame): ReplayReader {
  const replay: Replay = {
    version: 1,
    game_id: String(game.id),
    seed: game.seed,
    players: [],
    cards: game.cards as unknown as Replay['cards'],
    steps: [],
    final_state: null as unknown as ReplayState,
    outcome: null,
  }
  return new ReplayReader(replay, game.names)
}

/** Just enough of a state to name the cards an action points at (the log keeps only what is in play). */
function contextState(entry: LiveLogEntry): ReplayState {
  const inPlay = entry.ctx?.in_play ?? [[], []]
  const slot = (card: string | null) =>
    card ? { card, hp: 0, max_hp: 0, energy: [], tools: [], status: [], played_this_turn: false } : null
  const player = (cards: (string | null)[] | undefined) => ({
    hand: [],
    hand_count: 0,
    deck_count: 0,
    discard: [],
    discard_energies: [],
    energy_zone: { current: null, next: null },
    in_play: (cards ?? []).map(slot),
  })
  return {
    turn: entry.turn,
    current_player: entry.actor,
    points: [0, 0],
    winner: null,
    players: [player(inPlay[0]), player(inPlay[1])],
    stadium: entry.ctx?.stadium ?? null,
  }
}

/** In the game both players set up at once; the engine does it in turns: the bot's spots stay hidden until yours. */
function masked(state: ReplayState, setup: boolean): ReplayState {
  if (!setup) return state
  const bot = state.players[1]
  return {
    ...state,
    players: [state.players[0], { ...bot, in_play: bot.in_play.map(() => null) }],
  }
}

function statusLine(game: LiveGame): { text: string; tone: 'muted' | 'turn' | 'end' | 'error' } {
  switch (game.status) {
    case 'queued':
      return game.workerOnline
        ? { text: 'La PC está preparando la partida…', tone: 'muted' }
        : { text: 'La PC está apagada: la partida sigue cuando la prendas.', tone: 'muted' }
    case 'running':
      return game.workerOnline
        ? { text: 'Juega el bot…', tone: 'muted' }
        : { text: 'Esperando a la PC (la partida sigue donde quedó cuando se prenda).', tone: 'muted' }
    case 'waiting':
      return { text: 'Tu turno', tone: 'turn' }
    case 'done':
      return { text: 'Partida terminada', tone: 'end' }
    case 'abandoned':
      return { text: 'Partida abandonada.', tone: 'end' }
    case 'failed':
      return { text: `La partida falló: ${game.error ?? 'error del motor'}`, tone: 'error' }
  }
}

function LogList({ game, reader }: { game: LiveGame; reader: ReplayReader }) {
  const [open, setOpen] = useState(false)
  const entries = useMemo(
    () =>
      game.log
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => !entry.forced || entry.actor === 1)
        .reverse(),
    [game.log],
  )
  if (game.log.length === 0) return null
  return (
    <Section
      title="Lo que pasó"
      action={
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(!open)}>
          {open ? 'Ocultar' : 'Mostrar'}
        </Button>
      }
    >
      {open ? (
        <ol className="flex flex-col gap-0.5 text-sm">
          {entries.map(({ entry, index }) => (
            <li key={index} className={cn('flex gap-2', entry.forced && 'text-muted-foreground')}>
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular">
                {entry.turn === 0 ? 'inicio' : `turno ${entry.turn}`}
              </span>
              <span className={cn('w-8 shrink-0 text-xs font-medium', entry.actor === 1 && 'text-primary')}>
                {WHO[entry.actor] ?? '?'}
              </span>
              <span className="min-w-0 flex-1">
                {reader.describe(entry.action, contextState(entry), entry.actor, entry.text)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </Section>
  )
}

export function GamePage() {
  const { id = '' } = useParams()
  const query = usePlayGame(id)
  const game = query.data
  const reader = useMemo(() => (game ? readerFor(game) : null), [game])
  if (query.isLoading) return <LoadingRows rows={6} />
  if (query.isError || !game || !reader) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return (
    <BoardProvider reader={reader} cardIds={game.cardIds}>
      <Game game={game} reader={reader} refetch={() => void query.refetch()} />
    </BoardProvider>
  )
}

function Game({ game, reader, refetch }: { game: LiveGame; reader: ReplayReader; refetch: () => void }) {
  const navigate = useNavigate()
  const choose = useChoose(String(game.id))
  const abandon = useAbandon(String(game.id))
  const hint = useHint(String(game.id))
  const undo = useUndo(String(game.id))
  const rematch = useRematch(String(game.id))
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [discard, setDiscard] = useState<Seat | null>(null)
  const [rivalList, setRivalList] = useState(false)

  const decision = game.decision
  const ply = decision?.ply ?? null
  // States seen at each decision: what changed since the previous one floats over the cards.
  const seen = useRef(new Map<number, ReplayState>())
  const lastState = useRef<ReplayState | null>(null)
  if (decision) {
    seen.current.set(decision.ply, decision.state as unknown as ReplayState)
    lastState.current = decision.state as unknown as ReplayState
  }
  const finalState = game.finalState as unknown as ReplayState | null
  const raw = (decision?.state as unknown as ReplayState | undefined) ?? finalState ?? lastState.current
  const setup = decision?.turn === 0
  const state = raw ? masked(raw, setup) : null
  const previous = ply !== null ? (seen.current.get(ply - 1) ?? null) : null
  const changes = useMemo(() => (state && previous ? boardChanges(previous, state) : null), [state, previous])

  // A short buzz when it becomes your turn (Android), only if you are looking.
  const lastStatus = useRef(game.status)
  useEffect(() => {
    if (game.status === 'waiting' && lastStatus.current !== 'waiting' && document.visibilityState === 'visible') {
      navigator.vibrate?.(40)
    }
    lastStatus.current = game.status
  }, [game.status])

  const play = useTouchPlay({
    options: decision?.actions ?? null,
    state,
    resetKey: ply,
    onChoose: (i) => void send(i),
  })
  const { actions, selected, setSelected, targets, playable, energyPlayable, pick } = play
  const describe = (action: BoardAction) =>
    reader.describe(action.action, state ?? contextState({ turn: 0, actor: 0, text: '', action: null }), 0, action.text)
  const endTurn = actions.find((action) => action.kind === 'endTurn') ?? null
  const canAttack = actions.some((action) => action.kind === 'attack')
  const busy = choose.isPending || undo.isPending

  async function send(i: number) {
    if (!decision) return
    setOptionsOpen(false)
    try {
      await choose.mutateAsync({ ply: decision.ply, i })
    } catch (error) {
      toast.error(errorMessage(error))
      refetch()
    }
  }

  const line = statusLine(game)
  const active = game.status === 'queued' || game.status === 'running' || game.status === 'waiting'
  return (
    <div className="flex flex-col gap-3 pb-28">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="font-medium">{game.human.label}</span>
            <span className="text-muted-foreground"> contra </span>
            <span className="font-medium">{game.rival.label}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            #{game.id} · bot {game.botEs}
            {game.coach ? ' · entrenador' : ''}
            {game.undos > 0 ? ` · ${game.undos} ${game.undos === 1 ? 'deshecha' : 'deshechas'}` : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRivalList(true)}>
          <LayersIcon aria-hidden="true" />
          Mazo del bot
        </Button>
      </div>

      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          line.tone === 'turn' && 'border-primary font-medium text-primary',
          line.tone === 'error' && 'border-destructive text-destructive',
        )}
        role="status"
      >
        {game.status === 'running' && game.workerOnline ? <Spinner className="size-4" /> : null}
        <span className="flex-1">
          {line.text}
          {decision && pick ? ': elegí un Pokémon marcado' : ''}
          {decision && setup ? ': prepará tu mesa (el bot pone la suya a la vez)' : ''}
        </span>
      </div>

      {game.status === 'done' ? (
        <EndScreen
          game={game}
          reader={reader}
          pending={rematch.isPending || undo.isPending}
          onRematch={(sameSeed) =>
            rematch.mutate(
              { sameSeed },
              {
                onSuccess: (created) => navigate(`/jugar/${created.id}`),
                onError: (error) => toast.error(errorMessage(error)),
              },
            )
          }
          onUndo={() => undo.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })}
        />
      ) : null}

      {game.status === 'waiting' ? <BotTurn game={game} reader={reader} context={contextState} /> : null}

      {state ? (
        <Table
          state={state}
          bottom={0}
          labels={[`Vos: ${game.human.label}`, `Bot: ${game.rival.label}`]}
          changes={changes}
          stamp={ply ?? 'end'}
          hiddenHand={1}
          targets={targets}
          selected={selected}
          playable={playable}
          energyPlayable={energyPlayable}
          onSlot={play.onSlot}
          onHandCard={play.onHandCard}
          onEnergy={play.onEnergy}
          onInspect={play.inspect}
          onDiscard={setDiscard}
          banner={
            decision && previous?.turn !== decision.turn ? (
              <TurnBanner
                text={decision.turn === 0 ? 'Prepará tu mesa' : `Tu turno · ${decision.turn}`}
                stamp={decision.ply}
              />
            ) : null
          }
        />
      ) : null}

      {game.coach ? <CoachLast game={game} reader={reader} /> : null}
      {game.coachSummary && game.coachSummary.decisions > 0 && game.status !== 'done' ? (
        <CoachSummarySection summary={game.coachSummary} reader={reader} final={false} />
      ) : null}

      <LogList game={game} reader={reader} />

      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button type="button" variant="ghost" onClick={() => setConfirmAbandon(true)}>
            <FlagIcon aria-hidden="true" />
            Abandonar
          </Button>
        ) : null}
        {game.replay ? (
          <Button asChild variant="outline">
            <Link to={`/jugar/${game.id}/repeticion`}>Ver la repetición</Link>
          </Button>
        ) : null}
        {!active ? (
          <Button asChild variant="ghost">
            <Link to="/jugar">Otra partida</Link>
          </Button>
        ) : null}
      </div>

      {decision ? (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-background/95 px-3 py-2 backdrop-blur pb-safe">
          {selected ? (
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <span className="flex-1 text-primary">Tocá un lugar marcado</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <XIcon aria-hidden="true" />
                Cancelar
              </Button>
            </div>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => setOptionsOpen(true)}>
              <ListIcon aria-hidden="true" />
              Opciones ({actions.length})
            </Button>
            {decision.hintAvailable ? (
              <Button
                type="button"
                variant={decision.hint !== null ? 'secondary' : 'ghost'}
                size="sm"
                disabled={hint.isPending || decision.hint !== null}
                onClick={() =>
                  hint.mutate({ ply: decision.ply }, { onError: (error) => toast.error(errorMessage(error)) })
                }
              >
                <LightbulbIcon aria-hidden="true" />
                {decision.hint !== null ? 'Pista abajo' : 'Pista'}
              </Button>
            ) : null}
            {game.choices > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  undo.mutate(undefined, {
                    onSuccess: () => toast.success('Volviendo a tu jugada anterior…'),
                    onError: (error) => toast.error(errorMessage(error)),
                  })
                }
              >
                <Undo2Icon aria-hidden="true" />
                Deshacer
              </Button>
            ) : null}
            {endTurn ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={busy}
                onClick={() => (canAttack ? setConfirmEnd(true) : play.choose(endTurn.i))}
              >
                Terminar turno
              </Button>
            ) : null}
          </div>
          {decision.hint !== null ? (
            <p className="mt-1 text-xs text-primary">
              Entrenador: {(() => {
                const option = actions.find((action) => action.i === decision.hint)
                return option ? describe(option) : '—'
              })()}
            </p>
          ) : null}
        </div>
      ) : null}

      <OptionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        actions={actions}
        describe={describe}
        hint={decision?.hint ?? null}
        disabled={busy}
        onChoose={play.choose}
      />
      <TouchPlaySheet play={play} state={state} describe={describe} hint={decision?.hint ?? null} busy={busy} />
      <CardGridSheet
        title={discard === null ? '' : discard === 0 ? 'Tu descarte' : 'Descarte del bot'}
        cards={
          discard === null || !state ? [] : (state.players[discard]?.discard ?? []).map((engineId) => ({ engineId }))
        }
        energies={discard === null || !state ? [] : state.players[discard]?.discard_energies}
        open={discard !== null}
        onOpenChange={(open) => (open ? undefined : setDiscard(null))}
        onInspect={(engineId) => {
          setDiscard(null)
          play.inspect(engineId)
        }}
      />
      <CardGridSheet
        title={`Mazo del bot: ${game.rival.label}`}
        description="Es una partida de práctica: la lista del bot se ve entera."
        cards={game.decks.rival}
        open={rivalList}
        onOpenChange={setRivalList}
        onInspect={(engineId) => {
          setRivalList(false)
          play.inspect(engineId)
        }}
      />
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="¿Terminar el turno sin atacar?"
        description="Tu activo todavía puede atacar."
        confirmLabel="Terminar turno"
        pending={busy}
        onConfirm={() => {
          setConfirmEnd(false)
          if (endTurn) play.choose(endTurn.i)
        }}
      />
      <ConfirmDialog
        open={confirmAbandon}
        onOpenChange={setConfirmAbandon}
        title="¿Abandonar la partida?"
        description="La PC deja de jugarla; queda en la lista como abandonada."
        confirmLabel="Abandonar"
        destructive
        pending={abandon.isPending}
        onConfirm={() =>
          abandon.mutate(undefined, {
            onSuccess: () => setConfirmAbandon(false),
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}
