#!/usr/bin/env node
// La mudanza al repo público (D-022, docs/MUDANZA.md): arma en una carpeta un repositorio nuevo con UN solo commit,
// sin historial, con el árbol de <ref> (por defecto origin/main) y firmado con la dirección noreply de GitHub de la
// cuenta de `gh` (o la que se pase). Con --version (Santi: 1.0.0) pone esa versión en los package.json de la copia,
// crea el tag v<versión> y escribe las notas del release (desde Avance: fases 0 a 44) en --notes. No crea, renombra
// ni empuja repositorios remotos: eso es un paso aparte, con el OK de Santi. Con --verify revisa la copia.
//
//   node scripts/public-repo.mjs [--ref origin/main] [--out <carpeta>] [--version 1.0.0] [--notes <archivo>]
//                                [--name "…"] [--email "…"] [--verify] [--force]
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    ref: { type: 'string', default: 'origin/main' },
    out: { type: 'string' },
    version: { type: 'string' },
    notes: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
    verify: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})
if (values.help) {
  console.log(
    'node scripts/public-repo.mjs [--ref origin/main] [--out <carpeta>] [--version 1.0.0] [--notes <archivo>] [--name "…"] [--email "…"] [--verify] [--force]',
  )
  process.exit(0)
}
if (values.version && !/^\d+\.\d+\.\d+$/.test(values.version)) {
  console.error('✗ --version tiene que ser x.y.z')
  process.exit(1)
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}
const ok = (message) => console.log(`✓ ${message}`)

// 1. What goes: the tree of the ref, exactly (git archive: tracked files only, nothing ignored or local).
const sha = run('git', ['rev-parse', '--verify', `${values.ref}^{commit}`])
const out = values.out ?? join(tmpdir(), `tcg-pocket-public-${sha.slice(0, 7)}`)
if (existsSync(out) && readdirSync(out).length > 0) {
  if (!values.force) fail(`${out} ya existe y no está vacía (--force la borra).`)
  rmSync(out, { recursive: true, force: true })
}
mkdirSync(out, { recursive: true })
const tarFile = join(tmpdir(), `tcg-pocket-public-${sha.slice(0, 7)}.tar`)
run('git', ['archive', '--format=tar', `--output=${tarFile}`, sha])
// Windows' own bsdtar (Git Bash puts GNU tar first in the PATH, which misreads «C:\…» paths).
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
run(tar, ['-xf', tarFile, '-C', out])
rmSync(tarFile, { force: true })
ok(`árbol de ${sha.slice(0, 7)} (${values.ref}) en ${out}`)

