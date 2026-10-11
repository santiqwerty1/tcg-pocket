import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseRelease, loadRelease } from '../src/bootstrap.js'
import { WorkerClient } from '../src/client.js'
import { run } from '../src/run.js'
import { supervise } from '../src/supervisor.js'
import {
  androidInstallation,
  type Installation,
  isBad,
  isHealthy,
  RESTART_FOR_UPDATE,
  readPointer,
  rollBackUnhealthy,
  Updater,
  updatesAllowedFrom,
  windowsInstallation,
  writePointer,
} from '../src/update.js'

const FAKE_ENGINE = join(import.meta.dirname, 'fake-engine.mjs')
const silent = () => undefined
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

/** A package as the image builds it: `tcg-worker/` with a check that passes or fails (and a worker.cjs). */
function makePackage(work: string, name: string, options: { checkCode?: number; main?: string } = {}): Buffer {
  const root = join(work, `src-${name}`)
  const dir = join(root, 'tcg-worker')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'check.mjs'), `process.exit(${options.checkCode ?? 0})\n`)
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ name }))
  writeFileSync(
    join(dir, 'worker.cjs'),
    options.main ?? `exports.main = async (args, context) => (context.releaseDir ? 0 : 1)\n`,
  )
  const file = join(work, `${name}.tar.gz`)
  execFileSync(tar, ['-czf', file, '-C', root, 'tcg-worker'])
  return readFileSync(file)
}

