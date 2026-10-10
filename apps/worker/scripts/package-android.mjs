#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

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
mkdirSync(dir, { recursive: true })
const nativeVersion = JSON.parse(execFileSync(referenceEngine, ['version'], { encoding: 'utf8' }))
const deck = `Energy: Psychic
2 Swablu A4a 64
2 Mega Altaria ex B1 102
1 Jirachi B1 106
2 Chingling B1 109
1 Indeedee ex B1 121
1 Altaria B1 197
1 Sabrina A1 225
2 Rocky Helmet A2 148
1 Cyrus A2 150
1 Mars A2 155
1 Poké Ball A2b 111
2 Professor's Research A4b 373
1 Copycat B1 225
2 Lisia B1 226`
const cases = []
for (const bot of ['r', 'e2', 'f2']) {
  const job = {
    deckA: deck,
    deckB: deck,
    players: [bot, bot],
    seed: 20261010,
    games: 8,
    threads: 2,
    replaySample: 0,
    perGame: true,
  }
  const input = join(work, 'job.json'),
    output = join(work, 'result.json')
  writeFileSync(input, JSON.stringify(job))
  execFileSync(referenceEngine, ['simulate', input, output], { stdio: ['ignore', 'pipe', 'inherit'] })
  const { durationMs: _duration, replays: _replays, ...expected } = JSON.parse(readFileSync(output, 'utf8'))
  cases.push({ job, expected })
}
const reference = { version: { engineRev: nativeVersion.engineRev, cliVersion: nativeVersion.cliVersion }, cases }
writeFileSync(join(dir, 'determinism.json'), `${JSON.stringify(reference, null, 2)}\n`)
writeFileSync(join(out, 'android-version.json'), `${JSON.stringify(reference.version)}\n`)
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
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar'
execFileSync(tar, ['-czf', join(dir, 'sources.tar.gz'), '-C', work, 'sources'])
const archive = join(out, `tcg-worker-${version}-android-arm64.tar.gz`)
execFileSync(tar, ['-czf', archive, '-C', work, 'tcg-worker'])
const sha = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(`${archive}.sha256`, `${sha}  tcg-worker-${version}-android-arm64.tar.gz\n`)
copyFileSync(archive, join(out, 'android-arm64.tar.gz'))
console.log(`Paquete Android: ${archive} (sha256 ${sha})`)
