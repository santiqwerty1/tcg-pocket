/**
 * The board (Fase 22): what each engine action starts from and points at, so a game against the bot is played by
 * touching cards — a card of the hand, the energy of the zone or a Pokémon in play, then where it goes — and what
 * changed between two moments of a game (damage, healing, knockouts, points), for the badges and animations.
 */
import type { ReplayState } from './replay'

export type Seat = 0 | 1

/** deckgym's in_play index: 0 is the active spot, 1–3 the bench. */
export interface SlotRef {
  player: Seat
  index: number
}

export type ActionSource =
  | { kind: 'hand'; engineId: string }
  | { kind: 'energy' }
  | { kind: 'slot'; player: Seat; index: number }
  | { kind: 'none' }

export type ActionKind =
  | 'attack'
  | 'play'
  | 'place'
  | 'evolve'
  | 'attach'
  | 'tool'
  | 'retreat'
  | 'ability'
  | 'activate'
  | 'damage'
  | 'endTurn'
  | 'other'

export interface BoardAction {
  /** Index among the decision's options. */
  i: number
  kind: ActionKind
  source: ActionSource
  target: SlotRef | null
  action: unknown
  text: string
}

/** `{"Pokemon": {...}}`, `{"Trainer": {...}}` or the card itself → its engine id. */
export function engineIdOf(card: unknown): string | null {
  if (typeof card !== 'object' || card === null) return null
  const record = card as Record<string, unknown>
  const inner = (record.Pokemon ?? record.Trainer ?? record) as { id?: unknown }
  return typeof inner.id === 'string' ? inner.id : null
}

const seat = (value: unknown, fallback: Seat): Seat => (value === 0 || value === 1 ? value : fallback)
const none: ActionSource = { kind: 'none' }

export function classifyAction(i: number, action: unknown, text: string, actor: Seat): BoardAction {
  const base = { i, action, text }
  const slot = (index: unknown, player: Seat = actor): SlotRef | null =>
    typeof index === 'number' && Number.isInteger(index) ? { player, index } : null
  if (action === 'EndTurn') return { ...base, kind: 'endTurn', source: none, target: null }
  if (typeof action !== 'object' || action === null) return { ...base, kind: 'other', source: none, target: null }
  const [kind, value] = Object.entries(action as Record<string, unknown>)[0] ?? ['', null]
  const v = (value ?? {}) as Record<string, unknown>
  const hand = (card: unknown): ActionSource => {
    const id = engineIdOf(card)
    return id ? { kind: 'hand', engineId: id } : none
  }
  switch (kind) {
    case 'Attack':
      return { ...base, kind: 'attack', source: { kind: 'slot', player: actor, index: 0 }, target: null }
    case 'Play':
      return { ...base, kind: 'play', source: hand(v.trainer_card), target: null }
    case 'Place': {
      const [card, index] = (Array.isArray(value) ? value : []) as [unknown, unknown]
      return { ...base, kind: 'place', source: hand(card), target: slot(index) }
    }
    case 'Evolve':
      return {
        ...base,
        kind: 'evolve',
        source: v.from_deck ? none : hand(v.evolution),
        target: slot(v.in_play_idx),
      }
    case 'Attach': {
      const attachments = (Array.isArray(v.attachments) ? v.attachments : []) as [number, string, number][]
      const target = attachments.length === 1 ? slot(attachments[0]?.[2]) : null
      return { ...base, kind: 'attach', source: v.is_turn_energy ? { kind: 'energy' } : none, target }
    }
    case 'AttachTool':
      // deckgym plays a tool in two steps: «Play» takes it out of the hand, and then it asks where it goes. By then
      // the card is not in the hand to touch, so the choice is a pick: touching the Pokémon attaches it.
      return { ...base, kind: 'tool', source: none, target: slot(v.in_play_idx) }
    case 'Retreat':
      return {
        ...base,
        kind: 'retreat',
        source: { kind: 'slot', player: actor, index: 0 },
        target: slot(value),
      }
    case 'UseAbility':
      return {
        ...base,
        kind: 'ability',
        source: { kind: 'slot', player: actor, index: Number(v.in_play_idx) },
        target: null,
      }
    case 'Activate':
      return { ...base, kind: 'activate', source: none, target: slot(v.in_play_idx, seat(v.player, actor)) }
    case 'ApplyDamage': {
      const targets = (Array.isArray(v.targets) ? v.targets : []) as [number, number, number][]
      const only = targets.length === 1 ? targets[0] : undefined
      return {
        ...base,
        kind: 'damage',
        source: none,
        target: only ? slot(only[2], seat(only[1], actor)) : null,
      }
    }
    default: {
      // Anything else that names one Pokémon in play (a heal, a tool to discard…) can be chosen by touching it.
      const target = 'in_play_idx' in v ? slot(v.in_play_idx, seat(v.player, actor)) : null
      return { ...base, kind: 'other', source: none, target }
    }
  }
}

