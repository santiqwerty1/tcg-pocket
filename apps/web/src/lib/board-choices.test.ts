import { describe, expect, it } from 'vitest'
import { activeExtras, classifyAction, isPickDecision, optionsAt, pickLeavesOptions, targetsOf } from './board'

// The audit of 12/10/2026: deckgym 33ff2a5's follow-up choices (move_generation_stack), in the JSON engine-cli play
// sends. Each case was list-only or wrong before; the comment says which card offers it.
const pokemon = (id: string, name: string) => ({ Pokemon: { id, name, hp: 70, stage: 0 } })
const trainer = (id: string, name: string, kind = 'Item') => ({ Trainer: { id, name, trainer_card_type: kind } })
const classify = (action: unknown, i = 0) => classifyAction(i, action, String(i), 0)
const NONE = { kind: 'none' } as const

describe('board audit (12/10/2026): what each follow-up choice points at', () => {
  it("the opponent's benched Pokémon where the field has no player (Sandy Shocks, Team Rocket's Hypno; Psychic)", () => {
    // Before: the target was the decider's own bench, so touching one of yours chose an opponent's.
    expect(classify({ SwitchOpponentBenchedThenDamage: { in_play_idx: 2, damage: 30 } }).target).toEqual({
      player: 1,
      index: 2,
    })
    expect(classify({ MoveRandomOpponentEnergyToActive: { from_in_play_idx: 1 } }).target).toEqual({
      player: 1,
      index: 1,
    })
  })

  it('one Pokémon named by another field (Armaldo, Regice/Swanna, Team Rocket’s Raticate ex, Acerola)', () => {
    expect(classify({ ScheduleDelayedSpotKnockOut: { target_player: 1, target_in_play_idx: 0 } }).target).toEqual({
      player: 1,
      index: 0,
    })
    expect(
      classify({ ScheduleDelayedSpotDamage: { target_player: 1, target_in_play_idx: 3, amount: 30 } }).target,
    ).toEqual({ player: 1, index: 3 })
    expect(classify({ MoveActiveEnergyToBench: { to_in_play_idx: 2, amount: null } }).target).toEqual({
      player: 0,
      index: 2,
    })
    expect(classify({ MoveOpponentActiveEnergyToSelf: { to_in_play_idx: 1 } }).target).toEqual({
      player: 0,
      index: 1,
    })
    expect(classify({ MoveDamageToOpponentActive: { from_in_play_idx: 3, amount: 40 } }).target).toEqual({
      player: 0,
      index: 3,
    })
  })

  it('two Pokémon with one end fixed: the other is the pick; both free stays a list (Energy Blender)', () => {
    const move = (from: number, to: number) => ({
      MoveEnergy: { from_in_play_idx: from, to_in_play_idx: to, energy_type: 'Water', amount: 1 },
    })
    // Dawn, Elemental Switch, Vaporeon, Lunala ex: from the bench to the Active.
    expect(classify(move(2, 0)).target).toEqual({ player: 0, index: 2 })
    // From the Active to the bench.
    expect(classify(move(0, 3)).target).toEqual({ player: 0, index: 3 })
    expect(classify(move(1, 2)).target).toBeNull()
    expect(
      classify({
        MoveEnergyAndReoffer: { from_in_play_idx: 1, to_in_play_idx: 2, energy_type: 'Fire', remaining_moves: 3 },
      }).target,
    ).toBeNull()
    // Dusknoir's Shadow Void: the damaged Pokémon is the pick.
    expect(classify({ MoveAllDamage: { from: 2, to: 1 } }).target).toEqual({ player: 0, index: 2 })
  })

  it('a single card of your own hand is touched in the hand; sets of several and other zones stay a list', () => {
    const pikachu = pokemon('A1 094', 'Pikachu')
    expect(classify({ CommunicatePokemon: { hand_pokemon: pikachu } }).source).toEqual({
      kind: 'hand',
      engineId: 'A1 094',
    })
    expect(
      classify({ SwitchHandCardForRandomTool: { hand_card: trainer('A1 219', 'Erika', 'Supporter') } }).source,
    ).toEqual({ kind: 'hand', engineId: 'A1 219' })
    expect(classify({ ShufflePokemonIntoDeck: { hand_pokemon: [pikachu] } }).source).toEqual({
      kind: 'hand',
      engineId: 'A1 094',
    })
    expect(classify({ ShuffleOwnCardsIntoDeck: { cards: [pikachu] } }).source.kind).toBe('hand')
    expect(classify({ DiscardOwnCards: { cards: [pikachu] } }).source.kind).toBe('hand')
    // Maintenance (two cards at once): a list.
    expect(classify({ ShuffleOwnCardsIntoDeck: { cards: [pikachu, pikachu] } }).source).toEqual(NONE)
    // The opponent's hand (Silver, Absol) and a discard pile (Delcatty, Pokémon Flute) are never your hand.
    for (const action of [
      { ShuffleOpponentSupporter: { supporter_card: trainer('A1 225', 'Sabrina', 'Supporter') } },
      { DiscardOpponentSupporter: { supporter_card: trainer('A1 225', 'Sabrina', 'Supporter') } },
      { PutDiscardCardInHand: { card: pikachu } },
      { BenchOpponentPokemonFromDiscard: { card: pikachu } },
    ]) {
      expect(classify(action).source, JSON.stringify(action)).toEqual(NONE)
    }
  })

  it('a fossil in play is its own source (touch it to discard it), and the Active’s sheet lists it', () => {
    expect(classify({ DiscardFossil: { in_play_idx: 2 } }).source).toEqual({ kind: 'slot', player: 0, index: 2 })
    const turn = [
      classify({ DiscardFossil: { in_play_idx: 0 } }, 0),
      classify({ DiscardFossil: { in_play_idx: 2 } }, 1),
      classify({ Attack: 0 }, 2),
      classify({ Retreat: 1 }, 3),
      classify({ UseAbility: { in_play_idx: 0 } }, 4),
      classify('EndTurn', 5),
    ]
    // Before the review the Active's sheet showed attack, ability and retreat only: a fossil there had no button.
    expect(activeExtras(turn).map((action) => action.i)).toEqual([0])
  })
})

