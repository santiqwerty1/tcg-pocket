/**
 * pokemon_zone_summary (2/11/2026): the summary of the latest pokemon-zone import, compact for the model. Every rate
 * of the game's counters carries its Spanish `text` with n and interval; the game's counters, the matches logged and
 * the estimated numbers of the luck are said apart.
 */
import {
  formatGameCounterEs,
  formatPercentEs,
  type GameCounterView,
  HOURGLASSES_PER_PACK,
  type LuckVerdict,
  type PokemonZoneLuck,
} from '@tcg/domain'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import type { PokemonZoneSummary } from '../pokemon-zone/pokemon-zone.service.js'

type Json = Record<string, unknown>

const VERDICT: Record<LuckVerdict, string> = {
  too_few: 'pocas cartas',
  normal: 'dentro de lo normal',
  unlucky: 'peor de lo normal',
  lucky: 'mejor de lo normal',
}

const ownerFormat = new Intl.DateTimeFormat('es-AR', {
  timeZone: OWNER_TIME_ZONE,
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** «2/11/2026, 23:43» in Buenos Aires. */
export function ownerDateTime(iso: string): string {
  return ownerFormat.format(new Date(iso))
}

function counter(view: GameCounterView | null): Json | null {
  return view ? { battles: view.battles, wins: view.wins, text: formatGameCounterEs(view) } : null
}

const round1 = (value: number) => Math.round(value * 10) / 10

function luck(item: PokemonZoneLuck | null): Json | null {
  if (!item) return null
  const tier = (value: PokemonZoneLuck['rare']) =>
    value
      ? {
          observed: value.observed,
          expectedEstimated: round1(value.expected),
          expectedPercentEstimated: formatPercentEs(value.expectedShare),
          verdict: VERDICT[value.check.verdict],
        }
      : null
  return {
    packsOpened: item.packs,
    cardsObtained: item.cards,
    cardsFromPacksEstimated: item.packCards,
    cardsFromElsewhereEstimated: item.otherCards,
    wonderPicks: item.wonderPicks,
    trades: item.trades,
    byRarity: item.byRarity,
    ...(item.unknownRarity > 0 ? { cardsWithoutAppRarity: item.unknownRarity } : {}),
    ...(item.unknownPacks > 0 ? { packsOfExpansionsNotInCatalog: item.unknownPacks } : {}),
    artRareOrBetter: tier(item.rare),
    ex: tier(item.ex),
    byExpansion: item.expansions
      .filter((row) => row.packs > 0)
      .slice(0, 30)
      .map((row) => ({ expansion: row.nameEs ?? row.nameEn, id: row.expansionId, packs: row.packs, cards: row.cards })),
    topPacks: item.byPack
      .slice(0, 10)
      .map((row) => ({ pack: row.nameEs ?? row.nameEn, expansion: row.expansionId, opened: row.opened })),
  }
}

export function pokemonZoneJson(summary: PokemonZoneSummary): Json {
  const latest = summary.latest
  if (!latest) {
    return {
      imports: 0,
      note: 'Todavía no hay ninguna importación de pokemon-zone: Santi la trae con el marcador de Colección → pokemon-zone, desde su navegador en pokemon-zone.com.',
    }
  }
  const battles = summary.battles
  const window = battles?.window ?? null
  const notLogged = (rows: { kind: string; notLogged: number; game: number; logged: number }[]) =>
    Object.fromEntries(rows.map((row) => [row.kind, { game: row.game, logged: row.logged, notLogged: row.notLogged }]))
  const origin = { imported: 'los de esta importación', edited: 'cambiados a mano después' } as const
  return {
    imports: summary.imports,
    gameReadAt: ownerDateTime(latest.syncedAt),
    importedAt: ownerDateTime(latest.importedAt),
    level: latest.level,
    packPoints: Object.fromEntries(Object.entries(latest.packPoints).filter(([, value]) => value > 0)),
    hourglasses: {
      ...latest.hourglasses,
      packsFromPackHourglasses:
        latest.hourglasses.pack === null ? null : Math.floor(latest.hourglasses.pack / HOURGLASSES_PER_PACK),
    },
    currencies: latest.currencies,
    promoCoupons: latest.coupons.map((coupon) => ({
      event: coupon.nameEs ?? coupon.event,
      count: coupon.count,
      activeEvent: coupon.active,
    })),
    settingsOfSobres: {
      packPoints: summary.settings.packPoints ? origin[summary.settings.packPoints] : null,
      packHourglasses: summary.settings.hourglasses ? origin[summary.settings.hourglasses] : null,
    },
    battles: battles
      ? {
          game: {
            versus: counter(battles.game.versus),
            ranked: counter(battles.game.ranked),
            rankedPoints: battles.game.rankedPoints,
            solo: counter(battles.game.solo),
            rental: counter(battles.game.rental),
          },
          // Review of pz/import: no «not logged» over the whole life of the game: the app logs since October 2026,
          // so that difference says nothing. Only between imports.
          loggedInApp: {
            all: battles.logged.all,
            competitive: battles.logged.competitive,
            since: battles.logged.firstAt ? ownerDateTime(battles.logged.firstAt) : null,
          },
          betweenLastImports: window
            ? {
                from: ownerDateTime(window.from),
                to: ownerDateTime(window.to),
                game: {
                  versus: window.game.versus,
                  ranked: window.game.ranked,
                  rankedPoints: window.game.rankedPoints,
                  solo: window.game.solo,
                },
                logged: window.logged,
                notLogged: notLogged(window.comparison),
              }
            : null,
        }
      : null,
    luck: summary.luck
      ? { lifetime: luck(summary.luck.lifetime), sinceLastImport: luck(summary.luck.since) }
      : 'El catálogo no está cargado: la suerte de los sobres no se puede calcular.',
    notes: [
      'Los contadores de partidas son del juego, de por vida (o entre importaciones): una fuente aparte de las partidas registradas en la app; nunca se suman. Versus son todas las partidas contra personas (incluye las competitivas) y se comparan con todas las registradas; las competitivas, con las competitivas registradas.',
      'Suerte de los sobres: sobres abiertos y cartas por rareza son reales (del juego, cuentan Wonder Pick, intercambios y regalos); lo «Estimated» sale de las tasas publicadas de los sobres de cada expansión, pesadas por los sobres que abrió.',
      `Relojes de arena de sobre: ${HOURGLASSES_PER_PACK} son un sobre.`,
      ...(window
        ? []
        : ['Con una sola importación (o la anterior de otra cuenta) no hay comparación entre importaciones.']),
    ],
  }
}
