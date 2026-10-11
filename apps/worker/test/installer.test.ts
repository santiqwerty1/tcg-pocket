import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
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
      'engine-cli': 'fake',
      'determinism.json': '{"version":{"engineRev":"test","cliVersion":"test"}}',
    })) {
      await writeFile(join(fixture, 'tcg-worker', file), content)
    }
    await build({
      entryPoints: [join(import.meta.dirname, '../src/android.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      outfile: join(fixture, 'tcg-worker/worker.mjs'),
    })
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
      node: `#!/bin/sh\ncase "$1" in */worker.mjs) if [ "$2" != '--stop' ]; then echo "worker $2"; exit 0; fi;; esac\nexec ${quote(process.execPath)} "$@"\n`,
    }
    for (const [name, content] of Object.entries(scripts)) {
      await writeFile(join(bin, name), content)
      await chmod(join(bin, name), 0o755)
    }
    const installer = join(import.meta.dirname, '../android/install.sh')
    async function install(updating: boolean, widgets = 's', name = '', defaultName = 'Android') {
      const child = spawn('script', ['-e', '-q', '-c', `bash ${quote(installer)} https://tcg.example`, '/dev/null'], {
        env: {
          ...process.env,
          PATH: `${bin}:${prefix}/bin:${process.env.PATH}`,
          TCG_ANDROID_HOME: root,
          TCG_ANDROID_BOOT_DIR: boot,
          PREFIX: prefix,
          HOME: dir,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const prompts = [
        'Token de worker',
        'Núcleos',
        `Nombre en la app (Enter = ${defaultName})`,
        '¿Solo mientras carga?',
        '¿Arrancar al encender',
        '¿Accesos directos',
      ]
      const answers = [updating ? '' : token, '', name, 'n', widgets, widgets]
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
        expect(output).toContain('No hay un worker corriendo.')
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      await install(false)
      const configPath = join(root, 'data/config.json')
      const readConfig = async () => JSON.parse(await readFile(configPath, 'utf8'))
      expect((await readConfig()).name).toBe('Android')
      await writeFile(configPath, JSON.stringify({ ...(await readConfig()), name: 'Android localhost' }))
      await install(true, 's', 'Celu de Santi')
      expect((await readConfig()).name).toBe('Celu de Santi')
      await install(true, 's', '', 'Celu de Santi')
      expect((await readConfig()).name).toBe('Celu de Santi')
      const curl = JSON.parse(await readFile(trace, 'utf8')) as { args: string[]; stdin: string; envToken?: string }
      expect(curl.stdin).toContain(`Authorization: Bearer ${token}`)
      expect(curl.args.join(' ')).not.toContain(token)
      expect(curl.args.at(-1)).toBe('https://tcg.example/api/worker/packages/android-arm64')
      expect(curl.envToken).toBeUndefined()
      const config = JSON.parse(await readFile(configPath, 'utf8')) as {
        token: string
        cores: number
        priority: string
        onlyCharging: boolean
      }
      expect(config.token).toBe(token)
      expect(config.cores).toBe(Math.max(1, Math.floor(availableParallelism() / 2)))
      expect(config.priority).toBe('below_normal')
      expect(config.onlyCharging).toBe(false)
      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
      const launcher = join(prefix, 'bin/tcg-worker')
      const launchEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
      execFileSync('bash', [launcher, '--check'], { env: launchEnv })
      expect(await readFile(launcher, 'utf8')).not.toContain(token)
      expect(await readFile(join(boot, 'tcg-worker'), 'utf8')).not.toContain(token)
      const shortcuts = join(dir, '.shortcuts')
      const start = join(shortcuts, 'Arrancar worker')
      const stop = join(shortcuts, 'tasks/Detener worker')
      const status = join(shortcuts, 'Estado del worker')
      for (const file of [shortcuts, join(shortcuts, 'tasks'), start, stop, status])
        expect((await stat(file)).mode & 0o777).toBe(0o700)
      for (const file of [start, stop, status]) {
        expect(await readFile(file, 'utf8')).toMatch(new RegExp(`^#!${prefix}/bin/bash`))
        expect(await readFile(file, 'utf8')).not.toContain(token)
      }
      expect(execFileSync('bash', [start], { env: launchEnv, encoding: 'utf8' })).toContain('worker')
      expect(execFileSync('bash', [stop], { env: launchEnv, encoding: 'utf8' })).toContain('No hay un worker')
      const toastFile = join(dir, 'toast.txt')
      await writeFile(join(prefix, 'bin/termux-toast'), `#!/bin/sh\nprintf '%s' "$1" > ${quote(toastFile)}\n`)
      await chmod(join(prefix, 'bin/termux-toast'), 0o700)
      execFileSync('bash', [stop], { env: launchEnv })
      expect(await readFile(toastFile, 'utf8')).toContain('No hay un worker')
      await writeFile(join(root, 'data/worker.lock'), String(process.pid))
      expect(() => execFileSync('bash', [stop], { env: launchEnv, stdio: 'pipe' })).toThrow()
      expect(await readFile(toastFile, 'utf8')).toContain('otro proceso')
      await rm(join(root, 'data/worker.lock'))
      const checking = spawn('bash', [status], { env: launchEnv, stdio: ['pipe', 'pipe', 'pipe'] })
      const checked = once(checking, 'exit')
      let checkOutput = ''
      checking.stdout.on('data', (data: Buffer) => {
        checkOutput += data.toString()
      })
      try {
        await expect.poll(() => checkOutput, { timeout: 2000 }).toContain('worker --check')
        expect(checking.exitCode).toBeNull()
        checking.stdin.write('\n')
        expect((await checked)[0]).toBe(0)
      } finally {
        if (checking.exitCode === null) checking.kill('SIGKILL')
      }
      // Reinstallation replaces edited scripts, then opting out removes only our shortcuts.
      await writeFile(start, 'obsolete')
      await install(true, 's', '', 'Celu de Santi')
      expect(await readFile(start, 'utf8')).not.toContain('obsolete')
      const other = join(shortcuts, 'Mi otro acceso')
      await writeFile(other, 'keep')
      await install(true, 'n', '', 'Celu de Santi')
      for (const file of [start, stop, status, join(boot, 'tcg-worker')])
        await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(other, 'utf8')).toBe('keep')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  30_000,
)
