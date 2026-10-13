#!/usr/bin/env node
// El repo es público (D-022). En cada PR, la CI (job `privacy`) falla si:
// - algún commit del PR tiene autor o committer con un mail que no es noreply (`*@users.noreply.github.com`,
//   `noreply@github.com`, o `noreply@anthropic.com` de las sesiones en la nube);
// - el diff o los mensajes de los commits agregan mails que no son noreply ni de dominios reservados para ejemplos
//   (example.com, .test, .invalid, .internal…), rutas `C:/Users/<…>` (o con `\`, `/c/Users/<…>`, `/mnt/c/…`) con un
//   nombre que no es un marcador, tokens de la app (`tcg_mcp_`, `tcg_wk_`, `tcg_rl_` con su parte secreta), refs de
//   Supabase (`<ref>.supabase.co`, el usuario `postgres.<ref>` del pooler, el panel del proyecto), una URL de Postgres
//   con contraseña a un host que no es local, tokens de GitHub, Fly o Tigris, JWT o claves privadas (PEM, PGP, PuTTY).
// No guarda ningún dato real para buscarlo: son formas, no valores. Nunca imprime lo que encontró: el archivo o el
// commit, la línea, la regla y un prefijo del sha256.
//
// Excepciones para falsos positivos, siempre con la regla y un motivo:
// - en la misma línea, `privacy-allow(<regla>): <motivo>` (solo esa regla, en esa línea);
// - en scripts/ci/privacy-allow.json, `{ "sha256": "<sha256 del texto encontrado>", "motivo": "…" }` (el texto mismo no
//   va: si fuera un dato real, quedaría publicado) o `{ "archivo": "<ruta>", "regla": "<regla>", "motivo": "…" }`.
// Cada excepción usada queda en el log de la CI (`::notice`), y un PR que toca este control lo avisa (`::warning`).
//
//   node scripts/ci/privacy-check.mjs --base <sha> [--head <sha>]   (por defecto head = HEAD)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** Commit authors and committers that are nobody's mail. */
const NOREPLY_COMMIT = /^(?:[^@\s]+@users\.noreply\.github\.com|noreply@github\.com|noreply@anthropic\.com)$/i

/** RFC 2606, 6761 and 8375 (and Docker's `host.docker.internal`): domains for examples, tests and local hosts. */
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|org|net)|test|example|invalid|localhost|local|internal|home\.arpa)$/i
/** «icon@2x.png»: a file name, not a mail. */
const FILE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/i
/** Mails that are services', not people's: SSH remotes and the bots' trailers. */
const SERVICE_MAIL = /^(git@github\.com|git@gitlab\.com|support@github\.com|noreply@github\.com)$/i
/** Hosts a Postgres URL may hold a password for: the local ones and the CI's. */
const LOCAL_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|::1|postgres|db|host\.docker\.internal|[^.]+\.(internal|local|test))$/i
/** Placeholders for a user name in a path: `<usuario>`, `%USERNAME%`, `${USER}`, `{usuario}`, `…`, and Windows' own. */
const PATH_PLACEHOLDER =
  /^(<[^>]*>|%[^%]+%|\$\{?[A-Za-z_]+\}?|\{[^}]*\}|…+|\.\.\.|Public|Default|All Users|runneradmin)$/i

