// node --test scripts/ci/privacy-check.test.mjs — the public-repo check of each PR (D-022).
// The suspicious values are built from pieces, so this file's own diff carries none of them.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { addedLines, badCommits, check, findInLines, masked, sha256 } from './privacy-check.mjs'

const SCRIPT = fileURLToPath(new URL('./privacy-check.mjs', import.meta.url))
const AT = '@'
const mail = (local, domain) => `${local}${AT}${domain}`
const users = (prefix, sep, name) => `${prefix}Users${sep}${name}`
const token = (kind) => `tcg_${kind}_${'Ab1-_'.repeat(9)}`
const jwtPart = (text) => Buffer.from(text).toString('base64url')
const jwt = `${jwtPart('{"alg":"HS256","typ":"JWT"}')}.${jwtPart('{"sub":"1234567890","iat":1}')}.${'s'.repeat(20)}`
const ref = 'abcdefghijklmnopqrst'
const supa = 'supa' + 'base'
const begin = (kind) => `-----BEGIN ${kind}${'PRIVATE'} KEY-----`

const line = (text, file = 'apps/x.ts') => ({ file, line: 1, text })
const rules = (text, allow) => findInLines([line(text)], allow).map((finding) => finding.regla)

describe('what the diff and the messages may not add', () => {
  it('mails, but not noreply, the example, test and local domains, file names or service addresses', () => {
    assert.deepEqual(rules(`contact ${mail('alguien', 'gmail.com')}`), ['mail'])
    assert.deepEqual(rules(`by ${mail('7223+someone', 'users.noreply.github.com')}`), [])
    assert.deepEqual(rules(`Co-Authored-By: Claude <${mail('noreply', 'anthropic.com')}>`), [])
    assert.deepEqual(rules(mail('no-reply', 'accounts.google.com')), [])
    for (const domain of [
      'example.com',
      'pantallas.test',
      'b.invalid',
      'localhost',
      'x.example',
      'host.docker.internal',
    ]) {
      assert.deepEqual(rules(mail('owner', domain)), [], domain)
    }
    assert.deepEqual(rules(`icon${AT}2x.png and git${AT}github.com:org/repo.git`), [])
    assert.deepEqual(rules(`Signed-off-by: dependabot[bot] <${mail('support', 'github.com')}>`), [])
  })

  it('a Windows user in a path, in every spelling, but not a placeholder', () => {
    for (const path of [
      users('C:/', '/', 'jperez'),
      users('C:\\', '\\', 'jperez'),
      users('C:\\\\', '\\\\', 'jperez'),
      users('/c/', '/', 'jperez'),
      users('/mnt/c/', '/', 'jperez'),
      users('file:///C:/', '/', 'jperez'),
    ]) {
      assert.deepEqual(rules(`cd ${path}/repo`), ['ruta'], path)
    }
    for (const name of [
      '<usuario>',
      '<…>',
      '%USERNAME%',
      '$' + '{USER}',
      '$USER',
      '$env:USERNAME',
      '{usuario}',
      '…',
      'Public',
      'All Users',
      'runneradmin',
    ]) {
      assert.deepEqual(rules(`cd ${users('C:/', '/', name)}/Personal`), [], name)
    }
    // A real name between the signs of a placeholder is still a real name.
    for (const name of ['<jperez>', '<ana>', '%jperez%', '{jperez}', '$jperez', '$' + '{jperez}']) {
      assert.deepEqual(rules(`cd ${users('C:/', '/', name)}/Personal`), ['ruta'], name)
    }
  })

  it('the app’s tokens, also glued to other text; the short placeholders of the docs pass', () => {
    assert.deepEqual(rules(`Authorization: Bearer ${token('mcp')}`), ['token'])
    assert.deepEqual(rules(`Bearer%20${token('wk')}`), ['token'])
    assert.deepEqual(rules(`"line\\n${token('rl')}"`), ['token'])
    assert.deepEqual(rules('un token tcg_mcp_… o tcg_wk_AbCdEf'), [])
  })

  it('Supabase refs, the pooler user and the dashboard; Postgres with a password to a host that is not local', () => {
    assert.deepEqual(rules(`postgres://${ref}.${supa}.co:5432`), ['supabase'])
    assert.deepEqual(rules(`user postgres.${ref} on aws-0-sa-east-1.pooler.${supa}.com`), ['supabase'])
    assert.deepEqual(rules(`${supa}.com/dashboard/project/${ref}`), ['supabase'])
    assert.deepEqual(rules(`app.${supa}.com/project/${ref}`), ['supabase'])
    assert.deepEqual(rules(`la ref de Supabase, <ref>.${supa}.co`), [])
    // The ref is lowercase: a property of the same length is not one.
    assert.deepEqual(rules('postgres.transactionIsolation = 1'), [])
    assert.deepEqual(rules(`postgresql://app:s3cr3t${AT}10.0.0.7:5432/tcg`), ['postgres'])
    for (const host of ['127.0.0.1', 'localhost', 'host.docker.internal', 'postgres']) {
      assert.deepEqual(rules(`postgresql://tcg:tcg${AT}${host}:5433/tcg`), [], host)
    }
    // A password that is a placeholder, as in the docs.
    for (const password of ['<clave>', '$' + '{PGPASSWORD}', '$PGPASSWORD', '%PGPASSWORD%', '…', '***']) {
      const url = `postgresql://postgres.<ref>:${password}${AT}aws-0-<región>.pooler.${supa}.com:5432/postgres`
      assert.deepEqual(rules(url), [], password)
    }
  })

  it('other services’ tokens, JWT and private keys of every kind; a certificate passes', () => {
    for (const secret of [
      `gh${'p'}_${'a'.repeat(36)}`,
      `github_${'pat'}_${'a'.repeat(60)}`,
      `Fly${'V1'} ${'fm2_'}${'a'.repeat(40)}`,
      `${'tsec'}_${'a'.repeat(30)}`,
      `${'sb_secret'}_${'a'.repeat(30)}`,
      `x${'gh'}p_${'a'.repeat(36)}`,
      `${'AKIA'}${'A1B2'.repeat(4)}`,
    ]) {
      assert.deepEqual(rules(secret), ['secreto'], secret.slice(0, 6))
    }
    assert.deepEqual(rules(`Bearer ${jwt}`), ['jwt'])
    for (const kind of ['', 'RSA ', 'EC ', 'OPENSSH ', 'PGP ']) {
      const key = kind === 'PGP ' ? `${begin(kind)}`.replace('KEY-----', 'KEY BLOCK-----') : begin(kind)
      assert.deepEqual(rules(key), ['clave'], kind)
    }
    assert.deepEqual(rules(`PuTTY-User-Key-File-${3}: ssh-ed25519`), ['clave'])
    assert.deepEqual(rules('-----BEGIN CERTIFICATE-----'), [])
  })

  it('exceptions name their rule and say why: in the line, by the sha256 of the text, or by file and rule', () => {
    const real = mail('alguien', 'gmail.com')
    assert.deepEqual(rules(`${real} // privacy-allow(mail): el mail público de la licencia`), [])
    // Only the rule it names, and never without a motive.
    assert.deepEqual(rules(`${real} ${token('mcp')} // privacy-allow(mail): ejemplo`), ['token'])
    assert.deepEqual(rules(`${real} // privacy-allow(mail):`), ['mail'])
    assert.deepEqual(rules(real, [{ sha256: sha256(real), motivo: 'falso positivo conocido' }]), [])
    assert.deepEqual(
      findInLines([line(real, 'docs/x.md')], [{ archivo: 'docs/x.md', regla: 'mail', motivo: 'ejemplo' }]),
      [],
    )
    assert.deepEqual(
      findInLines([line(real, 'docs/y.md')], [{ archivo: 'docs/x.md', regla: 'mail', motivo: 'ejemplo' }]).length,
      1,
    )
    // Two markers on one line: each motive ends where the next marker starts.
    assert.deepEqual(
      rules(`${real} ${token('mcp')} // privacy-allow(mail): ejemplo privacy-allow(token): el de la doc`),
      [],
    )
    // Without a motive (or with one that is not text), the exception does not count and is a finding itself.
    assert.deepEqual(rules(real, [{ sha256: sha256(real) }]), ['excepción', 'mail'])
    assert.deepEqual(rules(real, [{ sha256: sha256(real), motivo: 3 }]), ['excepción', 'mail'])
    assert.deepEqual(rules(real, [{ archivo: 'apps/x.ts', regla: 'mail' }]), ['excepción', 'mail'])
    // The exceptions used are listed (for the CI's log).
    const { excepted } = check([line(`${real} // privacy-allow(mail): ejemplo`)])
    assert.deepEqual(excepted, [{ regla: 'mail', file: 'apps/x.ts', line: 1, motivo: 'ejemplo' }])
  })

  it('a finding never prints the text it found, only its hash; a motive for the log has it covered', () => {
    const [finding] = findInLines([line(mail('alguien', 'gmail.com'))])
    assert.ok(finding && !finding.why.includes('gmail'))
    assert.match(finding?.why ?? '', /^mail \(sha256 [0-9a-f]{16}…\)$/)
    assert.equal(
      masked(`el de ${mail('alguien', 'gmail.com')} y ${token('wk')}, ejemplo de la doc`),
      'el de [mail] y [token], ejemplo de la doc',
    )
  })
})

