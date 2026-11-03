/**
 * Suerte de los sobres with the game's own numbers (pokemon-zone, 2/11/2026). The CSV view (packs/luck.ts) has to
 * guess: it sees what the collection gained, not how many packs were opened nor where each copy came from. An import
 * says it: packs opened per expansion and per pack, and cards obtained by rarity — real counts, lifetime, so two
 * imports give what happened between them.
 *
 * What stays estimated: the cards those packs gave (packs × cards per pack, without the rare 6-card packs) and the
 * share of each rarity expected among them, from the published rates of each expansion's packs weighted by the packs
 * really opened. The game's rarity counts include every source (Wonder Pick, trades, gifts), so the check takes the
 * cards from elsewhere with the same mix as the packs — as the CSV view does — and says how many they are.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { Rarity } from '../catalog/types.js'
import { type PackLuckTier, RARE_TIER, rarityShareOfPack } from '../packs/luck.js'
import { luckCheck } from '../stats/luck.js'
import { pokemonZonePack, pokemonZoneRarity } from './catalog.js'
import type { PokemonZoneSnapshot } from './payload.js'

export interface PokemonZoneExpansionLuck {
  expansionId: string
  nameEs: string | null
  nameEn: string
  /** Real: packs opened. */
  packs: number
  /** Real: cards obtained of the expansion, from every source. */
  cards: number
  /** Estimated: packs × cards per pack; null when the app has no pack structure for it. */
  packCards: number | null
}

export interface PokemonZonePackLuck {
  /** pokemon-zone's pack id. */
  packId: string
  nameEn: string
  expansionId: string | null
  /** The app's pack, when it matches one. */
  appPackId: string | null
  nameEs: string | null
  /** Real: packs opened. */
  opened: number
}

export interface PokemonZoneLuck {
  /** Real: packs opened, every expansion. */
  packs: number
  /** Real: cards obtained with a rarity of the app, from every source (what the checks count over). */
  cards: number
  /** Estimated: the cards the packs of the expansions the app knows gave (packs × cards per pack). */
  packCards: number
  /** Estimated: cards that did not come from those packs (cards − packCards, at least 0). */
  otherCards: number
  /** Real: Wonder Picks and trades; null when the game did not give them. */
  wonderPicks: number | null
  trades: number | null
  /** Real: cards obtained by rarity of the app. */
  byRarity: Partial<Record<Rarity, number>>
  /** Real: cards with a rarity code the app does not have (left out of the checks). */
  unknownRarity: number
  /** Expansions with packs opened, most packs first. */
  expansions: PokemonZoneExpansionLuck[]
  /** Packs opened, most first. */
  byPack: PokemonZonePackLuck[]
  /** Packs of expansions the app has no pack structure for: out of the expected shares. */
  unknownPacks: number
  /** ☆ and above, and ◊◊◊◊: observed real, expected estimated; null when no pack of a known expansion was opened. */
  rare: PackLuckTier | null
  ex: PackLuckTier | null
}

type LuckSnapshot = Pick<PokemonZoneSnapshot, 'expansions' | 'packs' | 'rarities' | 'totals'>

/**
 * Luck over a span: since the previous import (`previous`) or lifetime (`previous` null). Null when a count went down
 * between the two (another account, or pokemon-zone started over): the difference means nothing.
 */
export function pokemonZoneLuck(
  current: LuckSnapshot,
  previous: LuckSnapshot | null,
  index: CatalogIndex,
): PokemonZoneLuck | null {
  let broken = false
  const delta = (after: number, before: number | undefined): number => {
    const value = after - (before ?? 0)
    if (value < 0) broken = true
    return Math.max(0, value)
  }
  const deltaOrNull = (after: number | null, before: number | null | undefined): number | null => {
    if (after === null) return null
    if (previous && (before === null || before === undefined)) return null
    return delta(after, before ?? 0)
  }

  const before = new Map(previous?.expansions.map((row) => [row.expansionId, row]) ?? [])
  const expansions: PokemonZoneExpansionLuck[] = []
  let packCards = 0
  let unknownPacks = 0
  let expectedRare = 0
  let expectedEx = 0
  for (const row of current.expansions) {
    const old = before.get(row.expansionId)
    const packs = delta(row.packsOpened, old?.packsOpened)
    const cards = delta(row.cardsObtained, old?.cardsObtained)
    const expansion = index.expansionById(row.expansionId)
    const structure = expansion?.packStructure ?? null
    const fromPacks = structure ? packs * structure.cardsPerPack : null
    if (packs === 0 && cards === 0) continue
    if (structure && fromPacks !== null) {
      const share = rarityShareOfPack(structure)
      packCards += fromPacks
      expectedRare += fromPacks * [...RARE_TIER].reduce((sum, rarity) => sum + (share[rarity] ?? 0), 0)
      expectedEx += fromPacks * (share['◊◊◊◊'] ?? 0)
    } else {
      unknownPacks += packs
    }
    expansions.push({
      expansionId: row.expansionId,
      nameEs: expansion?.nameEs ?? null,
      nameEn: row.nameEn,
      packs,
      cards,
      packCards: fromPacks,
    })
  }
  expansions.sort((a, b) => b.packs - a.packs || b.cards - a.cards || a.expansionId.localeCompare(b.expansionId))

  const openedBefore = new Map(previous?.packs.map((row) => [row.packId, row.opened]) ?? [])
  const byPack: PokemonZonePackLuck[] = []
  for (const row of current.packs) {
    const opened = delta(row.opened, openedBefore.get(row.packId))
    if (opened === 0) continue
    const ref = pokemonZonePack(index, row)
    byPack.push({
      packId: row.packId,
      nameEn: row.nameEn,
      expansionId: row.expansionId,
      appPackId: ref.packId,
      nameEs: ref.nameEs,
      opened,
    })
  }
  byPack.sort((a, b) => b.opened - a.opened || a.packId.localeCompare(b.packId))

  const obtainedBefore = new Map(previous?.rarities.map((row) => [row.code, row.obtained]) ?? [])
  const byRarity: Partial<Record<Rarity, number>> = {}
  let cards = 0
  let unknownRarity = 0
  for (const row of current.rarities) {
    const obtained = delta(row.obtained, obtainedBefore.get(row.code))
    const rarity = pokemonZoneRarity(row.code)
    if (!rarity) {
      unknownRarity += obtained
      continue
    }
    byRarity[rarity] = (byRarity[rarity] ?? 0) + obtained
    cards += obtained
  }

  const wonderPicks = deltaOrNull(current.totals.wonderPicks, previous?.totals.wonderPicks)
  const trades = deltaOrNull(current.totals.trades, previous?.totals.trades)
  if (broken) return null

  const tier = (observed: number, expectedFromPacks: number): PackLuckTier | null => {
    if (packCards === 0) return null
    const expectedShare = (expectedFromPacks / packCards) * 100
    return {
      observed,
      expected: (cards * expectedShare) / 100,
      expectedShare,
      check: luckCheck({ wins: observed, losses: cards - observed, ties: 0 }, expectedShare),
    }
  }
  const rareObserved = [...RARE_TIER].reduce((sum, rarity) => sum + (byRarity[rarity] ?? 0), 0)
  return {
    packs: expansions.reduce((sum, row) => sum + row.packs, 0),
    cards,
    packCards,
    otherCards: Math.max(0, cards - packCards),
    wonderPicks,
    trades,
    byRarity,
    unknownRarity,
    expansions,
    byPack,
    unknownPacks,
    rare: tier(rareObserved, expectedRare),
    ex: tier(byRarity['◊◊◊◊'] ?? 0, expectedEx),
  }
}
