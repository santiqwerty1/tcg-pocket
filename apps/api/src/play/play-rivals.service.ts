/**
 * Rivals for a game against the bot (Fase 23): the exact lists that placed well in the last days of the era, each
 * checked against the engine (a list with a card the catalog or the engine does not know cannot be played).
 */
import { Injectable } from '@nestjs/common'
import {
  buildSnapshot,
  describeProblems,
  energyFromNameEn,
  type RecentList,
  recentLists,
  type SelectableEnergy,
  type TournamentFormat,
} from '@tcg/domain'
import { EngineStatusService } from '../simulation/snapshots.service.js'
import { LIMITLESS_ATTRIBUTION, TournamentsService } from '../tournaments/tournaments.service.js'

export interface RecentListView extends Omit<RecentList, 'energies'> {
  energies: SelectableEnergy[]
  /** The engine can play it; otherwise why not. */
  playable: boolean
  problem: string | null
}

export interface RecentListsView {
  era: string
  format: TournamentFormat
  days: number
  from: Date | null
  to: Date | null
  items: RecentListView[]
  attribution: string
}

const selectable = (words: readonly string[]): SelectableEnergy[] =>
  words.map((word) => energyFromNameEn(word)).filter((energy): energy is SelectableEnergy => energy !== undefined)

@Injectable()
export class PlayRivalsService {
  constructor(
    private readonly tournaments: TournamentsService,
    private readonly engine: EngineStatusService,
  ) {}

  async recentLists(query: {
    days?: number | undefined
    top?: number | undefined
    era?: string | undefined
    format?: TournamentFormat | undefined
  }): Promise<RecentListsView> {
    const { scope, dataset } = await this.tournaments.scopedDataset({ era: query.era, format: query.format })
    const engine = await this.engine.status()
    const days = query.days ?? 7
    const { from, to, lists } = recentLists(dataset, { days, top: query.top, limit: 80 })
    const entryOf = new Map(dataset.entries.map((entry) => [entry.keyByGroup, entry]))
    return {
      era: scope.era,
      format: scope.format,
      days,
      from,
      to,
      attribution: LIMITLESS_ATTRIBUTION,
      items: lists.map((list) => {
        const entry = entryOf.get(list.listKey)
        const unknown = entry?.cards.filter((card) => card.cardId === null) ?? []
        let problem: string | null = null
        if (!entry) problem = 'la lista no está en el dataset'
        else if (unknown.length > 0) {
          problem = `cartas que el catálogo no conoce: ${unknown.map((card) => `${card.set}-${card.number}`).join(', ')}`
        } else {
          const draft = buildSnapshot({
            label: list.listKey,
            cards: entry.cards.map((card) => ({ cardId: card.cardId as string, count: card.count })),
            energies: selectable(entry.energies),
            index: scope.index,
            engine,
          })
          if (!draft.simulable) problem = describeProblems(draft.problems)
        }
        return { ...list, energies: selectable(list.energies), playable: problem === null, problem }
      }),
    }
  }
}