describe('reading a diff and the commits', () => {
  it('only the added lines, with their file and line; «++» in a line is content, quoted and tabbed names are read', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +10,3 @@',
      ' kept',
      '-gone',
      '+new one',
      '+++ still content of a.ts',
      'diff --git "a/decisi\\303\\263n.md" "b/decisión.md"',
      '--- /dev/null',
      '+++ "b/decisión.md"',
      '@@ -0,0 +1 @@',
      '+acento',
      'diff --git a/con espacio.md b/con espacio.md',
      '--- a/con espacio.md',
      '+++ b/con espacio.md\t',
      '@@ -1 +1 @@',
      '+espacio',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-all gone',
    ].join('\n')
    assert.deepEqual(addedLines(diff), [
      { file: 'a.ts', line: 11, text: 'new one' },
      { file: 'a.ts', line: 12, text: '++ still content of a.ts' },
      { file: 'decisión.md', line: 1, text: 'acento' },
      { file: 'con espacio.md', line: 1, text: 'espacio' },
    ])
  })

  it('commits whose author or committer is not noreply (anchored: a look-alike domain is not)', () => {
    const ok = mail('7223+someone', 'users.noreply.github.com')
    const log = [
      `aaa\t${ok}\t${ok}`,
      `bbb\t${ok}\t${mail('noreply', 'github.com')}`,
      `ccc\t${mail('alguien', 'gmail.com')}\t${ok}`,
      `ddd\t${ok}\t${mail('alguien', 'gmail.com')}`,
      `eee\t${mail('noreply', 'anthropic.com')}\t${mail('noreply', 'anthropic.com')}`,
      `fff\t${mail('x', 'users.noreply.github.com.evil.io')}\t${ok}`,
    ].join('\n')
    assert.deepEqual(
      badCommits(log).map((commit) => commit.sha),
      ['ccc', 'ddd', 'fff'],
    )
  })
})