/** The worker API's package routes, serving whatever the test sets; records every request. */
async function packageServer() {
  const state: { packages: Map<string, Buffer>; offered: string | null; announce?: string; requests: string[] } = {
    packages: new Map(),
    offered: null,
    requests: [],
  }
  const server: Server = createServer((request, response) => {
    state.requests.push(`${request.method} ${request.url}`)
    const offered = state.offered ? state.packages.get(state.offered) : undefined
    if (request.url?.endsWith('/version')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          engineRev: 'fb792ebfbaca995af9750c28101ce92a51282825',
          cliVersion: '0.1.0-fake',
          workerVersion: '9.9.9',
          ...(offered ? { sha256: state.offered, size: offered.length } : {}),
        }),
      )
    } else if (request.url?.startsWith('/api/worker/packages/') && offered) {
      response.setHeader('X-Checksum-Sha256', state.announce ?? state.offered ?? '')
      response.end(offered)
    } else if (request.url === '/api/worker/ping') {
      response.setHeader('Content-Type', 'application/json')
      response.end('{"ok":true,"token":{"name":"test"}}')
    } else if (request.url === '/api/worker/release') {
      response.setHeader('Content-Type', 'application/json')
      response.end('{"chunks":0,"games":0}')
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const offer = (data: Buffer) => {
    const sha = sha256(data)
    state.packages.set(sha, data)
    state.offered = sha
    return sha
  }
  return { url, state, offer, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** A Windows-like installation whose check is the package's own check.mjs (no executable needed). */
function testInstallation(dataDir: string, current: string | null, base = 'build-1'): Installation {
  const windows = windowsInstallation(dataDir, current ? join(dataDir, 'releases', current) : null, base)
  return { ...windows, checkCommand: (dir) => ({ command: process.execPath, args: [join(dir, 'check.mjs')] }) }
}

describe('self-update (D-026)', () => {
  let dir: string
  let server: Awaited<ReturnType<typeof packageServer>>
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tcg-update-'))
    server = await packageServer()
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('downloads, checks the sum, unpacks and runs the release check before anything else changes', async () => {
    const sha = server.offer(makePackage(dir, 'a'))
    const data = join(dir, 'data')
    const updater = new Updater(
      testInstallation(data, null),
      new WorkerClient(server.url, 'tcg_wk_test', silent),
      silent,
    )
    const ready = await updater.check()
    expect(ready?.sha256).toBe(sha)
    expect(ready?.workerVersion).toBe('9.9.9')
    const release = join(data, 'releases', sha)
    expect(existsSync(join(release, 'verified'))).toBe(true)
    expect(JSON.parse(readFileSync(join(release, 'release.json'), 'utf8'))).toEqual({ name: 'a' })
    // Nothing switched yet, and nothing left half done.
    expect(readPointer(join(data, 'releases'))).toBeNull()
    expect(readdirSync(join(data, 'releases')).sort()).toEqual([sha])
    // Asking again does not download again.
    const downloads = server.state.requests.filter((line) => !line.endsWith('/version')).length
    expect(await updater.check()).toEqual(ready)
    expect(server.state.requests.filter((line) => !line.endsWith('/version')).length).toBe(downloads)
    updater.activate()
    expect(readPointer(join(data, 'releases'))).toEqual({ sha, previous: null, base: 'build-1' })
  })

  it('stays on the running release when the server offers it, or offers nothing (older server)', async () => {
    const data = join(dir, 'data')
    const client = new WorkerClient(server.url, 'tcg_wk_test', silent)
    expect(await new Updater(testInstallation(data, null), client, silent).check()).toBeNull()
    const sha = server.offer(makePackage(dir, 'a'))
    expect(await new Updater(testInstallation(data, sha), client, silent).check()).toBeNull()
    expect(server.state.requests.every((line) => line.endsWith('/version'))).toBe(true)
  })

  it('a package that plays differently is never used; other failures after three tries; a wrong sum is retried', async () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const client = new WorkerClient(server.url, 'tcg_wk_test', silent)
    const log = vi.fn()
    // A timeout on a busy PC (or a crash): tried again, and given up on the third time.
    const flaky = server.offer(makePackage(dir, 'flaky', { checkCode: 1 }))
    const updater = new Updater(testInstallation(data, null), client, log)
    for (const attempt of [1, 2]) {
      expect(await updater.check()).toBeNull()
      expect(isBad(releases, flaky), `attempt ${attempt}`).toBe(false)
    }
    expect(await updater.check()).toBeNull()
    expect(isBad(releases, flaky)).toBe(true)
    // Different games for the same seeds (exit 3, DETERMINISM_MISMATCH): never, from the first time.
    const bad = server.offer(makePackage(dir, 'bad', { checkCode: 3 }))
    expect(await updater.check()).toBeNull()
    expect(isBad(releases, bad)).toBe(true)
    expect(existsSync(join(releases, bad))).toBe(false)
    const downloads = () => server.state.requests.filter((line) => !line.endsWith('/version')).length
    const before = downloads()
    expect(await updater.check()).toBeNull()
    expect(downloads()).toBe(before)
    // A deploy between the version and the download: not this package's sum. Not bad, just later.
    const good = server.offer(makePackage(dir, 'good'))
    server.state.announce = bad
    expect(await updater.check()).toBeNull()
    expect(isBad(releases, good)).toBe(false)
    expect(readdirSync(releases).filter((entry) => entry.startsWith(good))).toEqual([])
    delete server.state.announce
    expect((await updater.check())?.sha256).toBe(good)
    expect(log).toHaveBeenCalledWith('no se pudo preparar la versión nueva; reintento más tarde', expect.anything())
  })

  it('rolls back a release that failed before it was ever ready, and never a healthy one', () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const [a, b] = ['a', 'b'].map((x) => x.repeat(64)) as [string, string]
    for (const sha of [a, b]) mkdirSync(join(releases, sha), { recursive: true })
    const installation = testInstallation(data, null)
    writePointer(releases, { sha: b, previous: a, base: 'build-1' })
    expect(rollBackUnhealthy(installation, silent)).toBe(true)
    expect(readPointer(releases)).toEqual({ sha: a, previous: null, base: 'build-1' })
    expect(isBad(releases, b)).toBe(true)
    // `a` worked before: an error now is the worker's, not the release's.
    writeFileSync(join(releases, a, 'healthy'), '')
    expect(rollBackUnhealthy(installation, silent)).toBe(false)
    // Windows can always go back to the executable's own code.
    writePointer(releases, { sha: b, previous: null, base: 'build-1' })
    expect(rollBackUnhealthy(installation, silent)).toBe(true)
    expect(readPointer(releases)?.sha).toBeNull()
  })

  it('takes code only over HTTPS or from this same machine', () => {
    for (const server of [
      'https://tcg-pocket.fly.dev',
      'http://127.0.0.1:3000',
      'http://localhost',
      'http://[::1]:80',
    ]) {
      expect(updatesAllowedFrom(server), server).toBe(true)
    }
    for (const server of ['http://tcg-pocket.fly.dev', 'http://127.0.0.1.evil.test', 'http://localhost.evil.test:80']) {
      expect(updatesAllowedFrom(server), server).toBe(false)
    }
  })

  it('Android switches the current link and keeps the way back; cleanup leaves only those two', async () => {
    const root = join(dir, 'android')
    const releases = join(root, 'releases')
    const [a, b, old] = ['a', 'b', 'c'].map((x) => x.repeat(64)) as [string, string, string]
    for (const sha of [a, b, old]) mkdirSync(join(releases, sha), { recursive: true })
    writeFileSync(join(releases, `${b}.partial`), 'cut')
    const running = androidInstallation(join(releases, a))
    expect(running?.current).toBe(a)
    expect(androidInstallation(join(dir, 'somewhere', a))).toBeNull()
    running?.activate(b, a)
    expect(basename(realpathSync(join(root, 'current')))).toBe(b)
    expect(readPointer(releases)).toEqual({ sha: b, previous: a })
    running?.activate(a, b)
    expect(basename(realpathSync(join(root, 'current')))).toBe(a)
    const next = androidInstallation(join(releases, a))
    if (!next) throw new Error('missing installation')
    new Updater(next, new WorkerClient(server.url, 'tcg_wk_test', silent), silent).cleanup()
    expect(readdirSync(releases).sort()).toEqual([a, b, 'current.json'].sort())
  })

  it('a start on an old release switches before taking work and exits for its supervisor', async () => {
    const data = join(dir, 'data')
    vi.stubEnv('TCG_WORKER_DIR', data)
    vi.stubEnv('TCG_WORKER_TOKEN', 'tcg_wk_test')
    vi.stubEnv('TCG_SERVER', server.url)
    const sha = server.offer(makePackage(dir, 'next'))
    const installation = testInstallation(data, null)
    const code = await run([], { enginePath: FAKE_ENGINE }, { installation })
    expect(code).toBe(RESTART_FOR_UPDATE)
    expect(readPointer(join(data, 'releases'))?.sha).toBe(sha)
    // No chunk was claimed; the leases (none) were handed back on the way out.
    expect(server.state.requests.some((line) => line.includes('/claim'))).toBe(false)
    expect(server.state.requests).toContain('POST /api/worker/release')
    // --check says whether this install follows the server, which package runs and which one the server has.
    vi.stubEnv('TCG_WORKER_AUTO_UPDATE', 'false')
    expect(await run(['--check'], { enginePath: FAKE_ENGINE }, { installation: testInstallation(data, sha) })).toBe(0)
    const line = readFileSync(join(data, 'worker.log'), 'utf8')
      .split('\n')
      .find((entry) => entry.includes(' actualizaciones '))
    expect(line).toContain('"autoUpdate":false')
    expect(line).toContain('"upToDate":true')
  })
})

