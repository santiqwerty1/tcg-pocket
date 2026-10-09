#!/usr/bin/env node
// La mudanza (D-022, docs/MUDANZA.md), decisión de Santi: el repo nuevo sigue la numeración del viejo. Issues y PR
// comparten números en GitHub, así que antes del primer PR se crean issues marcadores hasta el último número del repo
// anterior, cada uno «Número reservado: PR #N del repo anterior», y se cierran enseguida. Sin asignar, etiquetar ni
// mencionar a nadie (no notifica de más). Idempotente: arranca desde el último número que ya existe en el repo nuevo.
// Sin --apply solo dice qué haría.
//
//   node scripts/reserve-numbers.mjs --repo santiqwerty1/tcg-pocket --from santiqwerty1/tcg-pocket-privado [--apply]
//   node scripts/reserve-numbers.mjs --repo santiqwerty1/tcg-pocket --upto 31 [--apply]
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    repo: { type: 'string' },
    from: { type: 'string' },
    upto: { type: 'string' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})
const usage = 'node scripts/reserve-numbers.mjs --repo <owner/nuevo> (--from <owner/viejo> | --upto <N>) [--apply]'
if (values.help || !values.repo || (!values.from && !values.upto)) {
  console.log(usage)
  process.exit(values.help ? 0 : 1)
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
/** The highest issue or PR number of a repository (0 when empty). */
const lastNumber = (repo) => {
  const top = gh([
    'api',
    `repos/${repo}/issues?state=all&per_page=1&sort=created&direction=desc`,
    '--jq',
    '.[0].number // 0',
  ])
  return Number(top || 0)
}

const MARKER = /^Número reservado: PR #(\d+) del repo anterior$/
/** Every issue and PR of the new repository (number, title, state, whether it is a PR). */
const existing = () =>
  gh([
    'api',
    '--paginate',
    `repos/${values.repo}/issues?state=all&per_page=100`,
    '--jq',
    '.[] | [.number, .state, (.pull_request != null), .title] | @tsv',
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [number, state, isPull, ...title] = line.split('\t')
      return { number: Number(number), state, isPull: isPull === 'true', title: title.join('\t') }
    })

const upto = values.upto ? Number(values.upto) : lastNumber(values.from)
if (!Number.isInteger(upto) || upto < 0) {
  console.error(`✗ número final inválido: ${values.upto ?? upto}`)
  process.exit(1)
}
// What is already there must be markers only (and in order): anything else (a PR of Dependabot, an issue) means
// the numbering already moved on, and reserving more would not make it follow the old repository's.
const present = existing().sort((a, b) => a.number - b.number)
const intruders = present.filter(
  (item) => item.number <= upto && (item.isPull || MARKER.exec(item.title)?.[1] !== String(item.number)),
)
if (intruders.length > 0) {
  console.error(
    `✗ En ${values.repo} hay números que no son marcadores: ${intruders.map((item) => `#${item.number} «${item.title}»`).join(', ')}. Reservá antes del primer push.`,
  )
  process.exit(1)
}
const openMarkers = present.filter((item) => item.state === 'open' && MARKER.test(item.title))
if (openMarkers.length > 0) {
  console.log(
    `${values.apply ? 'Cierro' : 'Cerraría'} ${openMarkers.length} marcadores abiertos de una corrida anterior.`,
  )
  if (values.apply)
    for (const item of openMarkers)
      gh(['issue', 'close', String(item.number), '--repo', values.repo, '--reason', 'not planned'])
}
const start = (present.at(-1)?.number ?? 0) + 1
if (start > upto) {
  console.log(`Nada que reservar: ${values.repo} ya llega al #${start - 1} (el viejo, al #${upto}).`)
  process.exit(0)
}
console.log(`${values.apply ? 'Reservo' : 'Reservaría'} del #${start} al #${upto} en ${values.repo}.`)
if (!values.apply) {
  console.log('Sin --apply no se crea nada.')
  process.exit(0)
}

const body =
  'Marcador de la mudanza al repo público (D-022): este número corresponde a un PR del repo anterior, que queda privado. Existe solo para que la numeración siga; está cerrado.'
for (let n = start; n <= upto; n++) {
  const url = gh([
    'issue',
    'create',
    '--repo',
    values.repo,
    '--title',
    `Número reservado: PR #${n} del repo anterior`,
    '--body',
    body,
  ])
  const created = Number(url.split('/').pop())
  if (created !== n) {
    console.error(`✗ se esperaba el #${n} y GitHub dio el #${created} (${url}): alguien creó algo en el medio. Paro.`)
    process.exit(1)
  }
  gh(['issue', 'close', String(n), '--repo', values.repo, '--reason', 'not planned'])
  console.log(`✓ #${n} reservado y cerrado`)
  // GitHub limits content creation bursts: one a second is well under it.
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
console.log(`Listo: el próximo PR de ${values.repo} va a ser el #${upto + 1}.`)
