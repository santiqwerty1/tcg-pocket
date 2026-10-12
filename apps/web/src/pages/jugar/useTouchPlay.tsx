/**
 * Playing by touch (Fase 22), shared by a game against the bot and the situations to solve (Fase 24): what is
 * selected (a card of the hand, the zone's energy, your active for a retreat), which spots light up, what a tap on a
 * card or a spot does, and the card sheet with the actions it offers.
 */
import { useEffect, useMemo, useState } from 'react'
import { CardSheet } from '@/components/board/CardSheet'
import { Button } from '@/components/ui/button'
import {
  type ActionSource,
  type BoardAction,
  classifyAction,
  isPickDecision,
  optionsAt,
  optionsFrom,
  type SlotRef,
  sameSource,
  slotKey,
  targetsOf,
} from '@/lib/board'
import type { ReplayState } from '@/lib/replay'
import { ActiveActions } from './GameParts'

const NONE: ActionSource = { kind: 'none' }

export interface TouchSheet {
  engineId: string
  at?: SlotRef
  actions: 'active' | 'hand' | null
  /** With `hand`: exactly these options (several for the Pokémon touched: two tools, one per energy type…). */
  options?: number[]
}

export function useTouchPlay({
  options,
  state,
  resetKey,
  onChoose,
}: {
  /** The decision's options; null while there is none (the bot moving, the game over). */
  options: readonly { i: number; text: string; action: unknown }[] | null
  state: ReplayState | null
  /** Changes with each decision: clears what was selected. */
  resetKey: unknown
  onChoose: (i: number) => void
}) {
  const [selected, setSelected] = useState<ActionSource | null>(null)
  const [sheet, setSheet] = useState<TouchSheet | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger, not an input
  useEffect(() => {
    setSelected(null)
    setSheet(null)
  }, [resetKey])

  // deckgym can offer the very same action twice (a fossil's discard, at 33ff2a5): the board shows it once, under the
  // first index, and `canonical` sends the other copies there (the coach may have picked either).
  const { actions, canonical } = useMemo(() => {
    const first = new Map<string, number>()
    const alias = new Map<number, number>()
    const list: BoardAction[] = []
    for (const option of options ?? []) {
      const key = JSON.stringify(option.action)
      const seen = first.get(key)
      if (seen !== undefined) {
        alias.set(option.i, seen)
        continue
      }
      first.set(key, option.i)
      list.push(classifyAction(option.i, option.action, option.text, 0))
    }
    return { actions: list, canonical: (i: number) => alias.get(i) ?? i }
  }, [options])
  const live = options !== null
  const pick = isPickDecision(actions)
  const targets = useMemo(() => {
    const refs = selected ? targetsOf(actions, selected) : pick ? targetsOf(actions, NONE) : []
    return new Set(refs.map(slotKey))
  }, [actions, selected, pick])
  const playable = useMemo(
    () => new Set(actions.flatMap((action) => (action.source.kind === 'hand' ? [action.source.engineId] : []))),
    [actions],
  )
  const energyPlayable = actions.some((action) => action.source.kind === 'energy')

  function choose(i: number) {
    setSelected(null)
    setSheet(null)
    onChoose(i)
  }

  function inspect(engineId: string, at?: SlotRef) {
    setSheet(at ? { engineId, at, actions: null } : { engineId, actions: null })
  }

  function onHandCard(engineId: string) {
    if (!live) return inspect(engineId)
    const source: ActionSource = { kind: 'hand', engineId }
    const fromHand = optionsFrom(actions, source)
    if (fromHand.length === 0) return inspect(engineId)
    if (selected && sameSource(selected, source)) return setSelected(null)
    if (fromHand.every((action) => action.target !== null)) return setSelected(source)
    setSheet({ engineId, actions: 'hand' })
  }

  /**
   * The options for the Pokémon touched: one is played; several (two tools on it, one per energy type) open the
   * sheet with just those, instead of silently playing the first (audit of 12/10/2026).
   */
  function playAt(source: ActionSource, at: SlotRef, card: string | null): boolean {
    const found = optionsAt(actions, source, at)
    const [only] = found
    if (found.length === 1 && only) {
      choose(only.i)
      return true
    }
    if (found.length > 1) {
      setSheet({ engineId: card ?? '', at, actions: 'hand', options: found.map((action) => action.i) })
      return true
    }
    return false
  }

  function onSlot(at: SlotRef) {
    const card = state?.players[at.player]?.in_play[at.index]?.card ?? null
    if (live) {
      if (selected) {
        if (playAt(selected, at, card)) return
        if (selected.kind === 'slot' && selected.player === at.player && selected.index === at.index) {
          return setSelected(null)
        }
      }
      if (pick && playAt(NONE, at, card)) return
      if (
        at.player === 0 &&
        at.index === 0 &&
        card &&
        optionsFrom(actions, { kind: 'slot', player: 0, index: 0 }).length
      ) {
        return setSheet({ engineId: card, at, actions: 'active' })
      }
      const own = optionsFrom(actions, { kind: 'slot', player: at.player, index: at.index })
      if (own.length === 1 && own[0]) {
        // An ability of a benched Pokémon: one tap to see it, the sheet to confirm.
        return setSheet({ engineId: card ?? '', at, actions: 'hand' })
      }
    }
    if (card) inspect(card, at)
  }

  function onEnergy() {
    if (!energyPlayable) return
    const source: ActionSource = { kind: 'energy' }
    setSelected(selected && sameSource(selected, source) ? null : source)
  }

  return {
    actions,
    canonical,
    selected,
    setSelected,
    sheet,
    setSheet,
    pick,
    targets,
    playable,
    energyPlayable,
    choose,
    inspect,
    onHandCard,
    onSlot,
    onEnergy,
  }
}