describe('Windows executable (D-026)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tcg-bootstrap-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('loads the pointer release only when this build wrote it and it was verified and not marked bad', () => {
    const releases = join(dir, 'releases')
    const sha = 'd'.repeat(64)
    const release = join(releases, sha)
    mkdirSync(release, { recursive: true })
    writeFileSync(join(release, 'worker.cjs'), 'exports.main = async (args, context) => args.length + 40\n')
    expect(chooseRelease(dir, 'build-1', {})).toBeNull()
    writePointer(releases, { sha, previous: null, base: 'build-1' })
    expect(chooseRelease(dir, 'build-1', {})).toBeNull()
    writeFileSync(join(release, 'verified'), '')
    expect(chooseRelease(dir, 'build-1', {})).toBe(release)
    // A zip installed by hand (another build) starts on its own code.
    expect(chooseRelease(dir, 'build-2', {})).toBeNull()
    expect(chooseRelease(dir, 'build-2', { TCG_WORKER_RELEASE: release })).toBe(release)
    writeFileSync(join(releases, `${sha}.bad`), '{}')
    expect(chooseRelease(dir, 'build-1', {})).toBeNull()
  })

  it('calls the main of a release loaded from disk', async () => {
    const release = join(dir, 'r')
    mkdirSync(release)
    writeFileSync(join(release, 'worker.cjs'), 'exports.main = async (args, context) => args.length + 40\n')
    expect(await loadRelease(release).main(['--child', 'x'], { releaseDir: release, buildId: 'b' })).toBe(42)
    writeFileSync(join(release, 'worker.cjs'), 'exports.other = 1\n')
    expect(() => loadRelease(join(dir, 'missing'))).toThrow()
  })

  it('the supervisor restarts a child that updated, rolls back one that never got ready, stops on success', async () => {
    const releases = join(dir, 'releases')
    const [a, b] = ['a', 'b'].map((x) => x.repeat(64)) as [string, string]
    for (const sha of [a, b]) mkdirSync(join(releases, sha), { recursive: true })
    writeFileSync(join(releases, a, 'healthy'), '')
    writePointer(releases, { sha: a, previous: null, base: 'build-1' })
    const installation = windowsInstallation(dir, null, 'build-1')
    const codes = [RESTART_FOR_UPDATE, 3, 0]
    const runChild = vi.fn(async () => {
      const code = codes.shift() ?? 0
      // The first child switches to `b` before exiting for the restart.
      if (code === RESTART_FOR_UPDATE) writePointer(releases, { sha: b, previous: a, base: 'build-1' })
      return code
    })
    expect(await supervise({ dataDir: dir, installation, log: silent, runChild })).toBe(0)
    expect(runChild).toHaveBeenCalledTimes(3)
    expect(readPointer(releases)?.sha).toBe(a)
    expect(isBad(releases, b)).toBe(true)
    expect(isHealthy(releases, a)).toBe(true)
    // An error on a healthy release ends the supervisor with it.
    expect(await supervise({ dataDir: dir, installation, log: silent, runChild: async () => 4 })).toBe(4)
  })

  it('a second supervisor in the same folder does nothing', async () => {
    mkdirSync(join(dir, 'supervisor'), { recursive: true })
    writeFileSync(join(dir, 'supervisor', 'worker.lock'), String(process.ppid))
    const runChild = vi.fn(async () => 0)
    expect(
      await supervise({ dataDir: dir, installation: windowsInstallation(dir, null, 'b'), log: silent, runChild }),
    ).toBe(0)
    expect(runChild).not.toHaveBeenCalled()
  })
})
