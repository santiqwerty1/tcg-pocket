/**
 * Claude analiza una partida (Fase 29): a finished game against the bot told in Spanish for the MCP — turn by turn,
 * the board at the start of each turn, every action and, in games with the coach, what the coach thought of each of
 * the owner's choices. The narration follows the app's replay viewer (apps/web/src/lib/replay.ts reads the same
 * deckgym JSON; the web does not link @tcg/domain at runtime, so each side keeps its copy).
 */
import { COACH_VERDICT_ES, type CoachVerdict } from './coach.js'
import { gradeAnswer } from './puzzles.js'

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
  Poisoned: 'envenenado',
  Burned: 'quemado',
  Asleep: 'dormido',
  Paralyzed: 'paralizado',
  Confused: 'confundido',
}

function energyEs(energy: string): string {
  return ENERGY_ES[energy] ?? energy
}

function statusEs(status: unknown): string {
  if (typeof status === 'string') return STATUS_ES[status] ?? status
  return JSON.stringify(status)
}

export interface ReviewSlot {
  card: string
  hp: number
  max_hp: number
  energy: string[]
  tools: string[]
  status: unknown[]
}

export interface ReviewPlayerState {
  hand: string[]
  hand_count: number
  deck_count: number
  discard: string[]
  in_play: (ReviewSlot | null)[]
}

export interface ReviewState {
  turn: number
  current_player: number
  points: [number, number]
  players: [ReviewPlayerState, ReviewPlayerState]
  stadium: string | null
}

export interface ReviewStep {
  turn: number
  actor: number
  state: ReviewState
  options: { text: string; action: unknown }[]
  chosen: number
  scores?: number[] | null
}

/** deckgym's replay JSON (engine-cli play writes it when a game ends). */
export interface ReviewReplay {
  players: { name: string; deck: string[] }[]
  cards: Record<string, unknown>
  steps: ReviewStep[]
  final_state: ReviewState
  outcome: unknown
}

export function isReviewReplay(value: unknown): value is ReviewReplay {
  if (typeof value !== 'object' || value === null) return false
  const replay = value as Partial<ReviewReplay>
  return Array.isArray(replay.steps) && Array.isArray(replay.players) && typeof replay.cards === 'object'
}

/** `{"Pokemon": {...}}` or `{"Trainer": {...}}` → the card inside. */
function inner(card: unknown): { id: string; name: string } | null {
  if (typeof card !== 'object' || card === null) return null
  const record = card as Record<string, unknown>
  const value = (record.Pokemon ?? record.Trainer ?? record) as { id?: unknown; name?: unknown }
  return typeof value.id === 'string' && typeof value.name === 'string' ? { id: value.id, name: value.name } : null
}

/** Tells deckgym's actions in Spanish with the catalog's card names. */
export class ReplayNarrator {
  private readonly englishToId = new Map<string, string>()

  constructor(
    private readonly replay: ReviewReplay,
    private readonly names: Record<string, string>,
  ) {
    for (const [id, card] of Object.entries(replay.cards)) {
      const value = inner(card)
      if (value) this.englishToId.set(value.name, id)
    }
  }

  /** Spanish name of an engine id («A1 001»); the engine's English name when the catalog does not know it. */
  name(id: string | null | undefined): string {
    if (!id) return '—'
    return this.names[id] ?? inner(this.replay.cards[id])?.name ?? id
  }

  private cardName(card: unknown): string {
    const value = inner(card)
    return value ? this.name(value.id) : '?'
  }

  slotName(state: ReviewState, player: number, index: number): string {
    const slot = state.players[player]?.in_play[index]
    const place = index === 0 ? 'activo' : `banca ${index}`
    return slot ? `${this.name(slot.card)} (${place})` : place
  }

