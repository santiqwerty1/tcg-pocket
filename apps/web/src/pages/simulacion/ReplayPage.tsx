/**
 * Text replay viewer (PLAN §3.7, Fase 6): a simulated game step by step, the bot's choices told in Spanish, and the
 * board (active, bench, hand, points, energy zone) at the selected step. Steps with a single option are the engine's
 * forced moves; «solo decisiones» hides them.
 */
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { ReplayResponse } from '@/api/schemas'
import { useReplay } from '@/api/simulations'
import { ErrorState, LoadingRows } from '@/components/ListState'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { shortSha } from '@/lib/format'
import {
  energyEs,
  groupByTurn,
  isReplay,
  type Replay,
  ReplayReader,
  type ReplaySlot,
  type ReplayState,
  statusEs,
} from '@/lib/replay'
import { cn } from '@/lib/utils'

const SIDE = ['A', 'B'] as const

function energySummary(energies: string[]): string {
  const counts = new Map<string, number>()
  for (const energy of energies) counts.set(energy, (counts.get(energy) ?? 0) + 1)
  return [...counts].map(([energy, count]) => `${energyEs(energy)}${count > 1 ? ` ×${count}` : ''}`).join(', ')
}

function Slot({ slot, reader, active }: { slot: ReplaySlot | null; reader: ReplayReader; active?: boolean }) {
  if (!slot) {
    return (
      <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        vacío
      </div>
    )
  }
  const damaged = slot.hp < slot.max_hp
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5 rounded-md border p-1.5 text-xs', active && 'border-primary')}>
      <span className="truncate font-medium" title={slot.card}>
        {reader.name(slot.card)}
      </span>
      <span className={cn('tabular', damaged ? 'text-destructive' : 'text-muted-foreground')}>
        {slot.hp}/{slot.max_hp} PS
      </span>
      {slot.energy.length > 0 ? <span className="text-muted-foreground">{energySummary(slot.energy)}</span> : null}
      {slot.tools.length > 0 ? (
        <span className="hidden text-muted-foreground md:block">
          {slot.tools.map((tool) => reader.name(tool)).join(', ')}
        </span>
      ) : null}
      {slot.status.length > 0 ? (
        <span className="text-warning">{slot.status.map((status) => statusEs(status)).join(', ')}</span>
      ) : null}
    </div>
  )
}

function PlayerBoard({
  state,
  player,
  reader,
  deck,
  bot,
}: {
  state: ReplayState
  player: 0 | 1
  reader: ReplayReader
  deck: string | null
  bot: string
}) {
  const data = state.players[player]
  const [active, ...bench] = data.in_play
  const turn = state.current_player === player
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-lg border p-2', turn && 'border-primary/60')}>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{SIDE[player]}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{deck ?? '—'}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular md:hidden">
          mano {data.hand_count} · mazo {data.deck_count}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular" title="Puntos">
          {state.points[player]} pts
        </span>
      </div>
      <div className="hidden text-xs text-muted-foreground md:block">
        {bot} · mano {data.hand_count} · mazo {data.deck_count} · descarte {data.discard.length}
        {data.energy_zone.current || data.energy_zone.next
          ? ` · zona de energía: ${data.energy_zone.current ? energyEs(data.energy_zone.current) : '—'} (luego ${
              data.energy_zone.next ? energyEs(data.energy_zone.next) : '—'
            })`
          : ''}
      </div>
      <div className="grid grid-cols-4 gap-1">
        <Slot slot={active ?? null} reader={reader} active />
        {bench.map((slot, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: bench spots are positional
          <Slot key={index} slot={slot} reader={reader} />
        ))}
      </div>
      {data.hand.length > 0 ? (
        <div className="hidden text-xs md:block">
          <span className="text-muted-foreground">Mano: </span>
          {data.hand.map((card) => reader.name(card)).join(', ')}
        </div>
      ) : null}
    </div>
  )
}

