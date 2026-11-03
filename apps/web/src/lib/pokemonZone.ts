/**
 * pokemon-zone (2/11/2026): the bookmarklet that reads the owner's game data on pokemon-zone.com and the way it reaches
 * the app. pokemon-zone's JSON answers only a real browser, so the app's server cannot read it, and the browser cannot
 * send it to the app's API from another site (cookies and the cross-site check). So the bookmarklet compresses it
 * (gzip, base64url) and opens `<app>/coleccion/pokemon-zone/recibir#<data>`: the fragment never goes to a server
 * (nor to its logs), it works on a phone without popups, and the app then sends it to its own API with the session.
 *
 * The page reads the fragment as soon as the app starts (`stashIncoming`, before anything could send it to the login
 * page), keeps it in sessionStorage and clears it from the address bar.
 */
import { formatNumber, plural } from './format'
import { formatInterval, formatRateValue } from './matches'

export const RECEIVE_PATH = '/coleccion/pokemon-zone/recibir'
export const STASH_KEY = 'tcg.pokemon-zone.incoming'
/** Pack hourglasses per pack (one hour each; @tcg/domain `HOURGLASSES_PER_PACK`). */
export const HOURGLASSES_PER_PACK = 12

/**
 * The bookmarklet for an app served at `origin`. It runs on pokemon-zone.com with the owner's cookies, reads
 * `/api/players/mine/` and `/api/players/<friendId>/stats/` and keeps only the fields the app reads, field by field
 * (review of pz/import: nothing pokemon-zone adds later — a name, an id — lands in the URL, sessionStorage or the
 * history): the player's read date and level (the friend id goes only as its SHA-256), the resources the app reads
 * (pack points, hourglasses, three currencies, the promo coupons), the headline and battle counters it reads, packs per
 * expansion and per pack, and cards by rarity. It opens the app with them in the fragment. ASCII only, and no «%» nor
 * «#»: a bookmark's address would encode, decode or cut them.
 */
