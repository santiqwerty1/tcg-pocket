/**
 * Opponent archetypes typed by hand. Until tournament archetypes exist (Fase 5) the opponent is free text, so the
 * statistics group spellings that only differ in case, accents, hyphens or spacing («Mega-Blaziken ex» ≡
 * «mega blaziken EX»), and the quick-entry sheet suggests what was typed before, most recent and frequent first.
 */
import type { MatchFacts } from './types.js'

/** Display form: NFC, trimmed, inner whitespace collapsed; null when nothing is left. */
export function cleanOpponent(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null
  const cleaned = text.normalize('NFC').replace(/\s+/gu, ' ').trim()
  return cleaned.length === 0 ? null : cleaned
}

/** Grouping key: lower case, no diacritics, punctuation as spaces; null for an empty opponent. */
export function opponentKey(text: string | null | undefined): string | null {
  const cleaned = cleanOpponent(text)
  if (cleaned === null) return null
  const key = cleaned
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return key.length === 0 ? null : key
}

export interface OpponentSummary {
  key: string
  /** The most used spelling (ties: the most recent one). */
  label: string
  games: number
  lastPlayedAt: Date
}

interface Bucket {
  games: number
  lastPlayedAt: Date
  spellings: Map<string, { count: number; last: Date }>
  /** Recency-weighted count (see `suggestOpponents`). */
  score: number
}

/** Half-life of an opponent's weight in the suggestions: a match two weeks old counts half as much as one today. */
export const OPPONENT_HALF_LIFE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

function buckets(matches: readonly Pick<MatchFacts, 'opponent' | 'playedAt'>[], now: Date): Map<string, Bucket> {
  const byKey = new Map<string, Bucket>()
  for (const match of matches) {
    const label = cleanOpponent(match.opponent)
    const key = opponentKey(label)
    if (label === null || key === null) continue
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { games: 0, lastPlayedAt: match.playedAt, spellings: new Map(), score: 0 }
      byKey.set(key, bucket)
    }
    bucket.games += 1
    if (match.playedAt > bucket.lastPlayedAt) bucket.lastPlayedAt = match.playedAt
    const ageDays = Math.max(0, now.getTime() - match.playedAt.getTime()) / DAY_MS
    bucket.score += 0.5 ** (ageDays / OPPONENT_HALF_LIFE_DAYS)
    const spelling = bucket.spellings.get(label)
    if (spelling) {
      spelling.count += 1
      if (match.playedAt > spelling.last) spelling.last = match.playedAt
    } else {
      bucket.spellings.set(label, { count: 1, last: match.playedAt })
    }
  }
  return byKey
}

function labelOf(bucket: Bucket): string {
  let best: { label: string; count: number; last: Date } | null = null
  for (const [label, spelling] of bucket.spellings) {
    if (
      !best ||
      spelling.count > best.count ||
      (spelling.count === best.count && spelling.last.getTime() > best.last.getTime())
    ) {
      best = { label, ...spelling }
    }
  }
  return best?.label ?? ''
}

/** Display label for each opponent key in `matches` (the most used spelling). */
export function opponentLabels(matches: readonly Pick<MatchFacts, 'opponent' | 'playedAt'>[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const [key, bucket] of buckets(matches, new Date(0))) labels.set(key, labelOf(bucket))
  return labels
}

/**
 * Opponents to offer in the quick-entry sheet: ranked by a recency-weighted count (each match weighs
 * 0.5^(age / 14 days)), then by total games, then alphabetically. With `query`, only opponents whose key contains the
 * query's key.
 */
export function suggestOpponents(
  matches: readonly Pick<MatchFacts, 'opponent' | 'playedAt'>[],
  options: { now: Date; limit?: number; query?: string | null },
): OpponentSummary[] {
  const queryKey = opponentKey(options.query ?? null)
  const ranked = [...buckets(matches, options.now)]
    .filter(([key]) => queryKey === null || key.includes(queryKey))
    .sort(
      ([keyA, a], [keyB, b]) =>
        b.score - a.score ||
        b.games - a.games ||
        labelOf(a).localeCompare(labelOf(b), 'es') ||
        keyA.localeCompare(keyB),
    )
  return ranked
    .slice(0, options.limit ?? 12)
    .map(([key, bucket]) => ({ key, label: labelOf(bucket), games: bucket.games, lastPlayedAt: bucket.lastPlayedAt }))
}
