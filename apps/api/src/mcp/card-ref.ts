/** A card named the way it comes up in a chat: its code («B4-103», «b4 103») or its name in Spanish or English. */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { type CatalogIndex, foldText } from '@tcg/domain'

/** The card id; among same-named editions, one of `preferred` (the deck's own) wins. */
export function resolveCardRef(index: CatalogIndex, query: string, preferred: readonly string[] = []): string {
  const code = query.trim().replace(/\s+/g, '-').toUpperCase()
  const byId = index.cardById(code) ?? index.cardById(query.trim())
  if (byId) return byId.id
  const key = foldText(query)
  const hits = index.search(query, { lang: 'any', limit: 10 })
  const named = hits.filter(({ card }) => foldText(card.nameEs) === key || foldText(card.nameEn) === key)
  const pool = named.length > 0 ? named : hits
  const own = pool.find(({ card }) => preferred.includes(card.id))
  if (own) return own.card.id
  const groups = new Set(pool.map(({ card }) => card.functionalGroupId))
  if (pool.length === 0) throw new NotFoundException(`No encontré la carta «${query}».`)
  if (groups.size > 1) {
    throw new BadRequestException(
      `«${query}» puede ser varias cartas: ${pool
        .slice(0, 6)
        .map(({ card }) => `${card.nameEs} (${card.id})`)
        .join('; ')}. Indicá el código.`,
    )
  }
  return (pool[0] as (typeof pool)[number]).card.id
}

/**
 * A rival's card seen, by code or by name (14/10): any card of the name counts as the same one, so a name that several
 * functional cards share is no ambiguity here (the first exact match is taken).
 */
export function resolveSeenCard(index: CatalogIndex, query: string): string {
  const code = query.trim().replace(/\s+/g, '-').toUpperCase()
  const byId = index.cardById(code) ?? index.cardById(query.trim())
  if (byId) return byId.id
  const key = foldText(query)
  const hits = index.search(query, { lang: 'any', limit: 10 })
  const named = hits.find(({ card }) => foldText(card.nameEs) === key || foldText(card.nameEn) === key)
  const found = named ?? hits[0]
  if (!found) throw new NotFoundException(`No encontré la carta «${query}».`)
  return found.card.id
}

/** «2 Greninja», «2x Greninja», «Suicune ex», «A1-89»: one card seen and its copies (1 when not said). */
export function seenCardFromText(index: CatalogIndex, text: string): { cardId: string; count: number } {
  const match = /^\s*([12])\s*[x×]?\s+(.+)$/u.exec(text)
  const query = (match?.[2] ?? text).trim()
  return { cardId: resolveSeenCard(index, query), count: match ? Number(match[1]) : 1 }
}
