import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it.skipIf(process.platform === 'win32')(
  'Termux installer hides token, verifies download and creates a usable launcher; rerun updates',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tcg-install-test-'))
    const bin = join(dir, 'bin'),
      root = join(dir, 'install'),
      boot = join(dir, 'boot'),
      prefix = join(dir, 'prefix')
    const fixture = join(dir, 'fixture'),
      token = 'tcg_wk_fixture_android'
    await mkdir(bin)
    await mkdir(join(prefix, 'bin'), { recursive: true })
    await symlink('/bin/bash', join(prefix, 'bin/bash'))
    await mkdir(join(fixture, 'tcg-worker'), { recursive: true })
    for (const [file, content] of Object.entries({
      'worker.mjs': '',
      'engine-cli': 'fake',
      'determinism.json': '{"version":{"engineRev":"test","cliVersion":"test"}}',
    })) {
      await writeFile(join(fixture, 'tcg-worker', file), content)
    }
    const archive = join(dir, 'package.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', fixture, 'tcg-worker'])
    const sha = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')
    const helper = join(dir, 'curl.mjs'),
      trace = join(dir, 'curl.json')
    await writeFile(
      helper,
      `import fs from 'node:fs';
const args=process.argv.slice(2);let stdin='';process.stdin.setEncoding('utf8').on('data',d=>stdin+=d).on('end',()=>{
fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({args,stdin,envToken:process.env.token}));
fs.copyFileSync(${JSON.stringify(archive)},args[args.indexOf('--output')+1]);
fs.writeFileSync(args[args.indexOf('--dump-header')+1],'HTTP/1.1 200 OK\\r\\nX-Checksum-Sha256: ${sha}\\r\\n');});`,
    )
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
    const scripts = {
      uname: '#!/bin/sh\necho aarch64\n',
      pkg: '#!/bin/sh\nexit 0\n',
      curl: `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(helper)} "$@"\n`,
      node: `#!/bin/sh\ncase "$1" in */worker.mjs) exit 0;; esac\nexec ${quote(process.execPath)} "$@"\n`,
    }
    for (const [name, content] of Object.entries(scripts)) {
      await writeFile(join(bin, name), content)
      await chmod(join(bin, name), 0o755)
    }
    const installer = join(import.meta.dirname, '../android/install.sh')
    async function install(updating: boolean) {
      const child = spawn('script', ['-e', '-q', '-c', `bash ${quote(installer)} https://tcg.example`, '/dev/null'], {
        env: {
          ...process.env,
          PATH: `${bin}:${prefix}/bin:${process.env.PATH}`,
          TCG_ANDROID_HOME: root,
          TCG_ANDROID_BOOT_DIR: boot,
          PREFIX: prefix,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const prompts = ['Token de worker', 'Núcleos', '¿Solo mientras carga?', '¿Arrancar al encender']
      const answers = [updating ? '' : token, '', 'n', 's']
      let step = 0,
        output = ''
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString()
        if (step < prompts.length && output.includes(prompts[step] ?? 'never')) {
          child.stdin.write(`${answers[step]}\n`)
          step++
        }
      })
      child.stderr.on('data', (data: Buffer) => {
        output += data.toString()
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      try {
        const [code] = await once(child, 'exit')
        expect(output).not.toContain(token)
        expect(code, output).toBe(0)
        expect(step).toBe(prompts.length)
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      await install(false)
      await install(true)
      const curl = JSON.parse(await readFile(trace, 'utf8')) as { args: string[]; stdin: string; envToken?: string }
      expect(curl.stdin).toContain(`Authorization: Bearer ${token}`)
      expect(curl.args.join(' ')).not.toContain(token)
      expect(curl.args.at(-1)).toBe('https://tcg.example/api/worker/packages/android-arm64')
      expect(curl.envToken).toBeUndefined()
      const configPath = join(root, 'data/config.json')
      const config = JSON.parse(await readFile(configPath, 'utf8')) as {
        token: string
        cores: number
        onlyCharging: boolean
      }
      expect(config.token).toBe(token)
      expect(config.cores).toBe(Math.max(1, Math.floor(availableParallelism() / 2)))
      expect(config.onlyCharging).toBe(false)
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
      const launcher = join(prefix, 'bin/tcg-worker')
      const launchEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
      execFileSync('bash', [launcher, '--check'], { env: launchEnv })
      expect(await readFile(launcher, 'utf8')).not.toContain(token)
      expect(await readFile(join(boot, 'tcg-worker'), 'utf8')).not.toContain(token)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  30_000,
)
