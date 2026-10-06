// The 40 real decks of docs/context/mazos_40_listas.md and the playable copies of the 6/10 collection export,
// memoized per worker. The copies are computed here with a tiny test-only reduction (dedupe CSV rows by
// InternalId, sum NumberOwned per functional group) so these tests do not depend on src/collection.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DeckDraft, parseSpanishDeckFile, type SpanishFileDeck } from '../../src/decks/index.js'
import type { CardId } from '../../src/index.js'
import { catalogIndex, loadCollectionCsv } from './loadFixtures.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
export const DECKS_MD_PATH = join(repoRoot, 'docs/context/mazos_40_listas.md')

let markdown: string | undefined
export function loadDecksMarkdown(): string {
  markdown ??= readFileSync(DECKS_MD_PATH, 'utf8')
  return markdown
}

let parsed: SpanishFileDeck[] | undefined
export function parsedDecks(): SpanishFileDeck[] {
  parsed ??= parseSpanishDeckFile(loadDecksMarkdown(), catalogIndex())
  return parsed
}

/** Draft of deck `number`; throws when it did not parse (the parse tests report the details). */
export function deckDraft(number: number): DeckDraft {
  const deck = parsedDecks().find((d) => d.number === number)
  if (!deck?.draft) throw new Error(`deck ${number} did not parse: ${JSON.stringify(deck?.errors)}`)
  return deck.draft
}

/** The raw `- Pokémon:` / `- Entrenadores:` lines of deck `number`, as written in the file. */
export function deckLines(number: number): { pokemon: string; trainers: string } {
  const text = loadDecksMarkdown()
  const start = text.indexOf(`\n### ${number}. `)
  if (start < 0) throw new Error(`deck ${number} not found`)
  const end = text.indexOf('\n#', start + 1)
  const section = text.slice(start, end < 0 ? undefined : end)
  const pokemon = /^- Pokémon: .*$/mu.exec(section)?.[0]
  const trainers = /^- Entrenadores: .*$/mu.exec(section)?.[0]
  if (!pokemon || !trainers) throw new Error(`deck ${number} has no Pokémon/Entrenadores lines`)
  return { pokemon, trainers }
}

let playable: Map<CardId, number> | undefined
/** Playable copies per functional group from the CSV: one row per InternalId, summed by group. */
export function playableByGroupFromCsv(): Map<CardId, number> {
  if (playable) return playable
  const index = catalogIndex()
  const seen = new Set<number>()
  const byGroup = new Map<CardId, number>()
  for (const row of loadCollectionCsv()) {
    if (seen.has(row.InternalId)) continue
    seen.add(row.InternalId)
    const card = index.cardById(row.Id)
    if (!card) throw new Error(`CSV row ${row.Id} is not in the catalog`)
    byGroup.set(card.functionalGroupId, (byGroup.get(card.functionalGroupId) ?? 0) + row.NumberOwned)
  }
  playable = byGroup
  return playable
}
