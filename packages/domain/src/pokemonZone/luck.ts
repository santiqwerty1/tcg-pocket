/**
 * Suerte de los sobres with the game's own numbers (pokemon-zone, 2/11/2026). The CSV view (packs/luck.ts) has to
 * guess: it sees what the collection gained, not how many packs were opened nor where each copy came from. An import
 * says it: packs opened per expansion and per pack, and cards obtained by rarity — real counts, lifetime, so two
 * imports give what happened between them.
 *
 * What stays estimated: the cards those packs gave (packs × cards per pack, without the rare 6-card packs) and the
 * share of each rarity expected among them, from the published rates of each expansion's packs weighted by the packs
 * really opened. The game's rarity counts include every source, so the check counts over the cards whose odds are
 * known and is made at both ends of what the cards of unknown origin could hold (`GameLuckTier`): a verdict only when
 * both ends agree (review of pz/import).
 *
 * pz/luck (3/11/2026):
 * - Wonder Pick: the player sees the five cards of each offer and chooses one, and only then they are turned and
 *   shuffled (review of #172), so a Wonder Pick leans rare. It is never worse than a card of a pack, so for «peor de
 *   lo normal» (the low end of the luck) it counts at the packs' odds, which can only make that verdict harder; for
 *   «mejor de lo normal» it is of unknown origin. Inside an event that changes Wonder Pick (`SPECIAL_PICK_WINDOWS`:
 *   promos, which are no hit, and more Chansey picks) it is of unknown origin for both.
 * - A pack opened with a ticket for a guaranteed ★★ card (`GUARANTEED_PACK_WINDOWS`) has one card that is not luck.
 * - Every import is kept, so the luck is also the sum of the spans between consecutive imports where the cards of
 *   unknown origin are few (`pokemonZoneLuckSinceFirst`): a day of packs only counts whole.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { Rarity } from '../catalog/types.js'
import { RARE_TIER, rarityShareOfPack } from '../packs/luck.js'
import { type LuckCheck, type LuckVerdict, luckCheck } from '../stats/luck.js'
import { pokemonZonePack, pokemonZoneRarity } from './catalog.js'
import { type PokemonZoneSnapshot, starStarTickets } from './payload.js'

/** A verdict of «Según el juego»: «unknown» when the cards of unknown origin could change it. */
export type GameLuckVerdict = LuckVerdict | 'unknown'

/** A stretch of time (ISO; `until` exclusive) with something that changes the luck, and why. */
export interface LuckWindow {
  from: string
  until: string
  why: string
}

/**
 * Wonder Pick is not even a card of a pack inside these windows: its Wonder Picks are of unknown origin for both ends.
 * «Evento bis PROMO 2026» (pokemon.com/es, 28/10/2026): the B series promos come back to Wonder Pick and Chansey picks
 * (rare cards only) show up more often.
 */
export const SPECIAL_PICK_WINDOWS: readonly LuckWindow[] = [
  {
    from: '2026-10-30T06:00:00Z',
    until: '2026-11-13T07:00:00Z',
    why: 'Evento bis PROMO 2026: promos y más elecciones Chansey en Wonder Pick',
  },
]

/**
 * Campaigns with a ticket for a pack with a guaranteed ★★ card (`starStarTickets`): the anniversary campaign until
 * 15/12/2026 06:59 UTC (its start is taken early, at the news of 28/10).
 */
export const GUARANTEED_PACK_WINDOWS: readonly LuckWindow[] = [
  {
    from: '2026-10-28T00:00:00Z',
    until: '2026-12-15T07:00:00Z',
    why: 'Campaña de aniversario: un sobre con una carta ★★ asegurada',
  },
]

/**
 * Tickets a campaign gives (the news: one pack). When a count was not seen — before the first import, or with the
 * version 1 bookmarklet — the packs opened with one are at most the tickets known before, or this many.
 */
export const GUARANTEED_TICKETS_PER_CAMPAIGN = 1

/**
 * Between imports, a span counts towards «desde la primera importación» while the cards of unknown origin of all the
 * spans counted stay within this many standard deviations of their expected hits: Σ unknown ≤ 0,5 · √(Σ expected).
 */
export const INCLUSION_SD = 0.5

