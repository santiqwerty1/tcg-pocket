/**
 * Pack recommendation (BRIEF M4, PLAN §3.4): for every pack with a pack structure, P(≥1 wanted card), expected
 * wanted cards, expected value weighted by the goals, packs for 50 % / 90 %; for every missing card of the target
 * decks, its cheapest print in pack points, whether it can be traded and the best pack to open; for every target
 * deck, the expected packs to complete it from its best packs. Both models side by side, with the reason when they
 * differ (DECISIONES 4.1). Limited-time packs (the Deluxe Mega) weigh more the versions only they give while they last
 * (DECISIONES 4.9).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardEdition, CardId, Rarity } from '../catalog/types.js'
import { isHoloEdition } from '../decks/bestVersions.js'
import {
  type CompletionEstimate,
  expectedPacksToComplete,
  type MissingInPack,
  type PlanPacks,
  planPacks,
} from './completion.js'
import { type CollectionGoal, collectionWanted, type DeckGoal, deckDeficits, type GroupDeficit } from './goals.js'
import {
  combineChances,
  editionChances,
  matchWanted,
  type PackModel,
  type PackProfile,
  packProfile,
  packsForConfidence,
} from './pullRate.js'

export interface RarityRule {
  /** Pack points to buy one copy; null = cannot be bought (promos). */
  points: number | null
  /** Confirmed in the game by the owner. */
  verified: boolean
  tradeable: boolean
}

/**
 * Tracker craftingCost plus ✵/✵✵ (PLAN §3.4, B9). Confirmed by Santi in the game on 8/10/2026 (P-003, P-004): ✵ and ✵✵
 * cost 1000 and 1350 points; ◊ to ◊◊◊◊, ☆, ☆☆, ✵ and ✵✵ can be traded, ☆☆☆, ♛ and promos cannot.
 */
export const DEFAULT_RARITY_RULES: Readonly<Record<Rarity, RarityRule>> = {
  '◊': { points: 35, verified: false, tradeable: true },
  '◊◊': { points: 70, verified: false, tradeable: true },
  '◊◊◊': { points: 150, verified: false, tradeable: true },
  '◊◊◊◊': { points: 500, verified: false, tradeable: true },
  '☆': { points: 400, verified: false, tradeable: true },
  '☆☆': { points: 1250, verified: false, tradeable: true },
  '☆☆☆': { points: 1500, verified: false, tradeable: false },
  '✵': { points: 1000, verified: true, tradeable: true },
  '✵✵': { points: 1350, verified: true, tradeable: true },
  'Crown Rare': { points: 2500, verified: false, tradeable: false },
  P: { points: null, verified: false, tradeable: false },
}

/** Pack points earned per pack opened (of that pack's expansion). */
export const PACK_POINTS_PER_PACK = 5

/** Packs off by default: the Deluxe ex (A4b) left the shop (PLAN B9); the owner switches them. */
export const PACKS_OFF_BY_DEFAULT: ReadonlySet<string> = new Set(['A4b/deluxepack'])

/**
 * Packs sold for a limited time, with their last day (owner's time zone) when known: the Deluxe Mega runs from
 * 30/9 to 29/10/2026 (Serebii, Pocket Gamer; 28/10 in the evening, Pacific time), so 28/10 is the last safe day.
 */
export const PACKS_LIMITED_BY_DEFAULT: ReadonlyMap<string, string | null> = new Map([
  ['B4b/deluxepackmega', '2026-10-28'],
])

/** Default weight of the wanted versions only a limited-time pack gives, while it lasts. */
export const DEFAULT_LIMITED_BOOST = 3

/** A pack on sale for a limited time; `until` = its last day (YYYY-MM-DD), null when unknown. */
export interface LimitedPack {
  until: string | null
}

/** Whole days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export interface RecommendInput {
  index: CatalogIndex
  decks: readonly DeckGoal[]
  collection: CollectionGoal | null
  /** 0…1: weight of the decks goal against the collection goal (only matters when both are set). */
  alpha: number
  playable: (groupId: CardId) => number
  owned: (stockCardId: CardId) => number
  available: (packId: string) => boolean
  model: PackModel
  /** Leave unavailable packs out of the table and of the advice. */
  onlyAvailable: boolean
  rarityRule: (rarity: Rarity) => RarityRule
  /** Limited-time packs (null = always on sale); none when omitted. */
  limited?: (packId: string) => LimitedPack | null
  /** Today in the owner's time zone (YYYY-MM-DD): days left; a limited pack past its last day is not available. */
  today?: string
  /** ≥ 1: weight of the wanted cards only a limited pack gives (no pack that stays does). Default 2. */
  limitedBoost?: number
  /**
   * Pack points already saved, per expansion (Sobres → Ajustes). They can be spent even after the expansion's packs
   * left the shop (S-002, refuted by Santi on 8/10/2026). None when omitted.
   */
  savedPoints?: ((expansionId: string) => number) | undefined
}

