/**
 * Seeds of the simulations (PLAN §3.7): a job has a base seed (chosen or random, always shown), chunk `idx` of a
 * matrix plays with `baseSeed + idx` (a comparison's, with its rival's seed: `comparisonSeed`), and game `i` of a
 * chunk with `splitmix64(chunkSeed ^ splitmix64(i))` — the same function engine-cli uses (engine/src/main.rs), so
 * any game can be named by its seed and played again.
 */

const MASK_64 = (1n << 64n) - 1n

/** SplitMix64 step (Steele, Lea, Flood 2014), on unsigned 64-bit BigInts. */
export function splitmix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & MASK_64
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64
  return (z ^ (z >> 31n)) & MASK_64
}

/** Seed of game `index` of a chunk with seed `chunkSeed`, as a decimal string (u64 does not fit a JS number). */
export function gameSeed(chunkSeed: bigint | number | string, index: number): string {
  const seed = BigInt(chunkSeed) & MASK_64
  return splitmix64(seed ^ splitmix64(BigInt(index))).toString()
}

/** Seed of chunk `idx` of a job. Base seeds stay below 2^53 so every layer can carry them as plain numbers. */
export function chunkSeed(baseSeed: number, idx: number): number {
  return baseSeed + idx
}

/** Parts of a split pairing are this far apart in seed space (rivals per side stay well under it). */
export const COMPARE_SEED_STRIDE = 1000

/**
 * Seed of a comparison's chunk: every deck of side A plays rival `rival` (its index in side B) with the same seeds,
 * so two variants face the same shuffles and coin flips (H-020, DECISIONES 10.4); `part` is the index of the
 * chunk within a pairing split in chunks of `MAX_GAMES_PER_CHUNK`.
 */
export function comparisonSeed(baseSeed: number, rival: number, part = 0): number {
  return chunkSeed(baseSeed, part * COMPARE_SEED_STRIDE + rival)
}

/** Largest base seed: chunk seeds (base + idx) must stay exact JavaScript integers. */
export const MAX_BASE_SEED = 2 ** 52

/** A random base seed from a source of random 32-bit words (the API passes crypto, tests a fixed one). */
export function randomBaseSeed(randomUint32: () => number): number {
  const high = randomUint32() & 0xfffff
  const low = randomUint32() >>> 0
  return high * 2 ** 32 + low
}
