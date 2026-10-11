/**
 * Fase 44: the Energy Zone, turn by turn (T-014). Each own turn the zone gives one energy of one of the deck's types
 * (1 to 3, P-006), drawn at random with the same chance each, except the first player's first turn, which gives none.
 * So by own turn N the first player has received N − 1 energies and the second N.
 *
 * The chance that an attack can be paid by own turn N, exactly (a multinomial count): every energy received goes to
 * the attacker, so this is the best case. A typed cost of a type the deck does not select can never be paid.
 */
import type { EnergyType, SelectableEnergy } from '../catalog/types.js'

/** Own turns reported by default. */
export const ENERGY_ZONE_TURNS = 6

export interface EnergyZoneRow {
  /** Own turn. */
  turn: number
  /** Energies the zone has given by then. */
  energies: number
  /** P(the cost can be paid with them), 0–1. */
  probability: number
}

export interface EnergyZoneOdds {
  types: SelectableEnergy[]
  cost: EnergyType[]
  /** False when the cost asks for a type the deck does not select. */
  payable: boolean
  first: EnergyZoneRow[]
  second: EnergyZoneRow[]
  /** First own turn with ≥ 50 %, going first and going second (null if never within the turns shown). */
  likelyTurn: { first: number | null; second: number | null }
}

function factorial(n: number): number {
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

/** Every way to split `total` energies among `parts` types. */
function* compositions(total: number, parts: number, prefix: number[] = []): Generator<number[]> {
  if (parts === 1) {
    yield [...prefix, total]
    return
  }
  for (let x = 0; x <= total; x++) yield* compositions(total - x, parts - 1, [...prefix, x])
}

/** P(m energies drawn uniformly among `types` pay `cost`), exactly. */
function payProbability(types: readonly SelectableEnergy[], cost: readonly EnergyType[], m: number): number {
  const needs = types.map((type) => cost.filter((energy) => energy === type).length)
  if (m < cost.length) return 0
  const k = types.length
  let favorable = 0
  for (const counts of compositions(m, k)) {
    if (counts.every((count, i) => count >= (needs[i] ?? 0))) {
      favorable += factorial(m) / counts.reduce((product, count) => product * factorial(count), 1)
    }
  }
  return favorable / k ** m
}

export function energyZoneOdds(
  deckTypes: readonly SelectableEnergy[],
  cost: readonly EnergyType[],
  turns: number = ENERGY_ZONE_TURNS,
): EnergyZoneOdds {
  // A saved deck can repeat a type (the input schema accepts it): the zone gives each type once (Codex on #52).
  const types = [...new Set(deckTypes)]
  if (types.length < 1 || types.length > 3) throw new RangeError('energyZoneOdds: one to three energy types')
  const payable = cost.every((energy) => energy === 'colorless' || types.includes(energy as SelectableEnergy))
  const rows = (offset: number) =>
    Array.from({ length: turns }, (_, i) => {
      const turn = i + 1
      const energies = Math.max(0, turn - offset)
      return { turn, energies, probability: payable ? payProbability(types, cost, energies) : 0 }
    })
  const first = rows(1)
  const second = rows(0)
  const likely = (list: EnergyZoneRow[]) => list.find((row) => row.probability >= 0.5)?.turn ?? null
  return {
    types: [...types],
    cost: [...cost],
    payable,
    first,
    second,
    likelyTurn: { first: likely(first), second: likely(second) },
  }
}