/**
 * A tier (☆ or more, ◊◊◊◊) of the game's luck. The game counts the cards of every source together, so the check is
 * made over the cards whose odds are known at both ends of what the cards of unknown origin could hold of the tier,
 * and gives a verdict only when both ends agree. The low end («mejor de lo normal» has to hold there) counts the packs
 * only, with every other card of unknown origin; the high end («peor de lo normal» has to hold there) adds the Wonder
 * Picks at the packs' odds (review of #172: a Wonder Pick leans rare, never worse).
 */
export interface GameLuckTier {
  /** Real: cards of the tier obtained, from every source. */
  observed: number
  /** Estimated: share of the tier among the cards with known odds (0–100). */
  expectedShare: number
  /** The n of the high end: the packs' cards and the Wonder Picks at the packs' odds. */
  games: number
  /** Estimated: cards of the tier expected among them. */
  expected: number
  /** The n of the low end: the packs' cards only. */
  packGames: number
  /** Estimated: cards of the tier expected among the packs' cards. */
  packExpected: number
  /** Cards of unknown origin at the low end (Wonder Picks, trades, gifts, rewards…). */
  unknown: number
  /** Cards of the tier the packs gave at least (`min`), and the packs and Wonder Picks at most (`max`). */
  fromPacks: { min: number; max: number }
  /** The check of the low end (packs only, `fromPacks.min`) and of the high end (with Wonder Pick, `max`). */
  low: LuckCheck
  high: LuckCheck
  /** Both ends' verdict when they agree; «unknown» otherwise. */
  verdict: GameLuckVerdict
  /** For «lucky» or «unlucky», the less extreme end's tail (how often it happens, at most); otherwise null. */
  tail: number | null
  /**
   * How many of the cards of unknown origin (`unknown`, Wonder Picks included) would have to be of the tier for the
   * packs alone to be «normal» (fewer: luckier; more: unluckier); null when none gives it, or there are too few cards.
   */
  normalIf: { min: number; max: number } | null
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

/** Where the cards of a span came from: what is real, estimated or unknown (pz/luck). */
export interface PokemonZoneSources {
  /** Real: Wonder Picks of the span; null when the game did not give them. */
  wonderPicks: number | null
  /** Wonder Picks counted at the packs' odds for «peor de lo normal» (of unknown origin for «mejor»). */
  pickCards: number
  /** Wonder Picks of unknown origin for both: inside a window that changes Wonder Pick. */
  unknownPicks: number
  /** The windows that made Wonder Picks unknown in this span. */
  pickWindows: LuckWindow[]
  /** Real: trades; null when the game did not give them. */
  trades: number | null
  /**
   * Packs opened with a ticket for a guaranteed ★★ card (their guaranteed card is of unknown origin); when
   * `guaranteedSeen` is false the count was not seen and this is a bound (a campaign was on).
   */
  guaranteedPacks: number
  guaranteedSeen: boolean
  /** Estimated: the rest of unknown origin — gifts, rewards, pack-point exchanges, promos, 6-card packs. */
  restCards: number
}

export interface PokemonZoneLuck {
  /** Real: packs opened, every expansion. */
  packs: number
  /** Real: cards obtained with a rarity of the app, from every source (what the checks count over). */
  cards: number
  /** Estimated: the cards the packs of the expansions the app knows gave (packs × cards per pack). */
  packCards: number
  /** Estimated: cards of unknown origin for «peor de lo normal» (the rest once the packs' and Wonder Picks' are out). */
  otherCards: number
  /** Real: Wonder Picks and trades; null when the game did not give them. */
  wonderPicks: number | null
  trades: number | null
  /** Where the cards came from (pz/luck). */
  sources: PokemonZoneSources
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
  /** ☆ and above, and ◊◊◊◊: observed real, expected estimated; null when nothing has known odds. */
  rare: GameLuckTier | null
  ex: GameLuckTier | null
}

export type LuckSnapshot = Pick<PokemonZoneSnapshot, 'expansions' | 'packs' | 'rarities' | 'totals'>

/** What a span needs to know where its Wonder Picks and guaranteed packs stand. */
export interface LuckChainPoint {
  syncedAt: string
  totals: Pick<PokemonZoneSnapshot['totals'], 'wonderPicks' | 'packsOpened'>
  /** The tickets for a pack with a guaranteed card; absent or null: not seen. */
  guaranteedTickets?: PokemonZoneSnapshot['guaranteedTickets'] | null
}

/** How a span splits its Wonder Picks and how many guaranteed packs it had (`spanSources`). */
export interface SpanSources {
  /** Wonder Picks outside the special windows: at the packs' odds for «peor de lo normal». */
  regularPicks: number
  /** The windows that overlap the span. */
  pickWindows: LuckWindow[]
  /** Packs opened with a guaranteed ★★ ticket, seen: the drop of those tickets in stock. */
  guaranteedPacks: number
  /**
   * When a count was not seen, at most this many more. A bound: spans summed together share the campaign's tickets
   * (`guaranteedAllowance`, Codex on #172), so more imports never make it bigger.
   */
  unseenGuaranteed: number
}

const overlaps = (window: LuckWindow, start: string | null, end: string): boolean =>
  Date.parse(window.from) < Date.parse(end) && (start === null || Date.parse(start) < Date.parse(window.until))

/** The ★★ tickets a read says it holds; null when it did not say (version 1, or an import saved before pz/luck). */
const ticketsOf = (point: LuckChainPoint | null): number | null =>
  point ? starStarTickets(point.guaranteedTickets ?? null) : null

/**
 * The sources of the span from `start` (null: since the account began) to `end`, two imports of the same account. Its
 * Wonder Picks are regular unless the span overlaps a special window (then all are unknown: nothing says when each was
 * made); its guaranteed packs are the drop of the ★★ tickets in stock when a campaign overlaps it — or, when a count
 * was not seen, at most the tickets it started with (unseen: `GUARANTEED_TICKETS_PER_CAMPAIGN`), less the ones still
 * held at its end, and never more than the packs it opened.
 */
export function spanSources(
  start: LuckChainPoint | null,
  end: LuckChainPoint,
  pickWindows: readonly LuckWindow[] = SPECIAL_PICK_WINDOWS,
  guaranteedWindows: readonly LuckWindow[] = GUARANTEED_PACK_WINDOWS,
): SpanSources {
  const before = start ? start.totals.wonderPicks : 0
  const after = end.totals.wonderPicks
  const picks = before === null || after === null ? 0 : Math.max(0, after - before)
  const windows = pickWindows.filter((window) => overlaps(window, start?.syncedAt ?? null, end.syncedAt))
  const campaign = guaranteedWindows.some((window) => overlaps(window, start?.syncedAt ?? null, end.syncedAt))
  const ticketsBefore = ticketsOf(start)
  const ticketsAfter = ticketsOf(end)
  let guaranteedPacks = 0
  let unseenGuaranteed = 0
  if (campaign) {
    if (ticketsBefore !== null && ticketsAfter !== null) {
      guaranteedPacks = Math.max(0, ticketsBefore - ticketsAfter)
    } else {
      const packs = (end.totals.packsOpened ?? 0) - (start?.totals.packsOpened ?? 0)
      const held = ticketsBefore ?? GUARANTEED_TICKETS_PER_CAMPAIGN
      unseenGuaranteed = Math.max(0, Math.min(packs, held - (ticketsAfter ?? 0)))
    }
  }
  return { regularPicks: windows.length > 0 ? 0 : picks, pickWindows: windows, guaranteedPacks, unseenGuaranteed }
}

/**
 * The tickets for a guaranteed card an account's imports may have spent unseen, all spans together (Codex on #172):
 * `GUARANTEED_TICKETS_PER_CAMPAIGN` for each campaign its life overlaps, less the ones seen spent. However many imports
 * there are, the unseen packs of any spans summed never pass it.
 */
export function guaranteedAllowance(
  chain: readonly LuckChainPoint[],
  guaranteedWindows: readonly LuckWindow[] = GUARANTEED_PACK_WINDOWS,
): number {
  const last = chain[chain.length - 1]
  if (!last) return 0
  const campaigns = guaranteedWindows.filter((window) => overlaps(window, null, last.syncedAt)).length
  const seen = chain.reduce(
    (sum, point, i) =>
      sum + spanSources(i === 0 ? null : (chain[i - 1] ?? null), point, [], guaranteedWindows).guaranteedPacks,
    0,
  )
  return Math.max(0, campaigns * GUARANTEED_TICKETS_PER_CAMPAIGN - seen)
}

/** The sources of an account's whole life from its imports (oldest first): the sum of its spans. */
export function lifetimeSources(
  chain: readonly LuckChainPoint[],
  pickWindows: readonly LuckWindow[] = SPECIAL_PICK_WINDOWS,
  guaranteedWindows: readonly LuckWindow[] = GUARANTEED_PACK_WINDOWS,
): SpanSources {
  const total: SpanSources = { regularPicks: 0, pickWindows: [], guaranteedPacks: 0, unseenGuaranteed: 0 }
  chain.forEach((point, i) => {
    const span = spanSources(i === 0 ? null : (chain[i - 1] ?? null), point, pickWindows, guaranteedWindows)
    total.regularPicks += span.regularPicks
    for (const window of span.pickWindows) if (!total.pickWindows.includes(window)) total.pickWindows.push(window)
    total.guaranteedPacks += span.guaranteedPacks
    total.unseenGuaranteed += span.unseenGuaranteed
  })
  total.unseenGuaranteed = Math.min(total.unseenGuaranteed, guaranteedAllowance(chain, guaranteedWindows))
  return total
}

/** What a tier of one span adds to a check (pz/luck): summed over spans for «desde la primera importación». */
export interface TierParts {
  /** Real: cards of the tier obtained in the span. */
  observed: number
  /** Cards with known odds for the high end: the packs' and the regular Wonder Picks' at the packs' odds. */
  capacity: number
  /** Estimated: hits expected among `capacity`. */
  expected: number
  /** Cards with known odds for the low end: the packs' only. */
  packCapacity: number
  /** Estimated: hits expected among `packCapacity`. */
  packExpected: number
  /** Cards of unknown origin besides the regular Wonder Picks and the unseen guaranteed packs. */
  unknown: number
  /**
   * Packs that may have been opened with a guaranteed-card ticket, unseen (in the capacities until the spans are
   * summed: then the campaign's tickets cap them, Codex on #172).
   */
  unseenGuaranteed: number
}

interface PackMix {
  packCards: number
  rare: number
  ex: number
}

/** The cards and expected hits of some packs opened per expansion (estimated). */
function packMix(rows: readonly { expansionId: string; packs: number }[], index: CatalogIndex): PackMix {
  const mix: PackMix = { packCards: 0, rare: 0, ex: 0 }
  for (const row of rows) {
    const structure = index.expansionById(row.expansionId)?.packStructure ?? null
    if (!structure || row.packs === 0) continue
    const cards = row.packs * structure.cardsPerPack
    const share = rarityShareOfPack(structure)
    mix.packCards += cards
    mix.rare += cards * [...RARE_TIER].reduce((sum, rarity) => sum + (share[rarity] ?? 0), 0)
    mix.ex += cards * (share['◊◊◊◊'] ?? 0)
  }
  return mix
}

type LuckRead = LuckSnapshot & Partial<Pick<LuckChainPoint, 'syncedAt' | 'guaranteedTickets'>>

/**
 * Luck over a span: since the previous import (`previous`) or lifetime (`previous` null), with its `sources` (by
 * default `spanSources`, as if `previous` and `current` were consecutive imports). Null when a count went down between
 * the two (another account, or pokemon-zone started over): the difference means nothing.
 */
export function pokemonZoneLuck(
  current: LuckRead,
  previous: LuckRead | null,
  index: CatalogIndex,
  sources?: SpanSources,
): PokemonZoneLuck | null {
  const parts = spanParts(current, previous, index, sources)
  if (!parts) return null
  const { luck, rare, ex } = parts
  return { ...luck, rare: rare ? checkTier([rare]) : null, ex: ex ? checkTier([ex]) : null }
}

type SpanLuck = Omit<PokemonZoneLuck, 'rare' | 'ex'>

/** A span's numbers and its two tiers' parts (null parts when nothing has known odds). */
function spanParts(
  current: LuckRead,
  previous: LuckRead | null,
  index: CatalogIndex,
  given?: SpanSources,
): { luck: SpanLuck; rare: TierParts | null; ex: TierParts | null } | null {
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
  let unknownPacks = 0
  for (const row of current.expansions) {
    const old = before.get(row.expansionId)
    const packs = delta(row.packsOpened, old?.packsOpened)
    const cards = delta(row.cardsObtained, old?.cardsObtained)
    const expansion = index.expansionById(row.expansionId)
    const structure = expansion?.packStructure ?? null
    if (packs === 0 && cards === 0) continue
    if (!structure) unknownPacks += packs
    expansions.push({
      expansionId: row.expansionId,
      nameEs: expansion?.nameEs ?? null,
      nameEn: row.nameEn,
      packs,
      cards,
      packCards: structure ? packs * structure.cardsPerPack : null,
    })
  }
  expansions.sort((a, b) => b.packs - a.packs || b.cards - a.cards || a.expansionId.localeCompare(b.expansionId))
  const mix = packMix(expansions, index)

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
  const packs = expansions.reduce((sum, row) => sum + row.packs, 0)

  const point = (snapshot: LuckRead): LuckChainPoint => ({
    syncedAt: snapshot.syncedAt ?? new Date(0).toISOString(),
    totals: snapshot.totals,
    guaranteedTickets: snapshot.guaranteedTickets ?? null,
  })
  const sources = given ?? spanSources(previous ? point(previous) : null, point(current))
  // A Wonder Pick is at least a card of the packs being opened: the span's mix, or the account's whole mix when it
  // opened none.
  const pickMix =
    mix.packCards > 0
      ? mix
      : packMix(
          current.expansions.map((row) => ({ ...row, packs: row.packsOpened })),
          index,
        )
  const regularPicks = pickMix.packCards > 0 ? Math.min(sources.regularPicks, wonderPicks ?? 0) : 0
  const guaranteedPacks = Math.min(sources.guaranteedPacks, packs)
  const unseenGuaranteed = Math.min(sources.unseenGuaranteed, packs - guaranteedPacks)
  // Cards with known odds: the packs' (low end) and the packs' with the regular Wonder Picks' (high end); the unseen
  // guaranteed packs come off in `checkTier`; never more than the game counts.
  const packKnown = Math.max(0, mix.packCards - guaranteedPacks)
  const known = packKnown + regularPicks
  const capacity = Math.min(known, cards)
  const packCapacity = Math.min(packKnown, cards)
  const unknown = cards - capacity
  const windowPicks = Math.max(0, (wonderPicks ?? 0) - regularPicks)
  const restCards = Math.max(0, unknown - windowPicks - (trades ?? 0) - guaranteedPacks)
  const luck: SpanLuck = {
    packs,
    cards,
    packCards: mix.packCards,
    otherCards: unknown + unseenGuaranteed,
    wonderPicks,
    trades,
    sources: {
      wonderPicks,
      pickCards: regularPicks,
      unknownPicks: windowPicks,
      pickWindows: sources.pickWindows,
      trades,
      guaranteedPacks: guaranteedPacks + unseenGuaranteed,
      guaranteedSeen: unseenGuaranteed === 0,
      restCards,
    },
    byRarity,
    unknownRarity,
    expansions,
    byPack,
    unknownPacks,
  }
  if (capacity === 0) return { luck, rare: null, ex: null }
  // Expected hits: the packs' (without the guaranteed slots) and the regular Wonder Picks' at their mix's odds.
  const packShare = (hits: number) => (mix.packCards > 0 ? hits / mix.packCards : 0)
  const pickShare = (hits: number) => hits / pickMix.packCards
  const parts = (observed: number, packHits: number, pickHits: number): TierParts => {
    const fromPacks = packKnown * packShare(packHits)
    const hits = fromPacks + regularPicks * pickShare(pickHits)
    return {
      observed,
      capacity,
      expected: (hits / known) * capacity,
      packCapacity,
      packExpected: packKnown > 0 ? (fromPacks / packKnown) * packCapacity : 0,
      unknown,
      unseenGuaranteed,
    }
  }
  const rareObserved = [...RARE_TIER].reduce((sum, rarity) => sum + (byRarity[rarity] ?? 0), 0)
  return {
    luck,
    rare: parts(rareObserved, mix.rare, pickMix.rare),
    ex: parts(byRarity['◊◊◊◊'] ?? 0, mix.ex, pickMix.ex),
  }
}

/**
 * The check of a tier over some spans. The unseen guaranteed packs, capped by the campaign's tickets, come off the
 * cards with known odds and go to the unknown ones. Low end (for «mejor de lo normal»): the packs only, with the hits
 * at least what each span's other cards — its Wonder Picks included — could not hold. High end (for «peor de lo
 * normal»): the packs and the regular Wonder Picks at the packs' odds, with the hits at most what each span saw (or
 * its cards with known odds). A verdict when both ends agree.
 */
export function checkTier(
  spans: readonly TierParts[],
  guaranteedAllowance: number = Number.POSITIVE_INFINITY,
): GameLuckTier {
  const sum = (value: (span: TierParts) => number) => spans.reduce((total, span) => total + value(span), 0)
  const guaranteed = Math.min(
    sum((span) => span.unseenGuaranteed),
    guaranteedAllowance,
  )
  const observed = sum((span) => span.observed)
  // Low end: the packs alone.
  const packCapacity = sum((span) => span.packCapacity)
  const packGames = Math.max(0, packCapacity - guaranteed)
  const packShare = packCapacity > 0 ? (sum((span) => span.packExpected) / packCapacity) * 100 : 0
  const otherOf = (span: TierParts) => span.unknown + span.capacity - span.packCapacity
  const leastPacks = sum((span) => Math.max(0, span.observed - otherOf(span)))
  const mostPacks = Math.min(
    sum((span) => Math.min(span.observed, span.packCapacity)),
    packGames,
  )
  const min = Math.min(packGames, Math.max(0, leastPacks - guaranteed))
  // High end: with the Wonder Picks at the packs' odds.
  const capacity = sum((span) => span.capacity)
  const games = Math.max(0, capacity - guaranteed)
  const expectedShare = capacity > 0 ? (sum((span) => span.expected) / capacity) * 100 : 0
  const max = Math.min(
    sum((span) => Math.min(span.observed, span.capacity)),
    games,
  )
  const lowCheck = (hits: number) => luckCheck({ wins: hits, losses: packGames - hits, ties: 0 }, packShare)
  const low = lowCheck(min)
  const high = luckCheck({ wins: max, losses: games - max, ties: 0 }, expectedShare)
  const verdict: GameLuckVerdict = low.verdict === high.verdict ? low.verdict : 'unknown'
  return {
    observed,
    expectedShare,
    games,
    expected: (games * expectedShare) / 100,
    packGames,
    packExpected: (packGames * packShare) / 100,
    unknown: sum(otherOf) + guaranteed,
    fromPacks: { min, max },
    low,
    high,
    verdict,
    // Lucky at the least lucky end; unlucky at the least unlucky one.
    tail: verdict === 'lucky' ? low.upperTail : verdict === 'unlucky' ? high.lowerTail : null,
    normalIf: normalRange({ min, max: mostPacks }, observed, lowCheck),
  }
}

/**
 * The cards of unknown origin of the tier (`observed` − hits among the packs) for which the packs alone say «normal»:
 * more hits from the packs is luckier, so «normal» is one run between the «unlucky» and the «lucky» ones.
 */
function normalRange(
  fromPacks: { min: number; max: number },
  observed: number,
  check: (hits: number) => LuckCheck,
): { min: number; max: number } | null {
  const verdictAt = (hits: number) => check(hits).verdict
  if (fromPacks.max < fromPacks.min || verdictAt(fromPacks.min) === 'too_few') return null
  // The first hit count that is not «unlucky», and the last that is not «lucky».
  let lo = fromPacks.min
  let hi = fromPacks.max + 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (verdictAt(mid) === 'unlucky') lo = mid + 1
    else hi = mid
  }
  const firstNotUnlucky = lo
  lo = fromPacks.min - 1
  hi = fromPacks.max
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (verdictAt(mid) === 'lucky') hi = mid - 1
    else lo = mid
  }
  const lastNotLucky = lo
  if (firstNotUnlucky > lastNotLucky) return null
  return { min: observed - lastNotLucky, max: observed - firstNotUnlucky }
}

