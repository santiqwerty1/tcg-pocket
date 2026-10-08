import type { JobSummary, SelectableEnergy, SimulationKind, SimulationSource, SimulationStatus } from '@/api/schemas'
import { TOURNAMENT_FORMATS, type TournamentFormat } from '@/api/schemas'
import { isSelectableEnergy } from './energies'
import { formatNumber } from './format'

export const KIND_LABEL: Record<SimulationKind, string> = {
  matrix: 'Matriz',
  compare: 'Comparar',
  optimize: 'Optimizar',
  explore: 'Explorar (laboratorio)',
  consistency: 'Consistencia',
}

export const KIND_HINT: Record<SimulationKind, string> = {
  matrix: 'Todos contra todos dentro de una lista de mazos (o una lista contra otra).',
  compare: 'Uno o varios mazos contra una lista de rivales.',
  optimize: 'Sacá cartas de un mazo y probá combinaciones de candidatas contra rivales.',
  explore: 'Búsqueda automática de variantes de un mazo contra el meta (Laboratorio).',
  consistency: 'En qué turno tiene listo el mazo a su atacante principal (desde la ficha del mazo).',
}

export const STATUS_LABEL: Record<SimulationStatus, string> = {
  queued: 'en cola',
  running: 'corriendo',
  done: 'terminada',
  failed: 'falló',
  cancelled: 'cancelada',
}

export function isActive(status: SimulationStatus): boolean {
  return status === 'queued' || status === 'running'
}

/** Fraction 0–1 of the games played. */
export function progressFraction(job: Pick<JobSummary, 'progress'>): number {
  const { totalGames, gamesDone } = job.progress
  return totalGames > 0 ? Math.min(1, gamesDone / totalGames) : 0
}

/** «1 h 25 min», «3 min», «40 s». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Ways to fill `slots` places with `kinds` candidates, repetition allowed (what engine-cli `optimize` plays). */
export function multisetCount(kinds: number, slots: number): number {
  if (kinds <= 0 || slots <= 0) return 0
  let result = 1
  for (let i = 1; i <= slots; i++) result = (result * (kinds + i - 1)) / i
  return Math.round(result)
}

/**
 * Sources travel in the URL of the new-simulation form so «Simular» buttons can prefill it:
 * `d:<deckId>[:<energies>]` or `l:<listKey>:<era>:<format>:<group|name>[:<energies>]`, energies joined by «+».
 */
export function encodeSource(source: SimulationSource): string {
  const energies = source.energies?.length ? `:${source.energies.join('+')}` : ''
  if ('deckId' in source) return `d:${source.deckId}${energies}`
  return `l:${source.listKey}:${source.era ?? ''}:${source.format ?? ''}:${source.kind ?? 'group'}${energies}`
}

function parseEnergies(text: string | undefined): SelectableEnergy[] | undefined {
  if (!text) return undefined
  const list = text.split('+').filter(isSelectableEnergy)
  return list.length > 0 ? list : undefined
}

export function decodeSource(token: string): SimulationSource | null {
  const parts = token.split(':')
  if (parts[0] === 'd' && parts[1]) {
    const energies = parseEnergies(parts[2])
    return { deckId: parts[1], ...(energies ? { energies } : {}) }
  }
  if (parts[0] === 'l' && parts[1] && /^[0-9a-f]{14}$/.test(parts[1])) {
    const format = (TOURNAMENT_FORMATS as readonly string[]).includes(parts[3] ?? '')
      ? (parts[3] as TournamentFormat)
      : undefined
    const kind = parts[4] === 'name' ? 'name' : 'group'
    const energies = parseEnergies(parts[5])
    return {
      listKey: parts[1],
      ...(parts[2] ? { era: parts[2] } : {}),
      ...(format ? { format } : {}),
      kind,
      ...(energies ? { energies } : {}),
    }
  }
  return null
}

export function sourceId(source: SimulationSource): string {
  return 'deckId' in source ? `d:${source.deckId}` : `l:${source.listKey}:${source.era ?? ''}:${source.format ?? ''}`
}

export function gamesLabel(games: number): string {
  return `${formatNumber(games)} ${games === 1 ? 'partida' : 'partidas'}`
}
