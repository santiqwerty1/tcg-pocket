/** Matchups (Fase 9): how a matchup rate reads at a glance. */
import type { WinRate } from '@/api/schemas'

/** Favorable when the whole interval is above 50 %, unfavorable when it is below; otherwise «parejo». */
export function matchupTone(rate: WinRate | null): 'good' | 'bad' | 'even' | 'none' {
  if (!rate) return 'none'
  if (rate.ci95[0] > 50) return 'good'
  if (rate.ci95[1] < 50) return 'bad'
  return 'even'
}

export const TONE_CLASS: Record<ReturnType<typeof matchupTone>, string> = {
  good: 'text-success',
  bad: 'text-destructive',
  even: '',
  none: 'text-muted-foreground',
}

/** A short name for a column header: the first words up to ~14 characters. */
export function shortName(name: string): string {
  if (name.length <= 14) return name
  const words = name.split(' ')
  let out = ''
  for (const word of words) {
    if ((out ? `${out} ${word}` : word).length > 14) break
    out = out ? `${out} ${word}` : word
  }
  return out ? `${out}…` : `${name.slice(0, 13)}…`
}
