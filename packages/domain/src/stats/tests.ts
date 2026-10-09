/**
 * Honest tests (H-011, Fase 37): small 2×2 tables get Fisher's exact test instead of the normal approximation; many
 * changes at once (the weekly meta) get Benjamini–Hochberg instead of one z ≥ 1,96 each. The clustered intervals are
 * in `rates.ts`.
 */
/** Φ(x), the standard normal distribution function (Numerical Recipes' erfc, relative error under 1,2e-7). */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2)
}

function erfc(x: number): number {
  // Numerical Recipes' erfc (Chebyshev), relative error < 1,2e-7: plenty for p-values compared with 0,05.
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? r : 2 - r
}

/** Two-sided p-value of a z statistic. */
export function twoSidedP(z: number): number {
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))
}

function logFactorial(n: number): number {
  let sum = 0
  for (let i = 2; i <= n; i++) sum += Math.log(i)
  return sum
}

/**
 * Fisher's exact test, two-sided, for the 2×2 table [[a, b], [c, d]] (rows: groups; columns: won, not won): the
 * chance, with the margins fixed, of a table as unlikely as this one or more. Exact for the few games of own
 * matches, where the normal approximation of a z test is too generous.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const row1 = a + b
  const col1 = a + c
  const n = a + b + c + d
  if (n === 0) return 1
  const base =
    logFactorial(row1) + logFactorial(n - row1) + logFactorial(col1) + logFactorial(n - col1) - logFactorial(n)
  const probability = (x: number) =>
    Math.exp(
      base - logFactorial(x) - logFactorial(row1 - x) - logFactorial(col1 - x) - logFactorial(n - row1 - col1 + x),
    )
  const observed = probability(a)
  let p = 0
  for (let x = Math.max(0, row1 + col1 - n); x <= Math.min(row1, col1); x++) {
    const value = probability(x)
    if (value <= observed * (1 + 1e-7)) p += value
  }
  return Math.min(1, p)
}

/**
 * Benjamini–Hochberg at false discovery rate q: which of the p-values are discoveries, so that among the changes
 * called «claros» about q of them (5 %) are noise, whatever the number of archetypes and cards looked at.
 */
export function benjaminiHochberg(pValues: readonly number[], q = 0.05): boolean[] {
  const m = pValues.length
  const order = pValues.map((p, at) => ({ p, at })).sort((x, y) => x.p - y.p)
  let cut = -1
  for (const [rank, item] of order.entries()) if (item.p <= ((rank + 1) / m) * q) cut = rank
  const out = pValues.map(() => false)
  for (let rank = 0; rank <= cut; rank++) {
    const item = order[rank]
    if (item) out[item.at] = true
  }
  return out
}
