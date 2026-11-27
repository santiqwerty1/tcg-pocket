/**
 * The figures the tests of the pieces (components/figures) share. They are the ones «Piezas de la interfaz» draws
 * (pages/mas/pieces/fixtures.ts): one set of invented numbers, written once. The ones the API gives as a rate are in
 * its shape there and go through the adapter of lib/figure.ts; pages/mas/pieces/fixtures.test.ts runs each one through
 * the web's schema, so a change in the shape of a rate fails there first.
 *
 * Every number is invented (they start from the mock-up's public docs/prototipos/renovacion-ui/datos.js): none is a
 * real result.
 */
export {
  ARCHETYPE,
  BOTS,
  COVERED,
  EXACT_LIST,
  EXPECTED,
  FEW,
  LOST_ONCE,
  MINE,
  POPULAR,
  STALE,
  WON_TWICE,
} from '@/pages/mas/pieces/fixtures'

/** A no-break space: the one before «%», after «IC» and inside «n 47». Testing Library reads it as a plain one. */
export const NBSP = '\u00a0'
/** The dash of a range, with the word joiner `formatInterval` writes after it. */
export const DASH = '–\u2060'
