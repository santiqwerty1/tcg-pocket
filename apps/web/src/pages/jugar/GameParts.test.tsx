import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CardEdition } from '@/api/schemas'
import { type BoardCards, BoardCardsContext } from '@/components/board/BoardContext'
import type { BoardAction } from '@/lib/board'
import type { ReplayReader, ReplayState } from '@/lib/replay'
import { ActiveActions } from './GameParts'

/** Only what the attack line and the hint read. */
function edition(fields: Partial<CardEdition>): CardEdition {
  return { attacks: [], ability: null, ...fields } as CardEdition
}

const URSHIFU = edition({
  id: 'B3-51',
  energy: 'water',
  types: ['water'],
  ability: { name: 'Double Type', effect: 'As long as this Pokémon is in play, it is [W] and [F] type.' },
  attacks: [{ cost: ['water'], name: 'Golpe', damage: '60', effect: null }],
})
const MEWTWO = edition({
  id: 'C1-1',
  energy: 'psychic',
  types: ['psychic', 'fighting'],
  attacks: [{ cost: ['psychic'], name: 'Golpe', damage: '60', effect: null }],
})
const LUCARIO = edition({ id: 'X-1', energy: 'fighting', types: ['fighting'], weakness: 'fighting' })

function renderActive(attacker: CardEdition) {
  const names: Record<string, string> = { mine: 'Mío', theirs: 'Lucario' }
  const board: BoardCards = {
    reader: { name: (id: string) => names[id] ?? id, card: () => null } as unknown as ReplayReader,
    cardIds: { mine: attacker.id, theirs: LUCARIO.id },
    editions: new Map([
      [attacker.id, attacker],
      [LUCARIO.id, LUCARIO],
    ]),
    images: false,
  }
  const slot = (card: string) => ({
    card,
    hp: 100,
    max_hp: 100,
    energy: [],
    tools: [],
    status: [],
    played_this_turn: false,
  })
  const state = { players: [{ in_play: [slot('mine')] }, { in_play: [slot('theirs')] }] } as unknown as ReplayState
  const attack: BoardAction = {
    i: 0,
    kind: 'attack',
    source: { kind: 'slot', player: 0, index: 0 },
    target: null,
    action: { Attack: { title: 'Golpe' } },
    text: 'Golpe',
  } as BoardAction
  render(
    <BoardCardsContext.Provider value={board}>
      <ActiveActions
        state={state}
        actions={[attack]}
        hint={null}
        disabled={false}
        describe={() => ''}
        onChoose={() => undefined}
        onRetreat={() => undefined}
      />
    </BoardCardsContext.Provider>,
  )
}

describe('the attack hint against the bot', () => {
  it('Urshifu against a Fighting-weak Active: the +20 depends on its Ability, which the board cannot see', () => {
    renderActive(URSHIFU)
    expect(screen.getByText('+20 por debilidad de Lucario, si su habilidad no está anulada')).toBeInTheDocument()
  })

  it('a printed second type (C1) states the +20', () => {
    renderActive(MEWTWO)
    expect(screen.getByText('+20 por debilidad de Lucario')).toBeInTheDocument()
  })
})
