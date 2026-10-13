/**
 * Reading deckgym replays (engine-cli `simulate` with replaySample): the JSON the engine writes per game, its actions
 * told in Spanish with the card names of the catalog. Actions the engine adds later fall back to its own text, with
 * the card names replaced.
 */

import { PERCENT } from '@/lib/format'
import { formatNumber } from './format'

const ENERGY_ES: Record<string, string> = {
  Grass: 'Planta',
  Fire: 'Fuego',
  Water: 'Agua',
  Lightning: 'Rayo',
  Psychic: 'Psíquico',
  Fighting: 'Lucha',
  Darkness: 'Oscuridad',
  Metal: 'Metal',
  Dragon: 'Dragón',
  Colorless: 'Incolora',
}

const STATUS_ES: Record<string, string> = {
  Poisoned: 'Envenenado',
  Burned: 'Quemado',
  Asleep: 'Dormido',
  Paralyzed: 'Paralizado',
  Confused: 'Confundido',
}

export function energyEs(energy: string): string {
  return ENERGY_ES[energy] ?? energy
}

export function statusEs(status: unknown): string {
  if (typeof status === 'string') return STATUS_ES[status] ?? status
  return JSON.stringify(status)
}

export interface ReplayCard {
  id: string
  name: string
  [key: string]: unknown
}

export interface ReplaySlot {
  card: string
  hp: number
  max_hp: number
  energy: string[]
  tools: string[]
  status: unknown[]
  played_this_turn: boolean
}

export interface ReplayPlayerState {
  hand: string[]
  hand_count: number
  deck_count: number
  discard: string[]
  discard_energies: string[]
  energy_zone: { current: string | null; next: string | null }
  in_play: (ReplaySlot | null)[]
}

export interface ReplayState {
  turn: number
  current_player: number
  points: [number, number]
  winner: unknown
  players: [ReplayPlayerState, ReplayPlayerState]
  stadium: string | null
}

export interface ReplayStep {
  ply: number
  turn: number
  actor: number
  state: ReplayState
  options: { text: string; action: unknown }[]
  chosen: number
  note?: string | null
  /** deckgym 33ff2a5+: how much the player liked each option (external bots only), parallel to `options`. */
  scores?: number[] | null
}

export interface Replay {
  version: number
  game_id: string
  seed: number | string
  players: { name: string; deck: string[] }[]
  cards: Record<string, Record<string, ReplayCard>>
  steps: ReplayStep[]
  final_state: ReplayState
  outcome: unknown
}

/** Light shape check: enough to render, the engine owns the rest. */
export function isReplay(value: unknown): value is Replay {
  if (typeof value !== 'object' || value === null) return false
  const replay = value as Partial<Replay>
  return Array.isArray(replay.steps) && Array.isArray(replay.players) && typeof replay.cards === 'object'
}

/** `{"Pokemon": {...}}` or `{"Trainer": {...}}` → the card inside. */
function inner(card: unknown): ReplayCard | null {
  if (typeof card !== 'object' || card === null) return null
  const record = card as Record<string, unknown>
  const value = (record.Pokemon ?? record.Trainer ?? record) as Partial<ReplayCard>
  return typeof value.id === 'string' && typeof value.name === 'string' ? (value as ReplayCard) : null
}

export class ReplayReader {
  private readonly englishToId = new Map<string, string>()
  readonly replay: Replay
  private readonly names: Record<string, string>

  constructor(replay: Replay, names: Record<string, string>) {
    this.replay = replay
    this.names = names
    for (const [id, card] of Object.entries(replay.cards)) {
      const value = inner(card)
      if (value) this.englishToId.set(value.name, id)
    }
  }

  /** Spanish name of an engine id («A1 001»); the engine's English name when the catalog does not know it. */
  name(id: string | null | undefined): string {
    if (!id) return '—'
    const es = this.names[id]
    if (es) return es
    const card = inner(this.replay.cards[id])
    return card?.name ?? id
  }

  card(id: string): ReplayCard | null {
    return inner(this.replay.cards[id])
  }

  private cardName(card: unknown): string {
    const value = inner(card)
    return value ? this.name(value.id) : '?'
  }

  /** «Activo» or «Banca n»: deckgym's in_play index 0 is the active spot. */
  slotName(state: ReplayState, player: number, index: number): string {
    const slot = state.players[player]?.in_play[index]
    const place = index === 0 ? 'activo' : `banca ${index}`
    return slot ? `${this.name(slot.card)} (${place})` : place
  }