/** What the diff and the commit messages may not add. Each finding names its rule, so an exception can name it too. */
export const RULES = [
  {
    regla: 'mail',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allowed: (text) => {
      const [local = '', domain = ''] = text.toLowerCase().split('@')
      return (
        domain === 'users.noreply.github.com' ||
        local === 'noreply' ||
        local === 'no-reply' ||
        EXAMPLE_DOMAIN.test(domain) ||
        FILE_EXTENSION.test(domain) ||
        SERVICE_MAIL.test(text)
      )
    },
  },
  {
    regla: 'ruta',
    pattern: /(?:[A-Za-z]:(?:\\\\|\\|\/\/|\/)|\/(?:mnt\/)?[a-z]\/)Users(?:\\\\|\\|\/\/|\/)([^\\/\s'"`|]+)/gi,
    allowed: (text) => {
      const name = /Users(?:\\\\|\\|\/\/|\/)(.+)$/i.exec(text)?.[1] ?? ''
      return PATH_PLACEHOLDER.test(name)
    },
  },
  // Without a leading \b: «Bearer%20tcg_mcp_…» and «\ntcg_mcp_…» count too; the prefix is specific enough.
  { regla: 'token', pattern: /tcg_(?:mcp|wk|rl)_[A-Za-z0-9_-]{20,}/g },
  {
    regla: 'supabase',
    pattern:
      /\b[a-z0-9-]+\.supabase\.(?:co|in)\b|\bpostgres\.[a-z0-9]{20}\b|supabase\.com\/dashboard\/project\/[a-z0-9]+/gi,
  },
  {
    regla: 'postgres',
    pattern: /postgres(?:ql)?:\/\/[^\s:@/'"`]+:[^\s@/'"`]+@([^\s:/'"`?]+)/gi,
    allowed: (text) => LOCAL_HOST.test(/@([^\s:/'"`?]+)$/.exec(text)?.[1] ?? ''),
  },
  {
    regla: 'secreto',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|FlyV1 [A-Za-z0-9_+/=,-]{20,}|fm[12]_[A-Za-z0-9_+/=-]{20,}|tsec_[A-Za-z0-9_+/=-]{20,}|sb_secret_[A-Za-z0-9_-]{20,})/g,
  },
  { regla: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    regla: 'clave',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|PuTTY-User-Key-File-\d/g,
  },
]

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A file name of a `diff --git` header line: «b/x», «"b/decisión.md"» (quoted when it has odd characters), tabs off. */
function headerPath(raw) {
  let path = raw.replace(/\t$/, '')
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\(["\\])/g, '$1')
  return path.startsWith('b/') ? path.slice(2) : null
}

/**
 * The lines a unified diff adds, with their file and line in the new version. Headers count only between
 * `diff --git` and the first `@@` (an added line may start with «++ »). An added line whose file cannot be read is
 * still checked, under «(archivo sin nombre)»: never skipped.
 * @param {string} diff
 */
export function addedLines(diff) {
  const out = []
  let file = null
  let header = false
  let line = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      header = true
      file = null
      continue
    }
    if (header) {
      if (raw.startsWith('+++ ')) file = raw.slice(4) === '/dev/null' ? null : headerPath(raw.slice(4))
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (hunk) {
        header = false
        line = Number(hunk[1])
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+')) {
      out.push({ file: file ?? '(archivo sin nombre)', line, text: raw.slice(1) })
      line++
    } else if (raw.startsWith(' ')) line++
  }
  return out
}

/**
 * The findings in some lines, and the exceptions that silenced one (for the log). `allow` is the parsed allowlist; its
 * entries without a motive are findings too (an exception says why).
 */
export function check(lines, allow = []) {
  const findings = []
  const excepted = []
  for (const entry of allow) {
    if (!entry || typeof entry.motivo !== 'string' || entry.motivo.trim() === '') {
      findings.push({
        regla: 'excepción',
        file: 'scripts/ci/privacy-allow.json',
        line: 0,
        why: 'una excepción sin motivo',
      })
    }
  }
  const valid = allow.filter((entry) => entry?.motivo?.trim())
  for (const { file, line, text } of lines) {
    const inline = new Map(
      [...text.matchAll(/privacy-allow\(([a-záéíóúñ]+)\):\s*(\S.*)$/gi)].map((match) => [
        (match[1] ?? '').toLowerCase(),
        (match[2] ?? '').trim(),
      ]),
    )
    for (const rule of RULES) {
      for (const match of text.matchAll(rule.pattern)) {
        const found = match[0]
        if (rule.allowed?.(found)) continue
        const hash = sha256(found)
        const motive =
          inline.get(rule.regla) ??
          valid.find((entry) => entry.sha256 === hash)?.motivo ??
          valid.find((entry) => entry.archivo === file && entry.regla === rule.regla)?.motivo
        if (motive) {
          excepted.push({ regla: rule.regla, file, line, motivo: motive })
          continue
        }
        findings.push({ regla: rule.regla, file, line, why: `${rule.regla} (sha256 ${hash.slice(0, 16)}…)` })
      }
    }
  }
  return { findings, excepted }
}

/** The findings alone (the tests' shorthand). */
export const findInLines = (lines, allow = []) => check(lines, allow).findings

/** The commits whose author or committer mail is not noreply. */
export function badCommits(log) {
  return log
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [sha = '', author = '', committer = ''] = row.split('\t')
      return { sha, author, committer }
    })
    .filter((commit) => !NOREPLY_COMMIT.test(commit.author) || !NOREPLY_COMMIT.test(commit.committer))
}

