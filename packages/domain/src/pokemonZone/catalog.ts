/**
 * pokemon-zone's codes in the app's terms: its rarity codes and its pack ids. Expansion ids are the same in both
 * («A1», «B4b», «C1»), so only the packs of an expansion need matching.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import type { Rarity } from '../catalog/types.js'

/**
 * pokemon-zone's rarity codes. Super Rare and Special Art Rare are both ☆☆ in the game; Immersive is ☆☆☆, Shiny ✵,
 * Shiny Super Rare ✵✵ and Crown Rare the crown. A code missing here (pokemon-zone also lists «AN») has no rarity of
 * the app: it is counted apart.
 */
export const POKEMON_ZONE_RARITY: Readonly<Record<string, Rarity>> = {
  C: '◊',
  U: '◊◊',
  R: '◊◊◊',
  RR: '◊◊◊◊',
  AR: '☆',
  SR: '☆☆',
  SAR: '☆☆',
  IM: '☆☆☆',
  S: '✵',
  SSR: '✵✵',
  UR: 'Crown Rare',
}

export function pokemonZoneRarity(code: string): Rarity | null {
  return POKEMON_ZONE_RARITY[code] ?? null
}

/** Letters and digits only, without accents: «Ho-Oh» and «ho-ohpack» meet at «hooh». */
function squash(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export interface PokemonZonePackRef {
  /** The app's pack («A1/mewtwopack»), or null when none matches. */
  packId: string | null
  nameEs: string | null
}

/**
 * The app's pack of a pokemon-zone pack: an expansion with a single pack is that pack whatever its name («Deluxe
 * Pack: Mega» is B4b's only one); with several, the part of the name after the last colon («Genetic Apex: Mewtwo»)
 * against the pack's tracker name without «pack» («mewtwopack») or its Spanish name.
 */
export function pokemonZonePack(
  index: CatalogIndex,
  pack: { expansionId: string | null; nameEn: string },
): PokemonZonePackRef {
  if (!pack.expansionId) return { packId: null, nameEs: null }
  const packs = index.catalog.packs.filter((item) => item.expansionId === pack.expansionId && item.name !== 'everypack')
  const only = packs.length === 1 ? packs[0] : undefined
  if (only) return { packId: only.id, nameEs: only.nameEs }
  const colon = pack.nameEn.lastIndexOf(':')
  const wanted = squash(colon === -1 ? pack.nameEn : pack.nameEn.slice(colon + 1))
  if (wanted === '') return { packId: null, nameEs: null }
  const found =
    packs.find((item) => squash(item.name.replace(/pack$/, '')) === wanted) ??
    packs.find((item) => squash(item.nameEs) === wanted)
  return found ? { packId: found.id, nameEs: found.nameEs } : { packId: null, nameEs: null }
}
