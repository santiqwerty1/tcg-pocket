/** A card named the way it comes up in a chat: its code («B4-103», «b4 103») or its name in Spanish or English. */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { type CardEdition, type CatalogIndex, foldText } from '@tcg/domain'

/**
 * The card a code names, whatever its case or spacing («B1a-38», «b1a-38», «B1a 38»): the catalog's ids mix cases, so
 * an upper-cased code misses B1a and the like (Codex on #114); the search matches ids folded.
 */
function cardByCode(index: CatalogIndex, query: string): CardEdition | undefined {
  const code = query.trim().replace(/\s+/g, '-')
  return (
    index.cardById(code.toUpperCase()) ??
    index.cardById(query.trim()) ??
    index.search(code, { lang: 'any', limit: 5 }).find((hit) => hit.matchedOn === 'id')?.card
  )
}

/** The card id; among same-named editions, one of `preferred` (the deck's own) wins. */
export function resolveCardRef(index: CatalogIndex, query: string, preferred: readonly string[] = []): string {
  const byId = cardByCode(index, query)
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
  const byId = cardByCode(index, query)
  if (byId) return byId.id
  const key = foldText(query)
  const hits = index.search(query, { lang: 'any', limit: 10 })
  // Self-review: only the card of that very name («Agua» is not Ondulagua).
  const named = hits.find(({ card }) => foldText(card.nameEs) === key || foldText(card.nameEn) === key)
  if (!named) {
    const close = hits.slice(0, 3).map(({ card }) => card.nameEs)
    throw new NotFoundException(
      `No encontré la carta «${query}»${close.length > 0 ? `; ¿era ${close.join(', ')}?` : ''}`,
    )
  }
  return named.card.id
}

/** «2 Greninja», «2x Greninja», «Suicune ex», «A1-89»: one card seen and its copies (1 when not said). */
export function seenCardFromText(index: CatalogIndex, text: string): { cardId: string; count: number } {
  const before = /^\s*([12])\s*[x×]?\s+(.+)$/u.exec(text)
  // «Greninja x2», «Greninja ×2» (self-review: a common way to say it).
  const after = before ? null : /^(.+?)\s*[x×]\s*([12])\s*$/u.exec(text)
  const query = (before?.[2] ?? after?.[1] ?? text).trim()
  const count = before ? Number(before[1]) : after ? Number(after[2]) : 1
  return { cardId: resolveSeenCard(index, query), count }
}
