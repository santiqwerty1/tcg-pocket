/**
 * The replay viewer (Fase 22), for simulated games and for games against the bot: the table after each move, with
 * what it changed floating over the cards; play and pause at three speeds, swipe or arrow keys to step, a slider
 * with the moments that scored points; the options the player had (as bars when there are scores) and, in a game
 * against the bot, what the coach thought of each of your choices.
 */
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PauseIcon,
  PlayIcon,
} from 'lucide-react'
import { type PointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CoachReview } from '@/api/schemas'
import { BoardProvider } from '@/components/board/BoardContext'
import { CardGridSheet, CardSheet } from '@/components/board/CardSheet'
import { Table, TurnBanner } from '@/components/board/Table'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { boardChanges, type Seat, type SlotRef } from '@/lib/board'
import { groupByTurn, type Replay, ReplayReader, type ReplayState, type ReplayStep, scoreLabels } from '@/lib/replay'
import { cn } from '@/lib/utils'
import { VerdictBadge } from '@/pages/jugar/Coach'

const SPEEDS = [1, 2, 4] as const
const STEP_MS = 1500

export interface ReplayViewerProps {
  replay: Replay
  names: Record<string, string>
  cardIds: Record<string, string>
  /** Whose side goes at the bottom. */
  bottom: Seat
  /** Full labels by player index (deck names) and short ones («A», «Vos»). */
  labels: [string, string]
  short: [string, string]
  /** A game against the bot: the coach's review of each of the owner's choices, by ply. */
  reviews?: CoachReview[] | undefined
  /** How to say who won, by player index («Ganaste», «Ganó el bot»); by default «Ganó A». */
  outcome?: [string, string] | undefined
  header?: ReactNode
}

/** The state right after a step: the next step's, or the final one. */
function stateAfter(replay: Replay, index: number): ReplayState {
  return replay.steps[index + 1]?.state ?? replay.final_state
}

