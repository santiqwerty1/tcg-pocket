/**
 * Small pure hash used for `FunctionalGroup.rulesHash`. No `node:crypto` so the domain runs in the browser too.
 * The hash is a fingerprint for change detection between catalog syncs, not a security primitive.
 */

const FNV_OFFSET_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

/** FNV-1a 32-bit over the UTF-16 code units of `text`. */
export function fnv1a32(text: string, seed: number = FNV_OFFSET_32): number {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0
  }
  return hash >>> 0
}

/**
 * 64 bits of fingerprint as 16 lower-case hex characters: FNV-1a forward plus FNV-1a over the reversed text
 * with a different seed, so a one-character change anywhere alters both halves.
 */
export function hashText(text: string): string {
  const forward = fnv1a32(text)
  let reversed = ''
  for (let i = text.length - 1; i >= 0; i--) reversed += text[i]
  const backward = fnv1a32(reversed, 0x9747b28c)
  return forward.toString(16).padStart(8, '0') + backward.toString(16).padStart(8, '0')
}
