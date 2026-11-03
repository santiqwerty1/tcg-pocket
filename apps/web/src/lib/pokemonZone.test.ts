import { Blob as NodeBlob } from 'node:buffer'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { type PokemonZonePayload, parsePokemonZone, pokemonZonePayloadSchema } from '@tcg/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bookmarkletCode,
  clearStash,
  decodeIncoming,
  MAX_INFLATED,
  RECEIVE_PATH,
  readStash,
  STASH_KEY,
  stashIncoming,
} from './pokemonZone'

const ORIGIN = 'https://tcg-pocket.fly.dev'
const FRIEND_ID = '1111222233334444'

/** pokemon-zone's answers, with fields the app does not read (they must not travel). */
const mine = {
  player: { friendId: FRIEND_ID, name: 'jugador', lastUpdatedAt: '2026-11-02T02:43:29.379814Z', level: 40, xp: 9 },
  resourceData: {
    packCeilPoints: [{ key: 'A1', value: 5, name: 'Genetic Apex' }],
    packPowerChargers: [
      { key: 'REGULAR_CHARGER_LARGE', value: 18, name: 'Pack Hourglass' },
      { key: 'OTHER', value: 1 },
    ],
    currencies: [
      { key: 'SHOP_TICKET', value: 3000, name: 'Shop ticket' },
      { key: 'GOLD', value: 7, name: 'Poke Gold' },
    ],
    tickets: [
      { key: 'T1', value: 2, name: 'Promo Card Exchange Tickets (PROMO Reissue Drop Event 2026)' },
      { key: 'T2', value: 95, name: 'Emblem Ticket (Genetic Apex)' },
    ],
    tradePowerChargers: [{ key: 'TRADE', value: 1000, name: 'Trade Hourglass' }],
    newResource: [{ key: 'X', value: 1 }],
  },
  config: { isPublic: true },
  cards: [{ cardId: 'PK_10_000010_00', amount: 2 }],
  decks: [{ name: 'Mazo' }],
}
const stats = {
  syncedAt: '2026-11-02T02:43:29.379814Z',
  ownerName: 'jugador',
  headline: [
    { id: 'packs_opened', label: 'Packs opened', value: 1226, rank: 3905 },
    { id: 'max_damage', label: 'Most damage', value: 250 },
  ],
  battles: [
    { id: 'pvp_battles', label: 'Versus battles', value: 3 },
    { id: 'emblems', value: 1 },
  ],
  packsByExpansion: [
    { expansionId: 'A1', name: 'Genetic Apex', sortOrder: 2011, packsOpened: 70, cardsObtained: 442, uniqueCards: 1 },
  ],
  packs: [{ packId: 'AN001_0010_00_000', name: 'Genetic Apex: Mewtwo', subName: null, expansionId: 'A1', opened: 26 }],
  cardsByRarity: [{ rarity: 'C', label: 'Common', sortOrder: 0, obtained: 3666, unique: 1 }],
  cardsByType: [{ type: 'Grass', obtained: 1 }],
}

/** Runs the bookmarklet as a browser would on `hostname`, with pokemon-zone's API stubbed. */
async function run(hostname: string, answer: (url: string) => Response = defaultAnswer) {
  const code = bookmarkletCode(ORIGIN)
  const location = { hostname, href: '' }
  const alert = vi.fn()
  const fetch = vi.fn(async (url: string) => answer(url))
  const body = code.slice('javascript:void'.length)
  // The bookmarklet is an async IIFE: its promise settles when it navigated or alerted. jsdom's Blob has no
  // `stream()`, a browser's (and Node's) does.
  await new Function('location', 'fetch', 'alert', 'Blob', `return ${body}`)(location, fetch, alert, NodeBlob)
  return { location, alert, fetch }
}

function defaultAnswer(url: string): Response {
  if (url === '/api/players/mine/') return Response.json({ data: mine })
  if (url === `/api/players/${FRIEND_ID}/stats/`) return Response.json({ data: stats })
  return new Response('nope', { status: 404 })
}

afterEach(() => {
  clearStash()
})

