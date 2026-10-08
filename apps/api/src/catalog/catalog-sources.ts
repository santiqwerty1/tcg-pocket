/**
 * Raw inputs of the catalog build (docs/PLAN.md §3.1): eight tracker files at the pinned commit plus deckgym's
 * `database.json` at the pinned rev, fetched from raw.githubusercontent.com or read from the domain fixtures
 * (`--from-fixtures`, offline and in tests). Every file is hashed (sha256) for the `catalog_syncs` record.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type BuildCatalogInput, engineCardsFromDatabaseJson, parseExpansionIds } from '@tcg/domain'
import { REPO_ROOT } from '../config/dotenv.js'

export const TRACKER_RAW_BASE = 'https://raw.githubusercontent.com/marcelpanse/tcg-pocket-collection-tracker'
export const ENGINE_RAW_BASE = 'https://raw.githubusercontent.com/bcollazo/deckgym-core'

export const TRACKER_PATHS = {
  cardsJson: 'frontend/assets/cards.json',
  pokemonTranslations: 'frontend/assets/pokemon_translations.json',
  trainersTranslations: 'frontend/assets/trainers_translations.json',
  toolsTranslations: 'frontend/assets/tools_translations.json',
  cardsDb: 'frontend/src/lib/CardsDB.ts',
  typesIndex: 'frontend/src/types/index.ts',
  esSets: 'frontend/public/locales/es-ES/common/sets.json',
  esPacks: 'frontend/public/locales/es-ES/common/packs.json',
} as const
export const ENGINE_PATH = 'database.json'

type TrackerFileKey = keyof typeof TRACKER_PATHS

/** Same files inside packages/domain/test/fixtures (see scripts/extract-fixtures.mjs). */
export const FIXTURE_PATHS: Record<TrackerFileKey, string> = {
  cardsJson: 'tracker/cards.json',
  pokemonTranslations: 'tracker/pokemon_translations.json',
  trainersTranslations: 'tracker/trainers_translations.json',
  toolsTranslations: 'tracker/tools_translations.json',
  cardsDb: 'tracker/CardsDB.ts',
  typesIndex: 'tracker/types.index.ts',
  esSets: 'tracker/es-ES.sets.json',
  esPacks: 'tracker/es-ES.packs.json',
}
export const FIXTURE_ENGINE_PATH = 'deckgym/engine-cards.json'
/** Missions (themed collections, Fase 8): one file per expansion that has them. */
export const MISSIONS_DIR = 'frontend/assets/themed-collections'
export const FIXTURE_MISSIONS_DIR = 'tracker/themed-collections'
export const DEFAULT_FIXTURES_DIR = resolve(REPO_ROOT, 'packages/domain/test/fixtures')

export interface SourceFile {
  /** Path inside the source repository (or the fixtures directory). */
  path: string
  sha256: string
  bytes: number
}

export interface CatalogPins {
  trackerCommit: string
  engineRev: string
}

export interface CatalogSources {
  input: BuildCatalogInput
  /** Keyed by logical name (cardsJson, …, engine). */
  files: Record<string, SourceFile>
}

export class CatalogSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogSourceError'
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function fileRecord(path: string, text: string): SourceFile {
  return { path, sha256: sha256Hex(text), bytes: Buffer.byteLength(text, 'utf8') }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new CatalogSourceError(`${what}: invalid JSON (${(error as Error).message})`)
  }
}

