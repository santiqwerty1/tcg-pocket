import { describe, expect, it } from 'vitest'
import {
  type BoardAction,
  boardChanges,
  classifyAction,
  hpTone,
  isPickDecision,
  optionAt,
  optionsFrom,
  targetsOf,
} from './board'
import type { ReplayState } from './replay'

// Real option shapes of engine-cli play (demo game of 8/10/2026, deckgym 33ff2a5).
const heatmor = {
  Pokemon: { id: 'B1 044', name: 'Heatmor', hp: 80, stage: 0, energy_type: 'Fire', attacks: [], ability: null },
}
const blaziken = { Pokemon: { id: 'B1 036', name: 'Mega Blaziken ex', hp: 210, stage: 2 } }
const pokeBall = { id: 'P-A 005', name: 'Poké Ball', trainer_card_type: 'Item' }
const helmet = { Trainer: { id: 'A2 148', name: 'Rocky Helmet', trainer_card_type: 'Tool' } }
const OPTIONS: [unknown, string][] = [
  ['EndTurn', 'EndTurn'],
  [{ Play: { trainer_card: pokeBall } }, 'Play(P-A 005 Poké Ball)'],
  [{ Place: [heatmor, 2] }, 'Place(Heatmor, 2)'],
  [{ Place: [heatmor, 3] }, 'Place(Heatmor, 3)'],
  [{ Attach: { attachments: [[1, 'Fire', 0]], is_turn_energy: true } }, 'Attach("(1, Fire, 0)", true)'],
  [{ Attach: { attachments: [[1, 'Fire', 1]], is_turn_energy: true } }, 'Attach("(1, Fire, 1)", true)'],
  [{ Evolve: { evolution: blaziken, in_play_idx: 0, from_deck: false } }, 'Evolve(Mega Blaziken ex, 0)'],
  [{ AttachTool: { in_play_idx: 1, tool_card: helmet } }, 'AttachTool(1, Rocky Helmet)'],
  [{ Attack: { title: 'Tongue Whip', fixed_damage: 0, energy_required: ['Fire'] } }, 'Attack(Tongue Whip)'],
  [{ Retreat: 1 }, 'Retreat(1)'],
  [{ UseAbility: { in_play_idx: 2 } }, 'UseAbility(2)'],
]
const actions: BoardAction[] = OPTIONS.map(([action, text], i) => classifyAction(i, action, text, 0))

describe('what each engine action starts from and points at', () => {
  it('classifies every kind the engine sends', () => {
    expect(actions.map((action) => [action.kind, action.source, action.target])).toEqual([
      ['endTurn', { kind: 'none' }, null],
      ['play', { kind: 'hand', engineId: 'P-A 005' }, null],
      ['place', { kind: 'hand', engineId: 'B1 044' }, { player: 0, index: 2 }],
      ['place', { kind: 'hand', engineId: 'B1 044' }, { player: 0, index: 3 }],
      ['attach', { kind: 'energy' }, { player: 0, index: 0 }],
      ['attach', { kind: 'energy' }, { player: 0, index: 1 }],
      ['evolve', { kind: 'hand', engineId: 'B1 036' }, { player: 0, index: 0 }],
      ['tool', { kind: 'hand', engineId: 'A2 148' }, { player: 0, index: 1 }],
      ['attack', { kind: 'slot', player: 0, index: 0 }, null],
      ['retreat', { kind: 'slot', player: 0, index: 0 }, { player: 0, index: 1 }],
      ['ability', { kind: 'slot', player: 0, index: 2 }, null],
    ])
  })

  it('a card of the hand lights its targets; touching one picks that option', () => {
    const heatmorInHand = { kind: 'hand', engineId: 'B1 044' } as const
    expect(targetsOf(actions, heatmorInHand)).toEqual([
      { player: 0, index: 2 },
      { player: 0, index: 3 },
    ])
    expect(optionAt(actions, heatmorInHand, { player: 0, index: 3 })?.i).toBe(3)
    expect(optionAt(actions, heatmorInHand, { player: 1, index: 3 })).toBeNull()
    expect(targetsOf(actions, { kind: 'energy' }).map((ref) => ref.index)).toEqual([0, 1])
    // The active: an attack (no target) and a retreat (to the bench).
    const active = { kind: 'slot', player: 0, index: 0 } as const
    expect(optionsFrom(actions, active).map((action) => action.kind)).toEqual(['attack', 'retreat'])
    expect(targetsOf(actions, active)).toEqual([{ player: 0, index: 1 }])
  })

  it('a decision that only asks for a Pokémon (a new active, damage to a benched one)', () => {
    const pick = [
      classifyAction(0, { Activate: { in_play_idx: 1, player: 0 } }, 'Activate(0, 1)', 0),
      classifyAction(1, { Activate: { in_play_idx: 2, player: 0 } }, 'Activate(0, 2)', 0),
    ]
    expect(isPickDecision(pick)).toBe(true)
    expect(targetsOf(pick, { kind: 'none' })).toEqual([
      { player: 0, index: 1 },
      { player: 0, index: 2 },
    ])
    const damage = classifyAction(
      0,
      { ApplyDamage: { attacking_ref: [0, 0], targets: [[20, 1, 2]], is_from_active_attack: true } },
      'ApplyDamage(...)',
      0,
    )
    expect(damage.target).toEqual({ player: 1, index: 2 })
    expect(isPickDecision(actions)).toBe(false)
  })
})