  describe(action: unknown, state: ReviewState, actor: number, fallback: string): string {
    const mine = (index: number) => this.slotName(state, actor, index)
    if (typeof action === 'string') {
      if (action === 'EndTurn') return 'Termina el turno'
      if (action === 'UseStadium') return `Usa el estadio ${this.name(state.stadium)}`
      if (action === 'DiscardActiveStadium') return `Descarta el estadio ${this.name(state.stadium)}`
      return this.translateText(fallback)
    }
    if (typeof action !== 'object' || action === null) return this.translateText(fallback)
    const [kind, value] = Object.entries(action as Record<string, unknown>)[0] ?? ['', null]
    const v = (value ?? {}) as Record<string, unknown>
    switch (kind) {
      case 'DrawCard': {
        const amount = Number(v.amount ?? 1)
        return amount === 1 ? 'Roba 1 carta' : `Roba ${amount} cartas`
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
      // Quick-Grow Extract and Wallace in our copy of deckgym (D-031): the Pokémon is chosen, the evolution is random.
      case 'EvolveIntoRandomFromDeck':
        return `Evoluciona ${mine(Number(v.in_play_idx))} a un Pokémon de tipo ${energyEs(String(v.energy))} al azar del mazo`
      case 'UseAbility':
        return `Usa la habilidad de ${mine(Number(v.in_play_idx))}`
      case 'Attack': {
        const damage = Number(v.fixed_damage ?? 0)
        return `Ataca con «${String(v.title ?? '?')}»${damage > 0 ? ` (${damage})` : ''}`
      }
      case 'Retreat':
        return `Se retira; entra ${mine(Number(value))}`
      case 'Attach': {
        const attachments = (v.attachments as [number, string, number][] | undefined) ?? []
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
        const targets = (v.targets as [number, number, number][] | undefined) ?? []
        return targets
          .map(([damage, player, index]) => `${damage} de daño a ${this.slotName(state, player, index)}`)
          .join(', ')
      }
      case 'Activate': {
        const player = Number(v.player)
        return `Pasa a activo a ${this.slotName(state, player, Number(v.in_play_idx))}${player === actor ? '' : ' del rival'}`
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

  /** The engine's own text with the English card names and energies in Spanish (actions not listed above). */
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

  /** «Torchic 40/60 PS · 1 Fuego · Casco Rocoso · envenenado». */
  slotText(slot: ReviewSlot): string {
    const energies = new Map<string, number>()
    for (const energy of slot.energy) energies.set(energy, (energies.get(energy) ?? 0) + 1)
    const parts = [`${this.name(slot.card)} ${slot.hp}/${slot.max_hp} PS`]
    if (energies.size > 0) {
      parts.push([...energies].map(([energy, count]) => `${count} ${energyEs(energy)}`).join(' + '))
    }
    for (const tool of slot.tools) parts.push(this.name(tool))
    for (const status of slot.status) parts.push(statusEs(status))
    return parts.join(' · ')
  }

  /** Card names grouped («2 Torchic, Poké Ball»). */
  cardList(ids: readonly string[]): string {
    const counts = new Map<string, number>()
    for (const id of ids) counts.set(this.name(id), (counts.get(this.name(id)) ?? 0) + 1)
    return [...counts].map(([name, count]) => (count > 1 ? `${count} ${name}` : name)).join(', ')
  }
}

export interface ReviewSide {
  active: string | null
  bench: string[]
  hand: string
  handCount: number
  deck: number
  discard: number
}

export interface ReviewBoard {
  /** «Vos 1 – Bot 0» (prize points). */
  points: string
  you: ReviewSide
  /** The bot's hand too: in the game you did not see it. */
  bot: ReviewSide
  stadium: string | null
}

export function boardOf(narrator: ReplayNarrator, state: ReviewState): ReviewBoard {
  const side = (player: ReviewPlayerState | undefined): ReviewSide => {
    const slots = player?.in_play ?? []
    const active = slots[0]
    return {
      active: active ? narrator.slotText(active) : null,
      bench: slots.slice(1).flatMap((slot) => (slot ? [narrator.slotText(slot)] : [])),
      hand: narrator.cardList(player?.hand ?? []),
      handCount: player?.hand_count ?? player?.hand.length ?? 0,
      deck: player?.deck_count ?? 0,
      discard: player?.discard.length ?? 0,
    }
  }
  return {
    points: `Vos ${state.points[0] ?? 0} – Bot ${state.points[1] ?? 0}`,
    you: side(state.players[0]),
    bot: side(state.players[1]),
    stadium: state.stadium ? narrator.name(state.stadium) : null,
  }
}

export interface ReviewOption {
  text: string
  /** The coach's value (rounded). */
  score: number
}

export interface ReviewAction {
  /** The owner's decision number (1, 2…) when it had more than one option. */
  ply?: number
  who: 'vos' | 'bot'
  text: string
  /** How many options there were (only when more than one). */
  options?: number
  /** Modo entrenador: what the coach thought of the owner's choice. */
  coach?: {
    verdict: string
    /** Value lost against the best option (10.000 = a prize point; 500 = a Pokémon ready to attack). */
    gap: number
    /** 1 = the best. */
    rank: number
    /** The coach's option, when it was another one. */
    best?: string
  }
  /** Detail «full»: every option with the coach's value, best first. */
  alternatives?: ReviewOption[]
}

export interface ReviewTurn {
  turn: number
  /** «preparación», «vos» or «bot». */
  player: string
  board: ReviewBoard
  actions: ReviewAction[]
}

export interface ReviewMoment {
  ply: number
  turn: number
  verdict: string
  gap: number
  chosen: string
  best: string
  /** The coach's three best options. */
  top: ReviewOption[]
  board: ReviewBoard
}

export interface GameReview {
  steps: number
  turns: ReviewTurn[]
  /** The owner's costliest choices (a «Peor» or worse), costliest first. */
  keyMoments: ReviewMoment[]
  /** Turns left out by `fromTurn`/`toTurn`. */
  omittedTurns: number
}

export interface GameReviewOptions {
  names: Record<string, string>
  fromTurn?: number | undefined
  toTurn?: number | undefined
  detail?: 'summary' | 'full' | undefined
  /** Key moments to keep (default 5). */
  moments?: number | undefined
}

const round = (value: number) => Math.round(value)

function scored(step: ReviewStep): number[] | null {
  const scores = step.scores
  if (step.actor !== 0 || !scores || scores.length !== step.options.length) return null
  return scores.every((score) => Number.isFinite(score)) ? scores : null
}

function ranked(narrator: ReplayNarrator, step: ReviewStep, scores: readonly number[]): ReviewOption[] {
  return step.options
    .map((option, i) => ({
      text: narrator.describe(option.action, step.state, step.actor, option.text),
      score: round(scores[i] ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
}

export function gameReview(replay: ReviewReplay, options: GameReviewOptions): GameReview {
  const narrator = new ReplayNarrator(replay, options.names)
  const detail = options.detail ?? 'summary'
  const turns: ReviewTurn[] = []
  const moments: (ReviewMoment & { order: number })[] = []
  const omitted = new Set<number>()
  let ply = 0
  for (const step of replay.steps) {
    const who = step.actor === 0 ? 'vos' : 'bot'
    const many = step.options.length > 1
    if (step.actor === 0 && many) ply += 1
    const inRange =
      (options.fromTurn === undefined || step.turn >= options.fromTurn) &&
      (options.toTurn === undefined || step.turn <= options.toTurn)
    const option = step.options[step.chosen]
    const text = option ? narrator.describe(option.action, step.state, step.actor, option.text) : '?'
    const action: ReviewAction = { who, text }
    const scores = many ? scored(step) : null
    if (step.actor === 0 && many) {
      action.ply = ply
      action.options = step.options.length
    }
    if (scores) {
      const grade = gradeAnswer(scores, step.chosen)
      const verdict: CoachVerdict = grade.verdict
      const bestOption = step.options[grade.best]
      const best = bestOption
        ? narrator.describe(bestOption.action, step.state, step.actor, bestOption.text)
        : undefined
      action.coach = {
        verdict: COACH_VERDICT_ES[verdict],
        gap: round(grade.gap),
        rank: grade.rank,
        ...(grade.best !== step.chosen && best ? { best } : {}),
      }
      if (detail === 'full') action.alternatives = ranked(narrator, step, scores)
      if (inRange && (verdict === 'mistake' || verdict === 'blunder')) {
        moments.push({
          order: grade.gap,
          ply,
          turn: step.turn,
          verdict: COACH_VERDICT_ES[verdict],
          gap: round(grade.gap),
          chosen: text,
          best: best ?? text,
          top: ranked(narrator, step, scores).slice(0, 3),
          board: boardOf(narrator, step.state),
        })
      }
    }
    if (!inRange) {
      omitted.add(step.turn)
      continue
    }
    let current = turns.at(-1)
    if (!current || current.turn !== step.turn) {
      current = {
        turn: step.turn,
        player: step.turn === 0 ? 'preparación' : step.state.current_player === 0 ? 'vos' : 'bot',
        board: boardOf(narrator, step.state),
        actions: [],
      }
      turns.push(current)
    }
    current.actions.push(action)
  }
  return {
    steps: replay.steps.length,
    turns,
    keyMoments: moments
      .sort((a, b) => b.order - a.order || a.ply - b.ply)
      .slice(0, options.moments ?? 5)
      .map(({ order: _order, ...moment }) => moment),
    omittedTurns: omitted.size,
  }
}
