import { generate, generateSecret, generateURI, verify } from 'otplib'

export const TOTP_ISSUER = 'TCG Pocket'
const TOKEN_PATTERN = /^\d{6}$/

export function generateTotpSecret(): string {
  return generateSecret()
}

export function totpUri(email: string, secret: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: email, secret })
}

/** Accepts the current 30-second step and its two neighbours (clock drift on the phone). */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false
  const result = await verify({ secret, token, epochTolerance: [30, 30] })
  return result.valid
}

/** Current code for a secret (tests and the owner:init self-check). */
export function currentTotp(secret: string): Promise<string> {
  return generate({ secret })
}