/** «Desde la primera importación»: the spans between consecutive imports that count, and the check over them. */
export interface PokemonZoneLuckSinceFirst {
  /** The first and the latest import's reads of the game (ISO). */
  from: string
  to: string
  /** Spans between consecutive imports (the ones whose counts went down are left out). */
  spans: number
  rare: GameLuckIntervals | null
  ex: GameLuckIntervals | null
}

export interface GameLuckIntervals extends GameLuckTier {
  /** Spans counted for this tier: the ones with few cards of unknown origin (`INCLUSION_SD`). */
  counted: number
}

/** The unknown cards of some spans summed as `checkTier` counts them at the high end: the guaranteed packs capped. */
function summedUnknown(spans: readonly TierParts[], guaranteedAllowance: number): number {
  const unknown = spans.reduce((sum, span) => sum + span.unknown, 0)
  const guaranteed = spans.reduce((sum, span) => sum + span.unseenGuaranteed, 0)
  return unknown + Math.min(guaranteed, guaranteedAllowance)
}

/**
 * The spans of a tier that count: in order of unknown cards per expected hit (fewest first; a tie, the newest first,
 * so the verdict never freezes on the oldest days: review of #172), each one while the unknown cards of all the
 * counted ones — whole cards, the guaranteed packs capped by `guaranteedAllowance` (Codex on #172), the Wonder Picks
 * not (they count at the packs' odds for «peor de lo normal») — stay within `INCLUSION_SD` standard deviations of their
 * expected hits. What decides is the spans' unknown cards and expected hits, never what they got, so the sum is a fair
 * check.
 */
