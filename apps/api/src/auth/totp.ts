import { generate, generateSecret, generateURI, verify } from 'otplib'

export const TOTP_ISSUER = 'TCG Pocket'
/** RFC 6238 default time step (otplib's default `period`). */
export const TOTP_PERIOD_SECONDS = 30
const TOKEN_PATTERN = /^\d{6}$/

export type TotpVerification = { valid: true; step: number } | { valid: false }

export function generateTotpSecret(): string {
  return generateSecret()
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: email, secret })
}

/**
 * Accepts the current 30-second step and its two neighbours (clock drift on the phone). A valid result carries the
 * time step the code belongs to, so the caller can refuse to accept the same code twice (replay).
 */
export async function verifyTotp(secret: string, token: string): Promise<TotpVerification> {
  if (!TOKEN_PATTERN.test(token)) return { valid: false }
  const result = await verify({ secret, token, epochTolerance: [TOTP_PERIOD_SECONDS, TOTP_PERIOD_SECONDS] })
  if (!result.valid) return { valid: false }
  // TOTP results carry the epoch (seconds) of the period start that matched.
  const epoch = 'epoch' in result && typeof result.epoch === 'number' ? result.epoch : Date.now() / 1000
  return { valid: true, step: Math.floor(epoch / TOTP_PERIOD_SECONDS) }
}

/** Current code for a secret (tests and the owner:init self-check). */
export function currentTotp(secret: string): Promise<string> {
  return generate({ secret })
}
