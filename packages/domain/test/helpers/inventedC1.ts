// FIXTURE INVENTADO: the real fixture catalog plus three made-up C1 cards with two types (fixtures/invented/README.md).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BuildCatalogInput,
  type BuildResult,
  buildCatalogWithReport,
  CatalogIndex,
  engineCardsFromDatabaseJson,
} from '../../src/index.js'
import { buildInput } from './loadFixtures.js'

export interface InventedC1 {
  expansion: Record<string, unknown>
  cards: Record<string, unknown>[]
  engine: unknown[]
}

export const invented = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'invented', 'c1-dual-type.json'), 'utf8'),
) as InventedC1

/** The real fixtures plus the invented C1: its expansion first in CardsDB and in `expansionIds`, its cards last. */
export function inputWithInventedC1(): BuildCatalogInput {
  const base = buildInput()
  const declaration = base.cardsDbSource.indexOf('export const expansions')
  const open = base.cardsDbSource.indexOf('= [', declaration) + '= ['.length
  const cardsDbSource = `${base.cardsDbSource.slice(0, open)}\n  ${JSON.stringify(invented.expansion)},${base.cardsDbSource.slice(open)}`
  const typesIndexSource = base.typesIndexSource.replace(
    'export const expansionIds = [',
    "export const expansionIds = [\n  'C1',",
  )
  return {
    ...base,
    cardsJson: [...(base.cardsJson as unknown[]), ...invented.cards],
    cardsDbSource,
    typesIndexSource,
    engineCards: [...(base.engineCards as unknown[]), ...engineCardsFromDatabaseJson(invented.engine)],
  }
}

let built: BuildResult | undefined
let index: CatalogIndex | undefined

/** The catalog index with the invented C1 cards (C1-1 psychic/fighting, C1-2 water/darkness, C1-3 water). */
export function inventedC1Index(): CatalogIndex {
  built ??= buildCatalogWithReport(inputWithInventedC1())
  index ??= new CatalogIndex(built.catalog)
  return index
}