export type ModelDifferenceReason = 'babies' | 'reprints'

export interface PackRow {
  packId: string
  expansionId: string
  available: boolean
  cardsPerPack: 4 | 5
  /** Editions of the pack that count for some goal. */
  wanted: number
  probability: number
  expected: number
  /**
   * Score that ranks the table, 1 = the best pack on sale: α × (deck value / best pack's deck value) + (1 − α) ×
   * (collection value / best pack's collection value), where a goal's value is Σ weight × expected copies (deck
   * weight = priority × missing; × limitedBoost for what only a limited pack gives). Packs off sale may pass 1.
   */
  expectedValue: number
  packsFor50: number | null
  packsFor90: number | null
  decks: { probability: number; expected: number } | null
  collection: { probability: number; expected: number } | null
  otherModel: { model: PackModel; probability: number; reasons: ModelDifferenceReason[] }
  /** Limited-time pack: last day, days left (0 = last day, negative = over) and what only it gives. */
  limited: LimitedRow | null
}

/**
 * A card only a limited pack gives. Versions are told apart by the tracker's internal id: B4b-8 is the same version
 * as B1-2 (one row, copies counted together), B4b-237 is a new version of Bulbasaur B1a-1 (holographic).
 */
export interface ExclusiveVersion {
  cardId: CardId
  nameEs: string
  rarity: Rarity
  holo: boolean
  /** Wanted by a deck (any version of the functional card would do) or by the collection (this version). */
  goal: 'decks' | 'collection'
}

export interface LimitedRow {
  until: string | null
  daysLeft: number | null
  /**
   * Wanted cards no pack that stays gives: functional cards for the decks goal, versions for the collection goal.
   * They weigh `limitedBoost` times more in the score while the pack is on sale.
   */
  exclusive: ExclusiveVersion[]
}

export interface PrintCost {
  cardId: CardId
  rarity: Rarity
  points: number
  verified: boolean
  tradeable: boolean
}

export interface MissingCardRow {
  groupId: CardId
  nameEs: string
  missing: number
  weight: number
  decks: GroupDeficit['decks']
  /** Cheapest print whose pack points can still be earned (its expansion has a pack on sale). */
  cheapest: PrintCost | null
  /**
   * When no print can be bought with points that can still be earned: the cheapest one in an expansion whose packs
   * left the shop, for points already saved there (D-008, decided 8/10/2026). Null otherwise.
   */
  retiredCheapest: PrintCost | null
  /** Some version can be traded (tradeable rarity and expansion). */
  tradeable: boolean
  /**
   * The cheapest print the points already saved in its expansion pay for, with the balance and how many of the
   * missing copies it covers. Each card is checked alone against the balance, like lists against the collection.
   */
  redeem: (PrintCost & { saved: number; copies: number }) | null
  bestPack: { packId: string; probability: number; packsPerCopy: number; limited: boolean } | null
  /** When the best pack is a limited one: the best pack that stays (null = none gives it). */
  afterLimited: { packId: string; probability: number; packsPerCopy: number } | null
  /** Points of the cheapest print, in packs opened (5 points each). */
  pointsInPacks: number | null
  /**
   * «redeem» when the points already saved pay for it (nothing to open or earn); «buy» when the points cost fewer
   * packs than the expected packs to pull it; «trade» when no pack on sale gives it and it cannot be bought, but a
   * version can be traded (the Deluxe ex left the shop, DECISIONES 4.10).
   */
  advice: 'redeem' | 'buy' | 'open' | 'trade' | null
}

