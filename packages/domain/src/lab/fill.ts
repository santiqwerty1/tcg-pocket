/**
 * T-017 C8: «llenar a fondo» the weakest places. After the probe round (C3), the first copy of each of the
 * `FILL_SLOTS` weakest cards goes out, and one search round tries every way to fill those places with the
 * `FILL_CANDIDATES` cards the meta plays most around the deck (and the cards that were there): what
 * `engine-cli optimize` does, but inside the lab — every list on the same seeds (H-020), games by weight, paired tests,
 * split among workers. The `FILL_VERIFY` best that pass the screen go to the verification together, and one stays only
 * when it beats the incumbent there by `verifyZ` corrected for how many were verified (Bonferroni): verifying three
 * and keeping the best of them would otherwise bring back the winner's curse the verification is there to stop (H-010).
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { CardId } from '../catalog/types.js'
import type { DeckCardEntry } from '../decks/types.js'
import { normalCdf } from '../stats/tests.js'
import { listKeyByGroup } from '../tournaments/dataset.js'
import { cardChanges, type PoolCard, replaceSlot, slotGroups, type Variant } from './mutate.js'
import { groupsOfCards } from './novelty.js'
import { differenceVerdict } from './paired.js'
import { type MetaScore, type ScoreDifference, scoreBeats } from './score.js'

/** Places filled at once: one copy of each of the two weakest cards. */
export const FILL_SLOTS = 2
/** Cards tried in those places, besides the ones that were there. */
export const FILL_CANDIDATES = 5
/** The best of the round that go to the verification together. */
export const FILL_VERIFY = 3

/** Ways to choose `slots` cards out of `kinds`, repeats allowed (C(kinds + slots − 1, slots)). */
function multisetCount(kinds: number, slots: number): number {
  let count = 1
  for (let i = 1; i <= slots; i++) count = (count * (kinds + i - 1)) / i
  return Math.round(count)
}

/** Most lists a fill round plays: every way to fill the places, but leaving them as they were. */
export function fillMaxVariants(slots = FILL_SLOTS, candidates = FILL_CANDIDATES): number {
  return multisetCount(candidates + slots, slots) - 1
}

export interface FillOptions {
  slots?: number | undefined
  candidates?: number | undefined
  /** Functional cards that never go out (they keep their places). */
  locked?: ReadonlySet<CardId> | undefined
  /** Keys already tried: a list is never played twice. */
  seen?: ReadonlySet<string> | undefined
  /** Copies the pool allows of a card (the collection's, with «colección»). */
  maxCopies: (groupId: CardId) => number
  valid: (cards: readonly DeckCardEntry[]) => boolean
}

export interface FillRound {
  /** The functional cards whose first copy goes out, weakest first. */
  out: CardId[]
  /** The cards tried in their places (editions), the meta's favourite first. */
  candidates: CardId[]
  variants: Variant[]
}

/**
 * The fill round for `deck`: the places of the first `slots` cards of `weakest` that are in the deck and not locked,
 * the `candidates` pool cards with the highest weight (era and archetype use) that the deck can take one more copy of,
 * and every valid, new list that fills the places with them or with what was there. Null when no place can be freed.
 */
export function fillRound(
  deck: readonly DeckCardEntry[],
  weakest: readonly CardId[],
  pool: readonly PoolCard[],
  index: CatalogIndex,
  options: FillOptions,
): FillRound | null {
  const slots = slotGroups(deck, index)
  const out = weakest
    .filter((groupId) => slots.includes(groupId) && !options.locked?.has(groupId))
    .slice(0, options.slots ?? FILL_SLOTS)
  if (out.length === 0) return null
  const places = out.map((groupId) => slots.indexOf(groupId))
  const editions = deck.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardId))
  const originals = places.map((at) => editions[at] as CardId)
  // The deck without those copies: a candidate needs room for one more copy there.
  const freed = deck.map((entry) => ({ ...entry }))
  for (const at of places) replaceSlot(freed, at, '__out__')
  const counts = groupsOfCards(
    freed.filter((entry) => entry.cardId !== '__out__'),
    index,
  )
  const outSet = new Set(out)
  // Review of #84: a candidate must make a valid list on its own in one of the places (the other one as it was), or it
  // would take a place among the favourites and give no list (an evolution whose pre-evolution the deck lacks). A
  // pair that only works together (a Basic and its evolution, both new) is left out.
  const fitsAlone = (cardId: CardId) =>
    places.some((_at, k) => {
      const cards = fill(
        deck,
        places,
        originals,
        originals.map((original, j) => (j === k ? cardId : original)),
      )
      return !!cards && options.valid(cards)
    })
  const candidates: CardId[] = []
  for (const card of [...pool].sort((a, b) => b.weight - a.weight || a.groupId.localeCompare(b.groupId))) {
    if (candidates.length >= (options.candidates ?? FILL_CANDIDATES)) break
    // A pre-evolution that only comes along (weight 0) never fills a place on its own.
    if (card.weight <= 0 || outSet.has(card.groupId)) continue
    if ((counts.get(card.groupId) ?? 0) >= Math.min(2, card.maxCopies, options.maxCopies(card.groupId))) continue
    if (fitsAlone(card.cardId)) candidates.push(card.cardId)
  }
  const choices = [...originals, ...candidates]
  const had = groupsOfCards(deck, index)
  const baseKey = listKeyByGroup(had)
  const keys = new Set<string>()
  const variants: Variant[] = []
  // Every multiset of `places.length` choices, in the order of `choices` (the meta's favourites first).
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === places.length) {
      const cards = fill(
        deck,
        places,
        originals,
        chosen.map((at) => choices[at] as CardId),
      )
      if (!cards) return
      const key = listKeyByGroup(groupsOfCards(cards, index))
      if (key === baseKey || keys.has(key) || options.seen?.has(key)) return
      // Within the copies the pool allows (a card of the deck keeps at least the copies it had).
      const counted = groupsOfCards(cards, index)
      for (const cardId of choices) {
        const groupId = index.cardById(cardId)?.functionalGroupId ?? cardId
        const limit = Math.max(had.get(groupId) ?? 0, Math.min(2, options.maxCopies(groupId)))
        if ((counted.get(groupId) ?? 0) > limit) return
      }
      if (!options.valid(cards)) return
      keys.add(key)
      const sorted = cards.filter((entry) => entry.count > 0)
      variants.push({ cards: sorted, key, ...cardChanges(deck, sorted, index) })
      return
    }
    for (let at = from; at < choices.length; at++) pick(at, [...chosen, at])
  }
  pick(0, [])
  return { out, candidates, variants }
}

