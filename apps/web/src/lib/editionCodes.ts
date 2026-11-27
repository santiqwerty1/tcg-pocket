/**
 * Mirrors MAX_ALLOWED_EDITIONS of @tcg/domain (a test checks they agree): as many allowed editions as the API takes,
 * and as many as one `GET /api/cards/batch` looks up.
 */
export const MAX_ALLOWED_EDITIONS = 80

/**
 * Edition codes typed or pasted by hand for an event's allowed editions («P-A-1, a2b-111 P-A-008»): split by commas,
 * semicolons or blanks, each written as the catalog writes it — the expansion's id as the catalog has it, whatever
 * the case, and the number without leading zeros — without repeats, in the order typed. A code whose expansion is
 * unknown stays as typed, so the screen and the API can say which one is wrong.
 */
export function parseEditionCodes(text: string, expansionIds: readonly string[]): string[] {
  const byLower = new Map(expansionIds.map((id) => [id.toLowerCase(), id]))
  const codes: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    // Brackets and a final period come along when the codes are copied from a sentence: «Poción (P-A-1).».
    const token = raw.replace(/^[([]+|[)\].:]+$/g, '')
    if (!token) continue
    const match = /^(.+)-0*(\d+)$/.exec(token)
    const expansion = match?.[1] ? byLower.get(match[1].toLowerCase()) : undefined
    const code = match && expansion ? `${expansion}-${match[2]}` : token
    if (!codes.includes(code)) codes.push(code)
  }
  return codes
}

/** The shape of an edition code the API takes (the domain's `eventRulesSchema`). */
export function looksLikeEditionCode(code: string): boolean {
  return /^[A-Za-z0-9-]{1,20}$/.test(code)
}
