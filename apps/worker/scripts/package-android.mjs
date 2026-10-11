#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { determinismReference } from './determinism-reference.mjs'
import { writeTarGz } from './deterministic-tar.mjs'

const root = resolve(import.meta.dirname, '..')
const repo = resolve(root, '../..')
const argument = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : resolve(process.argv[i + 1])
}
const engine = argument('--engine', join(repo, 'engine/target/aarch64-unknown-linux-musl/release/engine-cli'))
const elf = readFileSync(engine)
if (elf.subarray(0, 4).toString('hex') !== '7f454c46' || elf[4] !== 2 || elf[5] !== 1 || elf.readUInt16LE(18) !== 183) {
  throw new Error('El motor debe ser un ELF aarch64 de 64 bits, little endian.')
}
for (let i = 0; i < elf.readUInt16LE(56); i++) {
  if (elf.readUInt32LE(Number(elf.readBigUInt64LE(32)) + i * elf.readUInt16LE(54)) === 3) {
    throw new Error('El motor debe ser estático (sin intérprete de libc).')
  }
}
const referenceEngine = argument(
  '--reference-engine',
  join(repo, `engine/target/release/engine-cli${process.platform === 'win32' ? '.exe' : ''}`),
)
const out = argument('--out', join(root, 'build'))
const version = /WORKER_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'src/version.ts'), 'utf8'))?.[1]
if (!version) throw new Error('Falta WORKER_VERSION')
const work = join(out, 'android-package')
const dir = join(work, 'tcg-worker')
// From scratch: a file left by an earlier run would end up in the archive (and change its sum).
rmSync(work, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const reference = determinismReference(referenceEngine, work)
const nativeVersion = reference.version
writeFileSync(join(dir, 'determinism.json'), `${JSON.stringify(reference, null, 2)}\n`)
// What the app answers on /api/worker/packages/android-arm64/version, plus the sum it computes (D-026).
writeFileSync(
  join(out, 'android-version.json'),
  `${JSON.stringify({ platform: 'android-arm64', workerVersion: version, ...reference.version })}\n`,
)
await build({
  entryPoints: [join(root, 'src/android.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outfile: join(dir, 'worker.mjs'),
})
copyFileSync(engine, join(dir, 'engine-cli'))
chmodSync(join(dir, 'engine-cli'), 0o755)
copyFileSync(join(root, 'android/install.sh'), join(dir, 'install.sh'))
copyFileSync(join(root, 'android/install.sh'), join(out, 'install-android.sh'))
copyFileSync(join(root, 'android/LEEME.txt'), join(dir, 'LEEME.txt'))
copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE.txt'))
copyFileSync(join(root, 'android/LICENSE-musl.txt'), join(dir, 'LICENSE-musl.txt'))
const runtimeLicenses =
  argument('--runtime-licenses', null) ??
  join(execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim(), 'share/doc/rust')
copyFileSync(join(runtimeLicenses, 'COPYRIGHT-library.html'), join(dir, 'COPYRIGHT-library.html'))
cpSync(join(runtimeLicenses, 'licenses'), join(dir, 'licenses'), { recursive: true })
// Complete corresponding source, including git dependencies, usable without the private repository.
const sources = join(work, 'sources')
mkdirSync(join(sources, 'engine/.cargo'), { recursive: true })
mkdirSync(join(sources, 'apps/worker'), { recursive: true })
for (const name of ['src', 'Cargo.toml', 'Cargo.lock', 'build.rs'])
  cpSync(join(repo, 'engine', name), join(sources, 'engine', name), { recursive: true })
const vendor = argument('--vendor', null)
if (vendor) {
  cpSync(vendor, join(sources, 'engine/vendor'), { recursive: true })
  copyFileSync(join(vendor, '../vendor-config.toml'), join(sources, 'engine/.cargo/config.toml'))
} else {
  const config = execFileSync('cargo', ['vendor', '--locked', '--versioned-dirs', 'vendor'], {
    cwd: join(sources, 'engine'),
    encoding: 'utf8',
  })
  writeFileSync(join(sources, 'engine/.cargo/config.toml'), config)
}
for (const name of [
  'src',
  'scripts',
  'android',
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'vitest.config.ts',
])
  cpSync(join(root, name), join(sources, 'apps/worker', name), { recursive: true })
for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'LICENSE'])
  copyFileSync(join(repo, name), join(sources, name))
writeFileSync(
  join(sources, 'BUILD.txt'),
  `Fuentes de worker ${version}, engine-cli ${nativeVersion.cliVersion}, deckgym ${nativeVersion.engineRev}.
Rust 1.99.0. En engine/: cargo build --offline --locked --release.
ARM: rustup target add aarch64-unknown-linux-musl; instalar Zig 0.13.0 y cargo-zigbuild 0.23.4;
cargo zigbuild --offline --locked --release --target aarch64-unknown-linux-musl.
Node >=24, pnpm 12.9.1: pnpm install --frozen-lockfile --filter @tcg/worker (requiere internet).
pnpm -F @tcg/worker package:android --engine <binario ARM> --reference-engine <binario nativo>.
Las dependencias Rust y sus licencias están en engine/vendor. No se modificó deckgym-core.
Los scripts originales de empaquetado están en apps/worker/scripts.
`,
)
// Reproducible archives (D-026): the phone downloads ~15 MB only when its worker or engine really changed.
await writeTarGz(join(work, 'sources'), 'sources', join(dir, 'sources.tar.gz'))
const archive = join(out, `tcg-worker-${version}-android-arm64.tar.gz`)
await writeTarGz(dir, 'tcg-worker', archive, ['engine-cli', 'install.sh'])
const sha = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(`${archive}.sha256`, `${sha}  tcg-worker-${version}-android-arm64.tar.gz\n`)
copyFileSync(archive, join(out, 'android-arm64.tar.gz'))
console.log(`Paquete Android: ${archive} (sha256 ${sha})`)
