/**
 * Suerte de los sobres with the game's own numbers (pokemon-zone, 2/11/2026). The CSV view (packs/luck.ts) has to
 * guess: it sees what the collection gained, not how many packs were opened nor where each copy came from. An import
 * says it: packs opened per expansion and per pack, and cards obtained by rarity — real counts, lifetime, so two
 * imports give what happened between them.
 *
 * What stays estimated: the cards those packs gave (packs × cards per pack, without the rare 6-card packs) and the
 * share of each rarity expected among them, from the published rates of each expansion's packs weighted by the packs
 * really opened. The game's rarity counts include every source (Wonder Pick, trades, gifts), and those other cards
 * can hold more rare ones than packs do, so the check counts over the packs' cards only and is made at both ends of
 * what the other cards could hold (`GameLuckTier`): a verdict only when both ends agree (review of pz/import).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { Rarity } from '../catalog/types.js'
import { RARE_TIER, rarityShareOfPack } from '../packs/luck.js'
import { type LuckCheck, type LuckVerdict, luckCheck } from '../stats/luck.js'
import { pokemonZonePack, pokemonZoneRarity } from './catalog.js'
import type { PokemonZoneSnapshot } from './payload.js'

/** A verdict of «Según el juego»: «unknown» when the cards from other sources could change it. */
export type GameLuckVerdict = LuckVerdict | 'unknown'

/**
 * A tier (☆ or more, ◊◊◊◊) of the game's luck. The game counts the cards of every source together, and the cards that
 * did not come from the packs the app models (Wonder Pick, trades, gifts, pack points, expansions the catalog lacks)
 * lean towards rare ones; so the check is made at both ends — those cards held none of the tier, or as many as they
 * could — and gives a verdict only when both ends agree (review of pz/import).
 */
export interface GameLuckTier {
  /** Real: cards of the tier obtained, from every source. */
  observed: number
  /** Estimated: share of the tier among the cards of the packs opened (0–100). */
  expectedShare: number
  /** The n of the check: the cards the packs gave (estimated: packs × cards per pack). */
  games: number
  /** Estimated: cards of the tier expected among them. */
  expected: number
  /** Cards of the tier the packs gave: at least `min` (the other cards held as many as they could), at most `max`. */
  fromPacks: { min: number; max: number }
  /** The check with `fromPacks.min` and with `fromPacks.max`. */
  low: LuckCheck
  high: LuckCheck
  /** Both ends' verdict when they agree; «unknown» otherwise. */
  verdict: GameLuckVerdict
  /** For «lucky» or «unlucky», the less extreme end's tail (how often it happens, at most); otherwise null. */
  tail: number | null
}

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
  rare: GameLuckTier | null
  ex: GameLuckTier | null
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

  const tier = (observed: number, expectedFromPacks: number): GameLuckTier | null => {
    if (packCards === 0) return null
    const expectedShare = (expectedFromPacks / packCards) * 100
    // The cards the packs gave (never more than the game counts), and the rest from elsewhere.
    const games = Math.min(packCards, cards)
    const other = cards - games
    const fromPacks = { min: Math.max(0, observed - other), max: Math.min(observed, games) }
    const low = luckCheck({ wins: fromPacks.min, losses: games - fromPacks.min, ties: 0 }, expectedShare)
    const high = luckCheck({ wins: fromPacks.max, losses: games - fromPacks.max, ties: 0 }, expectedShare)
    const verdict: GameLuckVerdict = low.verdict === high.verdict ? low.verdict : 'unknown'
    return {
      observed,
      expectedShare,
      games,
      expected: (games * expectedShare) / 100,
      fromPacks,
      low,
      high,
      verdict,
      // Lucky with the fewest from the packs is the least lucky end; unlucky with the most, the least unlucky.
      tail: verdict === 'lucky' ? low.upperTail : verdict === 'unlucky' ? high.lowerTail : null,
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