describe('the command, on a repository of its own', () => {
  function repo() {
    const root = mkdtempSync(join(tmpdir(), 'privacy-'))
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    const run = (...args) =>
      execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    const commit = (file, text, email = mail('1+t', 'users.noreply.github.com'), message = file) => {
      writeFileSync(join(root, file), text)
      git('add', file)
      git('-c', 'user.name=t', '-c', `user.email=${email}`, 'commit', '-q', '-m', message)
      return git('rev-parse', 'HEAD').trim()
    }
    git('init', '-q')
    return { root, git, run, commit }
  }
  const failsWith = (fn, pattern) =>
    assert.throws(fn, (error) => pattern.test(String(error.stderr)) && !String(error.stderr).includes('gmail'))

  it('a clean PR passes; a token in the diff, a personal mail in a commit or in its message fail', () => {
    const { root, run, commit } = repo()
    try {
      const base = commit('a.txt', 'base\n')
      commit('b.txt', 'nada raro\n')
      assert.match(run('--base', base), /Privacidad: sin mails/)
      const leak = commit('c.txt', `secret ${token('mcp')}\n`)
      failsWith(() => run('--base', base, '--head', leak), /c\.txt:1: token/)
      const personal = commit('d.txt', 'ok\n', mail('alguien', 'gmail.com'))
      failsWith(() => run('--base', leak, '--head', personal), /autor y committer con un mail que no es noreply/)
      const said = commit('e.txt', 'ok\n', undefined, `log pegado: ${users('C:/', '/', 'jperez')}/x`)
      failsWith(() => run('--base', personal, '--head', said), /commit [0-9a-f]{7}:1: ruta/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a file with an accent in its name and a file git takes for binary are checked too', () => {
    const { root, run, commit } = repo()
    try {
      const base = commit('.gitattributes', '*.md -diff\n')
      const accent = commit('decisión.md', `secret ${token('wk')}\n`)
      failsWith(() => run('--base', base, '--head', accent), /decisión\.md:1: token/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('only what the PR adds since it branched: what the base removed after that is not the PR’s', () => {
    const { root, run, commit, git } = repo()
    try {
      commit('a.txt', 'base\n')
      // An old leak the base had when the PR branched, and removed afterwards.
      commit('old.txt', `secret ${token('mcp')}\n`)
      git('checkout', '-q', '-b', 'pr')
      const head = commit('b.txt', 'nada raro\n')
      git('checkout', '-q', '-')
      git('rm', '-q', 'old.txt')
      git('-c', 'user.name=t', '-c', `user.email=${mail('1+t', 'users.noreply.github.com')}`, 'commit', '-q', '-m', 'x')
      const base = git('rev-parse', 'HEAD').trim()
      // Between the two tips (`base..head`), old.txt would look added by the PR.
      assert.match(run('--base', base, '--head', head), /Privacidad: sin mails/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a git that fails or a broken allowlist stop it with code 2, saying only what failed', () => {
    const { root, run, commit } = repo()
    try {
      commit('a.txt', 'base\n')
      assert.throws(
        () => run('--base', 'no-such-ref'),
        (error) => error.status === 2 && /^✗ git log falló \(\d+\)\n$/.test(String(error.stderr)) && !error.stdout,
      )
      // A copy of the check whose allowlist is not a list.
      const copy = join(root, 'copy', 'scripts', 'ci')
      mkdirSync(copy, { recursive: true })
      writeFileSync(join(copy, 'privacy-check.mjs'), readFileSync(SCRIPT))
      writeFileSync(join(copy, 'privacy-allow.json'), '{"motivo": "no es una lista"}\n')
      assert.throws(
        () =>
          execFileSync(process.execPath, [join(copy, 'privacy-check.mjs'), '--base', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        (error) => error.status === 2 && /tiene que ser una lista/.test(String(error.stderr)),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('says when a PR changes this check, and lists the exceptions it used', () => {
    const { root, run, commit, git } = repo()
    try {
      const base = commit('a.txt', 'base\n')
      git('checkout', '-q', '-b', 'pr')
      const real = mail('alguien', 'gmail.com')
      // A motive that quotes what it excepts: the log covers it.
      const head = commit('x.txt', `${real} privacy-allow(mail): el ejemplo del README, ${real}\n`)
      const out = run('--base', base, '--head', head)
      assert.match(out, /::notice title=privacidad::x\.txt:1: mail exceptuado, «el ejemplo del README, \[mail\]»/)
      assert.ok(!out.includes('gmail'))
      assert.doesNotMatch(out, /::warning/)
      mkdirSync(join(root, 'scripts', 'ci'), { recursive: true })
      const guard = commit('scripts/ci/privacy-allow.json', '[]\n')
      assert.match(
        run('--base', head, '--head', guard),
        /::warning title=privacidad::este PR cambia scripts\/ci\/privacy-allow\.json/,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
