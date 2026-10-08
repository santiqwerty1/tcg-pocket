/** Decks named the way Santi names them in a chat: «13», «mazo 13», part of the name (MCP read and write tools). */
import { Injectable, NotFoundException } from '@nestjs/common'
import { foldText } from '@tcg/domain'
import { PrismaService } from '../prisma/prisma.service.js'

export interface DeckRef {
  id: string
  name: string
  archived: boolean
}

@Injectable()
export class DeckRefResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A deck by its number in the name («13» → «13. Hoopa ex / Mega-Absol ex»), its database id, its exact name or
   * part of it (accent- and case-insensitive). Active decks win over archived ones on ties.
   */
  async resolve(ref: string): Promise<DeckRef> {
    const rows = await this.prisma.deck.findMany({
      select: { id: true, name: true, archivedAt: true },
      orderBy: { id: 'asc' },
    })
    const decks = rows.map((row) => ({ id: String(row.id), name: row.name, archived: row.archivedAt !== null }))
    const pick = (candidates: DeckRef[]): DeckRef | null => {
      if (candidates.length === 0) return null
      if (candidates.length === 1) return candidates[0] as DeckRef
      const active = candidates.filter((deck) => !deck.archived)
      if (active.length === 1) return active[0] as DeckRef
      throw new NotFoundException(
        `«${ref}» coincide con varios mazos: ${candidates.map((deck) => `${deck.name} (id ${deck.id})`).join('; ')}. Indicá cuál.`,
      )
    }
    const trimmed = ref.trim()
    const number = /^(?:mazo\s*)?(?:n[.º°]?\s*)?#?(\d{1,6})$/iu.exec(trimmed)?.[1]
    if (number) {
      const pattern = new RegExp(`^${number}(?:[.)\\s:-]|$)`)
      const byNumber = pick(decks.filter((deck) => pattern.test(deck.name.trim())))
      if (byNumber) return byNumber
      const byId = decks.find((deck) => deck.id === number)
      if (byId) return byId
    }
    const key = foldText(trimmed)
    const found =
      pick(decks.filter((deck) => foldText(deck.name) === key)) ??
      pick(decks.filter((deck) => foldText(deck.name).includes(key)))
    if (!found) throw new NotFoundException(`No encontré ningún mazo «${ref}».`)
    return found
  }
}
