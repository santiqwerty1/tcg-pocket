/**
 * Ejercicios de cálculo (Fase 30): `GET /api/drills` asks a question built from the owner's decks (kind, deck and
 * seed decide it), `POST /api/drills/answer` rebuilds it, grades the choice and keeps the result, and
 * `GET /api/drills/stats` says how it is going.
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Module, Post, Query } from '@nestjs/common'
import {
  type CardEdition,
  DRILL_KINDS,
  type Drill,
  type DrillDeck,
  type DrillKind,
  type DrillPokemon,
  drawDrill,
  drillQuestion,
  gradeDrill,
  isBasicPokemon,
  koDrill,
  plainDamage,
  seededRandom,
} from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { CatalogService } from '../catalog/catalog.service.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { PrismaService } from '../prisma/prisma.service.js'

const MAX_SEED = 2 ** 31 - 1
const DAY_MS = 24 * 60 * 60 * 1000

export type DrillQuestionView = ReturnType<typeof drillQuestion> & { deckId: string; deck: string }

export interface DrillAnswerView {
  correct: boolean
  answer: number
  explanation: string
  stats: DrillStatsView
}

export interface DrillStatsView {
  today: { answered: number; correct: number }
  /** Right answers in a row, the latest first. */
  streak: number
  /** Last 30 days, by kind. */
  byKind: Record<DrillKind, { answered: number; correct: number }>
}

interface OwnDeck {
  id: number
  name: string
  cards: { card: CardEdition; count: number }[]
}

function pokemonOf(card: CardEdition): DrillPokemon | null {
  if (card.cardType !== 'pokemon' || card.energy === 'trainer' || !card.hp) return null
  return {
    nameEs: card.nameEs,
    hp: card.hp,
    energy: card.energy,
    weakness: card.weakness,
    prizePoints: card.prizePoints,
    attacks: card.attacks.flatMap((attack) => {
      const damage = plainDamage(attack.damage)
      return damage === null ? [] : [{ name: attack.name, damage }]
    }),
  }
}