export type TouchPlay = ReturnType<typeof useTouchPlay>

/** The card sheet of the board, with what the card can do now. */
export function TouchPlaySheet({
  play,
  state,
  describe,
  hint,
  busy,
}: {
  play: TouchPlay
  state: ReplayState | null
  describe: (action: BoardAction) => string
  hint: number | null
  busy: boolean
}) {
  const { sheet, actions } = play
  const sheetSlot =
    sheet?.at !== undefined && state ? (state.players[sheet.at.player]?.in_play[sheet.at.index] ?? null) : null
  const sheetOptions =
    sheet?.actions === 'hand'
      ? sheet.options
        ? actions.filter((action) => sheet.options?.includes(action.i))
        : sheet.at
          ? optionsFrom(actions, { kind: 'slot', player: sheet.at.player, index: sheet.at.index })
          : optionsFrom(actions, { kind: 'hand', engineId: sheet.engineId })
      : []
  return (
    <CardSheet
      engineId={sheet?.engineId ?? null}
      slot={sheetSlot}
      open={sheet !== null}
      onOpenChange={(open) => (open ? undefined : play.setSheet(null))}
      hideAttacks={sheet?.actions === 'active'}
      actions={
        sheet?.actions === 'active' && state ? (
          <ActiveActions
            state={state}
            actions={actions}
            hint={hint}
            disabled={busy}
            describe={describe}
            onChoose={play.choose}
            onRetreat={() => {
              play.setSheet(null)
              play.setSelected({ kind: 'slot', player: 0, index: 0 })
            }}
          />
        ) : sheet?.actions === 'hand' && sheetOptions.length > 0 ? (
          sheetOptions.map((action) => (
            <Button
              key={action.i}
              type="button"
              variant={hint === action.i ? 'default' : 'outline'}
              className="h-auto justify-start py-2 text-left whitespace-normal"
              disabled={busy}
              onClick={() => play.choose(action.i)}
            >
              {describe(action)}
            </Button>
          ))
        ) : null
      }
    />
  )
}
