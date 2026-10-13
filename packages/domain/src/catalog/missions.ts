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
 * Phone review (13/10/2026): the rewards in Spanish. The tracker has no Spanish for them, so the items' names are the
 * app's, not confirmed against the game in Spanish: Santi reviews them (DECISIONES 56.6). Card and expansion names
 * come from the catalog when it knows them. The mission names stay in English (each one is unique; there is no source).
 */
export const REWARD_ITEMS_ES: Readonly<Record<string, string>> = {
  'wonder hourglass': 'Reloj de arena maravilla',
  'pack hourglass': 'Reloj de arena de sobre',
  'shop ticket': 'Ticket de tienda',
  shinedust: 'Polvo brillante',
}

/** What a cosmetic reward is, after its name in parentheses. */
export const REWARD_KINDS_ES: Readonly<Record<string, string>> = {
  'profile icon': 'ícono de perfil',
  emblem: 'emblema',
  cover: 'portada',
  backdrop: 'fondo',
  playmat: 'tapete',
  'card sleeve': 'funda',
  'pokémon coin': 'moneda',
  'pokemon coin': 'moneda',
}

/** Spanish names the catalog knows, by English name (cards and expansions); null when it does not. */
export interface RewardNames {
  card?: ((nameEn: string) => string | null) | undefined
  expansion?: ((nameEn: string) => string | null) | undefined
}

/** «Team Rocket Grunt Ver. 3» → the card's Spanish name, keeping the «Ver. 3». */
function nameEs(name: string, names: RewardNames | undefined): string {
  const version = /^(.*?)(\s+Ver\.\s*\d+)$/i.exec(name)
  const base = version?.[1] ?? name
  const spanish = names?.card?.(base) ?? null
  return spanish ? `${spanish}${version?.[2] ?? ''}` : name
}

/** «Mythical Island: Mew» or «Moltres, Zapdos, And Articuno», in Spanish: «… y Articuno», no comma before «y». */
function subjectEs(subject: string, names: RewardNames | undefined): string {
  const colon = subject.indexOf(': ')
  if (colon > 0) {
    const expansion = names?.expansion?.(subject.slice(0, colon)) ?? null
    if (expansion) return `${expansion}: ${subjectEs(subject.slice(colon + 2), names)}`
  }
  const parts = subject
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.replace(/^and\s+/i, '').trim())
    .filter(Boolean)
    .map((part) => nameEs(part, names))
  if (parts.length < 2) return parts[0] ?? subject
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
}

/**
 * A mission's reward in Spanish: «Reloj de arena maravilla ×36 · Reloj de arena de sobre ×12 · Ticket de tienda». The
 * items are separated by «·», since one can hold commas («Moltres, Zapdos y Articuno (emblema)»).
 */
export function rewardEs(reward: string, names?: RewardNames): string {
  return reward
    .split(/<br\s*\/?>/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const amount = /\s*×\s*[\d.,]+\s*$/.exec(item)
      let rest = amount ? item.slice(0, amount.index) : item
      const kind = /\s*\(([^)]+)\)\s*$/.exec(rest)
      if (kind) rest = rest.slice(0, kind.index)
      rest = rest.trim()
      const word = REWARD_ITEMS_ES[rest.toLowerCase()]
      const subject = word ?? subjectEs(rest, names)
      const kindText = kind ? ` (${REWARD_KINDS_ES[(kind[1] ?? '').toLowerCase()] ?? kind[1]})` : ''
      return `${subject}${kindText}${amount ? ` ${amount[0].trim()}` : ''}`
    })
    .join(' · ')
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