describe('the bookmarklet', () => {
  it('is one ASCII line with nothing a bookmark address would decode or cut', () => {
    const code = bookmarkletCode(`${ORIGIN}/`)
    expect(code.startsWith('javascript:void(async()=>{')).toBe(true)
    expect(code).toContain(`const A="${ORIGIN}";`)
    expect(code).not.toMatch(/[%#\n]/)
    expect(code).toMatch(/^[\x20-\x7e]+$/)
  })

  it('on pokemon-zone.com: reads the two endpoints and opens the app with them in the fragment', async () => {
    const { location, alert, fetch } = await run('www.pokemon-zone.com')
    expect(alert).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/players/mine/', `/api/players/${FRIEND_ID}/stats/`])
    const [base, data] = location.href.split('#')
    expect(base).toBe(`${ORIGIN}${RECEIVE_PATH}`)
    const payload = await decodeIncoming(data ?? '')
    expect(payload).toEqual({
      v: 1,
      mine: {
        // Only its SHA-256 leaves pokemon-zone: not the friend id, not the name; nor the cards and decks.
        player: {
          accountHash: createHash('sha256').update(FRIEND_ID).digest('hex'),
          lastUpdatedAt: mine.player.lastUpdatedAt,
          level: 40,
        },
        // Only what the app reads, field by field.
        resourceData: {
          currencies: [{ key: 'SHOP_TICKET', value: 3000 }],
          tickets: [{ key: 'T1', value: 2, name: 'Promo Card Exchange Tickets (PROMO Reissue Drop Event 2026)' }],
          packCeilPoints: [{ key: 'A1', value: 5 }],
          packPowerChargers: [{ key: 'REGULAR_CHARGER_LARGE', value: 18 }],
          challengePowerChargers: [],
          tradePowerChargers: [{ key: 'TRADE', value: 1000 }],
          eventPowerChargers: [],
          revivalClocks: [],
        },
      },
      stats: {
        syncedAt: stats.syncedAt,
        headline: [{ id: 'packs_opened', value: 1226 }],
        battles: [{ id: 'pvp_battles', value: 3 }],
        packsByExpansion: [{ expansionId: 'A1', name: 'Genetic Apex', packsOpened: 70, cardsObtained: 442 }],
        packs: [{ packId: 'AN001_0010_00_000', name: 'Genetic Apex: Mewtwo', expansionId: 'A1', opened: 26 }],
        cardsByRarity: [{ rarity: 'C', obtained: 3666 }],
      },
    })
    expect(JSON.stringify(payload)).not.toMatch(/jugador|isPublic|Emblem|Poke Gold|max_damage|rank|Grass/)
    // …and it is what the API takes.
    expect(pokemonZonePayloadSchema.safeParse(payload).success).toBe(true)
    expect(location.href).not.toContain(FRIEND_ID)
  })

  it('anywhere else, or without a session on pokemon-zone, it only says why', async () => {
    const elsewhere = await run('www.example.com')
    expect(elsewhere.fetch).not.toHaveBeenCalled()
    expect(elsewhere.alert).toHaveBeenCalledWith(expect.stringContaining('Abrí pokemon-zone.com'))
    expect(elsewhere.location.href).toBe('')
    const logout = await run('www.pokemon-zone.com', () => new Response('', { status: 403 }))
    expect(logout.alert).toHaveBeenCalledWith(expect.stringContaining('Iniciá sesión en pokemon-zone.com'))
    expect(logout.location.href).toBe('')
    // A site whose name only ends like it is not pokemon-zone.
    expect((await run('evilpokemon-zone.com')).fetch).not.toHaveBeenCalled()
  })

  it('review of #170: without stats (never synced on pokemon-zone), it says so in Spanish', async () => {
    const expected = 'TCG Pocket: pokemon-zone no devolvió tus estadísticas; tocá Sync en tu perfil y probá de nuevo.'
    // Without the player's read date either (the server's fallback), stats without a date are not enough.
    const undated = { ...mine, player: { ...mine.player, lastUpdatedAt: undefined } }
    for (const [player, data] of [
      [mine, null],
      [undated, {}],
      [undated, { ...stats, syncedAt: undefined }],
    ] as const) {
      const empty = await run('www.pokemon-zone.com', (url) =>
        url === '/api/players/mine/' ? Response.json({ data: player }) : Response.json({ data }),
      )
      expect(empty.alert).toHaveBeenCalledWith(expected)
      expect(empty.location.href).toBe('')
    }
  })

  it('review of #170: stats without their date go with the player’s, as the server takes them', async () => {
    const { location, alert } = await run('www.pokemon-zone.com', (url) =>
      url === '/api/players/mine/'
        ? Response.json({ data: mine })
        : Response.json({ data: { ...stats, syncedAt: undefined } }),
    )
    expect(alert).not.toHaveBeenCalled()
    const payload = await decodeIncoming(location.href.split('#')[1] ?? '')
    const parsed = pokemonZonePayloadSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
    expect(parsePokemonZone(parsed.data as PokemonZonePayload).syncedAt).toBe(
      new Date(mine.player.lastUpdatedAt).toISOString(),
    )
  })
})

describe('receiving', () => {
  it('stashes the fragment of the receiving page and clears it from the address bar', () => {
    const replaceState = vi.fn()
    expect(
      stashIncoming({ pathname: RECEIVE_PATH, hash: '#abc_-1', search: '' }, { replaceState, state: { k: 1 } }),
    ).toBe(true)
    expect(sessionStorage.getItem(STASH_KEY)).toBe('abc_-1')
    expect(replaceState).toHaveBeenCalledWith({ k: 1 }, '', RECEIVE_PATH)
    expect(readStash()).toBe('abc_-1')
    clearStash()
    expect(readStash()).toBeNull()
  })

  it('leaves any other page or an empty fragment alone', () => {
    const replaceState = vi.fn()
    expect(stashIncoming({ pathname: '/coleccion', hash: '#abc', search: '' }, { replaceState, state: null })).toBe(
      false,
    )
    expect(stashIncoming({ pathname: RECEIVE_PATH, hash: '#', search: '' }, { replaceState, state: null })).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
    expect(readStash()).toBeNull()
  })

  it('refuses what is not the bookmarklet’s data', async () => {
    const encode = (bytes: Buffer) => bytes.toString('base64url')
    await expect(decodeIncoming('not base64!')).rejects.toThrow(/cortados/)
    await expect(decodeIncoming(encode(Buffer.from('plain')))).rejects.toThrow(/cortados/)
    await expect(decodeIncoming(encode(gzipSync('{nope')))).rejects.toThrow(/JSON/)
    // A small fragment that inflates past the cap.
    await expect(decodeIncoming(encode(gzipSync(Buffer.alloc(MAX_INFLATED + 1, 32))))).rejects.toThrow(/cortados/)
    expect(await decodeIncoming(encode(gzipSync(JSON.stringify({ ok: 1 }))))).toEqual({ ok: 1 })
  })
})