@Injectable()
export class DrillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  /** The decks not archived, with their current list. */
  private async decks(): Promise<OwnDeck[]> {
    const index = this.catalog.requireIndex()
    const decks = await this.prisma.deck.findMany({
      where: { archivedAt: null, currentRevisionId: { not: null } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, currentRevisionId: true },
    })
    const revisions = new Map(
      (
        await this.prisma.deckRevision.findMany({
          where: { id: { in: decks.flatMap((deck) => (deck.currentRevisionId ? [deck.currentRevisionId] : [])) } },
          select: { id: true, cards: true },
        })
      ).map((row) => [row.id, row.cards as unknown as { cardId: string; count: number }[]]),
    )
    return decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      cards: (revisions.get(deck.currentRevisionId ?? 0) ?? []).flatMap((entry) => {
        const card = index.cardById(entry.cardId)
        return card ? [{ card, count: entry.count }] : []
      }),
    }))
  }

  private async build(
    kind: DrillKind,
    deckId: string | undefined,
    seed: number,
  ): Promise<{ drill: Drill; deck: OwnDeck }> {
    const decks = (await this.decks()).filter((deck) => deck.cards.length > 0)
    if (decks.length === 0) {
      throw new BadRequestException({ code: 'validation', message: 'Primero necesitás un mazo.' })
    }
    const deck = deckId
      ? decks.find((item) => String(item.id) === deckId)
      : decks[Math.floor(seededRandom(seed ^ 0x5bd1e995)() * decks.length)]
    if (!deck) throw new BadRequestException({ code: 'validation', message: `No hay un mazo ${deckId} sin archivar.` })
    try {
      if (kind === 'draw') {
        const groups = new Map<string, DrillDeck['cards'][number]>()
        for (const { card, count } of deck.cards) {
          const current = groups.get(card.functionalGroupId)
          groups.set(card.functionalGroupId, {
            groupId: card.functionalGroupId,
            nameEs: card.nameEs,
            copies: (current?.copies ?? 0) + count,
            basic: isBasicPokemon(card),
          })
        }
        return { drill: drawDrill({ name: deck.name, cards: [...groups.values()] }, seed), deck }
      }
      const unique = (cards: CardEdition[]) => [
        ...new Map(cards.map((card) => [card.functionalGroupId, card] as const)).values(),
      ]
      const attackers = unique(deck.cards.map((entry) => entry.card)).flatMap((card) => pokemonOf(card) ?? [])
      const defenders = unique(decks.flatMap((item) => item.cards.map((entry) => entry.card))).flatMap(
        (card) => pokemonOf(card) ?? [],
      )
      return { drill: koDrill(attackers, defenders, seed), deck }
    } catch (error) {
      throw new BadRequestException({
        code: 'validation',
        message: `${deck.name}: ${(error as Error).message}`,
      })
    }
  }

  async question(input: { kind: DrillKind; deckId?: string | undefined; seed: number }): Promise<DrillQuestionView> {
    const { drill, deck } = await this.build(input.kind, input.deckId, input.seed)
    return { ...drillQuestion(drill), deckId: String(deck.id), deck: deck.name }
  }

  async answer(input: { kind: DrillKind; deckId: string; seed: number; choice: number }): Promise<DrillAnswerView> {
    const { drill, deck } = await this.build(input.kind, input.deckId, input.seed)
    if (input.choice >= drill.choices.length) {
      throw new BadRequestException({ code: 'validation', message: 'Esa opción no existe.' })
    }
    const grade = gradeDrill(drill, input.choice)
    await this.prisma.drillAttempt.create({
      data: { kind: input.kind, deckId: deck.id, seed: BigInt(input.seed), correct: grade.correct },
    })
    return { ...grade, stats: await this.stats() }
  }

  async stats(): Promise<DrillStatsView> {
    const since = new Date(Date.now() - 30 * DAY_MS)
    const rows = await this.prisma.drillAttempt.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { id: 'desc' },
      select: { kind: true, correct: true, createdAt: true },
    })
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const today = rows.filter((row) => row.createdAt >= startOfToday)
    const streak = rows.findIndex((row) => !row.correct)
    const byKind = Object.fromEntries(
      DRILL_KINDS.map((kind) => {
        const mine = rows.filter((row) => row.kind === kind)
        return [kind, { answered: mine.length, correct: mine.filter((row) => row.correct).length }]
      }),
    ) as DrillStatsView['byKind']
    return {
      today: { answered: today.length, correct: today.filter((row) => row.correct).length },
      streak: streak === -1 ? rows.length : streak,
      byKind,
    }
  }
}

const seed = z.coerce.number().int().min(0).max(MAX_SEED)
const questionSchema = z.object({
  kind: z.enum(DRILL_KINDS),
  deckId: z
    .string()
    .regex(/^\d{1,9}$/)
    .optional(),
  seed,
})
const answerSchema = z.object({
  kind: z.enum(DRILL_KINDS),
  deckId: z.string().regex(/^\d{1,9}$/),
  seed,
  choice: z.number().int().min(0).max(10),
})

@Controller('api/drills')
export class DrillsController {
  constructor(private readonly drills: DrillsService) {}

  @Get('stats')
  stats(@CurrentSession() _session: RequestSession): Promise<DrillStatsView> {
    return this.drills.stats()
  }

  @Get()
  question(
    @Query(new ZodValidationPipe(questionSchema)) query: z.infer<typeof questionSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DrillQuestionView> {
    return this.drills.question(query)
  }

  @Post('answer')
  @HttpCode(200)
  answer(
    @Body(new ZodValidationPipe(answerSchema)) body: z.infer<typeof answerSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<DrillAnswerView> {
    return this.drills.answer(body)
  }
}

@Module({
  imports: [CatalogModule],
  controllers: [DrillsController],
  providers: [DrillsService],
})
export class DrillsModule {}