describe('board audit (12/10/2026): answering by touch', () => {
  it('a «No» does not keep the Pokémon from being touched (heal on evolving, «may switch», Eldegoss)', () => {
    const decision = [
      classify({ Heal: { in_play_idx: 0, amount: 30, cure_status: false } }, 0),
      classify({ Heal: { in_play_idx: 2, amount: 30, cure_status: false } }, 1),
      classify('Noop', 2),
    ]
    // Before: a single option without a Pokémon made the whole decision list-only.
    expect(isPickDecision(decision)).toBe(true)
    // The prompt says «lo demás, en «Opciones»» only when something is left there.
    expect(pickLeavesOptions(decision)).toBe(true)
    expect(pickLeavesOptions(decision.slice(0, 2))).toBe(false)
    expect(pickLeavesOptions([classify({ UseAbility: { in_play_idx: 1 } }), classify('Noop', 1)])).toBe(false)
    expect(targetsOf(decision, NONE)).toEqual([
      { player: 0, index: 0 },
      { player: 0, index: 2 },
    ])
    // Not a pick when something has to be picked up first (the main turn), nor with no Pokémon at all.
    expect(isPickDecision([classify('Noop'), classify({ DrawCard: { amount: 1 } }, 1)])).toBe(false)
    expect(isPickDecision([classify({ UseAbility: { in_play_idx: 1 } }), classify('Noop', 1)])).toBe(false)
  })

  it('several options for one Pokémon are all returned, so the board asks instead of playing the first', () => {
    // Field Blower on a Pokémon with two tools, plus the stadium.
    const blower = [
      classify({ DiscardToolFromPokemon: { player: 1, in_play_idx: 0, tool_idx: 0 } }, 0),
      classify({ DiscardToolFromPokemon: { player: 1, in_play_idx: 0, tool_idx: 1 } }, 1),
      classify('DiscardActiveStadium', 2),
    ]
    expect(isPickDecision(blower)).toBe(true)
    expect(optionsAt(blower, NONE, { player: 1, index: 0 }).map((action) => action.i)).toEqual([0, 1])
    // Dragonair: one option per energy type, all on the Active.
    const dragonair = ['Water', 'Lightning'].map((energy_type, i) =>
      classify({ AttachTypedFromDiscard: { in_play_idx: 0, energy_type, count: 1 } }, i),
    )
    expect(optionsAt(dragonair, NONE, { player: 0, index: 0 })).toHaveLength(2)
  })
})
