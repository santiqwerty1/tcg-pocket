/**
 * pokemon_zone_summary (2/11/2026): the summary of the latest pokemon-zone import, compact for the model. Every rate
 * of the game's counters carries its Spanish `text` with n and interval; the game's counters, the matches logged and
 * the estimated numbers of the luck are said apart.
 */
import {
  formatGameCounterEs,
  formatPercentEs,
  type GameCounterView,
  type GameLuckTier,
  type GameLuckVerdict,
  HOURGLASSES_PER_PACK,
  INCLUSION_SD,
  type PokemonZoneLuck,
  type PokemonZoneLuckSinceFirst,
  SPECIAL_PICK_SHARE,
} from '@tcg/domain'
import { OWNER_TIME_ZONE } from '../config/time-zone.js'
import type { PokemonZoneSummary } from '../pokemon-zone/pokemon-zone.service.js'

type Json = Record<string, unknown>

const VERDICT: Record<GameLuckVerdict, string> = {
  unknown: 'no se puede saber con lo que da el juego (las cartas de otras fuentes pueden cambiarlo)',
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

/**
 * Review of pz/import: names that come from the payload (a coupon's event, a pack, an expansion) reach the model only
 * as short plain text: letters, digits and simple punctuation, up to 80 characters.
 */
export function safeName(text: string): string {
  const plain = text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} :'’&().,-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 80 ? plain.slice(0, 80).trimEnd() : plain
}

function tier(value: GameLuckTier | null): Json | null {
  return value
    ? {
        observed: value.observed,
        cardsWithKnownOdds: value.games,
        expectedEstimated: round1(value.expected),
        expectedPercentEstimated: formatPercentEs(value.expectedShare),
        cardsOfUnknownOrigin: value.unknown,
        fromKnownCardsBetween: value.fromPacks,
        verdict: VERDICT[value.verdict],
        ...(value.verdict === 'unknown' && value.normalIf
          ? {
              normalIfUnknownCardsOfTier: value.normalIf,
              normalIfText: `sería normal si entre ${value.normalIf.min} y ${value.normalIf.max} de las ${value.unknown} cartas de origen desconocido fueran de estas; con menos, mejor de lo normal; con más, peor`,
            }
          : {}),
      }
    : null
}

function luck(item: PokemonZoneLuck | null): Json | null {
  if (!item) return null
  const { sources } = item
  return {
    packsOpened: item.packs,
    cardsObtained: item.cards,
    cardsFromPacksEstimated: item.packCards,
    // pz/luck: where the cards came from — real, estimated or unknown — never added into one number with another source.
    sources: {
      wonderPicks: sources.wonderPicks,
      wonderPicksAsPackCards: sources.pickCards,
      wonderPicksOfUnknownOrigin: sources.unknownPicks,
      ...(sources.pickWindows.length > 0
        ? { wonderPickNotPackLikeBecause: sources.pickWindows.map((window) => window.why) }
        : {}),
      trades: sources.trades,
      guaranteedStarStarPacks: sources.guaranteedPacks,
      ...(sources.guaranteedSeen ? {} : { guaranteedStarStarPacksIsABound: true }),
      restEstimated: sources.restCards,
    },
    cardsOfUnknownOriginEstimated: item.otherCards,
    byRarity: item.byRarity,
    ...(item.unknownRarity > 0 ? { cardsWithoutAppRarity: item.unknownRarity } : {}),
    ...(item.unknownPacks > 0 ? { packsOfExpansionsNotInCatalog: item.unknownPacks } : {}),
    artRareOrBetter: tier(item.rare),
    ex: tier(item.ex),
    byExpansion: item.expansions
      .filter((row) => row.packs > 0)
      .slice(0, 30)
      .map((row) => ({
        expansion: row.nameEs ?? safeName(row.nameEn),
        id: row.expansionId,
        packs: row.packs,
        cards: row.cards,
      })),
    topPacks: item.byPack
      .slice(0, 10)
      .map((row) => ({ pack: row.nameEs ?? safeName(row.nameEn), expansion: row.expansionId, opened: row.opened })),
  }
}

/** pz/luck: «desde la primera importación», the spans between imports with few cards of unknown origin, summed. */
function sinceFirst(item: PokemonZoneLuckSinceFirst | null): Json | null {
  if (!item) return null
  const counted = (value: PokemonZoneLuckSinceFirst['rare']) =>
    value ? { spansCounted: value.counted, ...tier(value) } : { spansCounted: 0, verdict: 'todavía ninguno cuenta' }
  return {
    from: ownerDateTime(item.from),
    to: ownerDateTime(item.to),
    spansBetweenImports: item.spans,
    artRareOrBetter: counted(item.rare),
    ex: counted(item.ex),
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
      event: coupon.nameEs ?? `otro evento («${safeName(coupon.event)}»)`,
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
      ? {
          lifetime: luck(summary.luck.lifetime),
          sinceLastImport: luck(summary.luck.since),
          sinceFirstImport: sinceFirst(summary.luck.sinceFirst),
        }
      : 'El catálogo no está cargado: la suerte de los sobres no se puede calcular.',
    notes: [
      'Los contadores de partidas son del juego, de por vida (o entre importaciones): una fuente aparte de las partidas registradas en la app; nunca se suman. Versus son todas las partidas contra personas (incluye las competitivas) y se comparan con todas las registradas; las competitivas, con las competitivas registradas.',
      'Suerte de los sobres: sobres abiertos y cartas por rareza son reales (del juego, cuentan Wonder Pick, intercambios y regalos); lo «Estimated» sale de las tasas publicadas de los sobres de cada expansión, pesadas por los sobres que abrió.',
      `Suerte, de dónde vino cada carta: las de sobre y las de Wonder Pick tienen probabilidades conocidas (una carta de Wonder Pick es una carta al azar de un sobre que abrió otro jugador), salvo durante un evento que cambia Wonder Pick (promos, más elecciones Chansey) y hasta un ${Math.round(SPECIAL_PICK_SHARE * 100)} % que pueden ser elecciones especiales; intercambios, regalos, premios, canjes y la carta asegurada de un sobre de aniversario son de origen desconocido. El veredicto sale solo si no cambia con lo que esas pudieron tener.`,
      `Desde la primera importación: se suman los períodos entre importaciones con pocas cartas de origen desconocido (todas juntas, a lo sumo ${String(INCLUSION_SD).replace('.', ',')} desvíos de los aciertos esperados); cada período cuenta o no por esas cartas y lo esperado, nunca por lo que salió.`,
      `Relojes de arena de sobre: ${HOURGLASSES_PER_PACK} son un sobre.`,
      ...(window
        ? []
        : ['Con una sola importación (o la anterior de otra cuenta) no hay comparación entre importaciones.']),
    ],
  }
}
