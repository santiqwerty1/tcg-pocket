/**
 * Misiones (themed collections, BRIEF «más adelante», PLAN Fase 8): the tracker's `assets/themed-collections/
 * <expansion>-missions.json` at the pinned commit. Each mission asks for copies of some cards; a slot accepts any of
 * its options (reprints and other arts) and counts copies owned. The game's names and rewards are in English (the
 * tracker has no Spanish for them).
 */
import { z } from 'zod'
import type { CatalogIndex } from './catalogIndex.js'
import type { CardId } from './types.js'

export interface MissionSlot {
  /** Card ids that count for this slot. */
  options: CardId[]
  /** Copies needed. */
  amount: number
}

export interface Mission {
  expansionId: string
  name: string
  slots: MissionSlot[]
  reward: string | null
  /** Hidden in the game until found. */
  secret: boolean
}

const missionFileSchema = z.array(
  z.object({
    expansionId: z.string(),
    name: z.string().min(1),
    requiredCards: z.array(z.object({ options: z.array(z.string()), amount: z.number().int().min(1) })),
    reward: z.string().optional(),
    secret: z.boolean().optional(),
  }),
)

/**
 * The missions of one file. Options the catalog does not know are dropped (and named in `warnings`); a slot left
 * without options drops its mission; missions that ask for no cards (open packs) are left out.
 */
export function parseMissions(
  raw: unknown,
  known: (cardId: CardId) => boolean,
): { missions: Mission[]; warnings: string[] } {
  const parsed = missionFileSchema.safeParse(raw)
  if (!parsed.success)
    return { missions: [], warnings: [`missions: invalid file (${parsed.error.issues[0]?.message})`] }
  const warnings: string[] = []
  const missions: Mission[] = []
  for (const mission of parsed.data) {
    // «Open 60 packs» missions ask for no cards: not about the collection.
    if (mission.requiredCards.length === 0) continue
    const slots: MissionSlot[] = []
    let broken = false
    for (const slot of mission.requiredCards) {
      const options = slot.options.filter((id) => {
        if (known(id)) return true
        warnings.push(`mission «${mission.name}»: unknown card ${id}`)
        return false
      })
      if (options.length === 0) broken = true
      slots.push({ options, amount: slot.amount })
    }
    if (broken) {
      warnings.push(`mission «${mission.name}» dropped: a slot has no known card`)
      continue
    }
    missions.push({
      expansionId: mission.expansionId,
      name: mission.name,
      slots,
      reward: mission.reward ?? null,
      secret: mission.secret ?? false,
    })
  }
  return { missions, warnings }
}

/**
 * Phone review (13/10/2026): the rewards' items in Spanish. The tracker has no Spanish for them, so these are the
 * app's names, not confirmed against the game in Spanish: Santi reviews them (DECISIONES 56.6). The mission names
 * stay in English (each one is unique; there is no source for them).
 */
export const REWARD_ITEMS_ES: readonly [english: RegExp, spanish: string][] = [
  [/\bWonder Hourglass\b/gi, 'Reloj de arena maravilla'],
  [/\bPack Hourglass\b/gi, 'Reloj de arena de sobre'],
  [/\bShop Ticket\b/gi, 'Ticket de tienda'],
  [/\bShinedust\b/gi, 'Polvo brillante'],
  [/\(profile icon\)/gi, '(ícono de perfil)'],
  [/\(emblem\)/gi, '(emblema)'],
  [/\(cover\)/gi, '(portada)'],
  [/\(backdrop\)/gi, '(fondo)'],
  [/\(playmat\)/gi, '(tapete)'],
  [/\(card sleeve\)/gi, '(funda)'],
  [/\(pok[eé]mon coin\)/gi, '(moneda)'],
]

/** A mission's reward in Spanish, one item after the other («Reloj de arena maravilla ×12, Ticket de tienda»). */
export function rewardEs(reward: string): string {
  return reward
    .split(/<br\s*\/?>/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      let text = item.replace(/(^|,\s*)And\s+/gi, '$1y ')
      for (const [english, spanish] of REWARD_ITEMS_ES) text = text.replace(english, spanish)
      return text
    })
    .join(', ')
}

export interface SlotProgress {
  options: CardId[]
  amount: number
  /** Copies owned among the options (each stock unit once: twins A1-1/A4b-1 are one card). */
  have: number
}

export interface MissionProgress {
  mission: Mission
  slots: SlotProgress[]
  complete: boolean
  /** Copies still missing over every slot. */
  missingCopies: number
}

/** How far the collection is from each mission. `owned`: copies owned per stock unit. */
export function missionProgress(
  missions: readonly Mission[],
  index: CatalogIndex,
  owned: (stockCardId: CardId) => number,
): MissionProgress[] {
  return missions.map((mission) => {
    const slots = mission.slots.map((slot) => {
      const units = new Set<CardId>()
      for (const option of slot.options) {
        const unit = index.cardById(option)?.stockCardId
        if (unit) units.add(unit)
      }
      const have = [...units].reduce((sum, unit) => sum + owned(unit), 0)
      return { options: slot.options, amount: slot.amount, have }
    })
    const missingCopies = slots.reduce((sum, slot) => sum + Math.max(0, slot.amount - slot.have), 0)
    return { mission, slots, complete: missingCopies === 0, missingCopies }
  })
}
