/**
 * Resolves a card name written without an edition code (the Spanish list format) to a functional group.
 * Lookups are case- and accent-insensitive (`foldText`); the Spanish name is tried first, the English one as a
 * fallback (es↔en is 1:1 in the catalog, PLAN I5). Built once per CatalogIndex and memoized.
 */
import type { CatalogIndex } from '../catalog/catalogIndex.js'
import { foldText } from '../catalog/normalize.js'
import type { CardId, FunctionalGroup } from '../catalog/types.js'

export type NameResolution =
  | { kind: 'ok'; group: FunctionalGroup; cardId: CardId }
  | { kind: 'ambiguous'; groups: FunctionalGroup[]; candidates: string[] }
  | { kind: 'unknown'; suggestions: string[] }

const MAX_SUGGESTIONS = 3
/** Below this length a "contains" match would list half the catalog; only prefixes are offered. */
const MIN_CONTAINS_LENGTH = 3

interface NameEntry {
  display: string
  folded: string
}

export class DeckNameResolver {
  private readonly groupsByEs = new Map<string, FunctionalGroup[]>()
  private readonly groupsByEn = new Map<string, FunctionalGroup[]>()
  private readonly names: NameEntry[] = []

  constructor(readonly index: CatalogIndex) {
    const seen = new Set<string>()
    for (const group of index.catalog.groups) {
      push(this.groupsByEs, foldText(group.nameEs), group)
      push(this.groupsByEn, foldText(group.nameEn), group)
      for (const display of [group.nameEs, group.nameEn]) {
        const folded = foldText(display)
        if (seen.has(folded)) continue
        seen.add(folded)
        this.names.push({ display: group.nameEs, folded })
      }
    }
  }

  /** Groups whose Spanish name equals `name` (folded); falls back to the English name. */
  groupsByName(name: string): FunctionalGroup[] {
    const folded = foldText(name)
    return this.groupsByEs.get(folded) ?? this.groupsByEn.get(folded) ?? []
  }

  /** True when more than one functional group shares this Spanish name (the writer must then add the code). */
  isAmbiguousNameEs(nameEs: string): boolean {
    return (this.groupsByEs.get(foldText(nameEs)) ?? []).length > 1
  }

  resolve(name: string): NameResolution {
    const groups = this.groupsByName(name)
    if (groups.length === 1) {
      const group = groups[0] as FunctionalGroup
      return { kind: 'ok', group, cardId: group.displayCardId }
    }
    if (groups.length > 1) {
      return { kind: 'ambiguous', groups, candidates: groups.map((g) => `${g.nameEs} (${g.displayCardId})`) }
    }
    return { kind: 'unknown', suggestions: this.suggest(name) }
  }

  /** Up to 3 Spanish names close to `name`: shared prefix first, then one containing the other. */
  suggest(name: string, limit = MAX_SUGGESTIONS): string[] {
    const query = foldText(name)
    if (query === '') return []
    const scored: { entry: NameEntry; score: number; distance: number }[] = []
    for (const entry of this.names) {
      let score = 0
      if (entry.folded.startsWith(query) || query.startsWith(entry.folded)) score = 2
      else if (query.length >= MIN_CONTAINS_LENGTH && (entry.folded.includes(query) || query.includes(entry.folded)))
        score = 1
      if (score === 0) continue
      scored.push({ entry, score, distance: Math.abs(entry.folded.length - query.length) })
    }
    scored.sort(
      (a, b) => b.score - a.score || a.distance - b.distance || a.entry.display.localeCompare(b.entry.display),
    )
    const out: string[] = []
    for (const hit of scored) {
      if (!out.includes(hit.entry.display)) out.push(hit.entry.display)
      if (out.length >= limit) break
    }
    return out
  }
}

function push(map: Map<string, FunctionalGroup[]>, key: string, group: FunctionalGroup): void {
  const list = map.get(key)
  if (list) list.push(group)
  else map.set(key, [group])
}

const resolvers = new WeakMap<CatalogIndex, DeckNameResolver>()

export function nameResolverFor(index: CatalogIndex): DeckNameResolver {
  let resolver = resolvers.get(index)
  if (!resolver) {
    resolver = new DeckNameResolver(index)
    resolvers.set(index, resolver)
  }
  return resolver
}
