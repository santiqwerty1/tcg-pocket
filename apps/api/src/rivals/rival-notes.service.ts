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
    return (await this.write(input)).note
  }

  /**
   * `save`, also returning the note it replaced (Fase 43: what «Deshacer» brings back). The row is locked while it is
   * read and written, so `previous` is exactly what this write changed.
   */
  async write(input: {
    opponent: string
    text: string
    archetypeId?: string | null | undefined
    append?: boolean | undefined
  }): Promise<{ note: RivalNoteView | null; previous: RivalNoteView | null }> {
    const label = cleanOpponent(input.opponent)
    const key = opponentKey(input.opponent)
    if (label === null || key === null) {
      throw new BadRequestException({ code: 'validation', message: 'Escribí contra quién es la nota.' })
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT key FROM rival_notes WHERE key = ${key} FOR UPDATE`
      const current = await tx.rivalNote.findUnique({ where: { key } })
      const previous = current ? view(current) : null
      const added = input.text.trim()
      const text = input.append && current ? [current.text, added].filter(Boolean).join('\n\n') : added
      if (text.length > RIVAL_NOTE_MAX_LENGTH) {
        throw new BadRequestException({
          code: 'validation',
          message: `La nota supera los ${RIVAL_NOTE_MAX_LENGTH} caracteres.`,
        })
      }
      if (text === '') {
        if (current) await tx.rivalNote.delete({ where: { key } })
        return { note: null, previous }
      }
      const archetypeId = input.archetypeId === undefined ? (current?.archetypeId ?? null) : input.archetypeId
      const saved = await tx.rivalNote.upsert({
        where: { key },
        create: { key, label, archetypeId, text },
        update: { label, archetypeId, text },
      })
      return { note: view(saved), previous }
    })
  }

  /**
   * Fase 43, «Deshacer» of a Claude write: puts `before` back (null: deletes the note) only while the note is still
   * `after` (null: there is none), in one conditional write. False when it changed since.
   */
  async restore(
    key: string,
    after: string | null,
    before: { label: string; archetypeId: string | null; text: string; createdAt: string } | null,
  ): Promise<boolean> {
    if (after === null) {
      if (!before) return true
      const created = await this.prisma.rivalNote.createMany({
        data: [{ key, ...before, createdAt: new Date(before.createdAt) }],
        skipDuplicates: true,
      })
      return created.count > 0
    }
    const changed = before
      ? await this.prisma.rivalNote.updateMany({
          where: { key, text: after },
          data: { label: before.label, archetypeId: before.archetypeId, text: before.text },
        })
      : await this.prisma.rivalNote.deleteMany({ where: { key, text: after } })
    return changed.count > 0
  }

  async remove(key: string): Promise<void> {
    const note = await this.prisma.rivalNote.findUnique({ where: { key } })
    if (!note) throw new NotFoundException('Esa nota no existe.')
    await this.prisma.rivalNote.delete({ where: { key } })
  }
}