function Viewer({ data, replay, replayId }: { data: ReplayResponse; replay: Replay; replayId: string }) {
  const reader = useMemo(() => new ReplayReader(replay, data.names), [replay, data.names])
  const [onlyChoices, setOnlyChoices] = useState(true)
  const visible = useMemo(
    () =>
      replay.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !onlyChoices || step.options.length > 1 || step.turn === 0),
    [replay.steps, onlyChoices],
  )
  const [selected, setSelected] = useState(0)
  const position = Math.max(
    0,
    visible.findIndex((item) => item.index >= selected),
  )
  const current = visible[position]?.step ?? replay.steps[0]
  const selectedRef = useRef<HTMLLIElement | null>(null)

  const groups = useMemo(() => groupByTurn(replay.steps), [replay.steps])
  const visibleSet = new Set(visible.map((item) => item.index))
  const winner = reader.winner()
  const final = replay.final_state
  const go = (next: number) => {
    const clamped = Math.min(visible.length - 1, Math.max(0, next))
    const target = visible[clamped]
    if (!target) return
    setSelected(target.index)
    requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: 'center' }))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link to={`/simulacion/${data.game.jobId}`} className="text-sm text-primary hover:underline">
          {data.game.jobLabel}
        </Link>
        <p className="text-sm">
          <strong>A</strong> {data.game.decks[0] ?? '—'} <span className="text-muted-foreground">vs</span>{' '}
          <strong>B</strong> {data.game.decks[1] ?? '—'}
        </p>
        <p className="text-sm font-medium">
          {winner === null
            ? `Empate en el turno ${final.turn}`
            : `Ganó ${SIDE[winner]} en el turno ${final.turn}, ${final.points[winner]}–${final.points[1 - winner]} puntos`}
        </p>
        <p className="text-xs text-muted-foreground">
          Partida {data.game.gameIndex + 1} · semilla <code className="font-mono">{data.game.seed}</code> · motor{' '}
          <code className="font-mono">{shortSha(data.game.engineRev)}</code> · {replay.steps.length} pasos
        </p>
        <p className="text-xs">
          <a
            href={`/viewer/index.html?url=${encodeURIComponent(`/api/simulations/replays/${replayId}/raw`)}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Ver en el visor gráfico de deckgym
          </a>{' '}
          <span className="text-muted-foreground">
            (en inglés; código AGPL-3.0:{' '}
            <a
              href={`https://github.com/bcollazo/deckgym-core/tree/${data.game.engineRev}/viewer`}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
            >
              fuente
            </a>
            )
          </span>
        </p>
      </div>

      {current ? (
        <div className="sticky top-0 z-10 flex flex-col gap-2 bg-background pb-2">
          <PlayerBoard
            state={current.state}
            player={1}
            reader={reader}
            deck={data.game.decks[1]}
            bot={data.game.playersEs[1]}
          />
          <PlayerBoard
            state={current.state}
            player={0}
            reader={reader}
            deck={data.game.decks[0]}
            bot={data.game.playersEs[0]}
          />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Primer paso" onClick={() => go(0)}>
              <ChevronsLeftIcon />
            </Button>
            <Button variant="outline" size="icon" aria-label="Paso anterior" onClick={() => go(position - 1)}>
              <ChevronLeftIcon />
            </Button>
            <span className="min-w-0 flex-1 text-center text-xs text-muted-foreground tabular">
              turno {current.turn} · paso {position + 1}/{visible.length}
            </span>
            <Button variant="outline" size="icon" aria-label="Paso siguiente" onClick={() => go(position + 1)}>
              <ChevronRightIcon />
            </Button>
            <Button variant="outline" size="icon" aria-label="Último paso" onClick={() => go(visible.length - 1)}>
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      ) : null}

      <Section
        title="Jugadas"
        action={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch id="replay-only-choices" checked={onlyChoices} onCheckedChange={setOnlyChoices} />
            <label htmlFor="replay-only-choices" title="Oculta los pasos con una sola opción">
              Solo decisiones
            </label>
          </div>
        }
      >
        <ol className="flex flex-col gap-2">
          {groups.map((group) => {
            const steps = group.steps.filter(({ index }) => visibleSet.has(index))
            if (steps.length === 0) return null
            return (
              <li key={`${group.turn}-${group.actor}-${group.steps[0]?.index}`} className="rounded-lg border">
                <div className="border-b bg-muted/40 px-2 py-1 text-xs font-medium">
                  {group.turn === 0 ? 'Preparación' : `Turno ${group.turn}`} · {SIDE[group.actor]}
                </div>
                <ul className="divide-y">
                  {steps.map(({ index, step }) => {
                    const option = step.options[step.chosen]
                    const text = option ? reader.describe(option.action, step.state, step.actor, option.text) : '—'
                    const isSelected = index === (visible[position]?.index ?? -1)
                    return (
                      <li key={index} ref={isSelected ? selectedRef : undefined}>
                        <button
                          type="button"
                          onClick={() => setSelected(index)}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-sm hover:bg-muted',
                            isSelected && 'bg-primary/10',
                          )}
                        >
                          <span>
                            {step.actor !== group.actor ? <strong>{SIDE[step.actor]}: </strong> : null}
                            {text}
                          </span>
                          {step.options.length > 1 && isSelected ? (
                            <span className="text-xs text-muted-foreground">
                              Opciones:{' '}
                              {step.options
                                .map((other, i) =>
                                  i === step.chosen
                                    ? `[${reader.describe(other.action, step.state, step.actor, other.text)}]`
                                    : reader.describe(other.action, step.state, step.actor, other.text),
                                )
                                .join(' · ')}
                            </span>
                          ) : step.options.length > 1 ? (
                            <span className="text-xs text-muted-foreground">entre {step.options.length} opciones</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
      </Section>
    </div>
  )
}

export function ReplayPage() {
  const { id = '' } = useParams()
  const query = useReplay(id)
  if (query.isPending) return <LoadingRows />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  if (!isReplay(query.data.replay)) {
    return <ErrorState error={new Error('La repetición no tiene el formato esperado del motor.')} />
  }
  return <Viewer data={query.data} replay={query.data.replay} replayId={id} />
}
