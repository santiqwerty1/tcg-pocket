// node --test scripts/decisiones.test.mjs — the numbering of the pending decisions (docs/REVISION.md).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyPending, parsePending } from './decisiones.mjs'

const SCRIPT = fileURLToPath(new URL('./decisiones.mjs', import.meta.url))

/** A DECISIONES like the real one: blocks 40 and 45 shared by two sections, the newest block 56. */
const DECISIONES = `# Decisiones

## Aprobadas por Santi (PLAN §8 bloque A)

| # | Decisión | Respuesta |
|---|---|---|
| A.1 | Hosting. | Fly. |

## Fase 37: números honestos (9/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 40.1 | Primera. | Porque sí. |
| 40.2 | Segunda. | Porque también. |

## Fase 37, laboratorio (9/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 40.20 | Del laboratorio. | Motivo. |

## Fase 42, laboratorio (9/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 45.1 | Una. | M. |
| 45.19 | Otra. | M. |

## Fase 42, infraestructura (9/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 45.20 | Infra. | M. |
| 45.57 | Infra última. | M. |

## Sin tabla todavía

Un párrafo.

## Cacería de bugs en el celu (13/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 56.8 | Textos. | M. |
`

const pending = (name, section, rows, extra = '') =>
  parsePending(name, `---\nseccion: ${section}\n${extra}---\n${rows.join('\n')}\n`)
const apply = (...pendings) => applyPending(DECISIONES, pendings)

