import { describe, expect, it } from 'vitest'
import { gameReview, isReviewReplay, type ReviewReplay, type ReviewState } from '../../src/simulation/gameReview.js'

const TORCHIC = { Pokemon: { id: 'B1 033', name: 'Torchic' } }
const CATERPIE = { Pokemon: { id: 'B3b 001', name: 'Caterpie' } }
const POKEBALL = { Trainer: { id: 'P-A 005', name: 'Poke Ball' } }

function state(turn: number, current: number, active: [string | null, string | null]): ReviewState {
  const slot = (card: string | null, hp = 60) =>
    card ? { card, hp, max_hp: 60, energy: ['Fire', 'Fire'], tools: [], status: ['Poisoned'] } : null
  return {
    turn,
    current_player: current,
    points: [0, 1],
    players: [
      { hand: ['P-A 005', 'B1 033', 'B1 033'], hand_count: 3, deck_count: 12, discard: [], in_play: [slot(active[0])] },
      { hand: ['P-A 005'], hand_count: 1, deck_count: 14, discard: ['B1 033'], in_play: [slot(active[1], 40)] },
    ],
    stadium: null,
  }
}

const REPLAY: ReviewReplay = {
  players: [
    { name: 'Santi', deck: [] },
    { name: 'bot', deck: [] },
  ],
  cards: { 'B1 033': TORCHIC, 'B3b 001': CATERPIE, 'P-A 005': POKEBALL },
  steps: [
    {
      turn: 0,
      actor: 0,
      state: state(0, 0, [null, null]),
      options: [{ text: 'Place(Torchic, 0)', action: { Place: [TORCHIC, 0] } }],
      chosen: 0,
    },
    {
      turn: 1,
      actor: 1,
      state: state(1, 1, ['B1 033', 'B3b 001']),
      options: [{ text: 'Attack(0)', action: { Attack: { title: 'Bug Bite', fixed_damage: 20 } } }],
      chosen: 0,
    },
    {
      turn: 2,
      actor: 0,
      state: state(2, 0, ['B1 033', 'B3b 001']),
      options: [
        { text: 'EndTurn', action: 'EndTurn' },
        { text: 'Play(Poke Ball)', action: { Play: { trainer_card: { id: 'P-A 005', name: 'Poke Ball' } } } },
        { text: 'Attack(0)', action: { Attack: { title: 'Peck', fixed_damage: 20 } } },
      ],
      chosen: 0,
      scores: [1000, 3000, 13000],
    },
    {
      turn: 2,
      actor: 0,
      state: state(2, 0, ['B1 033', 'B3b 001']),
      options: [
        { text: 'Attach Fire', action: { Attach: { attachments: [[1, 'Fire', 0]], is_turn_energy: true } } },
        { text: 'EndTurn', action: 'EndTurn' },
      ],
      chosen: 0,
      scores: [2000, 2050],
    },
  ],
  final_state: state(2, 0, ['B1 033', 'B3b 001']),
  outcome: { Win: 1 },
}

const NAMES = { 'B1 033': 'Torchic', 'B3b 001': 'Caterpie', 'P-A 005': 'Poké Ball' }

describe('Claude analiza una partida (Fase 29)', () => {
  it('tells the game turn by turn in Spanish with the board at the start of each turn', () => {
    expect(isReviewReplay(REPLAY)).toBe(true)
    expect(isReviewReplay({ steps: [] })).toBe(false)
    const review = gameReview(REPLAY, { names: NAMES })
    expect(review.turns.map((turn) => [turn.turn, turn.player])).toEqual([
      [0, 'preparación'],
      [1, 'bot'],
      [2, 'vos'],
    ])
    expect(review.turns[0]?.actions).toEqual([{ who: 'vos', text: 'Pone Torchic como activo' }])
    expect(review.turns[1]?.actions[0]).toEqual({ who: 'bot', text: 'Ataca con «Bug Bite» (20)' })
    const board = review.turns[2]?.board
    expect(board?.points).toBe('Vos 0 – Bot 1')
    expect(board?.you.active).toBe('Torchic 60/60 PS · 2 Fuego · envenenado')
    expect(board?.you.hand).toBe('Poké Ball, 2 Torchic')
    expect(board?.bot).toMatchObject({ active: 'Caterpie 40/60 PS · 2 Fuego · envenenado', handCount: 1, discard: 1 })
  })

  it('grades the owner’s choices like the coach and keeps the costliest as key moments', () => {
    const review = gameReview(REPLAY, { names: NAMES })
    const [endTurn, attach] = review.turns[2]?.actions ?? []
    expect(endTurn).toMatchObject({
      ply: 1,
      options: 3,
      text: 'Termina el turno',
      coach: { verdict: 'Error grave', gap: 12000, rank: 3, best: 'Ataca con «Peck» (20)' },
    })
    expect(endTurn?.alternatives).toBeUndefined()
    expect(attach).toMatchObject({
      ply: 2,
      text: 'Une 1 energía Fuego a Torchic (activo) (energía del turno)',
      coach: { verdict: 'Casi igual', gap: 50, rank: 2 },
    })
    expect(review.keyMoments).toHaveLength(1)
    expect(review.keyMoments[0]).toMatchObject({
      ply: 1,
      turn: 2,
      verdict: 'Error grave',
      chosen: 'Termina el turno',
      best: 'Ataca con «Peck» (20)',
      top: [
        { text: 'Ataca con «Peck» (20)', score: 13000 },
        { text: 'Juega Poké Ball', score: 3000 },
        { text: 'Termina el turno', score: 1000 },
      ],
    })
  })

  it('lists every option in detail «full» and narrows to a range of turns', () => {
    const full = gameReview(REPLAY, { names: NAMES, detail: 'full', fromTurn: 2, toTurn: 2 })
    expect(full.turns.map((turn) => turn.turn)).toEqual([2])
    expect(full.omittedTurns).toBe(2)
    expect(full.turns[0]?.actions[0]?.alternatives?.map((option) => option.score)).toEqual([13000, 3000, 1000])
    // Plies keep counting from the start of the game.
    expect(full.turns[0]?.actions[1]?.ply).toBe(2)
    const early = gameReview(REPLAY, { names: NAMES, toTurn: 1 })
    expect(early.keyMoments).toEqual([])
  })
})
