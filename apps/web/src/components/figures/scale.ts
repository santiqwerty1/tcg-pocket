/**
 * Where the parts of a chart of a figure go (mock-up D): the scale a point and its interval are drawn on, and the
 * place of each part in percent of the width of the chart. Numbers only, with nothing to draw: the small charts
 * (MiniCharts.tsx) and the large bar (IntervalBar.tsx) place their boxes with them, and a screen that draws only the
 * bar does not load the small charts with it.
 */
import type { Figure } from '@/lib/figure'

/** The two ends of the axis a point and its interval are drawn on, in percent of victories. */
export type Scale = readonly [lo: number, hi: number]

/** Every percentage has a place on it, and the same place in every chart: what a chart is drawn on unless told. */
const FULL_SCALE: Scale = [0, 100]

/** The scale to draw on: the one given while it is a growing pair of numbers, the full one otherwise. */
export function chartScale(scale?: Scale): Scale {
  if (!scale) return FULL_SCALE
  const [lo, hi] = scale
  return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? scale : FULL_SCALE
}

/** A share of the width in percent, kept inside the box and to two decimals (under a hundredth of a pixel). */
export function inBox(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.round(Math.min(100, Math.max(0, percent)) * 100) / 100
}

/** Where a value falls on a scale, from 0 (its left end) to 100 (its right end). A value out of it stays at the end. */
function scalePosition(value: number, scale: Scale): number {
  const [lo, hi] = scale
  return inBox(((value - lo) / (hi - lo)) * 100)
}

/** Where each part of an interval chart goes, in percent of the width of the chart. */
interface IntervalGeometry {
  point: number
  /** Null without an interval, and when none of it is inside the scale. */
  band: { left: number; width: number } | null
  /** Null when the scale has no tick, or when the tick falls out of it. */
  tick: number | null
  reference: number | null
}

/**
 * The places of a figure on a chart. On the full scale the tick is at 50 %, the line between winning and losing; a
 * scale cut to a range has no tick unless one is asked for, and never one that falls out of the range (it would be
 * drawn at an end, where it is not). A point, an interval and a reference out of the range stay at its end.
 */
export function intervalGeometry(
  figure: Figure,
  { scale, tick, reference }: { scale?: Scale; tick?: number | null; reference?: number | null } = {},
): IntervalGeometry {
  const range = chartScale(scale)
  const full = range[0] === FULL_SCALE[0] && range[1] === FULL_SCALE[1]
  const at = tick === undefined ? (full ? 50 : null) : tick
  const [low, high] = figure.ci95 ?? [0, 0]
  const from = scalePosition(Math.min(low, high), range)
  const to = scalePosition(Math.max(low, high), range)
  return {
    point: scalePosition(figure.value, range),
    band: figure.ci95 && to > from ? { left: from, width: inBox(to - from) } : null,
    tick: at != null && at >= range[0] && at <= range[1] ? scalePosition(at, range) : null,
    reference: reference == null ? null : scalePosition(reference, range),
  }
}
