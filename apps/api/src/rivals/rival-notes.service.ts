/**
 * Notas por rival (Fase 12): the owner's notes on how to play against a rival archetype. A note belongs to the
 * opponent's key (`opponentKey`: case, accents and punctuation do not matter), so the note written on Limitless's
 * «Mega Blaziken ex» shows up when a match is logged against «mega-blaziken EX».
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { cleanOpponent, opponentKey } from '@tcg/domain'
import type { RivalNote } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

export const RIVAL_NOTE_MAX_LENGTH = 5000

export interface RivalNoteView {
  key: string
  label: string
  archetypeId: string | null
  text: string
  createdAt: Date
  updatedAt: Date
}

function view(note: RivalNote): RivalNoteView {
  return {
    key: note.key,
    label: note.label,
    archetypeId: note.archetypeId,
    text: note.text,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

@Injectable()
export class RivalNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<RivalNoteView[]> {
    const notes = await this.prisma.rivalNote.findMany({ orderBy: { label: 'asc' } })
    return notes.map(view)
  }

  /** The note of an opponent as typed (any spelling), or null. */
  async lookup(opponent: string): Promise<RivalNoteView | null> {
    const key = opponentKey(opponent)
    if (key === null) return null
    const note = await this.prisma.rivalNote.findUnique({ where: { key } })
    return note ? view(note) : null
  }

  /**
   * Writes the note of an opponent (created or replaced; `append` adds a paragraph to what is there). Empty text
   * deletes it. The label is the spelling written now.
   */
  async save(input: {
    opponent: string
    text: string
    archetypeId?: string | null | undefined
    append?: boolean | undefined
  }): Promise<RivalNoteView | null> {
    const label = cleanOpponent(input.opponent)
    const key = opponentKey(input.opponent)
    if (label === null || key === null) {
      throw new BadRequestException({ code: 'validation', message: 'Escribí contra quién es la nota.' })
    }
    const current = await this.prisma.rivalNote.findUnique({ where: { key } })
    const added = input.text.trim()
    const text = input.append && current ? [current.text, added].filter(Boolean).join('\n\n') : added
    if (text.length > RIVAL_NOTE_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'validation',
        message: `La nota supera los ${RIVAL_NOTE_MAX_LENGTH} caracteres.`,
      })
    }
    if (text === '') {
      if (current) await this.prisma.rivalNote.delete({ where: { key } })
      return null
    }
    const archetypeId = input.archetypeId === undefined ? (current?.archetypeId ?? null) : input.archetypeId
    const saved = await this.prisma.rivalNote.upsert({
      where: { key },
      create: { key, label, archetypeId, text },
      update: { label, archetypeId, text },
    })
    return view(saved)
  }

  async remove(key: string): Promise<void> {
    const note = await this.prisma.rivalNote.findUnique({ where: { key } })
    if (!note) throw new NotFoundException('Esa nota no existe.')
    await this.prisma.rivalNote.delete({ where: { key } })
  }
}
