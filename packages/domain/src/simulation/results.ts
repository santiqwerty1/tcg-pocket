/**
 * Results of simulations (BRIEF M7, PLAN I9): wins, losses and ties shown apart, the rate with its Wilson interval
 * over games, the bot and n always named. Simulation results are their own source: never mixed with tournaments or
 * own matches. The rate depends on the bot.
 */
import { addRecords, EMPTY_RECORD, type GameRecord, type WinRate, winRate } from '../stats/rates.js'

export interface ChunkOutcome {
  /** Snapshot ids of the two sides as the chunk played them. */
  a: number
  b: number
  winsA: number
  winsB: number
  ties: number
}

/** A pairing from A's side. */
export interface PairingRecord {
  a: number
  b: number
  record: GameRecord
}

export function simulationRate(record: GameRecord): WinRate<'simulation'> | null {
  const games = record.wins + record.losses + record.ties
  return winRate('simulation', record, games, 'simulations')
}

/** Every chunk of every pairing summed, seen from each side: the record of A vs B and of B vs A. */
export function pairingRecords(chunks: readonly ChunkOutcome[]): Map<string, PairingRecord> {
  const records = new Map<string, PairingRecord>()
  const add = (a: number, b: number, record: GameRecord) => {
    const key = `${a}:${b}`
    const existing = records.get(key)
    if (existing) existing.record = addRecords(existing.record, record)
    else records.set(key, { a, b, record })
  }
  for (const chunk of chunks) {
    add(chunk.a, chunk.b, { wins: chunk.winsA, losses: chunk.winsB, ties: chunk.ties })
    add(chunk.b, chunk.a, { wins: chunk.winsB, losses: chunk.winsA, ties: chunk.ties })
  }
  return records
}

/** The record of one deck against every rival it played in these chunks. */
export function deckRecord(chunks: readonly ChunkOutcome[], deck: number): GameRecord {
  let record: GameRecord = { ...EMPTY_RECORD }
  for (const chunk of chunks) {
    if (chunk.a === deck) record = addRecords(record, { wins: chunk.winsA, losses: chunk.winsB, ties: chunk.ties })
    else if (chunk.b === deck) record = addRecords(record, { wins: chunk.winsB, losses: chunk.winsA, ties: chunk.ties })
  }
  return record
}

export interface MatrixRow {
  deck: number
  /** Against every rival of the job. */
  total: GameRecord
  cells: { rival: number; record: GameRecord | null }[]
}

/** Rows of a matrix job: each deck of side A against each rival, plus its total; best total first. */
export function matrixRows(
  chunks: readonly ChunkOutcome[],
  sideA: readonly number[],
  sideB: readonly number[],
): MatrixRow[] {
  const records = pairingRecords(chunks)
  const rows = [...new Set(sideA)].map((deck) => {
    const cells = [...new Set(sideB)]
      .filter((rival) => rival !== deck)
      .map((rival) => ({ rival, record: records.get(`${deck}:${rival}`)?.record ?? null }))
    let total: GameRecord = { ...EMPTY_RECORD }
    for (const cell of cells) if (cell.record) total = addRecords(total, cell.record)
    return { deck, total, cells }
  })
  const share = (record: GameRecord) => {
    const games = record.wins + record.losses + record.ties
    return games === 0 ? -1 : record.wins / games
  }
  return rows.sort((x, y) => share(y.total) - share(x.total))
}

export interface OptimizeCombination {
  cards: string[]
  record: GameRecord
  perEnemy: GameRecord[]
}

/** engine-cli optimize output → records from the optimized deck's side, best first. */
export function optimizeRanking(
  combinations: readonly {
    cards: string[]
    winsA: number
    winsB: number
    ties: number
    perEnemy: { winsA: number; winsB: number; ties: number }[]
  }[],
): OptimizeCombination[] {
  return combinations
    .map((combination) => ({
      cards: combination.cards,
      record: { wins: combination.winsA, losses: combination.winsB, ties: combination.ties },
      perEnemy: combination.perEnemy.map((tally) => ({ wins: tally.winsA, losses: tally.winsB, ties: tally.ties })),
    }))
    .sort((x, y) => {
      const rate = (record: GameRecord) => record.wins / Math.max(1, record.wins + record.losses + record.ties)
      return rate(y.record) - rate(x.record)
    })
}
