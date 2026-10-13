#!/usr/bin/env node
// El repo es público (D-022). En cada PR y en cada push a main, la CI (job `privacy`) falla si:
// - algún commit del PR tiene autor o committer con un mail que no es noreply (`*@users.noreply.github.com`,
//   `noreply@github.com`, o `noreply@anthropic.com` de las sesiones en la nube);
// - lo que agrega cualquiera de sus commits (uno por uno: lo que un commit agrega y otro borra queda igual en la
//   historia), los nombres de los archivos que agrega, los mensajes de los commits o el título y el cuerpo del PR traen
//   mails que no son noreply ni de dominios reservados para ejemplos (example.com, .test, .invalid, .internal…), rutas
//   `C:/Users/<usuario>` (o con `\`, `/c/Users/<usuario>`, `/mnt/c/…`, `\Users\<usuario>`) con un nombre que no es un
//   marcador, tokens de la app (`tcg_mcp_`, `tcg_wk_`, `tcg_rl_` con su parte secreta), refs de Supabase
//   (`<ref>.supabase.co`, el usuario `postgres.<ref>` del pooler, `--project-ref`, el panel del proyecto), una URL de
//   Postgres con contraseña a un host que no es local, tokens de GitHub, Fly, Tigris, AWS o Anthropic, la cookie de
//   sesión, un secreto del entorno con su valor, JWT o claves privadas (PEM, PGP, PuTTY).
// No guarda ningún dato real para buscarlo: son formas, no valores. Nunca imprime lo que encontró: el archivo o el
// commit, la línea, la regla y un prefijo del sha256.
//
// Excepciones para falsos positivos, siempre con la regla y un motivo:
// - en la misma línea, `privacy-allow(<regla>): <motivo>` (solo esa regla, en esa línea);
// - en scripts/ci/privacy-allow.json, `{ "sha256": "<sha256 del texto encontrado>", "motivo": "…" }` (el texto mismo no
//   va: si fuera un dato real, quedaría publicado) o `{ "archivo": "<ruta>", "regla": "<regla>", "motivo": "…" }`. Por
//   sha256, solo para valores que ya son públicos: el hash de un mail o de un valor corto se adivina probando.
// Cada excepción usada queda en el log de la CI (`::notice`), y un PR que toca este control lo avisa (`::warning`).
//
//   node scripts/ci/privacy-check.mjs --base <sha> [--head <sha>] [--texto <archivo con el título y el cuerpo del PR>]
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
/** The words a placeholder for a user name may hold (a real name between brackets, «<jperez>», is not one). */
const USER_WORD =
  '(?:usuario|tu-?usuario|nombre(?:-de-usuario)?|user(?:name)?|your-?(?:user(?:name)?|name)|name|me|yo|…+|\\.\\.\\.)'
/**
 * Placeholders for a user name in a path: `<usuario>`, `{usuario}`, `%USERNAME%`, `$USER`, `${USER}`, `$env:USERNAME`,
 * `…`, and Windows' own folders («All Users» stops at its space).
 */
const PATH_PLACEHOLDER = new RegExp(
  `^(?:<${USER_WORD}>|\\{${USER_WORD}\\}|%${USER_WORD}%|\\$${USER_WORD}|\\$\\{${USER_WORD}\\}|\\$env:${USER_WORD}|\\$\\{env:${USER_WORD}\\}|…+|\\.\\.\\.|Public|Default|All|runneradmin)$`,
  'i',
)
/** A password that is not one: `<clave>`, `${PGPASSWORD}`, `$PGPASSWORD`, `%PGPASSWORD%`, `{clave}`, `…`, `***`. */
const PASSWORD_PLACEHOLDER =
  /^(?:<[^>]+>|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_]+%|\{[^}]+\}|…+|\.\.\.|\*+)$/
/**
 * Whole words of a value written for tests or examples («ci-session-secret-…», «replace-with-…»), between «-», «_» or
 * «.»: never part of a word, so a random value that happens to hold «dev» or «test» is still checked.
 */
const PLACEHOLDER_WORD =
  /^(?:replace|change|changeme|example|ejemplo|test|testing|ci|dev|local|secret|session|pantallas|dummy|fake|placeholder|x{4,})$/i
const isPlaceholderValue = (value) => value.split(/[-_.]/).some((word) => PLACEHOLDER_WORD.test(word))

