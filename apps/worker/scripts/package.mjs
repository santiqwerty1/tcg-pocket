#!/usr/bin/env node
// The portable worker (Fase 21): build/tcg-worker-<version>-windows.zip with tcg-worker.exe (this worker bundled into a
// Node single executable application: no Node, repository or Rust needed on the other PC), engine-cli.exe and LEEME.txt.
//
//   node scripts/package.mjs [--engine <path to engine-cli.exe>]
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { inject } from 'postject'

const root = resolve(import.meta.dirname, '..')
const version = /WORKER_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'src/version.ts'), 'utf8'))?.[1]
if (!version) throw new Error('no se encontró WORKER_VERSION en src/version.ts')
const engineArg = process.argv.indexOf('--engine')
const engine =
  engineArg > 0 ? resolve(process.argv[engineArg + 1]) : resolve(root, '../../engine/target/release/engine-cli.exe')
if (!existsSync(engine)) throw new Error(`no está el motor en ${engine}: compilalo (cargo build --release en engine/)`)

const out = join(root, 'build', 'package')
const dir = join(out, 'tcg-worker')
rmSync(out, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// 1. One CommonJS file (single executable applications run CommonJS).
await build({
  entryPoints: [join(root, 'src/portable.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: join(out, 'worker.cjs'),
  logLevel: 'warning',
})

// 2. The blob, injected into a copy of this Node.
writeFileSync(
  join(out, 'sea-config.json'),
  JSON.stringify({ main: 'worker.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true }),
)
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: out, stdio: 'inherit' })
const exe = join(dir, 'tcg-worker.exe')
copyFileSync(process.execPath, exe)
await inject(exe, 'NODE_SEA_BLOB', readFileSync(join(out, 'sea-prep.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
})

// 3. The engine and the instructions.
copyFileSync(engine, join(dir, 'engine-cli.exe'))
writeFileSync(
  join(dir, 'LEEME.txt'),
  `TCG Pocket: worker de simulación ${version}

Para que otra PC juegue partidas de las simulaciones (las reparte la app entre todas las PCs prendidas).
No hace falta instalar Node, Rust ni el repositorio: alcanza con esta carpeta.

1. Copiá la carpeta tcg-worker a la otra PC, por ejemplo a C:\\tcg-worker (dejá juntos los dos .exe).
2. En la app: Más → Tokens de API → nuevo token de tipo worker (uno por PC: así lo podés revocar solo).
3. Doble clic en tcg-worker.exe: pide el token, cuántos núcleos usar y un nombre para la PC, prueba el motor y la
   conexión, y deja el worker corriendo oculto. Arranca solo cada vez que inicies sesión.
   Si Windows dice «Windows protegió su PC» (el archivo vino de internet y no está firmado): Más información →
   Ejecutar de todas formas.
4. En la app, Más → Simulación muestra las PCs conectadas.

Otros usos (desde una consola en esta carpeta):
  tcg-worker.exe --check      revisa la configuración, el motor y la conexión
  tcg-worker.exe --uninstall  saca el arranque automático (para cambiar algo, volvé a hacer doble clic)

La configuración y el registro quedan en %LOCALAPPDATA%\\tcg-worker (config.json y worker.log).
Si actualizás la app y el motor cambia, reemplazá los dos .exe por los del paquete nuevo y reiniciá la sesión.
engine-cli.exe incluye deckgym-core (AGPL-3.0, https://github.com/bcollazo/deckgym-core).
`.replace(/\n/g, '\r\n'),
)

// 4. The zip: Windows' own bsdtar (Git Bash puts GNU tar first in the PATH, and that one does not write zips).
const zip = join(root, 'build', `tcg-worker-${version}-windows.zip`)
rmSync(zip, { force: true })
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:Windows', 'System32', 'tar.exe') : 'tar'
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', out, 'tcg-worker'], { stdio: 'inherit' })
console.log(`Paquete listo: ${zip}`)