export interface DeckCompletion {
  deckId: string
  name: string
  priority: number
  /** Copies missing in total. */
  missingCopies: number
  /** Missing cards no available pack gives (promos, retired packs). */
  notInPacks: string[]
  /**
   * Packs that cover the most missing copies, then the fewest expected packs to get the ones they cover. A deck
   * usually mixes expansions, so one pack rarely covers everything: `covered` says how much of it this pack gives.
   */
  bestPacks: ({ packId: string; covered: number; limited: boolean } & CompletionEstimate)[]
  /**
   * Fase 14: the whole deck, each missing card from the pack that gives it best, opened one pack after the other
   * (cards to redeem with saved points and cards no pack gives are left out). Null when nothing is left to open.
   */
  plan: {
    packs: PlanPacks
    groups: { packId: string; copies: number; cards: string[]; limited: boolean }[]
    redeemable: string[]
  } | null
}

export interface Recommendation {
  model: PackModel
  alpha: number
  limitedBoost: number
  rows: PackRow[]
  missing: MissingCardRow[]
  decks: DeckCompletion[]
  /** Versions the collection goal wants that no pack on sale gives, and how many of them can be traded. */
  collectionOutOfPacks: { versions: number; tradeable: number } | null
}

function unique(cards: readonly CardEdition[]): CardEdition[] {
  const seen = new Map<CardId, CardEdition>()
  for (const card of cards) seen.set(card.id, card)
  return [...seen.values()]
}

function sameIds(a: readonly CardEdition[], b: readonly CardEdition[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map((card) => card.id))
  return b.every((card) => ids.has(card.id))
}

/** A version can be traded: its rarity and its expansion allow it. */
export function isTradeable(
  index: CatalogIndex,
  card: CardEdition,
  rarityRule: (rarity: Rarity) => RarityRule,
): boolean {
  return rarityRule(card.rarity).tradeable && (index.expansionById(card.expansionId)?.tradeable ?? false)
}

/**
 * Cheapest print of a functional card that can be bought with pack points. `earnable` leaves out expansions whose
 * points can no longer be earned (no pack of theirs on sale).
 */
export function cheapestPrint(
  index: CatalogIndex,
  groupId: CardId,
  rarityRule: (rarity: Rarity) => RarityRule,
  earnable: (expansionId: string) => boolean = () => true,
): PrintCost | null {
  let best: PrintCost | null = null
  for (const card of index.cardsOfGroup(groupId)) {
    const rule = rarityRule(card.rarity)
    if (rule.points === null || !earnable(card.expansionId)) continue
    if (best && best.points <= rule.points) continue
    best = {
      cardId: card.id,
      rarity: card.rarity,
      points: rule.points,
      verified: rule.verified,
      tradeable: isTradeable(index, card, rarityRule),
    }
  }
  return best
}

/** The cheapest print of a functional card that `saved` points of its own expansion already pay for. */
export function redeemablePrint(
  index: CatalogIndex,
  groupId: CardId,
  rarityRule: (rarity: Rarity) => RarityRule,
  saved: (expansionId: string) => number,
  missing: number,
): (PrintCost & { saved: number; copies: number }) | null {
  let best: (PrintCost & { saved: number; copies: number }) | null = null
  for (const card of index.cardsOfGroup(groupId)) {
    const rule = rarityRule(card.rarity)
    if (rule.points === null || rule.points <= 0) continue
    const balance = saved(card.expansionId)
    if (balance < rule.points || (best && best.points <= rule.points)) continue
    best = {
      cardId: card.id,
      rarity: card.rarity,
      points: rule.points,
      verified: rule.verified,
      tradeable: isTradeable(index, card, rarityRule),
      saved: balance,
      copies: Math.min(Math.max(1, missing), Math.floor(balance / rule.points)),
    }
  }
  return best
}