/** The user name of a `…Users…<nombre>` path. */
const userOf = (text) => /Users(?:\\{1,4}|\/{1,2})(.+)$/i.exec(text)?.[1] ?? ''

/** Shannon entropy in bits per character: random keys are near 4 (hex) to 6, words and repeated text under 3. */
function entropy(text) {
  const counts = new Map()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) bits -= (count / text.length) * Math.log2(count / text.length)
  return bits
}

/** What the diff and the commit messages may not add. Each finding names its rule, so an exception can name it too. */
export const RULES = [
  {
    regla: 'mail',
    // Also URL-encoded («nombre%40example.com»).
    pattern: /[A-Za-z0-9._%+-]+?(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allowed: (text) => {
      const [local = '', domain = ''] = text.toLowerCase().replace('%40', '@').split('@')
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
  // With a drive (or Git Bash's `/c/`, WSL's `/mnt/c/`), in any case; from one to four backslashes (JSON escaped twice).
  {
    regla: 'ruta',
    pattern: /(?:[A-Za-z]:|\/(?:mnt\/)?[a-z])(?:\\{1,4}|\/{1,2})Users(?:\\{1,4}|\/{1,2})([^\\/\s'"`|«»,;]+)/gi,
    allowed: (text) => PATH_PLACEHOLDER.test(userOf(text)),
  },
  // Without a drive («\Users\<nombre>», macOS's «/Users/<nombre>»): only «Users» as Windows and macOS write it, so a
  // route like «'/users/' + id» is not one.
  {
    regla: 'ruta',
    pattern: /(?<![\w.$%~:/\\-])(?:\\{1,4}|\/{1,2})Users(?:\\{1,4}|\/{1,2})([^\\/\s'"`|«»,;]+)/g,
    allowed: (text) => PATH_PLACEHOLDER.test(userOf(text)),
  },
  // Without a leading \b: «Bearer%20tcg_mcp_…» and «\ntcg_mcp_…» count too; the prefix is specific enough.
  { regla: 'token', pattern: /tcg_(?:mcp|wk|rl)_[A-Za-z0-9_-]{20,}/g },
  {
    regla: 'supabase',
    pattern: /\b[a-z0-9-]+\.supabase\.(?:co|in)\b|(?:app\.)?supabase\.com\/(?:dashboard\/)?project\/[a-z0-9]+/gi,
  },
  // The pooler's user, `postgres.<ref>`, and a ref given alone (`--project-ref <ref>`): the ref is 20 lowercase
  // characters, so «postgres.transactionIsolation» is not one.
  {
    regla: 'supabase',
    pattern: /\bpostgres\.[a-z0-9]{20}\b|(?:--project-ref|project[_-]?[Rr]ef)["'\s=:]+[a-z0-9]{20}\b/g,
  },
  {
    regla: 'postgres',
    pattern: /postgres(?:ql)?:\/\/[^\s:@/'"`]+:[^\s@/'"`]+@([^\s:/'"`?]+)/gi,
    allowed: (text) => {
      const [, password = '', host = ''] = /:\/\/[^:]+:([^@]+)@(.+)$/.exec(text) ?? []
      return LOCAL_HOST.test(host) || PASSWORD_PLACEHOLDER.test(password)
    },
  },
  {
    regla: 'secreto',
    pattern:
      // No leading \b either («xghp_…»): the prefixes and their lengths are specific enough. AKIA/ASIA: AWS-style key
      // ids; sk-ant-: an Anthropic key; __Host-session: the app's session cookie with its value.
      /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|FlyV1 [A-Za-z0-9_+/=,-]{20,}|fm[12]_[A-Za-z0-9_+/=-]{20,}|tsec_[A-Za-z0-9_+/=-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|A[KS]IA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|__Host-session=[A-Za-z0-9%._~+/=-]{20,})/g,
  },
  // A secret of the app's environment written with its value; test and example values say so, or are not random.
  {
    regla: 'secreto',
    pattern:
      /\b(?:SESSION_SECRET|session_?[Ss]ecret|VAPID_PRIVATE_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|TCG_WORKER_TOKEN)["']?\s*[=:]\s*["']?[A-Za-z0-9+/_=.-]{20,}/g,
    allowed: (text) => {
      const value = /[=:]\s*["']?([A-Za-z0-9+/_=.-]+)$/.exec(text)?.[1] ?? ''
      // 3,0: a random hex key is near 4 bits per character, so it is still caught.
      return isPlaceholderValue(value) || entropy(value) < 3
    },
  },
  { regla: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    regla: 'clave',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|PuTTY-User-Key-File-\d/g,
  },
]

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A text for the log with whatever a rule would find in it covered: a motive may quote what it excepts. */
export const masked = (text) =>
  RULES.reduce((out, rule) => out.replace(rule.pattern, `[${rule.regla}]`), text).slice(0, 200)

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
  const hasMotive = (entry) => typeof entry?.motivo === 'string' && entry.motivo.trim() !== ''
  for (const entry of allow) {
    if (!hasMotive(entry)) {
      findings.push({
        regla: 'excepción',
        file: 'scripts/ci/privacy-allow.json',
        line: 0,
        why: 'una excepción sin motivo',
      })
    }
  }
  const valid = allow.filter(hasMotive)
  for (const { file, line, text, commit } of lines) {
    // Each marker's motive ends where the next marker starts: two on one line except two rules.
    const inline = new Map(
      [...text.matchAll(/privacy-allow\(([a-záéíóúñ]+)\):\s*(\S.*?)(?=\s*privacy-allow\(|\s*$)/gi)].map((match) => [
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
          excepted.push({ regla: rule.regla, file, line, ...(commit ? { commit } : {}), motivo: motive })
          continue
        }
        findings.push({
          regla: rule.regla,
          file,
          line,
          ...(commit ? { commit } : {}),
          why: `${rule.regla} (sha256 ${hash.slice(0, 16)}…)`,
        })
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
      texto: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help || !values.base) {
    console.log('node scripts/ci/privacy-check.mjs --base <sha> [--head <sha>] [--texto <título y cuerpo del PR>]')
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
  if (!Array.isArray(allow)) throw new Error('scripts/ci/privacy-allow.json tiene que ser una lista de excepciones')
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
  // Commit by commit, not the net diff: a secret one commit adds and the next removes stays in the history the merge
  // publishes. One git call per commit, never one output split by a separator: a NUL inside a file (a binary
  // committed by mistake) would cut it and hide what follows. Merges inside the PR, by what their resolution adds
  // (`--remerge-diff`). `--text`: what git takes for binary (a NUL, `-diff` in .gitattributes) is checked too; a
  // textconv set up on a PC would show its conversion.
  const diffOptions = [
    '--text',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    '--src-prefix=a/',
    '--dst-prefix=b/',
  ]
  const merges = new Set(git('rev-list', '--merges', range).split('\n').filter(Boolean))
  const added = []
  const names = []
  const messages = []
  for (const sha of git('rev-list', '--reverse', range).split('\n').filter(Boolean)) {
    const commit = sha.slice(0, 7)
    const diff = merges.has(sha)
      ? git('show', '--remerge-diff', '--patch', '--format=', ...diffOptions, sha)
      : git('diff-tree', '--patch', '--root', '--no-commit-id', ...diffOptions, sha)
    for (const item of addedLines(diff)) added.push({ ...item, commit })
    // The names of the files it adds or renames (a file named after a mail), never printed.
    if (!merges.has(sha)) {
      const files = git('diff-tree', '-r', '--root', '--no-commit-id', '--name-only', '--diff-filter=AR', sha)
      for (const name of files.split('\n').filter(Boolean)) {
        names.push({ file: 'el nombre de un archivo', line: 0, text: name, commit })
      }
    }
    // Its message too: it is as public as the code.
    for (const [at, text] of git('show', '-s', '--format=%B', sha).split('\n').entries()) {
      messages.push({ file: `commit ${commit}`, line: at + 1, text })
    }
  }
  // The PR's title and body, when the CI passes them.
  const texts = values.texto
    ? readFileSync(values.texto, 'utf8')
        .split('\n')
        .map((text, at) => ({ file: 'la descripción del PR', line: at + 1, text }))
    : []
  const { findings, excepted } = check([...added, ...names, ...messages, ...texts], allow)
  const where = (item) => `${masked(item.file)}:${item.line}${item.commit ? ` (commit ${item.commit})` : ''}`
  for (const finding of findings) {
    console.error(`✗ ${where(finding)}: ${finding.why}`)
    failed = true
  }
  for (const item of excepted) {
    console.log(`::notice title=privacidad::${where(item)}: ${item.regla} exceptuado, «${masked(item.motivo)}»`)
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
