/**
 * Buscador único (Fase 27): one box for cards, decks, tournament archetypes, own matches, notes by rival and events.
 * Every word has to appear (accents and case do not matter); a few of each, the catalog's search ranking for cards.
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common'
import { foldText } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CatalogService } from '../catalog/catalog.service.js'
import type { CardSearchHit } from '../catalog/catalog-views.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { TournamentsService } from '../tournaments/tournaments.service.js'

const PER_KIND = 6
/** Matches read for the search (the most recent). */
const MATCHES_READ = 2000

export interface SearchView {
  q: string
  cards: CardSearchHit[]
  decks: { id: string; name: string; archived: boolean }[]
  archetypes: { id: string; name: string }[]
  matches: { id: string; deck: string; opponent: string | null; result: string; playedAt: Date; note: string }[]
  notes: { key: string; label: string; archetypeId: string | null; text: string }[]
  events: { id: string; name: string }[]
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly tournaments: TournamentsService,
  ) {}

  /** The catalog's own search (empty while the catalog is not synced). */
  private cards(q: string, words: readonly string[]): CardSearchHit[] {
    try {
      // The catalog searches a phrase: with several words, the hits of the whole phrase, else of the longest word
      // that have every word in a name.
      const phrase = this.catalog.search(q, { lang: 'any', limit: PER_KIND })
      if (phrase.length > 0 || words.length < 2) return phrase
      const longest = [...words].sort((a, b) => b.length - a.length)[0] ?? q
      return this.catalog
        .search(longest, { lang: 'any', limit: 300 })
        .filter((hit) => {
          const names = foldText(`${hit.card.nameEs} ${hit.card.nameEn}`)
          return words.every((word) => names.includes(word))
        })
        .slice(0, PER_KIND)
    } catch {
      return []
    }
  }

  async search(raw: string): Promise<SearchView> {
    const q = raw.trim()
    const words = foldText(q).split(' ').filter(Boolean)
    const empty: SearchView = { q, cards: [], decks: [], archetypes: [], matches: [], notes: [], events: [] }
    if (words.join('').length < 2) return empty
    const has = (...texts: (string | null | undefined)[]) => {
      const folded = foldText(texts.filter(Boolean).join(' '))
      return words.every((word) => folded.includes(word))
    }
    const [decks, matches, notes, events, archetypes] = await Promise.all([
      this.prisma.deck.findMany({ select: { id: true, name: true, archivedAt: true }, orderBy: { id: 'asc' } }),
      this.prisma.match.findMany({
        orderBy: { playedAt: 'desc' },
        take: MATCHES_READ,
        select: {
          id: true,
          result: true,
          opponentText: true,
          note: true,
          playedAt: true,
          deck: { select: { name: true } },
        },
      }),
      this.prisma.rivalNote.findMany({ orderBy: { updatedAt: 'desc' } }),
      this.prisma.event.findMany({ select: { id: true, name: true }, orderBy: { id: 'desc' } }),
      this.tournaments
        .scopedDataset({})
        .then(({ dataset }) => [...dataset.archetypes.values()])
        .catch(() => []),
    ])
    return {
      q,
      cards: this.cards(q, words),
      decks: decks
        .filter((deck) => has(deck.name) || String(deck.id) === q)
        .slice(0, PER_KIND)
        .map((deck) => ({ id: String(deck.id), name: deck.name, archived: deck.archivedAt !== null })),
      archetypes: archetypes
        .filter((archetype) => has(archetype.name))
        .slice(0, PER_KIND)
        .map((archetype) => ({ id: archetype.id, name: archetype.name })),
      matches: matches
        .filter((match) => has(match.opponentText, match.note, match.deck.name))
        .slice(0, PER_KIND)
        .map((match) => ({
          id: String(match.id),
          deck: match.deck.name,
          opponent: match.opponentText,
          result: match.result,
          playedAt: match.playedAt,
          note: match.note,
        })),
      notes: notes
        .filter((note) => has(note.label, note.text))
        .slice(0, PER_KIND)
        .map((note) => ({ key: note.key, label: note.label, archetypeId: note.archetypeId, text: note.text })),
      events: events
        .filter((event) => has(event.name))
        .slice(0, PER_KIND)
        .map((event) => ({ id: String(event.id), name: event.name })),
    }
  }
}

const searchSchema = z.object({ q: z.string().max(200).default('') })

@Controller('api/search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(
    @Query(new ZodValidationPipe(searchSchema)) query: z.infer<typeof searchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<SearchView> {
    return this.service.search(query.q)
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
