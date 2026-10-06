/**
 * Cleaning of the tracker's scraped fields (docs/fase0/catalogo.md §1.1, PLAN §3.1):
 * - trainer `ability.effect` ends with "\n\n … Illustrated by \n <artist>" (scraper.ts:209-218);
 * - `damage` of an attack with a multi-word name and no damage is the last word of the name (scraper.ts:342-344),
 *   and '0' is the scraper's placeholder for single-word attacks without damage;
 * - `cost` is the literal ['No Cost'] for free attacks; `effect` is 'No effect'; `weakness` is 'N/A' or 'none'.
 * Plus the derived fields: prize points, searchable text and the canonical rules text behind `rulesHash`.
 */
import { hashText } from './hash.js'
import type { TrackerAttack } from './schemas.js'
import { type Ability, type Attack, type CardType, ENERGY_TYPES, type EnergyType, type EvolutionType } from './types.js'

const ILLUSTRATED_BY_TAIL = /\s*Illustrated by[\s\S]*$/u
/** Printed damage: '30', '30+', '50x', '140-'. Anything else is scraper noise. */
const DAMAGE_PATTERN = /^\d+[+x×-]?$/u
const NO_COST = 'No Cost'
const NO_EFFECT = 'No effect'
const ENERGY_SET: ReadonlySet<string> = new Set(ENERGY_TYPES)

/** Lower-case, accent-insensitive, whitespace-collapsed form used for searching ("Copiona" ~ "copiona", "é" ~ "e"). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Removes the artist tail the scraper glues to trainer effects and trims. Idempotent. */
export function cleanRulesText(text: string): string {
  return text.replace(ILLUSTRATED_BY_TAIL, '').trim()
}

export function isDamageNoise(damage: string): boolean {
  return !DAMAGE_PATTERN.test(damage.trim())
}

/**
 * Printed damage or null. A word (leaked last word of the attack name) and the scraper's '0' placeholder mean
 * "no damage" (Pocket never prints 0). `attackName` is accepted for symmetry with `normalizeAttackName`.
 */
export function normalizeDamage(damage: string, _attackName?: string): string | null {
  const trimmed = damage.trim()
  if (isDamageNoise(trimmed)) return null
  return trimmed === '0' ? null : trimmed
}

/** Restores the attack name when its last word leaked into `damage` ("Find a" + "Friend" → "Find a Friend"). */
export function normalizeAttackName(name: string, damage: string): string {
  const trimmedDamage = damage.trim()
  if (trimmedDamage !== '' && isDamageNoise(trimmedDamage)) return `${name.trim()} ${trimmedDamage}`.trim()
  return name.trim()
}

export function normalizeCost(cost: readonly string[]): EnergyType[] {
  const result: EnergyType[] = []
  for (const token of cost) {
    if (token === NO_COST) continue
    if (!ENERGY_SET.has(token)) throw new Error(`Unknown energy in attack cost: '${token}'`)
    result.push(token as EnergyType)
  }
  return result
}

export function normalizeEffect(effect: string): string | null {
  const cleaned = cleanRulesText(effect)
  return cleaned === '' || cleaned === NO_EFFECT ? null : cleaned
}

export function normalizeWeakness(weakness: string): EnergyType | null {
  const trimmed = weakness.trim()
  if (trimmed === '' || trimmed === 'N/A' || trimmed.toLowerCase() === 'none') return null
  if (!ENERGY_SET.has(trimmed)) throw new Error(`Unknown weakness: '${weakness}'`)
  return trimmed as EnergyType
}

export function normalizeAttack(attack: TrackerAttack): Attack {
  return {
    cost: normalizeCost(attack.cost),
    name: normalizeAttackName(attack.name, attack.damage),
    damage: normalizeDamage(attack.damage, attack.name),
    effect: normalizeEffect(attack.effect),
  }
}

/** Ability (or trainer effect: the tracker stores it as an ability with an empty name) with the artist tail removed. */
export function normalizeAbility(ability: { name: string; effect: string } | undefined): Ability | null {
  if (!ability) return null
  const effect = cleanRulesText(ability.effect)
  const name = ability.name.trim()
  if (effect === '' && name === '') return null
  return { name, effect }
}

/** Prize points given to the opponent when knocked out: 3 Mega ex, 2 ex, 1 other Pokémon, 0 trainers. */
export function prizePointsOf(card: { cardType: CardType; ex: boolean; nameEn: string }): 0 | 1 | 2 | 3 {
  if (card.cardType === 'trainer') return 0
  if (card.ex) return card.nameEn.startsWith('Mega ') ? 3 : 2
  return 1
}

export interface SearchTextInput {
  id: string
  engineId: string
  nameEn: string
  nameEs: string
  attacks: readonly Attack[]
  ability: Ability | null
}

/** Folded text used by the search index: names, ids and rules text separated by ' | '. */
export function buildSearchText(input: SearchTextInput): string {
  const parts: string[] = [input.nameEn, input.nameEs, input.id, input.engineId]
  for (const attack of input.attacks) {
    parts.push(attack.name)
    if (attack.effect) parts.push(attack.effect)
  }
  if (input.ability) {
    if (input.ability.name) parts.push(input.ability.name)
    if (input.ability.effect) parts.push(input.ability.effect)
  }
  return parts.map(foldText).join(' | ')
}

export interface RulesTextInput {
  cardType: CardType
  evolutionType: EvolutionType
  energy: EnergyType | 'trainer'
  hp: number | null
  weakness: EnergyType | null
  retreat: number | null
  ex: boolean
  attacks: readonly Attack[]
  ability: Ability | null
}

/**
 * Canonical rules text of an edition: everything that makes two cards "the same card" in play, excluding the
 * name (kept as a separate field), rarity, art, pack and ids. Every edition of a functional group yields the
 * same text.
 */
export function rulesTextOf(card: RulesTextInput): string {
  const lines: string[] = [
    `type:${card.cardType}`,
    `evolution:${card.evolutionType}`,
    `energy:${card.energy}`,
    `hp:${card.hp ?? ''}`,
    `weakness:${card.weakness ?? ''}`,
    `retreat:${card.retreat ?? ''}`,
    `ex:${card.ex ? 1 : 0}`,
  ]
  for (const attack of card.attacks) {
    lines.push(`attack:${attack.name}|${attack.cost.join(',')}|${attack.damage ?? ''}|${attack.effect ?? ''}`)
  }
  lines.push(`ability:${card.ability ? `${card.ability.name}|${card.ability.effect}` : ''}`)
  return lines.join('\n')
}

export function rulesHashOf(card: RulesTextInput): string {
  return hashText(rulesTextOf(card))
}
