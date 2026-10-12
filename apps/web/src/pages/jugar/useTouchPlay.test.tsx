import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReplayState } from '@/lib/replay'
import { useTouchPlay } from './useTouchPlay'

// Both sides with an Active and two benched Pokémon (the cards do not matter here, only that the spots are taken).
const state = {
  players: [0, 1].map((player) => ({
    in_play: [0, 1, 2].map((index) => ({ card: `A1 00${player}${index}`, hp: 60 })),
  })),
} as unknown as ReplayState

function touch(options: unknown[]) {
  const onChoose = vi.fn()
  const { result } = renderHook(() =>
    useTouchPlay({
      options: options.map((action, i) => ({ i, text: String(i), action })),
      state,
      resetKey: 1,
      onChoose,
    }),
  )
  return { result, onChoose }
}

describe('playing a follow-up choice by touch (board audit of 12/10/2026)', () => {
  it("Sandy Shocks / Team Rocket's Hypno: the opponent's benched Pokémon, never one of yours", () => {
    const { result, onChoose } = touch([
      { SwitchOpponentBenchedThenDamage: { in_play_idx: 1, damage: 30 } },
      { SwitchOpponentBenchedThenDamage: { in_play_idx: 2, damage: 30 } },
    ])
    expect(result.current.pick).toBe(true)
    // Your own benched Pokémon at the same spot: before the audit this chose the opponent's switch.
    act(() => result.current.onSlot({ player: 0, index: 1 }))
    expect(onChoose).not.toHaveBeenCalled()
    act(() => result.current.onSlot({ player: 1, index: 2 }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('a heal offered with a «No» is answered by touching the Pokémon', () => {
    const { result, onChoose } = touch([
      { Heal: { in_play_idx: 0, amount: 30, cure_status: false } },
      { Heal: { in_play_idx: 2, amount: 30, cure_status: false } },
      'Noop',
    ])
    expect([...result.current.targets]).toEqual(['0:0', '0:2'])
    act(() => result.current.onSlot({ player: 0, index: 2 }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('two options for the Pokémon touched (Field Blower with two tools) open the sheet with just those two', () => {
    const { result, onChoose } = touch([
      { DiscardToolFromPokemon: { player: 1, in_play_idx: 0, tool_idx: 0 } },
      { DiscardToolFromPokemon: { player: 1, in_play_idx: 0, tool_idx: 1 } },
      'DiscardActiveStadium',
    ])
    act(() => result.current.onSlot({ player: 1, index: 0 }))
    // Before: the first one was played without asking.
    expect(onChoose).not.toHaveBeenCalled()
    expect(result.current.sheet).toMatchObject({ actions: 'hand', options: [0, 1], at: { player: 1, index: 0 } })
  })

  it('the same action offered twice (a fossil discard, deckgym 33ff2a5) is shown once, and its copy maps to it', () => {
    const fossil = { DiscardFossil: { in_play_idx: 1 } }
    const { result } = touch(['EndTurn', fossil, fossil])
    expect(result.current.actions.map((action) => action.i)).toEqual([0, 1])
    // The coach may have scored the second copy best: the hint goes to the one on the board.
    expect(result.current.canonical(2)).toBe(1)
    expect(result.current.canonical(0)).toBe(0)
    // On the bench, one tap opens its sheet with «Descartar» (before the dedupe, two copies kept it closed).
    act(() => result.current.onSlot({ player: 0, index: 1 }))
    expect(result.current.sheet).toMatchObject({ actions: 'hand', at: { player: 0, index: 1 } })
  })

  it('a fossil as the Active opens the Active’s sheet, which lists the discard', () => {
    const fossil = { DiscardFossil: { in_play_idx: 0 } }
    const { result } = touch(['EndTurn', fossil, fossil])
    act(() => result.current.onSlot({ player: 0, index: 0 }))
    expect(result.current.sheet).toMatchObject({ actions: 'active', at: { player: 0, index: 0 } })
  })

  it('Pokémon Communication: touching the card of your hand offers it', () => {
    const { result, onChoose } = touch([
      { CommunicatePokemon: { hand_pokemon: { Pokemon: { id: 'A1 094', name: 'Pikachu' } } } },
      { CommunicatePokemon: { hand_pokemon: { Pokemon: { id: 'A1 033', name: 'Charmander' } } } },
    ])
    expect([...result.current.playable].sort()).toEqual(['A1 033', 'A1 094'])
    act(() => result.current.onHandCard('A1 033'))
    expect(onChoose).not.toHaveBeenCalled()
    expect(result.current.sheet).toMatchObject({ engineId: 'A1 033', actions: 'hand' })
  })
})
