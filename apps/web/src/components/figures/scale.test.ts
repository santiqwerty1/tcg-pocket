// Where the parts of a chart go: numbers only, read as numbers. The figures are invented (test/figures.ts).
import { describe, expect, it } from 'vitest'
import type { Figure } from '@/lib/figure'
import { EXACT_LIST, EXPECTED, LOST_ONCE, MINE, WON_TWICE } from '@/test/figures'
import { chartScale, inBox, intervalGeometry } from './scale'

/** Where a value falls on a scale: the place of the point of a figure that has it. */
const placed = (value: number, scale?: readonly [number, number]) =>
  intervalGeometry({ ...MINE, value, ci95: null }, { scale }).point

describe('the scale of a chart', () => {
  it('is 0–100 unless another one is given, and the one given is kept as it is', () => {
    expect(chartScale()).toEqual([0, 100])
    expect(chartScale(undefined)).toBe(chartScale())
    const zoom = [40, 70] as const
    expect(chartScale(zoom)).toBe(zoom)
    expect(chartScale([-10, 10])).toEqual([-10, 10])
  })

  it('a scale that does not grow, or is not made of numbers, is the full one: nothing is ever divided by zero', () => {
    for (const broken of [
      [70, 40],
      [50, 50],
      [Number.NaN, 100],
      [0, Number.NaN],
      [0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, 100],
    ] as const) {
      expect(chartScale(broken), String(broken)).toBe(chartScale())
    }
  })

  it('places a value in percent of the width, to two decimals', () => {
    expect(placed(0)).toBe(0)
    expect(placed(100)).toBe(100)
    expect(placed(50)).toBe(50)
    expect(placed((24 / 47) * 100)).toBe(51.06)
    // On a scale cut to 40–70, 55 is in the middle and 47,5 a quarter of the way.
    expect(placed(55, [40, 70])).toBe(50)
    expect(placed(47.5, [40, 70])).toBe(25)
    expect(placed(48.2, [40, 70])).toBe(27.33)
  })

  it('a value out of the scale stays at its end, and what is not a number at the start', () => {
    expect(placed(37.2, [40, 70])).toBe(0)
    expect(placed(82, [40, 70])).toBe(100)
    expect(placed(-5)).toBe(0)
    expect(placed(140)).toBe(100)
    expect(placed(Number.NaN)).toBe(0)
  })

  it('a share of the width stays inside the box, to two decimals', () => {
    expect(inBox(33.333)).toBe(33.33)
    expect(inBox(-1)).toBe(0)
    expect(inBox(100.4)).toBe(100)
    expect(inBox(Number.NaN)).toBe(0)
    expect(inBox(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('intervalGeometry', () => {
  it('on the full scale: the point at the value, the band over the interval, the tick at 50', () => {
    expect(intervalGeometry(MINE)).toEqual({
      point: 51.06,
      band: { left: 37.2, width: 27.5 },
      tick: 50,
      reference: null,
    })
    expect(intervalGeometry(EXACT_LIST)).toEqual({
      point: 12.5,
      band: { left: 2.2, width: 44.9 },
      tick: 50,
      reference: null,
    })
  })

  it('on a scale cut to a range: everything moves with it, the interval is cut at the end, and there is no tick', () => {
    // 40–70 is 30 points wide: the value, (51,06 − 40) / 30; the interval starts before 40 and ends at 24,7 / 30.
    expect(intervalGeometry(MINE, { scale: [40, 70] })).toEqual({
      point: 36.88,
      band: { left: 0, width: 82.33 },
      tick: null,
      reference: null,
    })
  })

  it('a scale that keeps one end of 0–100 is cut all the same: no tick unless one is asked for', () => {
    // Only the whole 0–100 has its line between winning and losing drawn by itself.
    expect(intervalGeometry(MINE, { scale: [0, 60] }).tick).toBeNull()
    expect(intervalGeometry(MINE, { scale: [40, 100] }).tick).toBeNull()
    expect(intervalGeometry(MINE, { scale: [0, 60], tick: 50 }).tick).toBe(83.33)
    expect(intervalGeometry(MINE, { scale: [40, 100], tick: 50 }).tick).toBe(16.67)
  })

  it('a tick is drawn where it is asked for, and never out of the scale', () => {
    expect(intervalGeometry(MINE, { scale: [40, 70], tick: 50 }).tick).toBe(33.33)
    expect(intervalGeometry(MINE, { scale: [40, 70], tick: 40 }).tick).toBe(0)
    expect(intervalGeometry(MINE, { scale: [40, 70], tick: 70 }).tick).toBe(100)
    // 30 is not on 40–70: drawn at the end it would say «30 is here».
    expect(intervalGeometry(MINE, { scale: [40, 70], tick: 30 }).tick).toBeNull()
    expect(intervalGeometry(MINE, { scale: [60, 90] }).tick).toBeNull()
    expect(intervalGeometry(MINE, { scale: [60, 90], tick: 50 }).tick).toBeNull()
    // On the full scale another tick replaces the 50, and null takes it away.
    expect(intervalGeometry(MINE, { tick: 49.1 }).tick).toBe(49.1)
    expect(intervalGeometry(MINE, { tick: null }).tick).toBeNull()
    expect(intervalGeometry(MINE, { tick: undefined }).tick).toBe(50)
  })

  it('a reference is placed on the same scale, and one out of it stays at the end', () => {
    expect(intervalGeometry(MINE, { reference: 48.2 }).reference).toBe(48.2)
    expect(intervalGeometry(MINE, { scale: [40, 70], reference: 48.2 }).reference).toBe(27.33)
    expect(intervalGeometry(MINE, { scale: [40, 70], reference: 35 }).reference).toBe(0)
    expect(intervalGeometry(MINE, { scale: [40, 70], reference: 90 }).reference).toBe(100)
    expect(intervalGeometry(MINE, { reference: null }).reference).toBeNull()
    expect(intervalGeometry(MINE, { reference: 0 }).reference).toBe(0)
  })

  it('without an interval there is no band, and the point is still placed', () => {
    expect(EXPECTED.ci95).toBeNull()
    expect(intervalGeometry(EXPECTED)).toEqual({ point: 59.3, band: null, tick: 50, reference: null })
  })

  it('an interval wholly out of the scale draws no band, and the point stays at the end it left by', () => {
    // 2,2–47,1 around 12,5, on a scale that starts at 50.
    expect(intervalGeometry(EXACT_LIST, { scale: [50, 80] })).toEqual({
      point: 0,
      band: null,
      tick: null,
      reference: null,
    })
    const above: Figure = { ...MINE, value: 95, ci95: [90, 99] }
    expect(intervalGeometry(above, { scale: [40, 70] })).toMatchObject({ point: 100, band: null })
  })

  it('the ends of the scale: a real 0 % and a real 100 % are at the edges, with their bands inside the box', () => {
    expect(intervalGeometry(LOST_ONCE)).toMatchObject({ point: 0, band: { left: 0, width: 79.3 } })
    expect(intervalGeometry(WON_TWICE)).toMatchObject({ point: 100, band: { left: 34.2, width: 65.8 } })
  })

  it('an interval written backwards is the same interval, and a scale that is not one is the full scale', () => {
    const backwards: Figure = { ...MINE, ci95: [64.7, 37.2] }
    expect(intervalGeometry(backwards).band).toEqual({ left: 37.2, width: 27.5 })
    expect(intervalGeometry(MINE, { scale: [70, 40] })).toEqual(intervalGeometry(MINE))
  })
})