export function bookmarkletCode(origin: string): string {
  const app = JSON.stringify(origin.replace(/\/+$/, ''))
  const receive = JSON.stringify(RECEIVE_PATH)
  return [
    // `void`: a browser that shows what a javascript: address returns would replace the page with the promise.
    'javascript:void(async()=>{',
    `const A=${app};`,
    'try{',
    'if(!/(^|\\.)pokemon-zone\\.com$/.test(location.hostname))throw new Error("Abr\\u00ed pokemon-zone.com y toc\\u00e1 el marcador ah\\u00ed.");',
    'const g=async u=>{const r=await fetch(u,{credentials:"include",headers:{Accept:"application/json"}});',
    'if(!r.ok)throw new Error(u+" respondi\\u00f3 "+r.status+(r.status===401||r.status===403?". Inici\\u00e1 sesi\\u00f3n en pokemon-zone.com.":""));',
    'return(await r.json()).data};',
    'const m=await g("/api/players/mine/");const p=m&&m.player;',
    'if(!p||!p.friendId)throw new Error("No encontr\\u00e9 tu cuenta. Inici\\u00e1 sesi\\u00f3n en pokemon-zone.com.");',
    'const s=await g("/api/players/"+encodeURIComponent(p.friendId)+"/stats/");',
    // Review of #170: without its stats (never synced), a message in Spanish, not «Cannot read properties of undefined».
    // The read date as the server takes it: the stats', or else the player's (`lastUpdatedAt`).
    'if(!s||!(s.syncedAt||p.lastUpdatedAt))throw new Error("pokemon-zone no devolvi\\u00f3 tus estad\\u00edsticas; toc\\u00e1 Sync en tu perfil y prob\\u00e1 de nuevo.");',
    'const h=[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(p.friendId))))].map(x=>x.toString(16).padStart(2,"0")).join("");',
    // L: a list or none; K: items {key, value}, only those keys when given; F: those fields of each item.
    'const L=a=>Array.isArray(a)?a:[];',
    'const F=(a,f)=>L(a).map(x=>Object.fromEntries(f.map(k=>[k,x&&x[k]])));',
    'const K=(a,k)=>F(L(a).filter(x=>x&&(!k||k.includes(x.key))),["key","value"]);',
    'const r=m.resourceData||{};const c=["REGULAR_CHARGER_LARGE"];',
    'const H=["packs_opened","cards_obtained","unique_cards","wonder_picks","trades"];',
    'const B=["pvp_battles","pvp_wins","ranked_battles","ranked_wins","ranked_points","solo_battles","solo_wins","rental_deck_battles","rental_deck_wins"];',
    // Version 2 (pz/luck): also the tickets for a pack with a guaranteed card.
    'const b={v:2,mine:{player:{accountHash:h,lastUpdatedAt:p.lastUpdatedAt,level:p.level},resourceData:{',
    'currencies:K(r.currencies,["SHOP_TICKET","BRIGHT_SAND","SUBSCRIPTION_TICKET"]),',
    'tickets:F(L(r.tickets).filter(x=>x&&/^\\s*promo card exchange tickets?\\b|guaranteed booster pack exchange tickets?\\b/i.test(String(x.name))),["key","value","name"]),',
    'packCeilPoints:K(r.packCeilPoints),packPowerChargers:K(r.packPowerChargers,c),challengePowerChargers:K(r.challengePowerChargers,c),',
    'tradePowerChargers:K(r.tradePowerChargers),eventPowerChargers:K(r.eventPowerChargers),revivalClocks:K(r.revivalClocks)}},',
    'stats:{syncedAt:s.syncedAt,',
    'headline:F(L(s.headline).filter(x=>x&&H.includes(x.id)),["id","value"]),',
    'battles:F(L(s.battles).filter(x=>x&&B.includes(x.id)),["id","value"]),',
    'packsByExpansion:F(s.packsByExpansion,["expansionId","name","packsOpened","cardsObtained"]),',
    'packs:F(s.packs,["packId","name","expansionId","opened"]),',
    'cardsByRarity:F(s.cardsByRarity,["rarity","obtained"])}};',
    'const z=new Blob([JSON.stringify(b)]).stream().pipeThrough(new CompressionStream("gzip"));',
    'const y=new Uint8Array(await new Response(z).arrayBuffer());let t="";',
    'for(let i=0;i<y.length;i+=32768)t+=String.fromCharCode.apply(null,y.subarray(i,i+32768));',
    `location.href=A+${receive}+String.fromCharCode(35)+btoa(t).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")`,
    '}catch(e){alert("TCG Pocket: "+e.message)}})()',
  ].join('')
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * At start-up: data in the fragment of the receiving page goes to sessionStorage and leaves the address bar (and the
 * history entry). Returns whether it took something.
 */
export function stashIncoming(
  location: Pick<Location, 'pathname' | 'hash' | 'search'> = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): boolean {
  if (location.pathname.replace(/\/+$/, '') !== RECEIVE_PATH || location.hash.length <= 1) return false
  const data = location.hash.slice(1)
  try {
    storage()?.setItem(STASH_KEY, data)
  } catch {
    // Storage full or blocked: the page says there is nothing to read.
  }
  history.replaceState(history.state, '', `${RECEIVE_PATH}${location.search}`)
  return true
}

export function readStash(): string | null {
  try {
    return storage()?.getItem(STASH_KEY) ?? null
  } catch {
    return null
  }
}

export function clearStash(): void {
  try {
    storage()?.removeItem(STASH_KEY)
  } catch {
    // Nothing stored.
  }
}

/** base64url (no padding) → bytes. */
function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** At most this much JSON once inflated (the payload is ~20–60 KB). */
export const MAX_INFLATED = 2 * 1024 * 1024

/** The bookmarklet's data back as JSON; throws with a message in Spanish when it is not that. */
export async function decodeIncoming(data: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(data)) throw new Error('Los datos recibidos están cortados o no son del marcador.')
  let text: string
  try {
    const body = new Response(fromBase64Url(data) as BodyInit).body
    if (!body) throw new Error('empty')
    const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_INFLATED) {
        await reader.cancel()
        throw new Error('too large')
      }
      chunks.push(value)
    }
    const all = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      all.set(chunk, at)
      at += chunk.byteLength
    }
    text = new TextDecoder().decode(all)
  } catch {
    throw new Error('Los datos recibidos están cortados o no son del marcador.')
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('Los datos recibidos no son JSON.')
  }
}

/** A counter of the game as the API answers it (`GameCounterView` of @tcg/domain). */
export interface GameCounterText {
  battles: number
  wins: number
  rate: number | null
  ci95: readonly [number, number] | null
  orientative: boolean
}

/** «47,1 % (160 V en 340 partidas, IC 41,8–52,4 %)»: the game's counters are wins over battles. */
export function gameRateText(counter: GameCounterText | null): string {
  if (!counter) return 'sin datos'
  if (counter.rate === null || !counter.ci95) return 'sin partidas'
  const games = plural(counter.battles, 'partida', 'partidas')
  const parts = [`${formatNumber(counter.wins)} V en ${games}`, `IC ${formatInterval(counter.ci95)}`]
  if (counter.orientative) parts.push('orientativo')
  return `${formatRateValue(counter.rate)} (${parts.join(', ')})`
}

/** «2 cupones · Evento botín bis PROMO 2026», or the game's English name in quotes. */
export function couponLine(coupon: { count: number; nameEs: string | null; event: string }): string {
  const event = coupon.nameEs ?? `«${coupon.event}» (nombre del juego en inglés)`
  return `${plural(coupon.count, 'cupón', 'cupones')} · ${event}`
}
