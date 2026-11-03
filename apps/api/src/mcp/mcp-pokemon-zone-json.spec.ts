import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gameBattles, normalizePokemonZone, pokemonZonePayloadSchema, promoCoupons } from '@tcg/domain'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../config/dotenv.js'
import type { PokemonZoneSummary } from '../pokemon-zone/pokemon-zone.service.js'
import { pokemonZoneJson } from './mcp-pokemon-zone-json.js'

const snapshot = normalizePokemonZone(
  pokemonZonePayloadSchema.parse(
    JSON.parse(readFileSync(join(REPO_ROOT, 'packages/domain/test/fixtures/pokemon-zone/payload.json'), 'utf8')),
  ),
)

const summary = (window: boolean): PokemonZoneSummary => ({
  imports: 2,
  latest: {
    id: '2',
    importedAt: '2026-11-02T03:00:00.000Z',
    syncedAt: snapshot.syncedAt,
    level: snapshot.level,
    packPoints: snapshot.packPoints,
    hourglasses: snapshot.hourglasses,
    currencies: snapshot.currencies,
    coupons: promoCoupons(snapshot, new Date('2026-11-02T12:00:00Z')),
    totals: snapshot.totals,
  },
  previous: null,
  settings: { packPoints: 'imported', hourglasses: 'edited' },
  battles: {
    game: gameBattles(snapshot),
    logged: { all: 4, competitive: 1, firstAt: '2026-10-07T12:00:00.000Z' },
    lifetime: [{ kind: 'ranked', game: 340, logged: 1, notLogged: 339 }],
    window: window
      ? {
          from: '2026-11-01T02:40:00.000Z',
          to: snapshot.syncedAt,
          game: { versus: null, ranked: { battles: 3, wins: 2 }, solo: null, rental: null, rankedPoints: 10 },
          logged: { all: 1, competitive: 1 },
          comparison: [{ kind: 'ranked', game: 3, logged: 1, notLogged: 2 }],
        }
      : null,
  },
  luck: null,
})

describe('pokemon_zone_summary', () => {
  it('says how to bring an import before the first one', () => {
    const json = pokemonZoneJson({
      imports: 0,
      latest: null,
      previous: null,
      settings: { packPoints: null, hourglasses: null },
      battles: null,
      luck: null,
    })
    expect(json).toEqual({ imports: 0, note: expect.stringContaining('Colección → pokemon-zone') })
  })

  it('every rate of the game carries its text with n and interval; the counters are said apart', () => {
    const json = pokemonZoneJson(summary(true)) as {
      gameReadAt: string
      packPoints: Record<string, number>
      hourglasses: Record<string, unknown>
      promoCoupons: unknown[]
      settingsOfSobres: unknown
      battles: {
        game: { ranked: { text: string }; rental: { text: string } }
        betweenLastImports: { notLogged: unknown }
      }
      luck: unknown
      notes: string[]
    }
    expect(json.gameReadAt).toBe('1/11/2026, 23:43')
    expect(json.packPoints).not.toHaveProperty('B4b')
    expect(json.packPoints).toMatchObject({ A1: 5, C1: 310 })
    expect(json.hourglasses).toMatchObject({ pack: 18, packsFromPackHourglasses: 1 })
    expect(json.promoCoupons).toEqual([
      { event: 'Evento botín bis PROMO 2026', count: 2, activeEvent: true },
      { event: 'PROMO Reissue Wonder Pick Event 2026', count: 2, activeEvent: false },
    ])
    expect(json.settingsOfSobres).toEqual({
      packPoints: 'los de esta importación',
      packHourglasses: 'cambiados a mano después',
    })
    expect(json.battles.game.ranked.text).toBe('47,1 % (160 V en 340 partidas, IC 41,8–52,4 %)')
    expect(json.battles.game.rental.text).toContain('orientativo')
    expect(json.battles.betweenLastImports.notLogged).toEqual({ ranked: { game: 3, logged: 1, notLogged: 2 } })
    expect(json.luck).toMatch(/catálogo no está cargado/)
    expect(json.notes[0]).toMatch(/nunca se suman/)
    expect(JSON.stringify(json)).not.toContain('1111222233334444')
  })

  it('with one import it says there is no comparison yet', () => {
    const json = pokemonZoneJson(summary(false)) as { notes: string[]; battles: { betweenLastImports: unknown } }
    expect(json.battles.betweenLastImports).toBeNull()
    expect(json.notes.at(-1)).toMatch(/no hay comparación entre importaciones/)
  })
})