  /** The action of a step in Spanish. `state` is the state when it was chosen, `actor` who chose it. */
  describe(action: unknown, state: ReplayState, actor: number, fallback: string): string {
    const mine = (index: number) => this.slotName(state, actor, index)
    if (typeof action === 'string') {
      switch (action) {
        case 'EndTurn':
          return 'Termina el turno'
        case 'UseStadium':
          return `Usa el estadio ${this.name(state.stadium)}`
        case 'DiscardActiveStadium':
          return `Descarta el estadio ${this.name(state.stadium)}`
        default:
          return this.translateText(fallback)
      }
    }
    if (typeof action !== 'object' || action === null) return this.translateText(fallback)
    const [kind, value] = Object.entries(action as Record<string, unknown>)[0] ?? ['', null]
    const v = value as Record<string, unknown>
    switch (kind) {
      case 'DrawCard': {
        const amount = Number(v.amount ?? 1)
        return amount === 1 ? 'Roba 1 carta' : `Roba ${formatNumber(amount)} cartas`
      }
      case 'Play':
        return `Juega ${this.cardName({ Trainer: v.trainer_card })}`
      case 'Place': {
        const [card, index] = value as [unknown, number]
        return index === 0
          ? `Pone ${this.cardName(card)} como activo`
          : `Pone ${this.cardName(card)} en la banca (${index})`
      }
      case 'Evolve':
        return `Evoluciona ${mine(Number(v.in_play_idx))} a ${this.cardName(v.evolution)}${v.from_deck ? ' (desde el mazo)' : ''}`
      case 'UseAbility':
        return `Usa la habilidad de ${mine(Number(v.in_play_idx))}`
      case 'Attack': {
        const title = String(v.title ?? '?')
        const damage = Number(v.fixed_damage ?? 0)
        return `Ataca con «${title}»${damage > 0 ? ` (${damage})` : ''}`
      }
      case 'Retreat':
        return `Se retira; entra ${mine(Number(value))}`
      case 'Attach': {
        const attachments = (v.attachments as [number, string, number][]) ?? []
        const text = attachments
          .map(
            ([amount, energy, index]) =>
              `${amount} ${amount === 1 ? 'energía' : 'energías'} ${energyEs(energy)} a ${mine(index)}`,
          )
          .join(', ')
        return `Une ${text}${v.is_turn_energy ? ' (energía del turno)' : ''}`
      }
      case 'AttachTool':
        return `Une ${this.cardName(v.tool_card)} a ${mine(Number(v.in_play_idx))}`
      case 'MoveEnergy':
        return `Mueve ${v.amount} ${energyEs(String(v.energy_type))} de ${mine(Number(v.from_in_play_idx))} a ${mine(Number(v.to_in_play_idx))}`
      case 'Heal':
        return `Cura ${v.amount} a ${mine(Number(v.in_play_idx))}${v.cure_status ? ' y sus estados' : ''}`
      case 'ApplyDamage': {
        const targets = (v.targets as [number, number, number][]) ?? []
        return targets
          .map(([damage, player, index]) => `${damage} de daño a ${this.slotName(state, player, index)}`)
          .join(', ')
      }
      case 'Activate': {
        const player = Number(v.player)
        const who = player === actor ? '' : ' del rival'
        return `Pasa a activo a ${this.slotName(state, player, Number(v.in_play_idx))}${who}`
      }
      case 'DiscardFossil':
        return `Descarta el fósil ${mine(Number(v.in_play_idx))}`
      case 'DiscardOpponentSupporter':
        return `Descarta ${this.cardName(v.supporter_card)} de la mano del rival`
      case 'ShuffleOpponentSupporter':
        return `Devuelve ${this.cardName(v.supporter_card)} de la mano del rival a su mazo`
      case 'DiscardToolFromPokemon':
        return `Descarta una herramienta de ${this.slotName(state, Number(v.player), Number(v.in_play_idx))}`
      case 'AttachTypedFromDiscard':
        return `Une ${v.count} ${energyEs(String(v.energy_type))} del descarte a ${mine(Number(v.in_play_idx))}`
      case 'DiscardOwnBenchedThenDamage':
        return `Descarta ${mine(Number(v.in_play_idx))} y hace ${v.damage} de daño`
      case 'PutDiscardCardInHand':
        return `Recupera ${this.cardName(v.card)} del descarte`
      case 'CommunicatePokemon':
        return `Cambia ${this.cardName(v.hand_pokemon)} por un Pokémon del mazo`
      case 'MoveAllDamage':
        return `Mueve todo el daño de ${mine(Number(v.from))} a ${mine(Number(v.to))}`
      default:
        return this.translateText(fallback)
    }
  }

  /** The engine's own text with the English card names and energies in Spanish (for actions not listed above). */
  translateText(text: string): string {
    let out = text
    const english = [...this.englishToId.keys()].sort((a, b) => b.length - a.length)
    for (const name of english) {
      const id = this.englishToId.get(name)
      if (id && out.includes(name)) out = out.split(name).join(this.name(id))
    }
    return out.replace(/\b(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Dragon|Colorless)\b/g, (m) =>
      energyEs(m),
    )
  }

  /** Index of the winning player (0 or 1), or null for a tie / unfinished game. */
  winner(): number | null {
    const outcome = this.replay.outcome as { Win?: number } | string | null
    if (outcome && typeof outcome === 'object' && typeof outcome.Win === 'number') return outcome.Win
    return null
  }
}

/**
 * A bot's scores for the options as short labels: probabilities (non-negative, adding up to 1) as percentages,
 * anything else as numbers. Null when there are none or they do not match the options.
 */
export function scoreLabels(scores: readonly number[] | null | undefined, options: number): string[] | null {
  if (!scores || scores.length !== options || scores.some((value) => !Number.isFinite(value))) return null
  const total = scores.reduce((sum, value) => sum + value, 0)
  const probabilities = scores.every((value) => value >= 0) && Math.abs(total - 1) < 1e-6
  return scores.map((value) =>
    probabilities ? `${Math.round(value * 100)}${PERCENT}` : (Math.round(value * 100) / 100).toLocaleString('es-AR'),
  )
}

export interface TurnGroup {
  turn: number
  actor: number
  steps: { index: number; step: ReplayStep }[]
}

/** Steps grouped by turn (turn 0 is the setup, both players place their Pokémon). */
export function groupByTurn(steps: ReplayStep[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  steps.forEach((step, index) => {
    const last = groups.at(-1)
    if (last && last.turn === step.turn && (step.turn !== 0 || last.actor === step.actor)) {
      last.steps.push({ index, step })
    } else {
      groups.push({ turn: step.turn, actor: step.actor, steps: [{ index, step }] })
    }
  })
  return groups
}
