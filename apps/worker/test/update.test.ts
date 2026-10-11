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
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error: a build script in plain JavaScript, without types.
import { writeTarGz } from '../scripts/deterministic-tar.mjs'
import { chooseRelease, loadRelease } from '../src/bootstrap.js'
import { WorkerClient } from '../src/client.js'
import { looksLikeWorker } from '../src/portable.js'
import { run } from '../src/run.js'
import { supervise } from '../src/supervisor.js'
import {
  afterFailedStart,
  androidInstallation,
  badMark,
  type Installation,
  isBad,
  isHealthy,
  RESTART_FOR_UPDATE,
  RestartPacer,
  readPointer,
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

/** As if the wait after a failed preparation had passed. */
function waitPassed(releases: string, sha: string): void {
  const file = join(releases, `${sha}.attempts`)
  const attempts = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  writeFileSync(file, JSON.stringify({ ...attempts, retryAt: new Date(0).toISOString() }))
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

  it('a failed preparation waits longer each time: never a loop of downloads; a failing check is out for a day', async () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const client = new WorkerClient(server.url, 'tcg_wk_test', silent)
    const downloads = () => server.state.requests.filter((line) => !line.endsWith('/version')).length
    // A timeout on a busy PC (or a crash): exit 1.
    const flaky = server.offer(makePackage(dir, 'flaky', { checkCode: 1 }))
    const updater = new Updater(testInstallation(data, null), client, silent)
    updater.minCheckGapMs = 0
    expect(await updater.check()).toBeNull()
    expect(downloads()).toBe(1)
    expect(updater.retryInMs()).toBeGreaterThan(4 * 60_000)
    expect(updater.retryInMs()).toBeLessThanOrEqual(5 * 60_000)
    // Within the wait nothing is downloaded, however often it is asked (the claim loop, Android's 409).
    for (let i = 0; i < 5; i++) expect(await updater.check()).toBeNull()
    expect(downloads()).toBe(1)
    waitPassed(releases, flaky)
    expect(await updater.check()).toBeNull()
    expect(downloads()).toBe(2)
    expect(updater.retryInMs()).toBeGreaterThan(9 * 60_000)
    expect(isBad(releases, flaky)).toBe(false)
    waitPassed(releases, flaky)
    expect(await updater.check()).toBeNull()
    // The third failed check: out, but only for a day.
    expect(badMark(releases, flaky)?.permanent).toBeUndefined()
    expect(updater.status().bad?.reason).toContain('(1)')
    expect(badMark(releases, flaky, Date.now() + 25 * 60 * 60_000)).toBeNull()
  })

  it('a package that plays differently is out for good at once; a wrong sum only waits', async () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const client = new WorkerClient(server.url, 'tcg_wk_test', silent)
    const log = vi.fn()
    const downloads = () => server.state.requests.filter((line) => !line.endsWith('/version')).length
    const updater = new Updater(testInstallation(data, null), client, log)
    updater.minCheckGapMs = 0
    // Different games for the same seeds (exit 3, DETERMINISM_MISMATCH).
    const bad = server.offer(makePackage(dir, 'bad', { checkCode: 3 }))
    expect(await updater.check()).toBeNull()
    expect(badMark(releases, bad)?.permanent).toBe(true)
    expect(badMark(releases, bad, Date.now() + 30 * 24 * 60 * 60_000)).not.toBeNull()
    expect(existsSync(join(releases, bad))).toBe(false)
    const before = downloads()
    expect(await updater.check()).toBeNull()
    expect(downloads()).toBe(before)
    // A deploy between the version and the download: not this package's sum. Not bad, it just waits.
    const good = server.offer(makePackage(dir, 'good'))
    server.state.announce = bad
    expect(await updater.check()).toBeNull()
    expect(isBad(releases, good)).toBe(false)
    expect(readdirSync(releases).filter((entry) => entry.startsWith(good))).toEqual([`${good}.attempts`])
    delete server.state.announce
    expect(await updater.check()).toBeNull()
    waitPassed(releases, good)
    expect((await updater.check())?.sha256).toBe(good)
    expect(existsSync(join(releases, `${good}.attempts`))).toBe(false)
    expect(log).toHaveBeenCalledWith('no se pudo preparar la versión nueva; reintento más tarde', expect.anything())
  })

  it('asks the server at most once a minute', async () => {
    const data = join(dir, 'data')
    server.offer(makePackage(dir, 'a'))
    const updater = new Updater(
      testInstallation(data, null),
      new WorkerClient(server.url, 'tcg_wk_test', silent),
      silent,
    )
    const ready = await updater.check()
    for (let i = 0; i < 5; i++) expect(await updater.check()).toEqual(ready)
    expect(server.state.requests.filter((line) => line.endsWith('/version'))).toHaveLength(1)
  })

  it('a new release that fails to start is tried three times, then rolled back for a day; signals do not count', () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const [a, b] = ['a', 'b'].map((x) => x.repeat(64)) as [string, string]
    for (const sha of [a, b]) mkdirSync(join(releases, sha), { recursive: true })
    const installation = testInstallation(data, null)
    writePointer(releases, { sha: b, previous: a, base: 'build-1' })
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('restart')
    // Android's phantom process killer: ends it as before, and the release is not blamed.
    expect(afterFailedStart(installation, { code: null, signal: 'SIGKILL' }, silent)).toBe('stop')
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('restart')
    expect(readPointer(releases)?.sha).toBe(b)
    expect(isBad(releases, b)).toBe(false)
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('restart')
    expect(readPointer(releases)).toEqual({ sha: a, previous: null, base: 'build-1' })
    expect(badMark(releases, b)?.permanent).toBeUndefined()
    expect(isBad(releases, b)).toBe(true)
    // `a` worked before: an error now is the worker's, not the release's.
    writeFileSync(join(releases, a, 'healthy'), '')
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('stop')
  })

  it('an engine that plays differently goes back at once and for good; Windows can go back to its own code', () => {
    const data = join(dir, 'data')
    const releases = join(data, 'releases')
    const b = 'b'.repeat(64)
    mkdirSync(join(releases, b), { recursive: true })
    writePointer(releases, { sha: b, previous: null, base: 'build-1' })
    expect(afterFailedStart(testInstallation(data, null), { code: 3 }, silent)).toBe('restart')
    expect(readPointer(releases)?.sha).toBeNull()
    expect(badMark(releases, b)?.permanent).toBe(true)
  })

  it('Android without a release to go back to stops after its tries instead of rolling back', () => {
    const releases = join(dir, 'android', 'releases')
    const b = 'b'.repeat(64)
    mkdirSync(join(releases, b), { recursive: true })
    const installation = androidInstallation(join(releases, b))
    if (!installation) throw new Error('missing installation')
    writePointer(releases, { sha: b, previous: null })
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('restart')
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('restart')
    expect(afterFailedStart(installation, { code: 1 }, silent)).toBe('stop')
    expect(readPointer(releases)?.sha).toBe(b)
  })

  it('restarts are paced: a moment after an update, half a minute after a failure, ten minutes after five', () => {
    const pacer = new RestartPacer()
    const t = Date.now()
    expect(pacer.delayMs('update', t)).toBe(2_000)
    expect(pacer.delayMs('failure', t + 1)).toBe(30_000)
    for (const i of [2, 3, 4]) pacer.delayMs('update', t + i)
    expect(pacer.delayMs('update', t + 5)).toBe(10 * 60_000)
    expect(pacer.delayMs('update', t + 11 * 60_000)).toBe(2_000)
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

  it('on a release that never got ready, a failing loop ends the process so its supervisor can count it', async () => {
    const data = join(dir, 'data')
    vi.stubEnv('TCG_WORKER_DIR', data)
    vi.stubEnv('TCG_WORKER_TOKEN', 'tcg_wk_test')
    vi.stubEnv('TCG_SERVER', server.url)
    const sha = server.offer(makePackage(dir, 'running'))
    mkdirSync(join(data, 'releases', sha), { recursive: true })
    // Its engine does not start: before D-026's review this retried every 60 s forever.
    const engine = join(dir, 'missing-engine.exe')
    await expect(run([], { enginePath: engine }, { installation: testInstallation(data, sha) })).rejects.toThrow()
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

describe('packages and setup (D-026)', () => {
  it('the same files give the same tar.gz, whatever their dates; tar reads it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tcg-tar-'))
    try {
      const source = join(dir, 'src')
      mkdirSync(join(source, 'licenses', 'a'.repeat(80)), { recursive: true })
      writeFileSync(join(source, 'worker.cjs'), 'exports.main = 1\n')
      writeFileSync(join(source, 'engine-cli.exe'), 'MZ')
      writeFileSync(join(source, 'licenses', 'a'.repeat(80), `${'b'.repeat(90)}.txt`), 'long path\n')
      await writeTarGz(source, 'tcg-worker', join(dir, 'one.tar.gz'), ['engine-cli.exe'])
      utimesSync(join(source, 'worker.cjs'), new Date(2001, 1, 1), new Date(2001, 1, 1))
      await writeTarGz(source, 'tcg-worker', join(dir, 'two.tar.gz'), ['engine-cli.exe'])
      expect(sha256(readFileSync(join(dir, 'one.tar.gz')))).toBe(sha256(readFileSync(join(dir, 'two.tar.gz'))))
      mkdirSync(join(dir, 'out'))
      execFileSync(tar, ['-xzf', join(dir, 'one.tar.gz'), '-C', join(dir, 'out')])
      const long = join(dir, 'out', 'tcg-worker', 'licenses', 'a'.repeat(80), `${'b'.repeat(90)}.txt`)
      expect(readFileSync(long, 'utf8')).toBe('long path\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('setup stops only processes that are workers', () => {
    expect(looksLikeWorker('"C:\\tcg-worker\\tcg-worker.exe" --run')).toBe(true)
    expect(looksLikeWorker('"C:\\Program Files\\nodejs\\node.exe" "C:\\repo\\apps\\worker\\dist\\main.js"')).toBe(true)
    expect(looksLikeWorker('"C:\\Windows\\explorer.exe"')).toBe(false)
    expect(looksLikeWorker('')).toBe(false)
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
    // Switches to `b`; `b` fails three times before it is ready; back on `a`, which stops normally.
    const codes = [RESTART_FOR_UPDATE, 1, 1, 1, 0]
    const runChild = vi.fn(async () => {
      const code = codes.shift() ?? 0
      if (code === RESTART_FOR_UPDATE) writePointer(releases, { sha: b, previous: a, base: 'build-1' })
      return { code, signal: null }
    })
    const wait = vi.fn(async (_ms: number) => undefined)
    expect(await supervise({ dataDir: dir, installation, log: silent, runChild, wait })).toBe(0)
    expect(runChild).toHaveBeenCalledTimes(5)
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([2_000, 30_000, 30_000, 30_000])
    expect(readPointer(releases)?.sha).toBe(a)
    expect(isBad(releases, b)).toBe(true)
    expect(isHealthy(releases, a)).toBe(true)
    // An error on a healthy release ends the supervisor with it.
    const fails = async () => ({ code: 4, signal: null })
    expect(await supervise({ dataDir: dir, installation, log: silent, runChild: fails, wait: async () => 0 })).toBe(4)
  })

  it('a second supervisor in the same folder does nothing', async () => {
    mkdirSync(join(dir, 'supervisor'), { recursive: true })
    writeFileSync(join(dir, 'supervisor', 'worker.lock'), String(process.ppid))
    const runChild = vi.fn(async () => ({ code: 0, signal: null }))
    expect(
      await supervise({ dataDir: dir, installation: windowsInstallation(dir, null, 'b'), log: silent, runChild }),
    ).toBe(0)
    expect(runChild).not.toHaveBeenCalled()
  })
})
