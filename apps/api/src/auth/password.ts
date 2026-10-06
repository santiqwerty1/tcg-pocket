import argon2 from 'argon2'

/** argon2id cost parameters (`memoryCost` in KiB). */
export interface Argon2Cost {
  memoryCost: number
  timeCost: number
  parallelism: number
}

/**
 * OWASP's recommended minimum for argon2id (19 MiB, 2 passes, 1 lane). The library defaults (64 MiB, 3 passes,
 * 4 lanes) would let a handful of concurrent login attempts eat a quarter of the 512 MB machine; the cost is
 * configurable through ARGON2_* (see env.ts) and is stored in the hash, so verification needs no parameters.
 */
export const DEFAULT_ARGON2_COST: Argon2Cost = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export function hashPassword(password: string, cost: Argon2Cost = DEFAULT_ARGON2_COST): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, ...cost })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

let dummyHash: Promise<string> | null = null

/** Burns the same time as a real verification so a missing owner/email mismatch is not distinguishable by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-constant-time')
  await verifyPassword(await dummyHash, password)
  return false
}
