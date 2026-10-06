/**
 * AES-256-GCM encryption for small secrets at rest (the TOTP secret). The key is derived from SESSION_SECRET with
 * HKDF-SHA256 and a purpose string, so the same env secret can serve several purposes without key reuse.
 * Format: `v1.<iv>.<ciphertext>.<tag>` (base64url).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretBoxError'
  }
}

export class SecretBox {
  private readonly key: Buffer

  constructor(secret: string, purpose = 'tcg-pocket/totp-secret') {
    if (secret.length < 32) throw new SecretBoxError('secret must be at least 32 characters')
    this.key = Buffer.from(hkdfSync('sha256', secret, 'tcg-pocket', purpose, KEY_BYTES))
  }

  seal(plaintext: string): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.')
  }

  open(sealed: string): string {
    const parts = sealed.split('.')
    if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError('unrecognized sealed format')
    const [, ivText, ciphertextText, tagText] = parts as [string, string, string, string]
    const iv = Buffer.from(ivText, 'base64url')
    const tag = Buffer.from(tagText, 'base64url')
    if (iv.length !== IV_BYTES || tag.length !== 16) throw new SecretBoxError('corrupt sealed value')
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString(
        'utf8',
      )
    } catch {
      throw new SecretBoxError('authentication failed (wrong key or tampered value)')
    }
  }
}
