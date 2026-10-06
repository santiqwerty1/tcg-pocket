import argon2 from 'argon2'

// argon2id with the library defaults (64 MiB, 3 passes, 4 lanes): fine for a single user.
const OPTIONS = { type: argon2.argon2id } as const

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS)
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
