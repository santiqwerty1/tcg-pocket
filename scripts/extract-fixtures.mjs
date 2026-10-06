// Copies the pinned reference data from refs/ into packages/domain/test/fixtures (reproducible, run on demand).
// refs/ is not versioned; the fixtures are. Pins: docs/LICENCIAS.md.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tracker = join(root, 'refs/tracker')
const deckgym = join(root, 'refs/deckgym-core')
const out = join(root, 'packages/domain/test/fixtures')
mkdirSync(join(out, 'tracker'), { recursive: true })
mkdirSync(join(out, 'deckgym'), { recursive: true })

const copies = [
  ['frontend/assets/cards.json', 'tracker/cards.json'],
  ['frontend/assets/pokemon_translations.json', 'tracker/pokemon_translations.json'],
  ['frontend/assets/trainers_translations.json', 'tracker/trainers_translations.json'],
  ['frontend/assets/tools_translations.json', 'tracker/tools_translations.json'],
  ['frontend/src/lib/CardsDB.ts', 'tracker/CardsDB.ts'],
  ['frontend/src/types/index.ts', 'tracker/types.index.ts'],
  ['frontend/public/locales/es-ES/common/sets.json', 'tracker/es-ES.sets.json'],
  ['frontend/public/locales/es-ES/common/packs.json', 'tracker/es-ES.packs.json'],
]
for (const [src, dst] of copies) copyFileSync(join(tracker, src), join(out, dst))

// deckgym database.json is 2.6 MB; keep only what the catalog needs.
const db = JSON.parse(readFileSync(join(deckgym, 'database.json'), 'utf8'))
const compact = db.map((entry) => {
  const kind = Object.keys(entry)[0]
  const v = entry[kind]
  return kind === 'Pokemon'
    ? {
        id: v.id,
        kind: 'pokemon',
        name: v.name,
        stage: v.stage,
        evolvesFrom: v.evolves_from,
        hp: v.hp,
        energyType: v.energy_type,
        rarity: v.rarity,
      }
    : { id: v.id, kind: 'trainer', name: v.name, trainerType: v.trainer_card_type, rarity: v.rarity }
})
writeFileSync(join(out, 'deckgym/engine-cards.json'), `${JSON.stringify(compact)}\n`)
console.log(`fixtures written: ${copies.length} tracker files, ${compact.length} engine cards`)