/** Files that, changed by a PR, change this check itself: worth a look from whoever reviews it. */
const GUARD_FILES = ['scripts/ci/privacy-check.mjs', 'scripts/ci/privacy-allow.json', '.github/workflows/ci.yml']

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help || !values.base) {
    console.log('node scripts/ci/privacy-check.mjs --base <sha> [--head <sha>]')
    return values.help ? 0 : 2
  }
  // A failed git never prints its output (it could hold the very data this protects): only what failed.
  const git = (...args) => {
    try {
      return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (error) {
      throw new Error(`git ${args[0]} falló (${error?.status ?? error?.code ?? 'sin código'})`)
    }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const allowFile = join(root, 'scripts', 'ci', 'privacy-allow.json')
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : []
  const range = `${values.base}..${values.head}`

  let failed = false
  for (const commit of badCommits(git('log', '--format=%H%x09%ae%x09%ce', range))) {
    const sides = [
      NOREPLY_COMMIT.test(commit.author) ? null : 'autor',
      NOREPLY_COMMIT.test(commit.committer) ? null : 'committer',
    ].filter(Boolean)
    console.error(`✗ commit ${commit.sha.slice(0, 7)}: ${sides.join(' y ')} con un mail que no es noreply`)
    failed = true
  }
  // The commit messages too: they are as public as the code.
  const messages = []
  for (const block of git('log', '--format=%x00%H%n%B', range).split('\0').filter(Boolean)) {
    const [sha = '', ...body] = block.split('\n')
    for (const [at, text] of body.entries()) messages.push({ file: `commit ${sha.slice(0, 7)}`, line: at + 1, text })
  }
  // `--text`: what git takes for binary (a NUL, `-diff` in .gitattributes) is checked too.
  const diff = git(
    'diff',
    '--text',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    '--no-relative',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    `${values.base}...${values.head}`,
  )
  const { findings, excepted } = check([...addedLines(diff), ...messages], allow)
  for (const finding of findings) {
    console.error(`✗ ${finding.file}:${finding.line}: ${finding.why}`)
    failed = true
  }
  for (const item of excepted) {
    console.log(`::notice title=privacidad::${item.file}:${item.line}: ${item.regla} exceptuado, «${item.motivo}»`)
  }
  const changed = git('diff', '--name-only', '--no-relative', `${values.base}...${values.head}`).split('\n')
  for (const file of GUARD_FILES.filter((guard) => changed.includes(guard))) {
    console.log(`::warning title=privacidad::este PR cambia ${file}, parte del control de privacidad`)
  }
  if (failed) {
    console.error(
      'Si es un falso positivo: `privacy-allow(<regla>): <motivo>` en la línea, o una excepción con motivo en scripts/ci/privacy-allow.json.',
    )
    return 1
  }
  console.log('Privacidad: sin mails, rutas, tokens, refs de Supabase, contraseñas, JWT ni claves en el PR.')
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : 'error'}`)
    process.exitCode = 2
  }
}
