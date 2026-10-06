import { idToString } from '../http/ids.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { GroupDeckUsage } from './catalog-views.js'

/**
 * "Which decks use this card": non-archived decks whose current revision lists any of `cardIds`, with the copies
 * summed over the editions (shared by `GET /api/groups/:id` and `GET /api/decks/by-card/:groupId`).
 */
export async function deckUsageOfCards(prisma: PrismaService, cardIds: readonly string[]): Promise<GroupDeckUsage[]> {
  if (cardIds.length === 0) return []
  const rows = await prisma.deckCard.findMany({
    where: { cardId: { in: [...cardIds] }, deck: { archivedAt: null } },
    include: { deck: { select: { id: true, name: true, builtInGame: true } } },
  })
  const byDeck = new Map<number, GroupDeckUsage>()
  for (const row of rows) {
    const usage = byDeck.get(row.deck.id)
    if (usage) usage.count += row.count
    else
      byDeck.set(row.deck.id, {
        id: idToString(row.deck.id),
        name: row.deck.name,
        count: row.count,
        builtInGame: row.deck.builtInGame,
      })
  }
  return [...byDeck.entries()].sort((a, b) => a[0] - b[0]).map(([, usage]) => usage)
}
