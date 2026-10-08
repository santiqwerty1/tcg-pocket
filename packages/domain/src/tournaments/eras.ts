/**
 * «Formato vigente» (BRIEF M5, PLAN §3.5, docs/fase0/limitless.md §3): Limitless does not publish the format of
 * Standard tournaments (`format: null`), so the era of a tournament is the newest set that opens an era with a release
 * date on or before the tournament's date (UTC; on release day the tournament already counts for the new set, as
 * Limitless does). Deluxe packs (A4b, B4b) do not open an era. The table is the owner's to edit: a new set gets a row.
 */

export interface SetRelease {
  /** Set code as Limitless and the tracker write it: «B4a». */
  code: string
  nameEn: string
  /** YYYY-MM-DD (UTC). */
  releaseDate: string
  /** False for the Deluxe packs: their cards are reprints and the format does not change. */
  opensEra: boolean
}

/** Release dates from pocket.limitlesstcg.com/cards (6/10/2026, PLAN Apéndice A.5); editable in the app. */
export const DEFAULT_SET_RELEASES: readonly SetRelease[] = [
  { code: 'A1', nameEn: 'Genetic Apex', releaseDate: '2024-10-30', opensEra: true },
  { code: 'A1a', nameEn: 'Mythical Island', releaseDate: '2024-12-17', opensEra: true },
  { code: 'A2', nameEn: 'Space-Time Smackdown', releaseDate: '2025-01-29', opensEra: true },
  { code: 'A2a', nameEn: 'Triumphant Light', releaseDate: '2025-02-28', opensEra: true },
  { code: 'A2b', nameEn: 'Shining Revelry', releaseDate: '2025-03-27', opensEra: true },
  { code: 'A3', nameEn: 'Celestial Guardians', releaseDate: '2025-04-30', opensEra: true },
  { code: 'A3a', nameEn: 'Extradimensional Crisis', releaseDate: '2025-05-29', opensEra: true },
  { code: 'A3b', nameEn: 'Eevee Grove', releaseDate: '2025-06-26', opensEra: true },
  { code: 'A4', nameEn: 'Wisdom of Sea and Sky', releaseDate: '2025-07-30', opensEra: true },
  { code: 'A4a', nameEn: 'Secluded Springs', releaseDate: '2025-08-28', opensEra: true },
  { code: 'A4b', nameEn: 'Deluxe Pack: ex', releaseDate: '2025-09-30', opensEra: false },
  { code: 'B1', nameEn: 'Mega Rising', releaseDate: '2025-10-30', opensEra: true },
  { code: 'B1a', nameEn: 'Crimson Blaze', releaseDate: '2025-12-17', opensEra: true },
  { code: 'B2', nameEn: 'Fantastical Parade', releaseDate: '2026-01-29', opensEra: true },
  { code: 'B2a', nameEn: 'Paldean Wonders', releaseDate: '2026-02-26', opensEra: true },
  { code: 'B2b', nameEn: 'Mega Shine', releaseDate: '2026-03-26', opensEra: true },
  { code: 'B3', nameEn: 'Pulsing Aura', releaseDate: '2026-04-28', opensEra: true },
  { code: 'B3a', nameEn: 'Paradox Drive', releaseDate: '2026-05-28', opensEra: true },
  { code: 'B3b', nameEn: 'Everyday Wonders', releaseDate: '2026-06-30', opensEra: true },
  { code: 'B4', nameEn: 'Ruler of the Skies', releaseDate: '2026-07-30', opensEra: true },
  { code: 'B4a', nameEn: "Team Rocket's Ambition", releaseDate: '2026-08-27', opensEra: true },
  { code: 'B4b', nameEn: 'Deluxe Pack: Mega', releaseDate: '2026-09-30', opensEra: false },
]

/** Promo sets never make a list «newer» than its era. */
export function isPromoSet(code: string): boolean {
  return /^P-[A-Z]$/.test(code)
}

/** The tournament formats the statistics separate. `CUSTOM` (house rules) and unknown values are left out. */
export const TOURNAMENT_FORMATS = ['STANDARD', 'NOEX'] as const
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number]

