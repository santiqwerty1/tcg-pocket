import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADVISORY_LOCKS, ADVISORY_PAIR_LOCKS } from './advisory-locks.js'

const SRC = join(import.meta.dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sources(path)
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })
}

const number = (text: string) => Number(text.replace(/_/g, ''))

describe('advisory lock keys', () => {
  it('are unique within each key space', () => {
    const single = Object.values(ADVISORY_LOCKS)
    const pairs = Object.values(ADVISORY_PAIR_LOCKS)
    expect(new Set(single).size).toBe(single.length)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('every key the code declares or writes is in the list, and no two declarations share one', () => {
    const known = new Set<number>([...Object.values(ADVISORY_LOCKS), ...Object.values(ADVISORY_PAIR_LOCKS)])
    const declared = new Map<number, string>()
    const missing: string[] = []
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8')
      const where = file.slice(SRC.length + 1)
      for (const match of text.matchAll(/pg_(?:try_)?advisory_(?:xact_)?(?:un)?lock\(\s*([0-9][0-9_]*)/g)) {
        const key = number(match[1] ?? '')
        if (!known.has(key)) missing.push(`${where}: ${key}`)
      }
      for (const match of text.matchAll(/const\s+([A-Z_]*LOCK(?:_KEY)?)\s*=\s*([0-9][0-9_]*)\b/g)) {
        const key = number(match[2] ?? '')
        if (!known.has(key)) missing.push(`${where}: ${match[1]} = ${key}`)
        const other = declared.get(key)
        if (other) missing.push(`${where}: ${match[1]} repeats ${other}`)
        declared.set(key, `${where}: ${match[1]}`)
      }
    }
    expect(missing).toEqual([])
  })
})
