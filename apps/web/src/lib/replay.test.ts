import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/replay.json'
import { groupByTurn, isReplay, ReplayReader } from './replay'

// First 40 steps of a real game played by engine-cli at fb792eb (deck 1 vs deck 2, e2 vs e2), card texts stripped.
const replay = fixture as unknown
const names: Record<string, string> = {
  'B3 005': 'Treecko',
  'A2 147': 'Capa Gigante',
  'P-A 007': 'Investigación de Profesores',
  'B1 033': 'Torchic',
  'P-A 005': 'Poké Ball',
}

describe('replay reader', () => {
  if (!isReplay(replay)) throw new Error('fixture is not a replay')
  const reader = new ReplayReader(replay, names)
  const describeStep = (index: number) => {
    const step = replay.steps[index]
    if (!step) throw new Error(`no step ${index}`)
    const option = step.options[step.chosen]
    if (!option) throw new Error(`no option at ${index}`)
    return reader.describe(option.action, step.state, step.actor, option.text)
  }

  it('tells the bot moves in Spanish with catalog names', () => {
    expect(describeStep(0)).toBe('Pone Treecko como activo')
    expect(describeStep(1)).toBe('Termina el turno')
    expect(describeStep(4)).toBe('Roba 1 carta')
    expect(describeStep(5)).toBe('Juega Capa Gigante')
    expect(describeStep(6)).toBe('Une Capa Gigante a Treecko (activo)')
    expect(describeStep(11)).toBe('Une 1 energía Fuego a Torchic (activo) (energía del turno)')
  })

  it('falls back to the engine name, and translates unknown actions by text', () => {
    expect(reader.name('B3 005')).toBe('Treecko')
    expect(reader.name('B1 217')).toBe('Flame Patch')
    expect(reader.translateText('Play(B1 033 Torchic, Fire)')).toBe('Play(B1 033 Torchic, Fuego)')
    expect(reader.describe({ SomethingNew: { x: 1 } }, replay.steps[0]?.state as never, 0, 'Weird(Treecko)')).toBe(
      'Weird(Treecko)',
    )
  })

  it('reads the winner and groups steps by turn', () => {
    expect(reader.winner()).toBe(1)
    const groups = groupByTurn(replay.steps)
    expect(groups[0]).toMatchObject({ turn: 0, actor: 0 })
    expect(groups[1]).toMatchObject({ turn: 0, actor: 1 })
    expect(groups[2]?.turn).toBe(1)
    expect(groups.flatMap((group) => group.steps).length).toBe(replay.steps.length)
  })

  it('rejects what is not a replay', () => {
    expect(isReplay(null)).toBe(false)
    expect(isReplay({ steps: [] })).toBe(false)
  })
})
