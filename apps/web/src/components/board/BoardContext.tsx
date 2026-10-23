/**
 * The board's cards (Fase 22): Spanish names and the engine's own data (`ReplayReader`), the catalog edition behind
 * each engine id (images, attacks, weakness, prize points) and whether images are on.
 */
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useCardsBatch } from '@/api/catalog'
import type { CardEdition } from '@/api/schemas'
import { useUiSettings } from '@/api/settings'
import type { ReplayReader } from '@/lib/replay'

export interface BoardCards {
  reader: ReplayReader
  cardIds: Record<string, string>
  editions: Map<string, CardEdition>
  images: boolean
}

/** Exported for tests that give a board without the catalog requests. */
export const BoardCardsContext = createContext<BoardCards | null>(null)

export function BoardProvider({
  reader,
  cardIds,
  children,
}: {
  reader: ReplayReader
  cardIds: Record<string, string>
  children: ReactNode
}) {
  const { boardImages } = useUiSettings()
  const batch = useCardsBatch(Object.values(cardIds))
  const value = useMemo<BoardCards>(
    () => ({ reader, cardIds, editions: batch.data ?? new Map(), images: boardImages }),
    [reader, cardIds, batch.data, boardImages],
  )
  return <BoardCardsContext.Provider value={value}>{children}</BoardCardsContext.Provider>
}

export function useBoardCards(): BoardCards {
  const value = useContext(BoardCardsContext)
  if (!value) throw new Error('useBoardCards outside BoardProvider')
  return value
}

/** Everything the board knows about an engine id. */
export function useBoardCard(engineId: string | null | undefined) {
  const { reader, cardIds, editions, images } = useBoardCards()
  if (!engineId) return null
  const cardId = cardIds[engineId]
  const edition = cardId ? editions.get(cardId) : undefined
  return {
    engineId,
    name: reader.name(engineId),
    cardId: cardId ?? null,
    edition: edition ?? null,
    engine: reader.card(engineId),
    imageUrl: images ? (edition?.imageUrl ?? null) : null,
  }
}
