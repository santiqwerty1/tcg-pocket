// The raw Limitless responses saved on 6/10/2026 (docs/fase0/limitless/): tournament lists and two real standings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LimitlessTournament } from '../../src/tournaments/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
export const LIMITLESS_DIR = join(repoRoot, 'docs/fase0/limitless')

export function readLimitless(file: string): unknown {
  return JSON.parse(readFileSync(join(LIMITLESS_DIR, file), 'utf8'))
}

/** PMPT #45 (393 players, BO3, 5/9/2026) and a NOEX tournament (79 players, BO1). */
export const BIG_ID = '6a95b87b629039f77d8a6954'
export const NOEX_ID = '6a9ebbfcab080c8c957fcc9a'

/** The 400 most recent tournaments on 6/10/2026 (pages 1 and 2 of limit=200). */
export function recentTournaments(): LimitlessTournament[] {
  return [
    ...(readLimitless('t1.json') as LimitlessTournament[]),
    ...(readLimitless('t2.json') as LimitlessTournament[]),
  ]
}