function OptionBars({ step, reader }: { step: ReplayStep; reader: ReplayReader }) {
  const labels = scoreLabels(step.scores, step.options.length)
  const scores = labels ? (step.scores ?? []) : null
  const min = scores ? Math.min(...scores) : 0
  const max = scores ? Math.max(...scores) : 0
  return (
    <ul className="flex flex-col gap-1">
      {step.options.map((option, i) => {
        const text = reader.describe(option.action, step.state, step.actor, option.text)
        const width = scores && max > min ? 8 + (((scores[i] ?? min) - min) / (max - min)) * 92 : 100
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
          <li key={i} className="relative overflow-hidden rounded border text-xs">
            {scores ? (
              <span
                className={cn('absolute inset-y-0 left-0', i === step.chosen ? 'bg-primary/25' : 'bg-muted')}
                style={{ width: `${width}%` }}
              />
            ) : null}
            <span className={cn('relative flex gap-2 px-2 py-1', i === step.chosen && 'font-semibold')}>
              <span className="min-w-0 flex-1">{text}</span>
              {labels ? <span className="tabular-nums text-muted-foreground">{labels[i]}</span> : null}
              {i === step.chosen ? (
                <span>
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">elegida</span>
                </span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function ReplayViewer(props: ReplayViewerProps) {
  const reader = useMemo(() => new ReplayReader(props.replay, props.names), [props.replay, props.names])
  return (
    <BoardProvider reader={reader} cardIds={props.cardIds}>
      <Viewer {...props} reader={reader} />
    </BoardProvider>
  )
}

function Viewer({
  replay,
  reader,
  bottom,
  labels,
  short,
  reviews,
  outcome,
  header,
}: ReplayViewerProps & { reader: ReplayReader }) {
  const [onlyChoices, setOnlyChoices] = useState(true)
  const visible = useMemo(
    () =>
      replay.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => !onlyChoices || step.options.length > 1 || step.turn === 0),
    [replay.steps, onlyChoices],
  )
  const [selected, setSelected] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [inspect, setInspect] = useState<{ engineId: string; at?: SlotRef } | null>(null)
  const [discard, setDiscard] = useState<Seat | null>(null)
  const [showAll, setShowAll] = useState(false)
  const position = Math.max(
    0,
    visible.findIndex((item) => item.index >= selected),
  )
  const current = visible[position]
  const previous = position > 0 ? visible[position - 1] : null
  const shown = current ? stateAfter(replay, current.index) : replay.final_state
  const before = previous ? stateAfter(replay, previous.index) : (replay.steps[0]?.state ?? null)
  const changes = useMemo(() => boardChanges(before, shown), [before, shown])

  // The coach's reviews: the n-th choice of the owner (seat 0, more than one option) is ply n.
  const reviewByStep = useMemo(() => {
    const map = new Map<number, CoachReview>()
    if (!reviews) return map
    const byPly = new Map(reviews.map((review) => [review.ply, review]))
    let ply = 0
    replay.steps.forEach((step, index) => {
      if (step.actor !== 0 || step.options.length < 2) return
      ply += 1
      const review = byPly.get(ply)
      if (review) map.set(index, review)
    })
    return map
  }, [reviews, replay.steps])

  // Moments that scored: markers on the slider.
  const markers = useMemo(
    () =>
      visible
        .map((item, i) => {
          const scoredBefore = item.step.state.points
          const after = stateAfter(replay, item.index).points
          const who = after[0] > scoredBefore[0] ? 0 : after[1] > scoredBefore[1] ? 1 : null
          return who === null ? null : { i, who }
        })
        .filter((marker): marker is { i: number; who: 0 | 1 } => marker !== null),
    [visible, replay],
  )

  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(visible.length - 1, Math.max(0, next))
      const target = visible[clamped]
      if (target) setSelected(target.index)
    },
    [visible],
  )

  useEffect(() => {
    if (!playing) return
    if (position >= visible.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => go(position + 1), STEP_MS / speed)
    return () => window.clearTimeout(timer)
  }, [playing, position, visible.length, speed, go])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.key === 'ArrowRight') go(position + 1)
      else if (event.key === 'ArrowLeft') go(position - 1)
      else if (event.key === ' ') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, position])

  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: PointerEvent) => {
    swipe.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: PointerEvent) => {
    const start = swipe.current
    swipe.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) go(position + (dx < 0 ? 1 : -1))
  }

  const step = current?.step
  const turnChanged = !previous || previous.step.turn !== step?.turn
  const review = current ? reviewByStep.get(current.index) : undefined
  const winner = reader.winner()
  const final = replay.final_state
  const inspectSlot =
    inspect?.at !== undefined ? (shown.players[inspect.at.player]?.in_play[inspect.at.index] ?? null) : null

  return (
    <div className="flex flex-col gap-3">
      {header}
      <p className="text-sm font-medium">
        {winner === null
          ? `Empate en el turno ${final.turn}`
          : `${outcome?.[winner] ?? `Ganó ${short[winner]}`} en el turno ${final.turn}, ${final.points[winner]}–${final.points[1 - winner]} puntos`}
      </p>

      {step ? (
        <div onPointerDown={onPointerDown} onPointerUp={onPointerUp} className="touch-pan-y">
          <Table
            state={shown}
            bottom={bottom}
            labels={labels}
            changes={changes}
            stamp={current?.index ?? 0}
            onInspect={(engineId, at) => setInspect(at ? { engineId, at } : { engineId })}
            onDiscard={setDiscard}
            banner={
              turnChanged && position > 0 ? (
                <TurnBanner
                  text={step.turn === 0 ? 'Preparación' : `Turno ${step.turn} · ${short[step.actor]}`}
                  stamp={current?.index ?? 0}
                />
              ) : null
            }
          />
        </div>
      ) : null}

      <div className="sticky bottom-16 z-10 flex flex-col gap-1.5 rounded-lg border bg-background/95 p-2 backdrop-blur">
        <div className="relative h-5">
          <input
            type="range"
            min={0}
            max={Math.max(0, visible.length - 1)}
            value={position}
            onChange={(event) => go(Number(event.target.value))}
            aria-label="Paso de la repetición"
            className="absolute inset-0 w-full accent-primary"
          />
          {markers.map((marker) => (
            <span
              key={marker.i}
              className={cn(
                'pointer-events-none absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full',
                marker.who === bottom ? 'bg-emerald-500' : 'bg-red-500',
              )}
              style={{ left: `${visible.length > 1 ? (marker.i / (visible.length - 1)) * 100 : 0}%` }}
              title={`${short[marker.who]} suma puntos`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Primer paso" onClick={() => go(0)}>
            <ChevronsLeftIcon />
          </Button>
          <Button variant="outline" size="icon" aria-label="Paso anterior" onClick={() => go(position - 1)}>
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon"
            aria-label={playing ? 'Pausa' : 'Reproducir'}
            onClick={() => {
              if (!playing && position >= visible.length - 1) go(0)
              setPlaying(!playing)
            }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button variant="outline" size="icon" aria-label="Paso siguiente" onClick={() => go(position + 1)}>
            <ChevronRightIcon />
          </Button>
          <Button variant="outline" size="icon" aria-label="Último paso" onClick={() => go(visible.length - 1)}>
            <ChevronsRightIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto tabular-nums"
            aria-label={`Velocidad ${speed}×`}
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
          >
            {speed}×
          </Button>
        </div>
      </div>

      {step ? (
        <div className="flex flex-col gap-1.5 rounded-lg border p-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-1">
              {step.turn === 0 ? 'Preparación' : `Turno ${step.turn}`} · {short[step.actor]} · paso {position + 1}/
              {visible.length}
            </span>
            {review ? <VerdictBadge verdict={review.verdict} /> : null}
          </div>
          <p className="font-medium">
            {(() => {
              const option = step.options[step.chosen]
              return option ? reader.describe(option.action, step.state, step.actor, option.text) : '—'
            })()}
          </p>
          {step.note ? <p className="text-xs italic text-muted-foreground">Nota del bot: {step.note}</p> : null}
          {step.options.length > 1 ? <OptionBars step={step} reader={reader} /> : null}
        </div>
      ) : null}

      <Section
        title="Todas las jugadas"
        action={
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Ocultar' : 'Mostrar'}
          </Button>
        }
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch id="replay-only-choices" checked={onlyChoices} onCheckedChange={setOnlyChoices} />
          <label htmlFor="replay-only-choices">Solo decisiones (oculta los pasos con una sola opción)</label>
        </div>
        {showAll ? (
          <MoveList
            replay={replay}
            reader={reader}
            visible={visible}
            selectedIndex={current?.index ?? -1}
            short={short}
            reviewByStep={reviewByStep}
            onSelect={(index) => {
              setPlaying(false)
              setSelected(index)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        ) : null}
      </Section>

      <CardSheet
        engineId={inspect?.engineId ?? null}
        slot={inspectSlot}
        open={inspect !== null}
        onOpenChange={(open) => (open ? undefined : setInspect(null))}
      />
      <CardGridSheet
        title={discard === null ? '' : `Descarte de ${short[discard]}`}
        cards={discard === null ? [] : (shown.players[discard]?.discard ?? []).map((engineId) => ({ engineId }))}
        energies={discard === null ? [] : shown.players[discard]?.discard_energies}
        open={discard !== null}
        onOpenChange={(open) => (open ? undefined : setDiscard(null))}
        onInspect={(engineId) => {
          setDiscard(null)
          setInspect({ engineId })
        }}
      />
    </div>
  )
}

function MoveList({
  replay,
  reader,
  visible,
  selectedIndex,
  short,
  reviewByStep,
  onSelect,
}: {
  replay: Replay
  reader: ReplayReader
  visible: { step: ReplayStep; index: number }[]
  selectedIndex: number
  short: [string, string]
  reviewByStep: Map<number, CoachReview>
  onSelect: (index: number) => void
}) {
  const groups = useMemo(() => groupByTurn(replay.steps), [replay.steps])
  const visibleSet = new Set(visible.map((item) => item.index))
  return (
    <ol className="flex flex-col gap-2">
      {groups.map((group) => {
        const steps = group.steps.filter(({ index }) => visibleSet.has(index))
        if (steps.length === 0) return null
        return (
          <li key={`${group.turn}-${group.actor}-${group.steps[0]?.index}`} className="rounded-lg border">
            <div className="border-b bg-muted/40 px-2 py-1 text-xs font-medium">
              {group.turn === 0 ? 'Preparación' : `Turno ${group.turn}`} · {short[group.actor]}
            </div>
            <ul className="divide-y">
              {steps.map(({ index, step }) => {
                const option = step.options[step.chosen]
                const text = option ? reader.describe(option.action, step.state, step.actor, option.text) : '—'
                const review = reviewByStep.get(index)
                return (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => onSelect(index)}
                      className={cn(
                        'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted',
                        index === selectedIndex && 'bg-primary/10',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {step.actor !== group.actor ? <strong>{short[step.actor]}: </strong> : null}
                        {text}
                      </span>
                      {review ? <VerdictBadge verdict={review.verdict} /> : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}
