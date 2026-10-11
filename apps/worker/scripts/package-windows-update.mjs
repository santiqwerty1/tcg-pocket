#!/usr/bin/env node
// The Windows update package (D-026): what tcg-worker.exe downloads from the app to update itself. No Node inside (the
// executable already has it, and that keeps the image a few MB bigger instead of 37): the worker as one CommonJS file
// (`worker.cjs`, loaded by the executable's own code, src/sea.ts), engine-cli.exe, its determinism reference and the
// license. Built into the Fly image (Dockerfile, `windows-package`) with the engine cross-compiled from the same lock.
//
//   node scripts/package-windows-update.mjs --engine <engine-cli.exe> [--reference-engine <native engine>]
//     [--runtime-licenses <dir with Rust's COPYRIGHT-library.html, licenses/ and LICENSE-mingw-w64.txt>] [--out <dir>]
//
// Writes windows-x64.tar.gz and windows-x64-version.json (what the API serves) and a copy named by version.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { determinismReference } from './determinism-reference.mjs'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const argument = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : resolve(process.argv[i + 1])
}
const engine = argument('--engine', join(repo, 'engine/target/x86_64-pc-windows-gnu/release/engine-cli.exe'))
// A Windows x86-64 executable: «MZ», then «PE\0\0» with machine 0x8664.
const pe = readFileSync(engine)
const peOffset = pe.length > 0x40 ? pe.readUInt32LE(0x3c) : 0
if (
  pe.subarray(0, 2).toString('latin1') !== 'MZ' ||
  pe.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0' ||
  pe.readUInt16LE(peOffset + 4) !== 0x8664
) {
  throw new Error('El motor debe ser un ejecutable de Windows x86-64.')
}
// The games the package's engine must reproduce: a native engine of the same source (the image's Linux one, or the
// same .exe on Windows).
const referenceEngine = argument('--reference-engine', process.platform === 'win32' ? engine : null)
if (!referenceEngine) throw new Error('Falta --reference-engine (un motor nativo del mismo código).')
const out = argument('--out', join(root, 'build'))
const version = /WORKER_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'src/version.ts'), 'utf8'))?.[1]
if (!version) throw new Error('Falta WORKER_VERSION')

const work = join(out, 'windows-update')
const dir = join(work, 'tcg-worker')
rmSync(work, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const reference = determinismReference(referenceEngine, work)
writeFileSync(join(dir, 'determinism.json'), `${JSON.stringify(reference, null, 2)}\n`)
await build({
  entryPoints: [join(root, 'src/portable.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: join(dir, 'worker.cjs'),
  logLevel: 'warning',
})
copyFileSync(engine, join(dir, 'engine-cli.exe'))
copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE.txt'))
// The notices of what the toolchain linked in (the image's build): Rust's libraries and the MinGW-w64 runtime.
const runtimeLicenses = argument('--runtime-licenses', null)
if (runtimeLicenses) {
  copyFileSync(join(runtimeLicenses, 'COPYRIGHT-library.html'), join(dir, 'COPYRIGHT-library.html'))
  cpSync(join(runtimeLicenses, 'licenses'), join(dir, 'licenses'), { recursive: true })
  if (existsSync(join(runtimeLicenses, 'LICENSE-mingw-w64.txt'))) {
    copyFileSync(join(runtimeLicenses, 'LICENSE-mingw-w64.txt'), join(dir, 'LICENSE-mingw-w64.txt'))
  }
}
const info = { platform: 'windows-x64', workerVersion: version, ...reference.version }
writeFileSync(join(dir, 'release.json'), `${JSON.stringify(info, null, 2)}\n`)
writeFileSync(
  join(dir, 'LEEME.txt'),
  `Actualización del worker ${version} (engine-cli ${reference.version.cliVersion}, deckgym ${reference.version.engineRev}).
La baja y la instala tcg-worker.exe solo; no hace falta tocar nada. El worker y engine-cli.exe son AGPL-3.0
(LICENSE.txt; fuentes en https://github.com/santiqwerty1/tcg-pocket, y completas, con las dependencias de Rust, en
sources.tar.gz del paquete Android que sirve la misma app); engine-cli.exe incluye deckgym-core (AGPL-3.0,
https://github.com/bcollazo/deckgym-core), las bibliotecas de Rust (COPYRIGHT-library.html, licenses/) y el runtime
de MinGW-w64 (LICENSE-mingw-w64.txt).
`.replace(/\n/g, '\r\n'),
)
rmSync(join(work, 'job.json'), { force: true })
rmSync(join(work, 'result.json'), { force: true })

// tar.gz with the folder tcg-worker/: Windows' bsdtar unpacks it on the PC (and writes it here, on Windows).
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar'
const archive = join(out, `tcg-worker-${version}-windows-x64-update.tar.gz`)
rmSync(archive, { force: true })
execFileSync(tar, ['-czf', archive, '-C', work, 'tcg-worker'], { stdio: 'inherit' })
const sha = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(`${archive}.sha256`, `${sha}  tcg-worker-${version}-windows-x64-update.tar.gz\n`)
copyFileSync(archive, join(out, 'windows-x64.tar.gz'))
writeFileSync(join(out, 'windows-x64-version.json'), `${JSON.stringify(info)}\n`)
console.log(`Paquete de actualización de Windows: ${archive} (sha256 ${sha})`)