const slot = (card: string, hp: number, max = hp) => ({
  card,
  hp,
  max_hp: max,
  energy: [],
  tools: [],
  status: [],
  played_this_turn: false,
})
const player = (inPlay: ReturnType<typeof slot | (() => null)>[], discard: string[] = []) => ({
  hand: [],
  hand_count: 0,
  deck_count: 10,
  discard,
  discard_energies: [],
  energy_zone: { current: null, next: null },
  in_play: inPlay,
})
const state = (mine: ReturnType<typeof player>, theirs: ReturnType<typeof player>, points: [number, number]) =>
  ({ turn: 3, current_player: 0, points, winner: null, players: [mine, theirs], stadium: null }) as ReplayState

describe('what changed between two moments', () => {
  it('damage, a retreat that keeps HP, a knockout with its points, a fresh card', () => {
    const before = state(
      player([slot('B1 044', 80), slot('A1 001', 70), null, null]),
      player([slot('A2 091', 60), slot('B1 102', 140), null, null]),
      [0, 0],
    )
    const after = state(
      // Retreated: Bulbasaur to the active (hurt by 30), Heatmor to the bench; a Swablu placed.
      player([slot('A1 001', 40, 70), slot('B1 044', 80), slot('A4a 064', 50), null]),
      // Riolu knocked out (to the discard pile): the Mega Altaria ex is promoted.
      player([slot('B1 102', 140), null, null, null], ['A2 091']),
      [1, 0],
    )
    const changes = boardChanges(before, after)
    expect([...changes.slots]).toEqual([
      ['0:0', { delta: -30, fresh: false }],
      ['0:2', { delta: 0, fresh: true }],
    ])
    expect(changes.knockedOut).toEqual([[], [{ engineId: 'A2 091', index: 0 }]])
    expect(changes.points).toEqual([1, 0])
    expect(boardChanges(null, after).slots.size).toBe(0)
  })

  it('two copies of a card: each keeps its own HP', () => {
    const before = state(player([slot('B4 103', 70, 150), null, slot('B4 103', 150), null]), player([]), [0, 0])
    const after = state(player([slot('B4 103', 70, 150), null, slot('B4 103', 130, 150), null]), player([]), [0, 0])
    expect([...boardChanges(before, after).slots]).toEqual([['0:2', { delta: -20, fresh: false }]])
  })

  it('HP tones', () => {
    expect([hpTone(80, 80), hpTone(40, 80), hpTone(20, 80), hpTone(10, 80)]).toEqual(['ok', 'warn', 'low', 'low'])
  })
})
