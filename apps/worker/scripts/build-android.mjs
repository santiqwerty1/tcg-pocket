#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Same stages locally and on Fly's remote builder; no host cross-compilation toolchain required.
const repo = resolve(import.meta.dirname, '../../..')
if (process.argv.includes('--engine')) {
  execFileSync(process.execPath, [resolve(import.meta.dirname, 'package-android.mjs'), ...process.argv.slice(2)], {
    stdio: 'inherit',
  })
  process.exit(0)
}
const image = 'tcg-worker-android-build'
execFileSync('docker', ['build', '--target', 'android-package', '-t', image, repo], { stdio: 'inherit' })
const container = execFileSync('docker', ['create', image], { encoding: 'utf8' }).trim()
const out = resolve(repo, 'apps/worker/build')
mkdirSync(out, { recursive: true })
try {
  const version = /WORKER_VERSION = '([^']+)'/.exec(
    readFileSync(resolve(repo, 'apps/worker/src/version.ts'), 'utf8'),
  )?.[1]
  if (!version) throw new Error('Falta WORKER_VERSION')
  for (const file of [
    `tcg-worker-${version}-android-arm64.tar.gz`,
    `tcg-worker-${version}-android-arm64.tar.gz.sha256`,
    'android-arm64.tar.gz',
    'android-version.json',
    'install-android.sh',
  ]) {
    execFileSync('docker', ['cp', `${container}:/android-package/${file}`, resolve(out, file)], { stdio: 'inherit' })
  }
} finally {
  execFileSync('docker', ['rm', container], { stdio: 'ignore' })
}
