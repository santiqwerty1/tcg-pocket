/**
 * Fase 44: «mi meta» (T-014). The rivals of the owner's own matches as shares of tournament archetypes, with more
 * weight to recent matches (each match weighs 0.5^(age / 14 days), as the opponent suggestions): who the owner
 * actually meets, to weigh «lo esperado contra el meta» with it instead of tournament shares.
 *
 * A rival counts for an archetype when its key is the key of the archetype's name (the quick-entry sheet offers the
 * era's archetypes by name) or when a note for that rival was written from the archetype (`links`). The rest stay
 * apart as «sin arquetipo», with their own count, and do not enter the shares.
 *
 * The caller passes the matches of the window it wants (the era, the modes; `MatchesService.myMeta`). The weights make
 * the shares rest on fewer matches than were played: every count that decides something (`enough`, the shares'
 * intervals, «orientativo») uses Kish's effective sample size, (Σw)² / Σw², not the raw count.
 */
import { formatIntervalEs, formatPercentEs, ORIENTATIVE_BELOW, wilsonFromRate } from '../stats/rates.js'
import { cleanOpponent, OPPONENT_HALF_LIFE_DAYS, opponentKey, opponentLabels } from './opponents.js'
import type { MatchFacts, MatchMode } from './types.js'

/** Effective matches against archetypes below which «mi meta» is too thin to weigh with. */
export const MY_META_MIN_MATCHES = 10
/**
 * The modes «mi meta» reads by default: the ones played against strangers (competitive and casual). Beginner battles,
 * events with their own rules and friends are not the field the owner meets.
 */
export const MY_META_MODES: readonly MatchMode[] = ['competitive', 'casual']
const DAY_MS = 24 * 60 * 60 * 1000

export interface MyMetaShare {
  archetypeId: string
  name: string
  /** 0–100 of the weighted matches against archetypes. */
  share: number
  /** Wilson over the effective sample size, 0–100. */
  ci95: [number, number]
  games: number
}

export interface MyMetaUnmatched {
  key: string
  label: string
  games: number
}

export interface MyMeta {
  halfLifeDays: number
  /** Matches with the rival noted, and without. */
  matches: number
  withoutRival: number
  /** Matches against a rival that maps to an archetype. */
  matched: number
  /** Kish's effective sample size of the matched matches: (Σw)² / Σw². */
  effectiveMatches: number
  /** 0–100 of the matches with a rival that map to an archetype, each match weighed by its age. */
  coverage: number
  /** At least `MY_META_MIN_MATCHES` effective matched matches. */
  enough: boolean
  /** Under `ORIENTATIVE_BELOW` effective matched matches. */
  orientative: boolean
  shares: MyMetaShare[]
  unmatched: MyMetaUnmatched[]
  text: string
}

const countFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

export function myMeta(
  matches: readonly Pick<MatchFacts, 'opponent' | 'playedAt'>[],
  archetypes: Iterable<{ id: string; name: string }>,
  options: { now: Date; halfLifeDays?: number | undefined; links?: ReadonlyMap<string, string> | undefined },
): MyMeta {
  const halfLife = Math.max(1, options.halfLifeDays ?? OPPONENT_HALF_LIFE_DAYS)
  const byKey = new Map<string, { id: string; name: string }>()
  const names = new Map<string, string>()
  for (const archetype of archetypes) {
    names.set(archetype.id, archetype.name)
    const key = opponentKey(archetype.name)
    if (key !== null && !byKey.has(key)) byKey.set(key, archetype)
  }
  const labels = opponentLabels(matches)
  const weights = new Map<string, { weight: number; games: number }>()
  const unmatched = new Map<string, number>()
  let withRival = 0
  let withoutRival = 0
  let matched = 0
  let totalWeight = 0
  let matchedWeight = 0
  let matchedSquares = 0
  for (const match of matches) {
    const key = opponentKey(cleanOpponent(match.opponent))
    if (key === null) {
      withoutRival += 1
      continue
    }
    withRival += 1
    const ageDays = Math.max(0, options.now.getTime() - match.playedAt.getTime()) / DAY_MS
    const weight = 0.5 ** (ageDays / halfLife)
    totalWeight += weight
    const linked = options.links?.get(key)
    const id = linked && names.has(linked) ? linked : byKey.get(key)?.id
    if (!id) {
      unmatched.set(key, (unmatched.get(key) ?? 0) + 1)
      continue
    }
    matched += 1
    matchedWeight += weight
    matchedSquares += weight * weight
    const row = weights.get(id) ?? { weight: 0, games: 0 }
    row.weight += weight
    row.games += 1
    weights.set(id, row)
  }
  const effective = matchedSquares === 0 ? 0 : (matchedWeight * matchedWeight) / matchedSquares
  const shares = [...weights]
    .map(([archetypeId, row]) => {
      const p = matchedWeight === 0 ? 0 : row.weight / matchedWeight
      const [lo, hi] = wilsonFromRate(p, effective)
      return {
        archetypeId,
        name: names.get(archetypeId) ?? archetypeId,
        share: p * 100,
        ci95: [lo * 100, hi * 100] as [number, number],
        games: row.games,
      }
    })
    .sort((a, b) => b.share - a.share || b.games - a.games || a.name.localeCompare(b.name, 'es'))
  const coverage = totalWeight === 0 ? 0 : (matchedWeight / totalWeight) * 100
  // Equal weights give exactly n, up to rounding: 10 matches of today must not read as 9,999… effective.
  const enough = effective >= MY_META_MIN_MATCHES - 1e-9
  const orientative = effective < ORIENTATIVE_BELOW - 1e-9
  const top = shares
    .slice(0, 3)
    .map((row) => `${row.name} ${formatPercentEs(row.share)} (IC\u00a0${formatIntervalEs(row.ci95)})`)
    .join(', ')
  const effectiveText = `${countFormat.format(effective)} efectivas, porque las recientes pesan más`
  return {
    halfLifeDays: halfLife,
    matches: withRival,
    withoutRival,
    matched,
    effectiveMatches: effective,
    coverage,
    enough,
    orientative,
    shares,
    unmatched: [...unmatched]
      .map(([key, games]) => ({ key, label: labels.get(key) ?? key, games }))
      .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label, 'es')),
    text: enough
      ? `Tu meta (${matched} partidas contra arquetipos de torneo, ${effectiveText}${orientative ? '; orientativo' : ''}): ${top}.`
      : `Todavía no alcanza: hacen falta ${MY_META_MIN_MATCHES} partidas efectivas contra rivales que sean arquetipos de torneo (tenés ${matched}, ${effectiveText}).`,
  }
}