function assemble(
  pins: CatalogPins,
  texts: Record<TrackerFileKey, string>,
  engineCards: unknown,
  files: Record<string, SourceFile>,
  missions: Record<string, unknown> = {},
): CatalogSources {
  const input: BuildCatalogInput = {
    cardsJson: parseJson(texts.cardsJson, TRACKER_PATHS.cardsJson),
    translations: {
      pokemon: parseJson(texts.pokemonTranslations, TRACKER_PATHS.pokemonTranslations),
      trainers: parseJson(texts.trainersTranslations, TRACKER_PATHS.trainersTranslations),
      tools: parseJson(texts.toolsTranslations, TRACKER_PATHS.toolsTranslations),
    },
    cardsDbSource: texts.cardsDb,
    typesIndexSource: texts.typesIndex,
    esSets: parseJson(texts.esSets, TRACKER_PATHS.esSets),
    esPacks: parseJson(texts.esPacks, TRACKER_PATHS.esPacks),
    engineCards,
    trackerCommit: pins.trackerCommit,
    engineRev: pins.engineRev,
    missions,
  }
  return { input, files }
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** Downloads the pinned files (9 requests in parallel). */
export async function fetchCatalogSources(pins: CatalogPins, fetchImpl: FetchLike = fetch): Promise<CatalogSources> {
  const download = async (url: string): Promise<string> => {
    const response = await fetchImpl(url)
    if (!response.ok) throw new CatalogSourceError(`HTTP ${response.status} fetching ${url}`)
    return response.text()
  }
  const keys = Object.keys(TRACKER_PATHS) as TrackerFileKey[]
  const [trackerTexts, engineText] = await Promise.all([
    Promise.all(keys.map((key) => download(`${TRACKER_RAW_BASE}/${pins.trackerCommit}/${TRACKER_PATHS[key]}`))),
    download(`${ENGINE_RAW_BASE}/${pins.engineRev}/${ENGINE_PATH}`),
  ])
  const texts = {} as Record<TrackerFileKey, string>
  const files: Record<string, SourceFile> = {}
  keys.forEach((key, index) => {
    texts[key] = trackerTexts[index] as string
    files[key] = fileRecord(TRACKER_PATHS[key], texts[key])
  })
  files.engine = fileRecord(ENGINE_PATH, engineText)
  // Same reduction as scripts/extract-fixtures.mjs, so fixtures and live data produce identical catalogs.
  const engineCards = engineCardsFromDatabaseJson(parseJson(engineText, ENGINE_PATH))
  // Missions: one optional file per expansion (a 404 means the expansion has none).
  const missions: Record<string, unknown> = {}
  await Promise.all(
    parseExpansionIds(texts.typesIndex).map(async (id) => {
      const path = `${MISSIONS_DIR}/${id}-missions.json`
      const response = await fetchImpl(`${TRACKER_RAW_BASE}/${pins.trackerCommit}/${path}`)
      if (response.status === 404) return
      if (!response.ok) throw new CatalogSourceError(`HTTP ${response.status} fetching ${path}`)
      const text = await response.text()
      missions[id] = parseJson(text, path)
      files[`missions:${id}`] = fileRecord(path, text)
    }),
  )
  return assemble(pins, texts, engineCards, files, missions)
}

/** Reads the same files from packages/domain/test/fixtures (already reduced engine data). */
export function readFixtureSources(pins: CatalogPins, fixturesDir: string = DEFAULT_FIXTURES_DIR): CatalogSources {
  const read = (relative: string): string => {
    try {
      return readFileSync(join(fixturesDir, relative), 'utf8')
    } catch (error) {
      throw new CatalogSourceError(`cannot read fixture ${relative} in ${fixturesDir}: ${(error as Error).message}`)
    }
  }
  const keys = Object.keys(FIXTURE_PATHS) as TrackerFileKey[]
  const texts = {} as Record<TrackerFileKey, string>
  const files: Record<string, SourceFile> = {}
  for (const key of keys) {
    texts[key] = read(FIXTURE_PATHS[key])
    files[key] = fileRecord(FIXTURE_PATHS[key], texts[key])
  }
  const engineText = read(FIXTURE_ENGINE_PATH)
  files.engine = fileRecord(FIXTURE_ENGINE_PATH, engineText)
  const missions: Record<string, unknown> = {}
  const missionsDir = join(fixturesDir, FIXTURE_MISSIONS_DIR)
  if (existsSync(missionsDir)) {
    for (const file of readdirSync(missionsDir)
      .filter((name) => name.endsWith('-missions.json'))
      .sort()) {
      const text = read(`${FIXTURE_MISSIONS_DIR}/${file}`)
      const id = file.replace(/-missions\.json$/, '')
      missions[id] = parseJson(text, file)
      files[`missions:${id}`] = fileRecord(`${FIXTURE_MISSIONS_DIR}/${file}`, text)
    }
  }
  return assemble(pins, texts, parseJson(engineText, FIXTURE_ENGINE_PATH), files, missions)
}
