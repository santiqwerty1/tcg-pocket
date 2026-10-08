/**
 * A game against a bot (PLAN §3.7, Fase 8): the table as you see it (your hand, both boards, points), the legal
 * actions of your turn as buttons, and what happened, the bot's moves included. The game runs on the PC; this page
 * shows it and sends your choices.
 */
import { FlagIcon, PlayIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/api/client'
import { useAbandon, useChoose, usePlayGame } from '@/api/play'
import type { LiveGame, LiveLogEntry } from '@/api/schemas'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState, LoadingRows, Spinner } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { energyEs, type Replay, ReplayReader, type ReplaySlot, type ReplayState } from '@/lib/replay'
import { cn } from '@/lib/utils'
import { Slot } from '../simulacion/ReplayPage'

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
  const slot = (card: string | null): ReplaySlot | null =>
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

function TableSide({
  state,
  player,
  reader,
  title,
}: {
  state: ReplayState
  player: 0 | 1
  reader: ReplayReader
  title: string
}) {
  const data = state.players[player]
  if (!data) return null
  const [active, ...bench] = data.in_play
  const turn = state.current_player === player
  const hand = Array.isArray(data.hand) ? data.hand : null
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-lg border p-2', turn && 'border-primary/60')}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0 text-sm font-semibold tabular" title="Puntos">
          {state.points[player]} pts
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        mano {data.hand_count} · mazo {data.deck_count} · descarte {data.discard.length}
        {data.energy_zone.current || data.energy_zone.next
          ? ` · energía: ${data.energy_zone.current ? energyEs(data.energy_zone.current) : '—'} (luego ${
              data.energy_zone.next ? energyEs(data.energy_zone.next) : '—'
            })`
          : ''}
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <Slot slot={active ?? null} reader={reader} active />
        {bench.map((slot, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bench spots are positional
          <Slot key={index} slot={slot} reader={reader} />
        ))}
      </div>
      {hand && hand.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {hand.map((card, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a hand can hold two copies of a card
            <Badge key={`${card}-${index}`} variant="secondary" className="font-normal">
              {reader.name(card)}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function statusLine(game: LiveGame): { text: string; tone: 'muted' | 'turn' | 'end' | 'error' } {
  switch (game.status) {
    case 'queued':
      return game.workerOnline
        ? { text: 'La PC está tomando la partida…', tone: 'muted' }
        : { text: 'La PC está apagada: la partida empieza cuando la prendas.', tone: 'muted' }
    case 'running':
      return game.workerOnline
        ? { text: 'Juega el bot…', tone: 'muted' }
        : { text: 'Esperando a la PC (la partida sigue donde quedó cuando se prenda).', tone: 'muted' }
    case 'waiting':
      return { text: 'Tu turno: elegí qué hacer.', tone: 'turn' }
    case 'done':
      return {
        text: `${game.winner === 'you' ? '¡Ganaste!' : game.winner === 'bot' ? 'Perdiste.' : 'Empate.'} ${game.turns ?? 0} turnos.`,
        tone: 'end',
      }
    case 'abandoned':
      return { text: 'Partida abandonada.', tone: 'end' }
    case 'failed':
      return { text: `La partida falló: ${game.error ?? 'error del motor'}`, tone: 'error' }
  }
}

/**
 * In the game both players place their Pokémon at the same time; the engine does it in turns. Until your setup is
 * done (a decision of turn 0 is pending), the bot's placement stays hidden.
 */
function inSetup(game: LiveGame): boolean {
  return game.decision?.turn === 0
}

function LogList({ game, reader }: { game: LiveGame; reader: ReplayReader }) {
  const [all, setAll] = useState(false)
  const hideBotSetup = inSetup(game)
  const entries = useMemo(
    () =>
      game.log
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => !(hideBotSetup && entry.turn === 0 && entry.actor === 1))
        .filter(({ entry }) => all || !entry.forced || entry.actor === 1)
        .reverse(),
    [game.log, all, hideBotSetup],
  )
  if (game.log.length === 0) return null
  const first = game.log.find((entry) => entry.turn === 1)
  return (
    <Section
      title="Lo que pasó"
      action={
        <Button type="button" variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? 'Menos' : 'Todo'}
        </Button>
      }
    >
      {first ? <p className="text-xs text-muted-foreground">Empezó {first.actor === 0 ? 'vos' : 'el bot'}.</p> : null}
      <ol className="flex flex-col gap-0.5 text-sm">
        {entries.slice(0, all ? undefined : 40).map(({ entry, index }) => (
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
    </Section>
  )
}

export function GamePage() {
  const { id = '' } = useParams()
  const query = usePlayGame(id)
  const choose = useChoose(id)
  const abandon = useAbandon(id)
  const [confirm, setConfirm] = useState(false)
  const lastState = useRef<ReplayState | null>(null)
  const game = query.data
  const reader = useMemo(() => (game ? readerFor(game) : null), [game])

  useEffect(() => {
    if (game?.decision) lastState.current = game.decision.state as unknown as ReplayState
  }, [game?.decision])

  if (query.isLoading) return <LoadingRows rows={6} />
  if (query.isError || !game || !reader) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const state =
    (game.decision?.state as unknown as ReplayState | undefined) ??
    (game.finalState as unknown as ReplayState | null) ??
    lastState.current
  const line = statusLine(game)
  const active = game.status === 'queued' || game.status === 'running' || game.status === 'waiting'

  async function pick(i: number) {
    if (!game?.decision) return
    try {
      await choose.mutateAsync({ ply: game.decision.ply, i })
    } catch (error) {
      toast.error(errorMessage(error))
      void query.refetch()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm">
          <span className="font-medium">{game.human.label}</span>
          <span className="text-muted-foreground"> contra </span>
          <span className="font-medium">{game.rival.label}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          #{game.id} · bot {game.botEs} · semilla {game.seed}
        </p>
      </div>

      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          line.tone === 'turn' && 'border-primary text-primary',
          line.tone === 'error' && 'border-destructive text-destructive',
        )}
        role="status"
      >
        {game.status === 'running' && game.workerOnline ? <Spinner className="size-4" /> : null}
        <span className="flex-1">{line.text}</span>
      </div>

      {state ? (
        <div className="flex flex-col gap-2">
          {inSetup(game) ? (
            <div className="rounded-lg border border-dashed p-2 text-sm text-muted-foreground">
              Bot: {game.rival.label} · prepara su mesa (la ves cuando pongas la tuya)
            </div>
          ) : (
            <TableSide state={state} player={1} reader={reader} title={`Bot: ${game.rival.label}`} />
          )}
          {state.stadium ? (
            <p className="text-center text-xs text-muted-foreground">Estadio: {reader.name(state.stadium)}</p>
          ) : null}
          <TableSide state={state} player={0} reader={reader} title={`Vos: ${game.human.label}`} />
        </div>
      ) : null}

      {game.decision ? (
        <Section title={`Tu decisión (turno ${game.decision.turn})`}>
          <div className="flex flex-col gap-1.5">
            {game.decision.actions.map((option) => (
              <Button
                key={option.i}
                type="button"
                variant="outline"
                className="h-auto min-h-11 justify-start py-2 text-left whitespace-normal"
                disabled={choose.isPending}
                onClick={() => void pick(option.i)}
              >
                <PlayIcon className="shrink-0" aria-hidden="true" />
                {reader.describe(
                  option.action,
                  state ?? (game.decision?.state as unknown as ReplayState),
                  0,
                  option.text,
                )}
              </Button>
            ))}
          </div>
        </Section>
      ) : null}

      <LogList game={game} reader={reader} />

      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button type="button" variant="ghost" onClick={() => setConfirm(true)}>
            <FlagIcon aria-hidden="true" />
            Abandonar
          </Button>
        ) : null}
        {game.replay ? (
          <Button asChild variant="outline">
            <a href={`/viewer/index.html?url=${encodeURIComponent(`/api/play/${game.id}/replay/raw`)}`}>
              Ver en el visor de deckgym
            </a>
          </Button>
        ) : null}
        {!active ? (
          <Button asChild>
            <Link to="/jugar">Otra partida</Link>
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="¿Abandonar la partida?"
        description="La PC deja de jugarla; queda en la lista como abandonada."
        confirmLabel="Abandonar"
        destructive
        pending={abandon.isPending}
        onConfirm={() =>
          abandon.mutate(undefined, {
            onSuccess: () => setConfirm(false),
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}