export function countedSpans(
  spans: readonly TierParts[],
  sd: number = INCLUSION_SD,
  guaranteedAllowance: number = Number.POSITIVE_INFINITY,
): TierParts[] {
  const load = (span: TierParts) => span.unknown + span.unseenGuaranteed
  const candidates = spans
    .map((span, at) => ({ span, at }))
    .filter(({ span }) => span.capacity > 0 && span.expected > 0)
    .sort((a, b) => load(a.span) / a.span.expected - load(b.span) / b.span.expected || b.at - a.at)
  let expected = 0
  const counted: { span: TierParts; at: number }[] = []
  for (const candidate of candidates) {
    const next = [...counted.map((item) => item.span), candidate.span]
    const nextExpected = expected + candidate.span.expected
    if (summedUnknown(next, guaranteedAllowance) > sd * Math.sqrt(nextExpected)) continue
    counted.push(candidate)
    expected = nextExpected
  }
  return counted.sort((a, b) => a.at - b.at).map(({ span }) => span)
}

/**
 * The luck since the first import of an account, from its imports (oldest first, one per read of the game): the spans
 * between consecutive imports that count (`countedSpans`), summed. Null with fewer than two imports.
 */
export function pokemonZoneLuckSinceFirst(
  chain: readonly (LuckSnapshot & LuckChainPoint)[],
  index: CatalogIndex,
): PokemonZoneLuckSinceFirst | null {
  const first = chain[0]
  const last = chain[chain.length - 1]
  if (!first || !last || chain.length < 2) return null
  const rare: TierParts[] = []
  const ex: TierParts[] = []
  let spans = 0
  for (let i = 1; i < chain.length; i++) {
    const before = chain[i - 1]
    const after = chain[i]
    if (!before || !after) continue
    const parts = spanParts(after, before, index, spanSources(before, after))
    if (!parts) continue
    spans += 1
    if (parts.rare) rare.push(parts.rare)
    if (parts.ex) ex.push(parts.ex)
  }
  // The campaign's tickets are shared by every span (Codex on #172): the unseen ones of the spans summed never pass them.
  const allowance = guaranteedAllowance(chain)
  const tier = (parts: TierParts[]): GameLuckIntervals | null => {
    const counted = countedSpans(parts, INCLUSION_SD, allowance)
    return counted.length === 0 ? null : { ...checkTier(counted, allowance), counted: counted.length }
  }
  return { from: first.syncedAt, to: last.syncedAt, spans, rare: tier(rare), ex: tier(ex) }
}