describe('decisiones pendientes (docs/REVISION.md)', () => {
  it('an existing section: after its last row, with the next number of its block in the whole file', () => {
    const { text, applied, errors } = apply(
      pending('lab-x.md', 'Fase 42, laboratorio (9/10/2026)', ['| **Nueva** del lab. | Motivo nuevo. |']),
    )
    assert.deepEqual(errors, [])
    // Block 45 goes up to 45.57 in another section: the new row is 45.58, right after 45.19.
    assert.match(
      text,
      /\| 45\.19 \| Otra\. \| M\. \|\n\| 45\.58 \| \*\*Nueva\*\* del lab\. \| Motivo nuevo\. \|\n\n## Fase 42, infraestructura/,
    )
    assert.deepEqual(applied, [
      {
        name: 'lab-x.md',
        section: 'Fase 42, laboratorio (9/10/2026)',
        created: false,
        similar: [],
        from: '45.58',
        to: '45.58',
      },
    ])
    // Nothing else moved.
    assert.equal(text.replace('| 45.58 | **Nueva** del lab. | Motivo nuevo. |\n', ''), DECISIONES)
  })

  it('a new section only with `nueva: true`: at the end, one blank line before it, the next block from .1', () => {
    const { text, applied } = apply(
      pending('flujo.md', 'Organización de las sesiones (D-021)', ['| Una. | A. |', '| Dos. | B. |'], 'nueva: true\n'),
    )
    assert.equal(
      text,
      `${DECISIONES}\n## Organización de las sesiones (D-021)\n\n| # | Decisión | Motivo |\n|---|---|---|\n| 57.1 | Una. | A. |\n| 57.2 | Dos. | B. |\n`,
    )
    assert.equal(applied[0]?.created, true)
    // A new section that looks like an existing one is created (it was asked for), and said.
    const near = apply(pending('x.md', 'Fase 42, laboratorio', ['| Una. | m. |'], 'nueva: true\n'))
    assert.deepEqual(near.applied?.[0]?.similar, ['Fase 42, laboratorio (9/10/2026)'])
    // `nueva: true` on a section that exists only adds rows: the order of the pendings does not matter.
    const existing = apply(pending('x.md', 'Fase 42, laboratorio (9/10/2026)', ['| Una. | m. |'], 'nueva: true\n'))
    assert.equal(existing.applied?.[0]?.created, false)
  })

  it('a title that is not exact creates nothing: it fails and says which section looks like it', () => {
    for (const title of [
      'Fase 42, laboratorio',
      'fase 42, LABORATORIO (9/10/2026)',
      '## Fase 42, laboratorio (9/10/2026)',
    ]) {
      const { errors } = apply(pending('x.md', title, ['| Una. | m. |']))
      assert.match(errors[0] ?? '', /¿quisiste decir «Fase 42, laboratorio \(9\/10\/2026\)»/, title)
    }
    const { errors } = apply(pending('x.md', 'Algo que no existe', ['| Una. | m. |']))
    assert.match(errors[0] ?? '', /para crearla, `nueva: true`/)
    // Spaces do not matter.
    assert.deepEqual(apply(pending('x.md', 'Cacería  de bugs en el celu  (13/10/2026)', ['| Una. | m. |'])).errors, [])
  })

  it('a section without a numbered table gets one at its end; a table that is not of decisions is refused', () => {
    const { text } = apply(pending('x.md', 'Sin tabla todavía', ['| Una. | m. |']))
    assert.match(
      text,
      /## Sin tabla todavía\n\nUn párrafo\.\n\n\| # \| Decisión \| Motivo \|\n\|---\|---\|---\|\n\| 57\.1 \| Una\. \| m\. \|\n\n## Cacería/,
    )
    const { errors } = apply(pending('x.md', 'Aprobadas por Santi (PLAN §8 bloque A)', ['| Una. | m. |']))
    assert.match(errors[0] ?? '', /no es de decisiones/)
  })

  it('two pendings of one section, one after the other; a new section and then one for it', () => {
    const one = apply(
      pending('a.md', 'Cacería de bugs en el celu (13/10/2026)', ['| A1. | m. |', '| A2. | m. |']),
      pending('b.md', 'Cacería de bugs en el celu (13/10/2026)', ['| B1. | m. |']),
    )
    assert.match(
      one.text,
      /\| 56\.8 \| Textos\. \| M\. \|\n\| 56\.9 \| A1\. \| m\. \|\n\| 56\.10 \| A2\. \| m\. \|\n\| 56\.11 \| B1\. \| m\. \|\n$/,
    )
    const two = apply(
      pending('a.md', 'Nueva', ['| Uno. | m. |'], 'nueva: true\n'),
      pending('b.md', 'Nueva', ['| Dos. | m. |']),
    )
    assert.match(two.text, /\| 57\.1 \| Uno\. \| m\. \|\n\| 57\.2 \| Dos\. \| m\. \|\n$/)
    assert.equal(two.text.match(/## Nueva/g)?.length, 1)
  })

  it('never applies a row twice: one already in DECISIONES is refused, with its whole pending', () => {
    const { errors } = apply(pending('again.md', 'Fase 42, laboratorio (9/10/2026)', ['| Otra. | M. |']))
    assert.match(errors[0] ?? '', /ya están en DECISIONES/)
    const twice = apply(
      pending('a.md', 'Fase 42, laboratorio (9/10/2026)', ['| Nueva. | M. |']),
      pending('b.md', 'Fase 42, laboratorio (9/10/2026)', ['| Nueva. | M. |']),
    )
    assert.match(twice.errors[0] ?? '', /^b\.md: .*ya están en DECISIONES/)
    // Twice in the same pending.
    const same = apply(pending('a.md', 'Fase 42, laboratorio (9/10/2026)', ['| Nueva. | M. |', '| Nueva. | M. |']))
    assert.match(same.errors[0] ?? '', /^a\.md: 1 fila\(s\) ya están/)
  })

  it('a code block or a repeated title do not fool it', () => {
    const fenced = DECISIONES.replace('Un párrafo.', 'Un párrafo.\n\n```\n## Falsa\n| 99.1 | x | y |\n```')
    const { text } = applyPending(fenced, [pending('x.md', 'Nueva', ['| Uno. | m. |'], 'nueva: true\n')])
    assert.match(text, /\| 57\.1 \| Uno\./)
    const twice = `${DECISIONES}\n## Fase 42, laboratorio (9/10/2026)\n\n| # | Decisión | Motivo |\n|---|---|---|\n| 45.60 | x | y |\n`
    assert.match(
      applyPending(twice, [pending('x.md', 'Fase 42, laboratorio (9/10/2026)', ['| a | b |'])]).errors[0] ?? '',
      /hay 2 secciones/,
    )
  })

  it('keeps a CRLF file CRLF, line by line', () => {
    const crlf = DECISIONES.replace(/\n/g, '\r\n')
    const { text } = applyPending(crlf, [pending('a.md', 'Cacería de bugs en el celu (13/10/2026)', ['| Uno. | m. |'])])
    assert.equal(text, `${crlf}| 56.9 | Uno. | m. |\r\n`)
    assert.ok(!/\r\r/.test(text) && !/[^\r]\n/.test(text))
  })
})

describe('reading a pending', () => {
  it('section and rows; a header and its separator are skipped; a BOM, CRLF and quotes are fine', () => {
    const ok = parsePending('x.md', '﻿---\r\nseccion: "S"\r\n---\r\n| Qué | Por qué |\r\n|---|---|\r\n| a | b |\r\n')
    assert.deepEqual(ok, { name: 'x.md', section: 'S', create: false, rows: ['| a | b |'] })
    assert.equal(parsePending('x.md', '---\nseccion: S\nnueva: true\n---\n| a | b |\n').create, true)
    assert.deepEqual(parsePending('x.md', '---\nseccion: S\n---\n| `a \\| b` | c |\n').rows, ['| `a \\| b` | c |'])
    // The usual header without its separator is not a decision.
    assert.deepEqual(parsePending('x.md', '---\nseccion: S\n---\n| Decisión | Motivo |\n| a | b |\n').rows, [
      '| a | b |',
    ])
  })

  it('refuses what is not two cells with text, a numbered row, prose, or an empty or folded section', () => {
    const error = (text) => parsePending('x.md', text).error ?? ''
    assert.match(error('| a | b |\n'), /frontmatter/)
    assert.match(error('---\nautor: x\n---\n| a | b |\n'), /seccion/)
    assert.match(error('---\nseccion:\nrama: x\n---\n| a | b |\n'), /seccion.*vacío/)
    assert.match(error('---\nseccion: >\n  Larga\n---\n| a | b |\n'), /una sola línea/)
    assert.match(error('---\nseccion: |-\n  Larga\n---\n| a | b |\n'), /una sola línea/)
    assert.match(error('---\nseccion: S\n---\nNada.\n'), /no es una fila/)
    assert.match(error('---\nseccion: S\n---\n\n'), /no tiene filas/)
    assert.match(error('---\nseccion: S\n---\n| 45.3 | a | b |\n'), /ya tiene número/)
    assert.match(error('---\nseccion: S\n---\n| a | b\n'), /no termina en/)
    assert.match(error('---\nseccion: S\n---\n| — | a | b |\n'), /dos celdas/)
    assert.match(error('---\nseccion: S\n---\n| `a | b` | c |\n'), /dos celdas/)
    assert.match(error('---\nseccion: S\n---\n| a |  |\n'), /dos celdas con texto/)
    assert.match(error('---\nseccion: S\n---\n| a | b |\n> | c | d |\n'), /no es una fila/)
  })
})

describe('the command', () => {
  function repo() {
    const root = mkdtempSync(join(tmpdir(), 'decisiones-'))
    mkdirSync(join(root, 'docs', 'decisiones', 'pendientes'), { recursive: true })
    writeFileSync(join(root, 'docs', 'DECISIONES.md'), DECISIONES)
    writeFileSync(join(root, 'docs', 'decisiones', 'pendientes', 'LEEME.md'), '# Decisiones pendientes de numerar\n')
    return root
  }
  const run = (root, ...args) =>
    execFileSync(process.execPath, [SCRIPT, '--root', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  it('--check says what it would do and changes nothing; without it, applies and deletes the pendings, not LEEME', () => {
    const root = repo()
    try {
      const pendingFile = join(root, 'docs', 'decisiones', 'pendientes', 'qa-x.md')
      writeFileSync(pendingFile, '---\nseccion: Cacería de bugs en el celu (13/10/2026)\n---\n| Una. | m. |\n')
      assert.match(run(root, '--check'), /qa-x\.md → «Cacería de bugs en el celu \(13\/10\/2026\)»: 56\.9/)
      assert.equal(readFileSync(join(root, 'docs', 'DECISIONES.md'), 'utf8'), DECISIONES)
      assert.ok(existsSync(pendingFile))
      run(root)
      assert.match(readFileSync(join(root, 'docs', 'DECISIONES.md'), 'utf8'), /\| 56\.9 \| Una\. \| m\. \|/)
      assert.ok(!existsSync(pendingFile))
      assert.ok(existsSync(join(root, 'docs', 'decisiones', 'pendientes', 'LEEME.md')))
      assert.match(run(root), /No hay decisiones pendientes/)
      // The same pending again (a failed delete, a merge that brings it back): refused, not applied twice.
      writeFileSync(pendingFile, '---\nseccion: Cacería de bugs en el celu (13/10/2026)\n---\n| Una. | m. |\n')
      assert.throws(
        () => run(root),
        (error) => /ya están en DECISIONES/.test(String(error.stderr)),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('one broken pending stops all of them, also with --check', () => {
    const root = repo()
    try {
      const folder = join(root, 'docs', 'decisiones', 'pendientes')
      writeFileSync(
        join(folder, 'a.md'),
        '---\nseccion: Cacería de bugs en el celu (13/10/2026)\n---\n| Bien. | m. |\n',
      )
      writeFileSync(join(folder, 'b.md'), '---\nseccion: S\n---\n| 45.1 | Mal. | m. |\n')
      for (const args of [['--check'], []]) {
        assert.throws(
          () => run(root, ...args),
          (error) => /b\.md: una fila ya tiene número/.test(String(error.stderr)),
        )
      }
      assert.equal(readFileSync(join(root, 'docs', 'DECISIONES.md'), 'utf8'), DECISIONES)
      assert.ok(existsSync(join(folder, 'a.md')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a --root without DECISIONES is an error, not «nothing to do»', () => {
    const root = mkdtempSync(join(tmpdir(), 'decisiones-'))
    try {
      assert.throws(
        () => run(join(root, 'no-existe')),
        (error) => /No encuentro/.test(String(error.stderr)),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
