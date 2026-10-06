// Loads the real fixtures from disk once per worker and memoizes the built catalog; src/ never touches the disk.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BuildCatalogInput, type BuildResult, buildCatalogWithReport, CatalogIndex } from '../../src/index.js'

export const TRACKER_COMMIT = '3ab58f1cec6a03e3e85455cf7aade3bb8561f92e'
export const ENGINE_REV = 'fb792ebfbaca995af9750c28101ce92a51282825'

const fixturesDir = join(import.meta.dirname, '..', 'fixtures')
const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
export const COLLECTION_CSV_PATH = join(repoRoot, 'docs/context/tcgcollectiontracterexport-2026-10-06.csv')

export interface Fixtures {
  cardsJson: unknown
  pokemonTranslations: unknown
  trainersTranslations: unknown
  toolsTranslations: unknown
  cardsDbSource: string
  typesIndexSource: string
  esSets: unknown
  esPacks: unknown
  enSets: unknown
  enPacks: unknown
  engineCards: unknown
}

function readText(relative: string): string {
  return readFileSync(join(fixturesDir, relative), 'utf8')
}

function readJson(relative: string): unknown {
  return JSON.parse(readText(relative))
}

let fixtures: Fixtures | undefined
export function loadFixtures(): Fixtures {
  fixtures ??= {
    cardsJson: readJson('tracker/cards.json'),
    pokemonTranslations: readJson('tracker/pokemon_translations.json'),
    trainersTranslations: readJson('tracker/trainers_translations.json'),
    toolsTranslations: readJson('tracker/tools_translations.json'),
    cardsDbSource: readText('tracker/CardsDB.ts'),
    typesIndexSource: readText('tracker/types.index.ts'),
    esSets: readJson('tracker/es-ES.sets.json'),
    esPacks: readJson('tracker/es-ES.packs.json'),
    enSets: readJson('tracker/en-US.sets.json'),
    enPacks: readJson('tracker/en-US.packs.json'),
    engineCards: readJson('deckgym/engine-cards.json'),
  }
  return fixtures
}

export function buildInput(): BuildCatalogInput {
  const f = loadFixtures()
  return {
    cardsJson: f.cardsJson,
    translations: { pokemon: f.pokemonTranslations, trainers: f.trainersTranslations, tools: f.toolsTranslations },
    cardsDbSource: f.cardsDbSource,
    typesIndexSource: f.typesIndexSource,
    esSets: f.esSets,
    esPacks: f.esPacks,
    enSets: f.enSets,
    enPacks: f.enPacks,
    engineCards: f.engineCards,
    trackerCommit: TRACKER_COMMIT,
    engineRev: ENGINE_REV,
  }
}

let built: BuildResult | undefined
export function builtCatalog(): BuildResult {
  built ??= buildCatalogWithReport(buildInput())
  return built
}

let index: CatalogIndex | undefined
export function catalogIndex(): CatalogIndex {
  index ??= new CatalogIndex(builtCatalog().catalog)
  return index
}

export interface CollectionCsvRow {
  Id: string
  CardName: string
  InternalId: number
  NumberOwned: number
  Expansion: string
  Pack: string
  Rarity: string
  Collected: boolean
}

/** The real collection export (BOM, LF, no quotes, 8 columns), used here only to assert names. */
export function loadCollectionCsv(): CollectionCsvRow[] {
  const text = readFileSync(COLLECTION_CSV_PATH, 'utf8').replace(/^﻿/, '')
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line !== '')
  if (header !== 'Id,CardName,InternalId,NumberOwned,Expansion,Pack,Rarity,Collected') {
    throw new Error(`Unexpected CSV header: ${header}`)
  }
  return lines.map((line) => {
    const [Id, CardName, InternalId, NumberOwned, Expansion, Pack, Rarity, Collected] = line.split(',')
    return {
      Id: Id as string,
      CardName: CardName as string,
      InternalId: Number(InternalId),
      NumberOwned: Number(NumberOwned),
      Expansion: Expansion as string,
      Pack: Pack as string,
      Rarity: Rarity as string,
      Collected: Collected === 'TRUE',
    }
  })
}