export function sameSource(a: ActionSource, b: ActionSource): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'hand' && b.kind === 'hand') return a.engineId === b.engineId
  if (a.kind === 'slot' && b.kind === 'slot') return a.player === b.player && a.index === b.index
  return true
}

export function sameSlot(a: SlotRef | null, b: SlotRef | null): boolean {
  return a !== null && b !== null && a.player === b.player && a.index === b.index
}

export const slotKey = (ref: SlotRef) => `${ref.player}:${ref.index}`

/** The options that start from a source. */
export function optionsFrom(actions: readonly BoardAction[], source: ActionSource): BoardAction[] {
  return actions.filter((action) => sameSource(action.source, source))
}

/** Targets to highlight once a source is chosen (or, with source «none», the targets of a pure choose-a-Pokémon). */
export function targetsOf(actions: readonly BoardAction[], source: ActionSource): SlotRef[] {
  const seen = new Set<string>()
  const out: SlotRef[] = []
  for (const action of optionsFrom(actions, source)) {
    if (!action.target || seen.has(slotKey(action.target))) continue
    seen.add(slotKey(action.target))
    out.push(action.target)
  }
  return out
}

/** The option to play when a target is touched with a source chosen. */
export function optionAt(actions: readonly BoardAction[], source: ActionSource, target: SlotRef): BoardAction | null {
  return optionsFrom(actions, source).find((action) => sameSlot(action.target, target)) ?? null
}

/** A decision where every option is «pick a Pokémon» (a new active, a target for damage): no source needed. */
export function isPickDecision(actions: readonly BoardAction[]): boolean {
  return actions.length > 0 && actions.every((action) => action.source.kind === 'none' && action.target !== null)
}

// ---------------------------------------------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------------------------------------------

export interface SlotChange {
  /** HP gained (positive) or lost (negative) by the same card since the previous moment. */
  delta: number
  /** The card arrived (placed, evolved, promoted from elsewhere). */
  fresh: boolean
}

export interface KnockOut {
  engineId: string
  index: number
}

export interface BoardChanges {
  /** By slot key of the newer state. */
  slots: Map<string, SlotChange>
  /** Cards knocked out (left play and went to the discard pile), by player, with the spot they were in. */
  knockedOut: [KnockOut[], KnockOut[]]
  /** Points scored by each player. */
  points: [number, number]
}

/**
 * What changed from `before` to `after`. Cards are matched by engine id within each player's play area, so a retreat
 * (cards swapping spots) keeps its HP; an evolution is a fresh card.
 */
export function boardChanges(before: ReplayState | null, after: ReplayState): BoardChanges {
  const slots = new Map<string, SlotChange>()
  const knockedOut: [KnockOut[], KnockOut[]] = [[], []]
  if (!before) return { slots, knockedOut, points: [0, 0] }
  for (const player of [0, 1] as const) {
    const old = (before.players[player]?.in_play ?? []).map((slot, index) =>
      slot ? { ...slot, index, used: false } : null,
    )
    const now = after.players[player]?.in_play ?? []
    now.forEach((slot, index) => {
      if (!slot) return
      // Same spot first (two copies of a card stay apart), then wherever it came from (a retreat).
      const same = old[index]
      const match =
        same && !same.used && same.card === slot.card
          ? same
          : old.find((candidate) => candidate && !candidate.used && candidate.card === slot.card)
      if (match) {
        match.used = true
        if (slot.hp !== match.hp) slots.set(slotKey({ player, index }), { delta: slot.hp - match.hp, fresh: false })
      } else {
        slots.set(slotKey({ player, index }), { delta: 0, fresh: true })
      }
    })
    const discardBefore = countBy(before.players[player]?.discard ?? [])
    const discardAfter = countBy(after.players[player]?.discard ?? [])
    for (const left of old) {
      if (!left || left.used) continue
      if ((discardAfter.get(left.card) ?? 0) > (discardBefore.get(left.card) ?? 0)) {
        knockedOut[player].push({ engineId: left.card, index: left.index })
      }
    }
  }
  return {
    slots,
    knockedOut,
    points: [after.points[0] - before.points[0], after.points[1] - before.points[1]],
  }
}

function countBy(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/** deckgym energy names («Fire») → the app's keys («fire»). */
export function energyKey(energy: string): string {
  return energy.toLowerCase()
}

/** HP bar tone: green above half, amber above a quarter, red below. */
export function hpTone(hp: number, max: number): 'ok' | 'warn' | 'low' {
  if (max <= 0) return 'ok'
  const share = hp / max
  return share > 0.5 ? 'ok' : share > 0.25 ? 'warn' : 'low'
}
