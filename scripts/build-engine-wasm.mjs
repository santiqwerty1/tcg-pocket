#!/usr/bin/env node
/**
 * The engine of the browser (T-015): engine/wasm compiled to WebAssembly, ready for the PWA in
 * `apps/web/public/engine/` (not versioned, like the viewer; the Docker build makes it in its `wasm-engine` stage).
 *
 *   node scripts/build-engine-wasm.mjs               cargo (wasm32-unknown-unknown) + wasm-bindgen + the files below
 *   node scripts/build-engine-wasm.mjs --from <dir>  only the files below, from wasm-bindgen's output (engine.js,
 *                                                    engine_bg.wasm), as the Docker build does
 *   --out <dir>                                      somewhere else than apps/web/public/engine
 *
 * Writes `engine-<hash>.js` and `engine-<hash>_bg.wasm` (a new build is a new name: no stale copy in a cache),
 * `manifest.json` (what the Web Worker reads first) and `engine-src-<version>.tar.gz`, the source of what is served
 * (AGPL-3.0, docs/LICENCIAS.md). Needs Rust with `rustup target add wasm32-unknown-unknown` and wasm-bindgen-cli at
 * the version of engine/wasm/Cargo.lock (`cargo install wasm-bindgen-cli --version <v> --locked`, or WASM_BINDGEN).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CRATE = join(ROOT, 'engine', 'wasm')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const out = resolve(argument('--out', join(ROOT, 'apps', 'web', 'public', 'engine')))
const from = argument('--from', null)

const manifestText = readFileSync(join(CRATE, 'Cargo.toml'), 'utf8')
const engineRev = /deckgym\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]{40})"/.exec(manifestText)?.[1]
const version = /^version\s*=\s*"([^"]+)"/m.exec(manifestText)?.[1]
if (!engineRev || !version) throw new Error('No encontré el rev de deckgym o la versión en engine/wasm/Cargo.toml')
// How its games play: engine-cli's GAMES_REV, which the browser's engine compiles too (engine/src/seeds.rs).
const gamesRevText = /pub const GAMES_REV: u32 = (\d+);/.exec(
  readFileSync(join(ROOT, 'engine', 'src', 'seeds.rs'), 'utf8'),
)
if (!gamesRevText) throw new Error('No encontré GAMES_REV en engine/src/seeds.rs')
const gamesRev = Number(gamesRevText[1])
const lock = readFileSync(join(CRATE, 'Cargo.lock'), 'utf8')
const bindgenVersion = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1]
if (!bindgenVersion) throw new Error('engine/wasm/Cargo.lock no tiene wasm-bindgen')

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })

/** cargo + wasm-bindgen into a temporary folder; returns it. */
function compile() {
  const bindgen = process.env.WASM_BINDGEN ?? 'wasm-bindgen'
  let found = ''
  try {
    found = execFileSync(bindgen, ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    // reported below
  }
  if (found !== `wasm-bindgen ${bindgenVersion}`) {
    throw new Error(
      `Hace falta wasm-bindgen ${bindgenVersion} (encontré «${found || 'nada'}»): ` +
        `cargo install wasm-bindgen-cli --version ${bindgenVersion} --locked, o WASM_BINDGEN=<ruta>.`,
    )
  }
  run('cargo', [
    'build',
    '--locked',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '--manifest-path',
    join(CRATE, 'Cargo.toml'),
  ])
  const target = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(CRATE, 'target')
  const dir = mkdtempSync(join(tmpdir(), 'engine-wasm-'))
  run(bindgen, [
    '--target',
    'web',
    '--no-typescript',
    '--out-name',
    'engine',
    '--out-dir',
    dir,
    join(target, 'wasm32-unknown-unknown', 'release', 'engine_wasm.wasm'),
  ])
  return dir
}

/** The source of what is served (AGPL-3.0): this crate, the engine-cli files it compiles, the locks and this script. */
function sources(target) {
  const work = mkdtempSync(join(tmpdir(), 'engine-wasm-src-'))
  try {
    const src = join(work, 'engine-wasm-src')
    for (const name of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'src'])
      cpSync(join(ROOT, 'engine', name), join(src, 'engine', name), { recursive: true })
    for (const name of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'src', 'tests', 'smoke.mjs'])
      cpSync(join(CRATE, name), join(src, 'engine', 'wasm', name), { recursive: true })
    mkdirSync(join(src, 'scripts'), { recursive: true })
    cpSync(fileURLToPath(import.meta.url), join(src, 'scripts', 'build-engine-wasm.mjs'))
    cpSync(join(ROOT, 'LICENSE'), join(src, 'LICENSE'))
    writeFileSync(
      join(src, 'BUILD.txt'),
      `Fuentes del motor del navegador (engine-wasm ${version}, deckgym ${engineRev}), AGPL-3.0.
Compilar: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version ${bindgenVersion} --locked;
node scripts/build-engine-wasm.mjs --out <carpeta>.
Las dependencias se bajan con cargo a las versiones y sumas de engine/wasm/Cargo.lock: deckgym-core sin modificar en
https://github.com/santiqwerty1/deckgym-core/tree/${engineRev} (nuestra copia de bcollazo/deckgym-core) y el resto en crates.io (MIT o Apache-2.0).
engine/src tiene los bots, el entrenador y las semillas de engine-cli, que engine/wasm compila tal cual.
`,
    )
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar'
    execFileSync(tar, ['-czf', target, '-C', work, 'engine-wasm-src'])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const built = from ? resolve(from) : compile()
try {
  const js = readFileSync(join(built, 'engine.js'), 'utf8')
  const wasm = readFileSync(join(built, 'engine_bg.wasm'))
  const hash = createHash('sha256').update(js).update(wasm).digest('hex').slice(0, 12)
  const names = { js: `engine-${hash}.js`, wasm: `engine-${hash}_bg.wasm`, sources: `engine-src-${version}.tar.gz` }
  if (existsSync(out)) rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  // The Web Worker always passes the .wasm's URL; the default inside the glue points at the renamed file anyway.
  writeFileSync(join(out, names.js), js.replaceAll("'engine_bg.wasm'", `'${names.wasm}'`))
  writeFileSync(join(out, names.wasm), wasm)
  sources(join(out, names.sources))
  writeFileSync(
    join(out, 'manifest.json'),
    // `build`: what was compiled (the same hash as the file names). A browser game keeps it: a page with another build
    // would rebuild another game from the same choices (review of #86).
    `${JSON.stringify({ engineRev, gamesRev, version, build: hash, ...names, wasmBytes: wasm.length }, null, 2)}\n`,
  )
  console.log(`Motor del navegador: ${out} (${names.wasm}, ${(wasm.length / 1024 / 1024).toFixed(1)} MB)`)
} finally {
  if (!from) rmSync(built, { recursive: true, force: true })
}