// 2. The version (Santi: the public repository starts at 1.0.0), only the "version" field of each package.json.
const versioned = []
if (values.version) {
  const manifests = [
    'package.json',
    ...['apps', 'packages'].flatMap((dir) =>
      existsSync(join(out, dir))
        ? readdirSync(join(out, dir))
            .map((name) => `${dir}/${name}/package.json`)
            .filter((file) => existsSync(join(out, file)))
        : [],
    ),
  ]
  for (const file of manifests) {
    const path = join(out, file)
    const text = readFileSync(path, 'utf8')
    const next = text.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${values.version}$2`)
    if (next === text && !/"version":/.test(text)) continue
    writeFileSync(path, next)
    versioned.push(file)
  }
  ok(`versión ${values.version} en ${versioned.join(', ')}`)
}

// 3. Who signs: the GitHub noreply address of the `gh` account, unless given.
let name = values.name
let email = values.email
if (!name || !email) {
  const user = JSON.parse(run('gh', ['api', 'user']))
  name ??= run('git', ['config', 'user.name']) || user.login
  email ??= `${user.id}+${user.login}@users.noreply.github.com`
}
if (!email.endsWith('@users.noreply.github.com')) console.warn(`! ${email} no es una dirección noreply de GitHub`)

// 4. One commit, no history (and the tag of the version).
const identity = {
  GIT_AUTHOR_NAME: name,
  GIT_AUTHOR_EMAIL: email,
  GIT_COMMITTER_NAME: name,
  GIT_COMMITTER_EMAIL: email,
}
const git = (args, env = {}) => run('git', args, { cwd: out, env: { ...process.env, ...identity, ...env } })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.name', name])
git(['config', 'user.email', email])
git(['config', 'core.autocrlf', 'false'])
git(['add', '-A'])
// The executable bit of the source tree (Windows does not keep it on disk: docker/migrate.sh, for instance).
const executables = run('git', ['ls-tree', '-r', sha])
  .split('\n')
  .filter((line) => line.startsWith('100755 '))
  .map((line) => line.split('\t')[1])
  .filter(Boolean)
if (executables.length > 0) git(['update-index', '--chmod=+x', ...executables])
const when = new Date().toISOString()
const title = values.version ? `TCG Pocket ${values.version}` : 'Initial public commit'
git(['commit', '-q', '-m', `${title}\n\nThe tree of ${sha} of the private repository, without its history (D-022).`], {
  GIT_AUTHOR_DATE: when,
  GIT_COMMITTER_DATE: when,
})
const newSha = git(['rev-parse', 'HEAD'])
const files = git(['ls-files']).split('\n').filter(Boolean)
ok(`commit ${newSha.slice(0, 7)} de ${name} <${email}>: ${files.length} archivos`)

// Same tree as the source, but for the version fields.
const entries = (lines) =>
  new Map(
    lines
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [meta, path] = line.split('\t')
        return [path, meta]
      }),
  )
const source = entries(run('git', ['ls-tree', '-r', sha]))
const copy = entries(git(['ls-tree', '-r', 'HEAD']))
const differ = [...new Set([...source.keys(), ...copy.keys()])].filter(
  (path) => source.get(path) !== copy.get(path) && !versioned.includes(path),
)
if (differ.length > 0) fail(`el árbol nuevo difiere del de origen en: ${differ.slice(0, 10).join(', ')}`)
ok(
  versioned.length > 0
    ? `mismo árbol que ${sha.slice(0, 7)}, salvo la versión de ${versioned.length} package.json`
    : `mismo árbol que ${sha.slice(0, 7)}: los rebase con --onto no van a tener conflictos`,
)

if (values.version) {
  git(['tag', '-a', `v${values.version}`, '-m', title], { GIT_COMMITTER_DATE: when })
  ok(`tag v${values.version}`)
}

// 5. Release notes from Avance: the phases with their title (links reduced to their text).
if (values.notes) {
  const avance = readFileSync(join(out, 'Boveda/Seguimiento/Avance.md'), 'utf8')
  const phases = [...avance.matchAll(/^\| (\d+) \| ([^|]+?) \| ([^|]+?) \|/gm)].map((match) => ({
    n: Number(match[1]),
    title: match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
  }))
  const lines = [
    `# ${title}`,
    '',
    'Primera versión pública (D-022): la app personal de Pokémon TCG Pocket — colección, mazos y partidas, sobres, torneos de Limitless, simulaciones con el motor deckgym, laboratorio de mazos y el conector de Claude (MCP). Licencia AGPL-3.0.',
    '',
    `## Qué trae (fases ${phases[0]?.n ?? 0} a ${phases.at(-1)?.n ?? 0})`,
    '',
    ...phases.map((phase) => `- Fase ${phase.n}: ${phase.title}`),
    '',
    'El historial de desarrollo anterior a esta versión queda en el repositorio privado. Las decisiones y su porqué están en `docs/DECISIONES.md` y en la bóveda (`Boveda/`).',
    '',
  ]
  writeFileSync(values.notes, lines.join('\n'))
  ok(`notas del release (${phases.length} fases) en ${values.notes}`)
}

if (!values.verify) process.exit(0)

// 6. The copy: the vault passes, and nothing that must not travel is in it.
const posta = spawnSync('posta check .', { cwd: out, encoding: 'utf8', shell: true })
if (posta.error || posta.status === null) console.warn('! posta no está en el PATH: la bóveda no se validó')
else if (posta.status !== 0) console.warn(`! posta check falló en la copia:\n${posta.stdout}${posta.stderr}`)
else ok('posta check sin errores en la copia')
const forbidden = [
  { what: 'archivos .env', test: (file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example') },
  { what: 'imágenes de cartas', test: (file) => /\.(png|webp|jpe?g)$/i.test(file) && /card|carta/i.test(file) },
]
for (const rule of forbidden) {
  const hits = files.filter(rule.test)
  if (hits.length > 0) console.warn(`! ${rule.what}: ${hits.slice(0, 5).join(', ')}`)
  else ok(`sin ${rule.what}`)
}
const big = files
  .map((file) => ({ file, size: statSync(join(out, file)).size }))
  .filter((entry) => entry.size > 5 * 1024 * 1024)
if (big.length > 0) console.warn(`! archivos de más de 5 MB: ${big.map((entry) => entry.file).join(', ')}`)
else ok('sin archivos de más de 5 MB')
const text = (file) => {
  try {
    return readFileSync(join(out, file), 'utf8')
  } catch {
    return ''
  }
}
const personal = files.filter((file) => /@gmail\.com|@hotmail\.|@outlook\./i.test(text(file)))
if (personal.length > 0) console.warn(`! mails personales en: ${personal.join(', ')}`)
else ok('sin mails personales en el árbol')
console.log(`Listo para revisar en ${out}. No se creó ni se empujó nada.`)
