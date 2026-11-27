/**
 * The figure: one shape for every percentage the pieces of mock-up D draw (components/figures). A piece never reads a
 * shape of the API: the adapters here turn each one into a `Figure`, or into null when there is nothing to show
 * («sin datos», never a zero). Each source keeps its own figure, under its own seal: nothing here adds two of them.
 */
import type { ComparisonColumn, GameRecord, WinRate } from '@/api/schemas'
import { formatInterval, formatRateValue, formatSampleOf, ORIENTATIVE_BELOW } from '@/lib/matches'

/** Whose number it is: my matches (M), tournaments (T) or bots (B). It is the API's `WinRate['source']`. */
export type SourceKey = WinRate['source']
/** What «orientativo» counted: matches, tournament lists or simulated games. The API's `WinRate['sampleKind']`. */
export type SampleKind = WinRate['sampleKind']

export interface Figure {
  /** 0 to 100, at full precision: rounding happens when it is written. */
  value: number
  /** The games behind the number. */
  n: number
  /** Null: a value that comes without an interval (what a deck should score against the meta, with no pairings). */
  ci95: readonly [number, number] | null
  /** The API's flag. An adapter never works it out again for a `WinRate`: a tournament rate counts lists, not games. */
  orientative: boolean
  /** What «orientativo» counts: it names the mark and the key of the legend. */
  sampleKind: SampleKind
  /** The lists behind a tournament rate («n = 268 en 40 listas»). Only with `sampleKind: 'lists'`. */
  samples?: number
  record?: GameRecord | null
  /** 0 to 100, for a number against the meta: how much of the meta has data. At 0 the figure carries the ▲ mark. */
  coverage?: number | null
  /** A Laboratorio score of another era: drawn quiet, and it sorts as no data. */
  stale?: { era: string } | null
  /** The bots of a B figure, when the data has them as a field. */
  bot?: string
}

/** Null is «sin datos». A real zero with games behind it is a figure. */
export type MaybeFigure = Figure | null

export const SOURCE_LETTER: Record<SourceKey, 'M' | 'T' | 'B'> = { matches: 'M', tournament: 'T', simulation: 'B' }
export const SOURCE_NAME: Record<SourceKey, string> = {
  matches: 'Mis partidas',
  tournament: 'Torneos',
  simulation: 'Bots',
}

/** What each kind of sample counts, as the legend and the marks say it: «menos de 30 listas». */
export const SAMPLE_NOUN: Record<SampleKind, string> = {
  matches: 'partidas',
  lists: 'listas',
  simulations: 'partidas simuladas',
}

/** What stands where a number has nothing behind it. */
export const NO_DATA = 'sin datos'
/** What the ▲ mark says: the number against the meta has no matchup with data behind it. */
export const NO_COVERAGE = 'sin cruces con datos en el meta'

/** «orientativo: menos de 30 partidas» | «… listas» | «… partidas simuladas»: the word, and what it counted. */
export function orientativeText(kind: SampleKind): string {
  return `orientativo: menos de ${ORIENTATIVE_BELOW} ${SAMPLE_NOUN[kind]}`
}

/** The order the kinds of sample are named in, whatever order they are given in. */
const SAMPLE_KINDS: readonly SampleKind[] = ['matches', 'lists', 'simulations']

/**
 * The key of «orientativo» in a legend, for the kinds of sample of the figures it stands under: with one kind, the
 * text of the mark («orientativo: menos de 30 partidas»); with more, each one after the first as another case, and
 * the lists named as what they are («orientativo: menos de 30 partidas, o de 30 listas en torneos»). Null without a
 * kind: a legend with no «orientativo» figure has no key for it.
 */
export function orientativeKey(kinds: readonly SampleKind[]): string | null {
  const present = SAMPLE_KINDS.filter((kind) => kinds.includes(kind))
  const [first, ...others] = present
  if (first === undefined) return null
  if (others.length === 0) return orientativeText(first)
  const noun = (kind: SampleKind) => (kind === 'lists' ? `${SAMPLE_NOUN.lists} en torneos` : SAMPLE_NOUN[kind])
  return [
    `orientativo: menos de ${ORIENTATIVE_BELOW} ${noun(first)}`,
    ...others.map((kind) => `o de ${ORIENTATIVE_BELOW} ${noun(kind)}`),
  ].join(', ')
}

/** What a legend says of every interval that is drawn or written under it: it is the one of 95 %. */
export const INTERVAL_KEY = `IC: intervalo de confianza del ${formatRateValue(95)}`

/** «IC 37,2–64,7 %»: the interval of a figure, as it is written and as it is said. The space after «IC» never breaks. */
export function intervalText(ci95: readonly [number, number]): string {
  return `IC\u00a0${formatInterval(ci95)}`
}

/**
 * A rate of the API as a figure; null without a rate. A rate over no games is no data either: the API never sends
 * one, and a zero that nobody played must not be written as a result.
 */
export function figureFromRate(rate: WinRate | null, record?: GameRecord | null): MaybeFigure {
  if (!rate || rate.games <= 0) return null
  return {
    value: rate.value,
    n: rate.games,
    ci95: rate.ci95,
    orientative: rate.orientative,
    sampleKind: rate.sampleKind,
    ...(rate.sampleKind === 'lists' ? { samples: rate.samples } : {}),
    record: record ?? null,
  }
}

/** One column of a deck's comparison (M, T or B): its headline rate with its record. */
export function figureFromColumn(column: ComparisonColumn): MaybeFigure {
  return figureFromRate(column.rate, column.record)
}

/** «n = 47»; «n = 268 en 40 listas» when the figure brings the lists it was counted on. */
export function figureSample(figure: Figure): string {
  return formatSampleOf(figure.n, figure.sampleKind === 'lists' ? figure.samples : null)
}

/**
 * The whole figure in words, for a name that a screen reader says: «51,1 %, n = 47, IC 37,2–64,7 %, orientativo»;
 * «sin datos» for null. The same pieces, in the same order, as `formatRate` (the domain's `formatWinRateEs`), with
 * commas where that one has brackets: it goes inside a longer sentence («Mis partidas: …»).
 */
export function figureText(figure: MaybeFigure): string {
  if (!figure) return NO_DATA
  const parts = [formatRateValue(figure.value), figureSample(figure)]
  if (figure.ci95) parts.push(intervalText(figure.ci95))
  if (figure.orientative) parts.push('orientativo')
  if (figure.coverage === 0) parts.push(NO_COVERAGE)
  if (figure.stale) parts.push(`de la era ${figure.stale.era}`)
  return parts.join(', ')
}