/** `format ?? 'STANDARD'`; null for `CUSTOM` and any value Limitless may add (kept out until reviewed). */
export function effectiveFormat(formatRaw: string | null | undefined): TournamentFormat | null {
  if (formatRaw === null || formatRaw === undefined || formatRaw === '' || formatRaw === 'STANDARD') return 'STANDARD'
  if (formatRaw === 'NOEX') return 'NOEX'
  return null
}

/** YYYY-MM-DD of an instant, in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function byRelease(sets: readonly SetRelease[]): SetRelease[] {
  return [...sets].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.code.localeCompare(b.code))
}

/** Sets that open an era, oldest first. */
export function eraSets(sets: readonly SetRelease[]): SetRelease[] {
  return byRelease(sets).filter((set) => set.opensEra)
}

/** Era (set code) of an instant: the newest era-opening set released on or before its UTC day; null before A1. */
export function eraOf(date: Date, sets: readonly SetRelease[]): string | null {
  const day = utcDay(date)
  let era: string | null = null
  for (const set of eraSets(sets)) {
    if (set.releaseDate <= day) era = set.code
    else break
  }
  return era
}

/** [from, to) of an era in UTC; `to` is null for the current era. */
export function eraRange(code: string, sets: readonly SetRelease[]): { from: Date; to: Date | null } | null {
  const ordered = eraSets(sets)
  const at = ordered.findIndex((set) => set.code === code)
  const set = ordered[at]
  if (!set) return null
  const next = ordered[at + 1]
  return {
    from: new Date(`${set.releaseDate}T00:00:00Z`),
    to: next ? new Date(`${next.releaseDate}T00:00:00Z`) : null,
  }
}

/**
 * Release order of a set code: higher = newer. Promos are -1 (never newest); a code the table does not know is
 * +Infinity, so a list with an unreleased set (a pre-release event, or a set missing from the table) stands out.
 */
export function setRank(code: string, sets: readonly SetRelease[]): number {
  if (isPromoSet(code)) return -1
  const at = byRelease(sets).findIndex((set) => set.code === code)
  return at === -1 ? Number.POSITIVE_INFINITY : at
}

/** Newest set among the codes (promos ignored); null when there is none. */
export function newestSet(codes: Iterable<string>, sets: readonly SetRelease[]): string | null {
  let best: { code: string; rank: number } | null = null
  for (const code of codes) {
    const rank = setRank(code, sets)
    if (rank < 0) continue
    if (!best || rank > best.rank) best = { code, rank }
  }
  return best?.code ?? null
}

/**
 * Cross-check of the era by date against the cards (PLAN §3.5): a list with a card of a set released after the
 * tournament's day, or of a set the table does not know, means a pre-release event or a set missing from the table.
 * Returns the offending set, or null when the lists agree with the date.
 */
export function eraConflict(date: Date, codes: Iterable<string>, sets: readonly SetRelease[]): string | null {
  const day = utcDay(date)
  const releases = new Map(sets.map((set) => [set.code, set.releaseDate]))
  for (const code of codes) {
    if (isPromoSet(code)) continue
    const release = releases.get(code)
    if (release === undefined || release > day) return code
  }
  return null
}

/** Days after which a new era is likely (sets come every ~30 days): the UI warns «era nueva probable». */
export const NEW_ERA_LIKELY_AFTER_DAYS = 35

/** The last release in the table and how many days ago it was; `likely` when it is more than 35 days. */
export function newEraWarning(
  today: string,
  sets: readonly SetRelease[],
): { lastRelease: SetRelease; days: number; likely: boolean } | null {
  const released = byRelease(sets).filter((set) => set.releaseDate <= today)
  const lastRelease = released.at(-1)
  if (!lastRelease) return null
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastRelease.releaseDate}T00:00:00Z`)) / 86_400_000,
  )
  return { lastRelease, days, likely: days > NEW_ERA_LIKELY_AFTER_DAYS }
}

/** Tournaments below this size do not count (PLAN B10: 12 reproduces the 154 tournaments Limitless shows for B4a). */
export const DEFAULT_MIN_PLAYERS = 12

/** Days of tournaments the first sync downloads (PLAN B10). */
export const DEFAULT_BACKFILL_DAYS = 60
