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

## Cacería de bugs en el celu (13/10/2026)

| # | Decisión | Motivo |
|---|---|---|
| 56.8 | Textos. | M. |
`

const pending = (name, section, rows) => parsePending(name, `---\nseccion: ${section}\n---\n${rows.join('\n')}\n`)

describe('decisiones pendientes (docs/REVISION.md)', () => {
  it('an existing section: after its last row, with the next number of its block in the whole file', () => {
    const { text, applied } = applyPending(DECISIONES, [
      pending('lab-x.md', 'Fase 42, laboratorio (9/10/2026)', ['| **Nueva** del lab. | Motivo nuevo. |']),
    ])
    // Block 45 goes up to 45.57 in another section: the new row is 45.58, right after 45.19.
    assert.match(
      text,
      /\| 45\.19 \| Otra\. \| M\. \|\n\| 45\.58 \| \*\*Nueva\*\* del lab\. \| Motivo nuevo\. \|\n\n## Fase 42, infraestructura/,
    )
    assert.deepEqual(applied, [
      { name: 'lab-x.md', section: 'Fase 42, laboratorio (9/10/2026)', created: false, from: '45.58', to: '45.58' },
    ])
    // Nothing else moved.
    assert.equal(text.replace('| 45.58 | **Nueva** del lab. | Motivo nuevo. |\n', ''), DECISIONES)
  })

  it('a new section: at the end, with the next block from .1', () => {
    const { text, applied } = applyPending(DECISIONES, [
      pending('flujo.md', 'Organización de las sesiones (D-021)', ['| Una. | A. |', '| Dos. | B. |']),
    ])
    assert.ok(
      text.endsWith(
        '## Organización de las sesiones (D-021)\n\n| # | Decisión | Motivo |\n|---|---|---|\n| 57.1 | Una. | A. |\n| 57.2 | Dos. | B. |\n',
      ),
    )
    assert.equal(applied[0]?.created, true)
    assert.equal(`${applied[0]?.from}–${applied[0]?.to}`, '57.1–57.2')
  })

  it('two pendings of one section, numbered one after the other in their order', () => {
    const { text } = applyPending(DECISIONES, [
      pending('a.md', 'Cacería de bugs en el celu (13/10/2026)', ['| A1. | m. |', '| A2. | m. |']),
      pending('b.md', 'Cacería de bugs en el celu (13/10/2026)', ['| B1. | m. |']),
    ])
    assert.match(
      text,
      /\| 56\.8 \| Textos\. \| M\. \|\n\| 56\.9 \| A1\. \| m\. \|\n\| 56\.10 \| A2\. \| m\. \|\n\| 56\.11 \| B1\. \| m\. \|\n$/,
    )
  })

  it('a new section, then a pending for it: the second one continues the new block', () => {
    const { text } = applyPending(DECISIONES, [
      pending('a.md', 'Nueva', ['| Uno. | m. |']),
      pending('b.md', 'Nueva', ['| Dos. | m. |']),
    ])
    assert.match(text, /\| 57\.1 \| Uno\. \| m\. \|\n\| 57\.2 \| Dos\. \| m\. \|\n$/)
    assert.equal(text.match(/## Nueva/g)?.length, 1)
  })

  it('keeps CRLF files CRLF', () => {
    const { text } = applyPending(DECISIONES.replace(/\n/g, '\r\n'), [pending('a.md', 'Nueva', ['| Uno. | m. |'])])
    assert.ok(!/[^\r]\n/.test(text))
  })

  it('refuses a pending without a section, without rows, or with a numbered row; skips headers and separators', () => {
    assert.match(parsePending('x.md', '| a | b |\n').error ?? '', /frontmatter/)
    assert.match(parsePending('x.md', '---\nautor: x\n---\n| a | b |\n').error ?? '', /seccion/)
    assert.match(parsePending('x.md', '---\nseccion: S\n---\nNada.\n').error ?? '', /no tiene filas/)
    assert.match(parsePending('x.md', '---\nseccion: S\n---\n| 45.3 | a | b |\n').error ?? '', /ya tiene número/)
    const ok = parsePending('x.md', '---\r\nseccion: "S"\r\n---\r\n| Decisión | Motivo |\r\n|---|---|\r\n| a | b |\r\n')
    assert.deepEqual(ok, { name: 'x.md', section: 'S', rows: ['| a | b |'] })
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
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('one broken pending stops all of them', () => {
    const root = repo()
    try {
      const folder = join(root, 'docs', 'decisiones', 'pendientes')
      writeFileSync(join(folder, 'a.md'), '---\nseccion: S\n---\n| Bien. | m. |\n')
      writeFileSync(join(folder, 'b.md'), '---\nseccion: S\n---\n| 45.1 | Mal. | m. |\n')
      assert.throws(
        () => run(root),
        (error) => /b\.md: una fila ya tiene número/.test(String(error.stderr)),
      )
      assert.equal(readFileSync(join(root, 'docs', 'DECISIONES.md'), 'utf8'), DECISIONES)
      assert.ok(existsSync(join(folder, 'a.md')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