/**
 * `deck` with `chosen` in `places`: a card that was in one of the places keeps its own (H-020: every other copy where
 * it was), and the rest go into the places left, in order.
 */
function fill(
  deck: readonly DeckCardEntry[],
  places: readonly number[],
  originals: readonly CardId[],
  chosen: readonly CardId[],
): DeckCardEntry[] | null {
  const left = [...chosen]
  const assigned: (CardId | null)[] = originals.map((original) => {
    const at = left.indexOf(original)
    if (at < 0) return null
    left.splice(at, 1)
    return original
  })
  for (const [k, card] of assigned.entries()) if (card === null) assigned[k] = left.shift() ?? null
  const cards = deck.map((entry) => ({ ...entry }))
  for (const [k, at] of places.entries()) {
    const card = assigned[k]
    if (!card) return null
    if (card !== originals[k] && !replaceSlot(cards, at, card)) return null
  }
  return cards
}

/** The one-sided `z` for `k` comparisons at once, so the chance of any false «better» stays at one comparison's. */
export function bonferroniZ(z: number, k: number): number {
  if (k <= 1) return z
  const tail = (1 - normalCdf(z)) / k
  let low = z
  let high = 12
  for (let step = 0; step < 80; step++) {
    const mid = (low + high) / 2
    if (1 - normalCdf(mid) > tail) low = mid
    else high = mid
  }
  return (low + high) / 2
}

export interface ScreenedCandidate {
  id: number
  difference: ScoreDifference | null
  complete: boolean
}

/** The screen of a fill round: the best `k` by paired difference that are past `z` errors (best first). */
export function pairedTop(candidates: readonly ScreenedCandidate[], z: number, k: number): number[] {
  return candidates
    .filter(
      (candidate): candidate is ScreenedCandidate & { difference: ScoreDifference } =>
        candidate.complete && !!candidate.difference && differenceVerdict(candidate.difference, z) === 'better',
    )
    .sort((a, b) => b.difference.value - a.difference.value || a.id - b.id)
    .slice(0, k)
    .map((candidate) => candidate.id)
}

/** The same without per-game results: by score, past `z` errors of the incumbent's (best first). */
export function roundTop(
  incumbent: MetaScore | null,
  candidates: readonly { id: number; score: MetaScore | null; complete: boolean }[],
  z: number,
  k: number,
): number[] {
  return candidates
    .filter(
      (candidate): candidate is { id: number; score: MetaScore; complete: boolean } =>
        candidate.complete && !!candidate.score && (!incumbent || scoreBeats(candidate.score, incumbent, z)),
    )
    .sort((a, b) => b.score.value - a.score.value || a.id - b.id)
    .slice(0, k)
    .map((candidate) => candidate.id)
}

/**
 * The verification (H-010) of one or more variants on fresh seeds: the best that beats the incumbent by `z` — by
 * `bonferroniZ(z, k)` when `k` were verified together — or null. An incomplete one never stays.
 */
export function verifyPick(results: readonly ScreenedCandidate[], z: number): number | null {
  const zk = bonferroniZ(z, results.length)
  const best = results
    .filter(
      (result): result is ScreenedCandidate & { difference: ScoreDifference } =>
        result.complete && !!result.difference && differenceVerdict(result.difference, zk) === 'better',
    )
    .sort((a, b) => b.difference.value - a.difference.value || a.id - b.id)[0]
  return best ? best.id : null
}