export function recommendPacks(input: RecommendInput): Recommendation {
  const { index, model } = input
  const deficits = deckDeficits(input.decks, index, input.playable)
  const deckWeight = new Map(deficits.map((deficit) => [deficit.groupId, deficit.weight]))
  const deckWanted = deficits.flatMap((deficit) =>
    deficit.listedCardIds.map((cardId) => index.cardById(cardId)).filter((card): card is CardEdition => !!card),
  )
  const colWanted = input.collection ? collectionWanted(index, input.owned, input.collection) : []
  const decksActive = deficits.length > 0
  const collectionActive = input.collection !== null
  const alpha = Math.min(1, Math.max(0, input.alpha))
  const deckFactor = decksActive ? (collectionActive ? alpha : 1) : 0
  const collectionFactor = collectionActive ? (decksActive ? 1 - alpha : 1) : 0

  const profiles = index.catalog.packs
    .map((pack) => packProfile(pack.id, index))
    .filter((profile): profile is PackProfile => profile !== null)

  // Limited-time packs: past their last day they are not on sale; while on sale, what only they give weighs more.
  const today = input.today
  const limitedOf = (packId: string): LimitedPack | null => input.limited?.(packId) ?? null
  const onSale = (packId: string): boolean => {
    if (!input.available(packId)) return false
    const until = limitedOf(packId)?.until
    return !(until && today && until < today)
  }
  const limitedBoost = Math.max(1, input.limitedBoost ?? DEFAULT_LIMITED_BOOST)
  const openable = profiles.filter((profile) => onSale(profile.packId))
  const staying = openable.filter((profile) => limitedOf(profile.packId) === null)
  const earnableExpansions = new Set(openable.map((profile) => profile.expansionId))

  const evaluate = (profile: PackProfile, which: PackModel) => {
    const byDecks = decksActive ? matchWanted(profile, deckWanted, { model: which, byGroup: true }) : []
    const byCollection = collectionActive ? matchWanted(profile, colWanted, { model: which, byGroup: false }) : []
    const all = unique([...byDecks, ...byCollection])
    const chances = new Map(all.map((card) => [card.id, editionChances(card, profile, which)]))
    const outcome = (cards: readonly CardEdition[]) =>
      combineChances(
        cards.map((card) => chances.get(card.id) as ReturnType<typeof editionChances>),
        profile.structure,
      )
    return { byDecks, byCollection, all, chances, outcome }
  }

  const evaluations = new Map(profiles.map((profile) => [profile.packId, evaluate(profile, model)]))
  // What the packs that stay give: functional cards for the decks, versions (internal ids) for the collection.
  const stayingGroups = new Set<CardId>()
  const stayingVersions = new Set<number>()
  for (const profile of staying) {
    const current = evaluations.get(profile.packId)
    for (const card of current?.byDecks ?? []) stayingGroups.add(card.functionalGroupId)
    for (const card of current?.byCollection ?? []) stayingVersions.add(card.internalId)
  }

  const rows: PackRow[] = []
  const rawValues = new Map<string, { deck: number; collection: number }>()
  for (const profile of profiles) {
    const available = onSale(profile.packId)
    if (input.onlyAvailable && !available) continue
    const current = evaluations.get(profile.packId) ?? evaluate(profile, model)
    const otherModel: PackModel = model === 'corrected' ? 'tracker' : 'corrected'
    const other = evaluate(profile, otherModel)
    const limited = limitedOf(profile.packId)
    const boosting = limited !== null && available
    const exclusive: ExclusiveVersion[] = []
    const seenGroups = new Set<CardId>()
    const seenVersions = new Set<number>()
    // Raw value of each goal: Σ weight × expected copies (deck weight = priority × missing; collection = 1), and
    // × limitedBoost for what only this limited pack gives while it is on sale.
    let deckValue = 0
    for (const card of current.byDecks) {
      const only = boosting && !stayingGroups.has(card.functionalGroupId)
      if (only && !seenGroups.has(card.functionalGroupId)) {
        seenGroups.add(card.functionalGroupId)
        exclusive.push(exclusiveVersion(index, card, 'decks'))
      }
      deckValue +=
        (deckWeight.get(card.functionalGroupId) ?? 0) * (only ? limitedBoost : 1) * current.outcome([card]).expected
    }
    let collectionValue = 0
    for (const card of current.byCollection) {
      const only = boosting && !stayingVersions.has(card.internalId)
      if (only && !seenVersions.has(card.internalId)) {
        seenVersions.add(card.internalId)
        exclusive.push(exclusiveVersion(index, card, 'collection'))
      }
      collectionValue += (only ? limitedBoost : 1) * current.outcome([card]).expected
    }
    rawValues.set(profile.packId, { deck: deckValue, collection: collectionValue })
    const total = current.outcome(current.all)
    const reasons: ModelDifferenceReason[] = []
    if (!sameIds(current.all, other.all)) reasons.push('reprints')
    const babyRarities = current.all.some(
      (card) => !profile.structure.containsBabies && (profile.count.get(card.rarity)?.baby ?? 0) > 0,
    )
    if (babyRarities) reasons.push('babies')
    rows.push({
      packId: profile.packId,
      expansionId: profile.expansionId,
      available,
      cardsPerPack: profile.structure.cardsPerPack,
      wanted: current.all.length,
      probability: total.probability,
      expected: total.expected,
      expectedValue: 0,
      packsFor50: packsForConfidence(total.probability, 0.5),
      packsFor90: packsForConfidence(total.probability, 0.9),
      decks: decksActive ? current.outcome(current.byDecks) : null,
      collection: collectionActive ? current.outcome(current.byCollection) : null,
      otherModel: { model: otherModel, probability: other.outcome(other.all).probability, reasons },
      limited: limited
        ? {
            until: limited.until,
            daysLeft: limited.until && today ? daysBetween(today, limited.until) : null,
            exclusive,
          }
        : null,
    })
  }
  // Each goal is scaled to its best pack on sale before weighing with α, so α means what it says: a collection goal
  // with thousands of wanted editions does not drown a deck missing one card (DECISIONES 4.4). A pack off sale may
  // score above 1: it says how much better it would be.
  const scaleBy = (goal: 'deck' | 'collection') => {
    const onSaleMax = Math.max(
      0,
      ...rows.filter((row) => row.available).map((row) => rawValues.get(row.packId)?.[goal] ?? 0),
    )
    return onSaleMax > 0 ? onSaleMax : Math.max(0, ...[...rawValues.values()].map((value) => value[goal]))
  }
  const maxDeck = scaleBy('deck')
  const maxCollection = scaleBy('collection')
  for (const row of rows) {
    const value = rawValues.get(row.packId) ?? { deck: 0, collection: 0 }
    row.expectedValue =
      (maxDeck > 0 ? (deckFactor * value.deck) / maxDeck : 0) +
      (maxCollection > 0 ? (collectionFactor * value.collection) / maxCollection : 0)
  }
  // Packs on sale first: the others are there to compare (acceptance d), not to open.
  rows.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      b.expectedValue - a.expectedValue ||
      b.probability - a.probability ||
      a.packId.localeCompare(b.packId, 'en', { numeric: true }),
  )

  // Per missing card: cost to buy and the best pack to open (packs on sale only).
  const groupChances = (profile: PackProfile, deficit: GroupDeficit) => {
    const listed = deficit.listedCardIds.map((cardId) => index.cardById(cardId)).filter((c): c is CardEdition => !!c)
    return matchWanted(profile, listed, { model, byGroup: true }).map((card) => editionChances(card, profile, model))
  }
  const missing: MissingCardRow[] = deficits.map((deficit) => {
    let bestPack: MissingCardRow['bestPack'] = null
    let afterLimited: MissingCardRow['afterLimited'] = null
    for (const profile of openable) {
      const probability = combineChances(groupChances(profile, deficit), profile.structure).probability
      if (probability <= 0) continue
      const limited = limitedOf(profile.packId) !== null
      if (!bestPack || probability > bestPack.probability) {
        bestPack = { packId: profile.packId, probability, packsPerCopy: 1 / probability, limited }
      }
      if (!limited && (!afterLimited || probability > afterLimited.probability)) {
        afterLimited = { packId: profile.packId, probability, packsPerCopy: 1 / probability }
      }
    }
    const cheapest = cheapestPrint(index, deficit.groupId, input.rarityRule, (id) => earnableExpansions.has(id))
    const retiredCheapest = cheapest
      ? null
      : cheapestPrint(index, deficit.groupId, input.rarityRule, (id) => !earnableExpansions.has(id))
    const tradeable = index.cardsOfGroup(deficit.groupId).some((card) => isTradeable(index, card, input.rarityRule))
    const pointsInPacks = cheapest ? cheapest.points / PACK_POINTS_PER_PACK : null
    const savedPoints = input.savedPoints
    const redeem = savedPoints
      ? redeemablePrint(index, deficit.groupId, input.rarityRule, savedPoints, deficit.missing)
      : null
    const advice: MissingCardRow['advice'] = redeem
      ? 'redeem'
      : pointsInPacks === null
        ? bestPack
          ? 'open'
          : tradeable
            ? 'trade'
            : null
        : !bestPack || pointsInPacks <= bestPack.packsPerCopy
          ? 'buy'
          : 'open'
    return {
      groupId: deficit.groupId,
      nameEs: deficit.nameEs,
      missing: deficit.missing,
      weight: deficit.weight,
      decks: deficit.decks,
      cheapest,
      retiredCheapest,
      tradeable,
      redeem,
      bestPack,
      afterLimited: bestPack?.limited ? afterLimited : null,
      pointsInPacks,
      advice,
    }
  })

  // Per target deck: expected packs to complete it from each available pack, best three.
  const decks: DeckCompletion[] = input.decks
    .filter((goal) => goal.priority > 0)
    .map((goal) => {
      const own = deckDeficits([goal], index, input.playable)
      const notInPacks = own
        .filter((deficit) =>
          openable.every(
            (profile) => combineChances(groupChances(profile, deficit), profile.structure).probability <= 0,
          ),
        )
        .map((deficit) => deficit.nameEs)
      const reachable = own.filter((deficit) => !notInPacks.includes(deficit.nameEs))
      const bestPacks: DeckCompletion['bestPacks'] = []
      if (reachable.length > 0) {
        for (const profile of openable) {
          // Only the missing cards this pack can give: the estimate is for those.
          const items: MissingInPack[] = reachable
            .map((deficit) => ({
              groupId: deficit.groupId,
              copies: deficit.missing,
              chances: groupChances(profile, deficit),
            }))
            .filter((item) => combineChances(item.chances, profile.structure).probability > 0)
          if (items.length === 0) continue
          const estimate = expectedPacksToComplete(items, profile.structure)
          if (!estimate) continue
          const covered = items.reduce((sum, item) => sum + item.copies, 0)
          bestPacks.push({ packId: profile.packId, covered, limited: limitedOf(profile.packId) !== null, ...estimate })
        }
        bestPacks.sort((a, b) => b.covered - a.covered || a.expectedPacks - b.expectedPacks)
      }
      // The plan: every reachable card from its best pack; the ones payable with saved points are not opened for.
      const advice = new Map(missing.map((row) => [row.groupId, row]))
      const redeemable = reachable.filter((deficit) => advice.get(deficit.groupId)?.advice === 'redeem')
      const byPack = new Map<string, { profile: PackProfile; items: MissingInPack[]; names: string[] }>()
      for (const deficit of reachable) {
        if (advice.get(deficit.groupId)?.advice === 'redeem') continue
        const best = advice.get(deficit.groupId)?.bestPack
        const profile = best ? openable.find((item) => item.packId === best.packId) : undefined
        if (!profile) continue
        const entry = byPack.get(profile.packId) ?? { profile, items: [], names: [] }
        entry.items.push({ groupId: deficit.groupId, copies: deficit.missing, chances: groupChances(profile, deficit) })
        entry.names.push(deficit.nameEs)
        byPack.set(profile.packId, entry)
      }
      const groups = [...byPack.values()]
      const plan: DeckCompletion['plan'] =
        groups.length === 0 && redeemable.length === 0
          ? null
          : {
              packs: planPacks(
                groups.map((group) => ({ missing: group.items, structure: group.profile.structure })),
                Number.parseInt(goal.deckId, 10) || 1,
              ),
              groups: groups
                .map((group) => ({
                  packId: group.profile.packId,
                  copies: group.items.reduce((sum, item) => sum + item.copies, 0),
                  cards: group.names,
                  limited: limitedOf(group.profile.packId) !== null,
                }))
                .sort((a, b) => b.copies - a.copies),
              redeemable: redeemable.map((deficit) => deficit.nameEs),
            }
      return {
        deckId: goal.deckId,
        name: goal.name,
        priority: goal.priority,
        missingCopies: own.reduce((sum, deficit) => sum + deficit.missing, 0),
        notInPacks,
        bestPacks: bestPacks.slice(0, 3),
        plan,
      }
    })

  // The collection goal's versions no pack on sale gives: only trades (or nothing, for promos) get them.
  let collectionOutOfPacks: Recommendation['collectionOutOfPacks'] = null
  if (collectionActive) {
    const reachable = new Set(openable.flatMap((profile) => profile.cards.map((card) => card.internalId)))
    const seen = new Set<number>()
    let versions = 0
    let tradeable = 0
    for (const card of colWanted) {
      if (reachable.has(card.internalId) || seen.has(card.internalId)) continue
      seen.add(card.internalId)
      versions += 1
      if (index.cardsByInternalId(card.internalId).some((print) => isTradeable(index, print, input.rarityRule))) {
        tradeable += 1
      }
    }
    collectionOutOfPacks = { versions, tradeable }
  }

  return { model, alpha, limitedBoost, rows, missing, decks, collectionOutOfPacks }
}

function exclusiveVersion(index: CatalogIndex, card: CardEdition, goal: ExclusiveVersion['goal']): ExclusiveVersion {
  return { cardId: card.id, nameEs: card.nameEs, rarity: card.rarity, holo: isHoloEdition(card, index), goal }
}
